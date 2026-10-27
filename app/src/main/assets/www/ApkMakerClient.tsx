'use client';

import { useState } from 'react';

const D = 'font-[family-name:Sora,ui-sans-serif,system-ui,sans-serif]';
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8C9AFF]';
const CARD = 'rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl';
const BTN = `rounded-xl bg-gradient-to-r from-[#4F63FF] to-[#8B5CF6] px-6 py-3.5 text-sm font-semibold text-white shadow-lg transition-all hover:opacity-90 disabled:opacity-40 ${FOCUS}`;
const INPUT = 'w-full rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-[#6B7790] outline-none focus:border-[#8C9AFF]';
const LABEL = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#9AA6BF]';

const GITHUB_YML = `name: Build signed APK
on:
  push:
    branches: [main, master]
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: '8.7'
      - name: Prepare signing key
        run: |
          mkdir -p signing
          KS_PASS=$(openssl rand -hex 16)
          KEY_ALIAS=release
          keytool -genkeypair -v -keystore signing/release.jks -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=App Owner, O=App, C=US"
          echo "KEYSTORE_PATH=$GITHUB_WORKSPACE/signing/release.jks" >> "$GITHUB_ENV"
          echo "KS_PASS=$KS_PASS" >> "$GITHUB_ENV"
          echo "KEY_ALIAS=$KEY_ALIAS" >> "$GITHUB_ENV"
      - name: Build release APK
        run: gradle :app:assembleRelease --no-daemon
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: signed-apk
          path: app/build/outputs/apk/release/*.apk`;

function mainActivity(pkg: string): string {
  return `package ${pkg}

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.webViewClient = WebViewClient()
        // Loads the local HTML5 game
        webView.loadUrl("file:///android_asset/www/index.html")
    }
}`;
}

