const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game Constants
const WIDTH = 1024;
const HEIGHT = 768;
const ROAD_WIDTH = 2000;
const SEGMENT_LENGTH = 200;
const CAMERA_HEIGHT = 1000;
const DRAW_DISTANCE = 300;
const MAX_SPEED = SEGMENT_LENGTH * 60; // Speed limit

let position = 0; // Z position
let playerX = 0; // Player X offset (-1 to 1)
let speed = 0;
let distance = 0;

// Colors
const COLORS = {
    SKY: '#1a1a2e',
    SUN: '#ff4d4d',
    MOUNTAIN: '#16213e',
    GRASS_LIGHT: '#2d5a27',
    GRASS_DARK: '#23451f',
    ROAD_LIGHT: '#4a4a4a',
    ROAD_DARK: '#3b3b3b',
    RUMBLE_LIGHT: '#e0e0e0',
    RUMBLE_DARK: '#c0c0c0',
    LANE: '#ffffff'
};

// Input Handling
const keys = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };
document.addEventListener('keydown', (e) => { if (e.key in keys) keys[e.key] = true; });
document.addEventListener('keyup', (e) => { if (e.key in keys) keys[e.key] = false; });

// Mobile Controls
const btnLeft = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');
btnLeft.addEventListener('touchstart', (e) => { e.preventDefault(); keys.ArrowLeft = true; });
btnLeft.addEventListener('touchend', (e) => { e.preventDefault(); keys.ArrowLeft = false; });
btnRight.addEventListener('touchstart', (e) => { e.preventDefault(); keys.ArrowRight = true; });
btnRight.addEventListener('touchend', (e) => { e.preventDefault(); keys.ArrowRight = false; });

// Resize
function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
}
window.addEventListener('resize', resize);
resize();

// Math Helpers
function project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth) {
    p.camera.x = (p.world.x || 0) - cameraX;
    p.camera.y = (p.world.y || 0) - cameraY;
    p.camera.z = (p.world.z || 0) - cameraZ;
    p.screen.scale = cameraDepth / p.camera.z;
    p.screen.x = Math.round((width / 2) + (p.screen.scale * p.camera.x * width / 2));
    p.screen.y = Math.round((height / 2) - (p.screen.scale * p.camera.y * height / 2));
    p.screen.w = Math.round((p.screen.scale * roadWidth * width / 2));
}

// Build Road Segments
const segments = [];
for (let i = 0; i < 1600; i++) {
    let curve = 0;
    // Create smooth long curves using Sine waves
    if (i > 50 && i < 800) curve = Math.sin(i / 100) * 5;
    if (i > 800) curve = Math.cos(i / 80) * -6;

    segments.push({
        index: i,
        curve: curve,
        color: i % 2 === 0 ? COLORS.ROAD_LIGHT : COLORS.ROAD_DARK,
        rumble: i % 2 === 0 ? COLORS.RUMBLE_LIGHT : COLORS.RUMBLE_DARK,
        grass: i % 2 === 0 ? COLORS.GRASS_LIGHT : COLORS.GRASS_DARK,
        p1: { world: { z: i * SEGMENT_LENGTH, y: 0 }, camera: {}, screen: {} },
        p2: { world: { z: (i + 1) * SEGMENT_LENGTH, y: 0 }, camera: {}, screen: {} }
    });
}

// Draw Scenery (Trees, Mountains, Sun)
function drawBackground() {
    // Sky Gradient
    let skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT / 2);
    skyGrad.addColorStop(0, '#0f172a');
    skyGrad.addColorStop(1, '#e11d48');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT / 2);

    // Sun
    ctx.fillStyle = COLORS.SUN;
    ctx.beginPath();
    ctx.arc(WIDTH / 2, HEIGHT / 3, 100, 0, Math.PI * 2);
    ctx.fill();

    // Parallax Mountains
    ctx.fillStyle = COLORS.MOUNTAIN;
    let offset = position * 0.02;
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT / 2);
    for (let x = 0; x <= WIDTH; x += 50) {
        let y = HEIGHT / 2 - 100 - Math.sin((x + offset) * 0.005) * 80 - Math.cos((x + offset) * 0.01) * 40;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(WIDTH, HEIGHT / 2);
    ctx.fill();
}

function drawTree(x, y, scale) {
    ctx.fillStyle = '#0a1c0a';
    ctx.fillRect(x - 10 * scale, y - 50 * scale, 20 * scale, 50 * scale);
    ctx.fillStyle = '#1b331a';
    ctx.beginPath();
    ctx.moveTo(x, y - 120 * scale);
    ctx.lineTo(x - 40 * scale, y - 40 * scale);
    ctx.lineTo(x + 40 * scale, y - 40 * scale);
    ctx.fill();
}

function drawPlayerCar() {
    let carW = 120;
    let carH = 70;
    let x = WIDTH / 2 + (playerX * 200) - carW / 2;
    let y = HEIGHT - carH - 40;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(x + carW / 2, y + carH, carW / 2, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Car Body
    ctx.fillStyle = '#ff0033';
    ctx.beginPath();
    ctx.roundRect(x, y, carW, carH, 10);
    ctx.fill();

    // Windshield
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.roundRect(x + 15, y + 10, carW - 30, 25, 5);
    ctx.fill();

    // Wheels
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 10, y + 10, 15, 30);
    ctx.fillRect(x + carW - 5, y + 10, 15, 30);
}

function render() {
    drawBackground();
    
    let baseSegment = Math.floor(position / SEGMENT_LENGTH);
    let basePercent = (position % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    
    let playerSegment = segments[baseSegment % segments.length];
    let playerPercent = basePercent;
    
    let playerY = 0;
    let maxy = HEIGHT;

    let x = 0;
    let dx = -(playerSegment.curve * playerPercent);
    let cameraDepth = 1 / Math.tan((100 / 2) * Math.PI / 180);
    let cameraX = playerX * ROAD_WIDTH;
    let cameraY = CAMERA_HEIGHT;

    for (let n = 0; n < DRAW_DISTANCE; n++) {
        let segment = segments[(baseSegment + n) % segments.length];
        segment.looped = segment.index < baseSegment;
        segment.fog = 1 - (n / DRAW_DISTANCE);
        segment.clip = maxy;

        project(segment.p1, (cameraX + x), cameraY, position - (segment.looped ? segments.length * SEGMENT_LENGTH : 0), cameraDepth, WIDTH, HEIGHT, ROAD_WIDTH);
        project(segment.p2, (cameraX + x + dx), cameraY, position - (segment.looped ? segments.length * SEGMENT_LENGTH : 0), cameraDepth, WIDTH, HEIGHT, ROAD_WIDTH);

        x += dx;
        dx += segment.curve;

        if (segment.p1.camera.z <= cameraDepth || segment.p2.screen.y >= segment.p1.screen.y || segment.p2.screen.y >= maxy) continue;

        // Draw Grass
        ctx.fillStyle = segment.grass;
        ctx.fillRect(0, segment.p2.screen.y, WIDTH, segment.p1.screen.y - segment.p2.screen.y);

        // Draw Road
        let p1 = segment.p1.screen;
        let p2 = segment.p2.screen;

        // Rumble Strips
        ctx.fillStyle = segment.rumble;
        ctx.beginPath();
        ctx.moveTo(p1.x - p1.w, p1.y);
        ctx.lineTo(p1.x + p1.w, p1.y);
        ctx.lineTo(p2.x + p2.w, p2.y);
        ctx.lineTo(p2.x - p2.w, p2.y);
        ctx.fill();

        // Road Surface
        ctx.fillStyle = segment.color;
        ctx.beginPath();
        ctx.moveTo(p1.x - p1.w * 0.9, p1.y);
        ctx.lineTo(p1.x + p1.w * 0.9, p1.y);
        ctx.lineTo(p2.x + p2.w * 0.9, p2.y);
        ctx.lineTo(p2.x - p2.w * 0.9, p2.y);
        ctx.fill();

        // Lane Lines
        if (segment.index % 4 === 0) {
            ctx.fillStyle = COLORS.LANE;
            ctx.beginPath();
            ctx.moveTo(p1.x - p1.w * 0.05, p1.y);
            ctx.lineTo(p1.x + p1.w * 0.05, p1.y);
            ctx.lineTo(p2.x + p2.w * 0.05, p2.y);
            ctx.lineTo(p2.x - p2.w * 0.05, p2.y);
            ctx.fill();
        }

        // Side Trees (Randomly spawn based on segment index)
        if (segment.index % 10 === 0) {
            drawTree(p1.x - p1.w * 2.5, p1.y, p1.scale * 2000);
            drawTree(p1.x + p1.w * 2.5, p1.y, p1.scale * 2000);
        }

        maxy = segment.p1.screen.y;
    }

    drawPlayerCar();

    // Speed Lines (Motion Blur effect)
    if (speed > 5000) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        for(let i=0; i<20; i++) {
            let sx = Math.random() * WIDTH;
            let sy = Math.random() * HEIGHT;
            let len = Math.random() * 200 + 50;
            ctx.fillRect(sx, sy, 2, len);
        }
    }
}

// Main Loop
let lastTime = performance.now();
function update(time) {
    let dt = Math.min(1, (time - lastTime) / 1000);
    lastTime = time;

    // Auto-accelerate
    speed += (MAX_SPEED - speed) * 0.1 * dt;
    
    // Deceleration if off-road (optional, we keep it simple here)
    
    // Input
    let playerDX = 0;
    if (keys.ArrowLeft) playerDX -= 1.5;
    if (keys.ArrowRight) playerDX += 1.5;
    
    // Steering sensitivity depends on speed
    playerX += playerDX * dt * (speed / MAX_SPEED) * 1.5;
    
    // Clamp player to road
    if (playerX < -1.5) playerX = -1.5;
    if (playerX > 1.5) playerX = 1.5;

    // Update position
    position += speed * dt;
    distance += speed * dt;

    // Update HUD
    document.getElementById('speedVal').innerText = Math.floor((speed / MAX_SPEED) * 320);
    document.getElementById('scoreVal').innerText = Math.floor(distance / 100);

    render();
    requestAnimationFrame(update);
}

// Polyfill for roundRect
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
    };
}

requestAnimationFrame(update);