export default function ApkMakerClient() {
  const [files, setFiles] = useState<File[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [pkg, setPkg] = useState('');
  
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(Array.from(e.target.files));
  };
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setLogoFile(e.target.files[0]);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(GITHUB_YML);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  async function build() {
    setError(''); setDone(false);
    
    if (!name.trim()) return setError('Enter an app name.');
    if (!pkg.trim()) return setError('Enter a package name (e.g., com.yourname.game).');
    if (files.length === 0) return setError('Please upload your game files or a ZIP file.');

    const isZip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip');
    if (!isZip) {
      const hasIndex = files.some(f => f.name.toLowerCase() === 'index.html');
      if (!hasIndex) return setError('Your files must include an "index.html" file to run the game.');
    }

    setBusy(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      
      let gameFiles: { name: string, file: File | Blob }[] = [];
      
      if (isZip) {
        const loadedZip = await JSZip.loadAsync(files[0]);
        for (const [relativePath, zipEntry] of Object.entries(loadedZip.files)) {
          if (!zipEntry.dir) {
            const blob = await zipEntry.async('blob');
            gameFiles.push({ name: relativePath, file: blob });
          }
        }
      } else {
        gameFiles = files.map(f => ({ name: f.name, file: f }));
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'android-game';
      const root = zip.folder(slug)!;

      // 1. Gradle Files
      root.file('settings.gradle.kts', `pluginManagement {\n    repositories { google(); mavenCentral(); gradlePluginPortal() }\n}\ndependencyResolutionManagement {\n    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)\n    repositories { google(); mavenCentral() }\n}\nrootProject.name = "${name}"\ninclude(":app")`);

      root.file('build.gradle.kts', `plugins {\n    id("com.android.application") version "8.5.2" apply false\n    id("org.jetbrains.kotlin.android") version "1.9.24" apply false\n}`);

      root.file('gradle.properties', `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nandroid.nonTransitiveRClass=true\nkotlin.code.style=official`);

      // 2. App Gradle
      root.file('app/build.gradle.kts', `plugins {\n    id("com.android.application")\n    id("org.jetbrains.kotlin.android")\n}\nandroid {\n    namespace = "${pkg}"\n    compileSdk = 34\n    defaultConfig {\n        applicationId = "${pkg}"\n        minSdk = 24\n        targetSdk = 34\n        versionCode = 1\n        versionName = "1.0.0"\n    }\n    signingConfigs {\n        create("release") {\n            val ksPath = System.getenv("KEYSTORE_PATH")\n            if (ksPath != null) {\n                storeFile = file(ksPath)\n                storePassword = System.getenv("KS_PASS")\n                keyAlias = System.getenv("KEY_ALIAS")\n                keyPassword = System.getenv("KS_PASS")\n            }\n        }\n    }\n    buildTypes {\n        release {\n            isMinifyEnabled = false\n            if (System.getenv("KEYSTORE_PATH") != null) {\n                signingConfig = signingConfigs.getByName("release")\n            }\n        }\n    }\n    compileOptions {\n        sourceCompatibility = JavaVersion.VERSION_17\n        targetCompatibility = JavaVersion.VERSION_17\n    }\n    kotlinOptions { jvmTarget = "17" }\n}\ndependencies {\n    implementation("androidx.appcompat:appcompat:1.7.0")\n}`);

      // 3. Manifest
      root.file('app/src/main/AndroidManifest.xml', `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <uses-permission android:name="android.permission.INTERNET" />\n    <application\n        android:allowBackup="true"\n        android:icon="@mipmap/ic_launcher"\n        android:label="@string/app_name"\n        android:theme="@style/Theme.AppCompat.NoActionBar"\n        android:hardwareAccelerated="true"\n        android:usesCleartextTraffic="true">\n        <activity android:name=".MainActivity" android:exported="true" android:configChanges="orientation|screenSize|keyboardHidden">\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n        </activity>\n    </application>\n</manifest>`);

      // 4. MainActivity
      root.file(`app/src/main/java/${pkg.split('.').join('/')}/MainActivity.kt`, mainActivity(pkg));

      // 5. Strings
      root.file('app/src/main/res/values/strings.xml', `<resources>\n    <string name="app_name">${name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>\n</resources>`);

      // 6. Insert Game Files into `assets/www`
      for (const gFile of gameFiles) {
        root.file('app/src/main/assets/www/' + gFile.name, gFile.file);
      }

      // 7. Generate Icons (Logo or Text fallback)
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const densities = [
        { dpi: 'mdpi', size: 48 },
        { dpi: 'hdpi', size: 72 },
        { dpi: 'xhdpi', size: 96 },
        { dpi: 'xxhdpi', size: 144 },
        { dpi: 'xxxhdpi', size: 192 }
      ];

      if (logoFile) {
        const img = new Image();
        const url = URL.createObjectURL(logoFile);
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = url;
        });
        
        for (const d of densities) {
          canvas.width = d.size;
          canvas.height = d.size;
          // Draw a white background to prevent transparency issues
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, d.size, d.size);
          // Draw image center-cropped
          const scale = Math.max(d.size / img.width, d.size / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (d.size - w) / 2, (d.size - h) / 2, w, h);
          
          const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png'));
          root.file(`app/src/main/res/mipmap-${d.dpi}/ic_launcher.png`, blob);
        }
        URL.revokeObjectURL(url);
      } else {
        // Fallback to text icon
        canvas.width = 192;
        canvas.height = 192;
        ctx.fillStyle = '#4F63FF';
        ctx.fillRect(0, 0, 192, 192);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 100px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name[0].toUpperCase(), 96, 96);
        const iconBlob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png'));
        
        for (const d of densities) {
          root.file(`app/src/main/res/mipmap-${d.dpi}/ic_launcher.png`, iconBlob);
        }
      }

      // Download ZIP
      const out = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = `${slug}-project.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      
      setDone(true);
    } catch (e) {
      setError((e as Error).message || 'Failed to generate project.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      
      {/* LEFT COLUMN: Form */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl sm:p-7 lg:col-span-3">
        
        <div className="mb-6">
          <label className={LABEL}>1. Upload Game / App Files (HTML5)</label>
          <input
            type="file"
            multiple
            accept=".html,.js,.css,.png,.jpg,.jpeg,.mp3,.ogg,.wav,.zip,.json,.svg,.woff,.woff2,.ttf"
            onChange={handleFileChange}
            className="block w-full text-sm text-[#9AA6BF] file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-white/20"
          />
          <p className="text-xs text-[#7D8AA5] mt-2">Must include <code>index.html</code>. ZIP file recommended.</p>
        </div>

        <div className="mb-6">
          <label className={LABEL}>2. Upload App Logo (Optional)</label>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleLogoChange}
            className="block w-full text-sm text-[#9AA6BF] file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-white/20"
          />
          <p className="text-xs text-[#7D8AA5] mt-2">Square PNG or JPG. Auto-resized for Android. Leave empty for a letter icon.</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 mb-6">
          <div>
            <label className={LABEL}>3. App Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Game" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>4. Package Name</label>
            <input value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder="com.yourname.game" className={INPUT} />
          </div>
        </div>

        {error && <p className="mb-6 rounded-xl border border-[#FB7185]/40 bg-[#FB7185]/10 px-4 py-3 text-sm text-[#FECDD3]">{error}</p>}

        <button onClick={build} disabled={busy} className={`${BTN} w-full`}>
          {busy ? 'Generating Project...' : 'Generate Android Game Project (ZIP)'}
        </button>
      </div>

      {/* RIGHT COLUMN: Success Guide / Info */}
      <aside className="flex flex-col gap-5 lg:col-span-2">
        {done ? (
          <div className="rounded-3xl border border-[#34D399]/40 bg-[#34D399]/10 p-5 sm:p-6">
            <h3 className="text-lg font-bold text-[#34D399]">Project Downloaded!</h3>
            <div className="mt-2 rounded-lg border border-[#FB7185]/40 bg-[#FB7185]/10 px-3 py-2">
              <p className="text-xs font-bold text-[#FB7185]">⚠️ IMPORTANT: You must follow all steps below to build your APK.</p>
            </div>
            
            <ol className="mt-4 space-y-4 text-sm leading-relaxed text-[#E8ECF6]">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 font-bold text-white">1</span>
                <div>
                  <strong className="block text-white">Upload to GitHub</strong>
                  Unzip the folder and upload all the files to a new <span className="font-semibold text-[#A5B4FF]">private GitHub repository</span>.
                </div>
              </li>
              
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 font-bold text-white">2</span>
                <div>
                  <strong className="block text-white">Create the Build File</strong>
                  On GitHub, click <span className="font-semibold text-[#A5B4FF]">Add file</span> → <span className="font-semibold text-[#A5B4FF]">Create new file</span>.
                  <br />
                  Name it exactly: <code className="mt-1 block bg-black/50 px-2 py-1 rounded text-xs text-[#5EEAD4]">.github/workflows/build.yml</code>
                </div>
              </li>
              
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 font-bold text-white">3</span>
                <div>
                  <strong className="block text-white">Paste the Code</strong>
                  Click the <strong className="text-[#34D399]">"Copy Code"</strong> button below and paste it into the GitHub text box. Then click <span className="font-semibold text-[#A5B4FF]">Commit changes</span>.
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 font-bold text-white">4</span>
                <div>
                  <strong className="block text-white">Run the Build</strong>
                  Go to the <span className="font-semibold text-[#A5B4FF]">Actions</span> tab, click <span className="font-semibold text-[#A5B4FF]">Build signed APK</span>, and click <span className="font-semibold text-[#A5B4FF]">Run workflow</span>.
                </div>
              </li>
            </ol>

            <div className="mt-5 rounded-xl border border-white/20 bg-black/40 p-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
                <span className="text-xs font-bold text-[#9AA6BF]">build.yml</span>
                <button onClick={copyToClipboard} className="rounded-lg bg-[#34D399] px-3 py-1 text-xs font-bold text-[#060912] transition-colors hover:bg-[#6EE7B7]">
                  {copied ? 'Copied!' : 'Copy Code'}
                </button>
              </div>
              <pre className="max-h-32 overflow-y-auto overflow-x-auto text-[10px] text-[#A5B4FF]">
                <code>{GITHUB_YML}</code>
              </pre>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl sm:p-6">
            <p className="text-sm font-bold text-white">What you get</p>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#9AA6BF]">
              <li>Runs 100% offline (HTML5 Game/App)</li>
              <li>Signed release build with your own key</li>
              <li>Custom app icon (auto-resized 5 sizes)</li>
              <li>No Android Studio required</li>
              <li>Auto-generated GitHub Actions workflow</li>
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
