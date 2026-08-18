import * as THREE from 'three';
import { ASSET_PATHS, FALLBACK_COLORS } from './buildings.js';

const logged = new Set();
const SIZE = 256;

function hexRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function noise(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function vary(hex, t, amt = 18) {
  const [r, g, b] = hexRgb(hex);
  const k = (t - 0.5) * amt;
  const c = (v) => Math.max(0, Math.min(255, v + k));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

function canvas2d(w = SIZE, h = SIZE) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d') };
}

function toTex(c, repeat = 1) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function fillNoise(g, hex, scale = 7, amp = 22) {
  const w = g.canvas.width;
  const h = g.canvas.height;
  const img = g.createImageData(w, h);
  const [r, gv, b] = hexRgb(hex);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n =
        noise(x / scale, y / scale) * 0.6 + noise(x / (scale * 0.35), y / (scale * 0.4)) * 0.4;
      const k = (n - 0.5) * amp;
      const i = (y * w + x) * 4;
      img.data[i] = r + k;
      img.data[i + 1] = gv + k * 0.9;
      img.data[i + 2] = b + k * 0.7;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function brickWall(hex, mortar, rows, cols, windows) {
  const { c, g } = canvas2d();
  g.fillStyle = mortar;
  g.fillRect(0, 0, SIZE, SIZE);
  const bw = SIZE / cols;
  const bh = SIZE / rows;
  for (let y = 0; y < rows; y++) {
    const off = y % 2 ? bw * 0.5 : 0;
    for (let x = -1; x <= cols; x++) {
      g.fillStyle = vary(hex, noise(x + 2, y + 4), 16);
      g.fillRect(x * bw + off + 1, y * bh + 1, bw - 2, bh - 2);
    }
  }
  if (windows) drawWindows(g, windows);
  return toTex(c);
}

function drawWindows(g, spec) {
  const cols = spec.cols || 3;
  const rows = spec.rows || 3;
  const insetX = spec.insetX ?? 0.14;
  const insetY = spec.insetY ?? 0.16;
  const gapX = spec.gapX ?? 0.08;
  const gapY = spec.gapY ?? 0.12;
  const lit = spec.lit || 0;
  const w = SIZE * (1 - insetX * 2 - gapX * (cols - 1)) / cols;
  const h = SIZE * (1 - insetY * 2 - gapY * (rows - 1)) / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = SIZE * insetX + x * (w + SIZE * gapX);
      const py = SIZE * insetY + y * (h + SIZE * gapY);
      const on = noise(x * 3.1, y * 7.7) < lit;
      g.fillStyle = on ? 'rgb(236, 196, 120)' : spec.dark || 'rgb(28, 36, 42)';
      g.fillRect(px, py, w, h);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(px, py, w, h * 0.35);
    }
  }
}

function glassGrid(base, cols, rows, mullion) {
  const { c, g } = canvas2d();
  g.fillStyle = mullion;
  g.fillRect(0, 0, SIZE, SIZE);
  const bw = SIZE / cols;
  const bh = SIZE / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const n = noise(x + 0.2, y + 1.4);
      const [r, gv, b] = hexRgb(base);
      g.fillStyle = `rgb(${r + n * 18},${gv + n * 14},${b + n * 10})`;
      g.fillRect(x * bw + 1.5, y * bh + 1.5, bw - 3, bh - 3);
      g.fillStyle = 'rgba(220,230,235,0.16)';
      g.fillRect(x * bw + 2, y * bh + 2, bw * 0.45, bh * 0.28);
    }
  }
  return toTex(c);
}

function shingles() {
  const { c, g } = canvas2d();
  g.fillStyle = '#2a2420';
  g.fillRect(0, 0, SIZE, SIZE);
  const rows = 14;
  const cols = 8;
  const bh = SIZE / rows;
  const bw = SIZE / cols;
  for (let y = 0; y < rows; y++) {
    const off = y % 2 ? bw * 0.5 : 0;
    for (let x = -1; x <= cols; x++) {
      g.fillStyle = vary(0x3c322c, noise(x, y), 14);
      g.beginPath();
      g.moveTo(x * bw + off, y * bh + 2);
      g.lineTo(x * bw + off + bw * 0.5, y * bh + bh - 1);
      g.lineTo(x * bw + off + bw, y * bh + 2);
      g.closePath();
      g.fill();
    }
  }
  return toTex(c);
}

function planks(hex) {
  const { c, g } = canvas2d();
  const n = 8;
  const bw = SIZE / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = vary(hex, noise(i, 2), 20);
    g.fillRect(i * bw, 0, bw - 1.5, SIZE);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(i * bw + bw - 1.5, 0, 1.5, SIZE);
    for (let k = 0; k < 4; k++) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(i * bw + bw * 0.35, 18 + k * 60, 4, 4);
    }
  }
  return toTex(c);
}

function cobble() {
  const { c, g } = canvas2d();
  g.fillStyle = '#5a564e';
  g.fillRect(0, 0, SIZE, SIZE);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const ox = y % 2 ? 12 : 0;
      g.fillStyle = vary(0x6e6960, noise(x, y), 20);
      g.fillRect(x * 26 + ox + 2, y * 26 + 2, 20, 18);
    }
  }
  return toTex(c);
}

function nightWindows() {
  const { c, g } = canvas2d();
  g.fillStyle = '#050508';
  g.fillRect(0, 0, SIZE, SIZE);
  const cols = 5;
  const rows = 8;
  const bw = SIZE / cols;
  const bh = SIZE / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (noise(x + 4, y + 9) < 0.38) continue;
      const warm = noise(x, y + 3) > 0.45;
      g.fillStyle = warm ? 'rgb(255, 196, 110)' : 'rgb(170, 200, 220)';
      g.fillRect(x * bw + 6, y * bh + 5, bw - 12, bh - 10);
    }
  }
  return toTex(c);
}

function treeSprite(kind) {
  const { c, g } = canvas2d(256, 320);
  g.clearRect(0, 0, 256, 320);
  if (kind === 'shrub') {
    for (const [cx, cy, rx, ry, hex] of [
      [128, 178, 102, 78, 0x314a2a],
      [96, 168, 62, 52, 0x3a552e],
      [164, 172, 58, 48, 0x2a4224],
      [128, 148, 70, 46, 0x3f5c32],
    ]) {
      g.fillStyle = vary(hex, 0.5, 10);
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    }
    return toTex(c, 1);
  }
  g.fillStyle = '#4a3424';
  g.fillRect(kind === 'pine' ? 122 : 118, kind === 'pine' ? 228 : 206, kind === 'pine' ? 12 : 20, 90);
  if (kind === 'pine') {
    const layers = [
      [128, 16, 36],
      [128, 62, 54],
      [128, 112, 70],
      [128, 164, 84],
      [128, 214, 74],
    ];
    for (const [cx, cy, r] of layers) {
      g.fillStyle = vary(0x2f4a30, cy / 240, 14);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx - r, cy + r * 1.28);
      g.lineTo(cx - r * 0.35, cy + r * 1.05);
      g.lineTo(cx + r * 0.28, cy + r * 1.12);
      g.lineTo(cx + r, cy + r * 1.28);
      g.closePath();
      g.fill();
    }
  } else {
    const hex = kind === 'maple' ? 0x4a6a30 : 0x3f5c32;
    const blobs = [
      [128, 108, 86, 74, hex],
      [82, 142, 58, 50, 0x4a6a38],
      [176, 138, 60, 52, 0x35542c],
      [118, 168, 70, 56, 0x466434],
      [148, 96, 48, 40, 0x5a7234],
      [104, 92, 44, 36, 0x3a5528],
    ];
    for (const [cx, cy, rx, ry, h] of blobs) {
      g.fillStyle = vary(h, 0.5, 10);
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  return toTex(c, 1);
}

function crownSprite(hex) {
  const { c, g } = canvas2d(256, 256);
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const d = 28 + noise(i, 3) * 62;
    g.fillStyle = vary(hex, noise(i, 8), 18);
    g.beginPath();
    g.ellipse(128 + Math.cos(a) * d * 0.55, 128 + Math.sin(a) * d * 0.55, 38 + noise(i, 2) * 22, 32 + noise(i, 5) * 16, a, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = vary(hex, 0.45, 8);
  g.beginPath();
  g.ellipse(128, 128, 70, 66, 0, 0, Math.PI * 2);
  g.fill();
  return toTex(c, 1);
}

function leafFill(hex) {
  const { c, g } = canvas2d();
  fillNoise(g, hex, 5, 28);
  return toTex(c);
}

function skyGradient() {
  const { c, g } = canvas2d(1024, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#6a849c');
  grd.addColorStop(0.45, '#c9b49a');
  grd.addColorStop(0.72, '#e2b48a');
  grd.addColorStop(1, '#d8c4a4');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 512);
  return toTex(c, 1);
}

function asphalt() {
  const { c, g } = canvas2d();
  fillNoise(g, 0x2a2b2e, 5, 14);
  g.strokeStyle = 'rgba(210,190,140,0.28)';
  g.lineWidth = 3;
  g.setLineDash([18, 16]);
  g.beginPath();
  g.moveTo(SIZE / 2, 0);
  g.lineTo(SIZE / 2, SIZE);
  g.stroke();
  return toTex(c);
}

export function generateFallback(name) {
  switch (name) {
    case 'grass.jpg': {
      const { c, g } = canvas2d();
      fillNoise(g, 0x4c6a3c, 6, 26);
      return toTex(c);
    }
    case 'dirt.jpg': {
      const { c, g } = canvas2d();
      fillNoise(g, 0x6a5344, 5, 20);
      return toTex(c);
    }
    case 'sand.jpg': {
      const { c, g } = canvas2d();
      fillNoise(g, 0xc4ad7a, 4, 16);
      return toTex(c);
    }
    case 'water.jpg': {
      const { c, g } = canvas2d();
      fillNoise(g, 0x1a4e58, 10, 18);
      return toTex(c);
    }
    case 'asphalt.jpg':
      return asphalt();
    case 'concrete.jpg': {
      const { c, g } = canvas2d();
      fillNoise(g, 0x8a8680, 6, 12);
      return toTex(c);
    }
    case 'cobble.jpg':
      return cobble();
    case 'roof_gravel.jpg': {
      const { c, g } = canvas2d();
      fillNoise(g, 0x5c5a56, 3, 22);
      return toTex(c);
    }
    case 'roof_shingle.jpg':
      return shingles();
    case 'wood_dock.jpg':
      return planks(0x6b4e34);
    case 'rowhouse.jpg':
      return brickWall(0x8b4a3a, '#cfc6b8', 10, 6, { cols: 2, rows: 2, lit: 0.15 });
    case 'apartment.jpg':
      return brickWall(0x9a7a62, '#d4cdc2', 8, 5, { cols: 3, rows: 4, lit: 0.12, insetY: 0.08, gapY: 0.06 });
    case 'glass_res.jpg':
      return glassGrid(0x6a8a96, 4, 8, '#d8dde0');
    case 'storefront.jpg':
      return brickWall(0x7a5a48, '#d2c8ba', 8, 5, { cols: 2, rows: 2, lit: 0.2, insetY: 0.08 });
    case 'office.jpg':
      return glassGrid(0x7c8890, 5, 6, '#c5ccd0');
    case 'skyscraper.jpg':
      return glassGrid(0x5d7380, 6, 10, '#d0d6da');
    case 'warehouse.jpg':
      return brickWall(0x7a7468, '#9a948a', 6, 4, { cols: 3, rows: 2, lit: 0.05, dark: 'rgb(40,40,42)' });
    case 'factory.jpg':
      return brickWall(0x5c5852, '#868078', 7, 4, { cols: 4, rows: 2, lit: 0.08 });
    case 'hospital.jpg':
      return brickWall(0xc9c2b4, '#e8e4dc', 8, 5, { cols: 4, rows: 3, lit: 0.18, dark: 'rgb(70,90,100)' });
    case 'school.jpg':
      return brickWall(0x9a6a4a, '#d8cfc2', 7, 4, { cols: 3, rows: 2, lit: 0.1 });
    case 'civic.jpg':
      return brickWall(0xa89a84, '#e4dcc8', 8, 4, { cols: 3, rows: 3, lit: 0.12 });
    case 'night_windows.jpg':
      return nightWindows();
    case 'oak.png':
    case 'oak.jpg':
      return treeSprite('oak');
    case 'pine.png':
    case 'pine.jpg':
      return treeSprite('pine');
    case 'maple.jpg':
      return treeSprite('maple');
    case 'shrub.jpg':
      return treeSprite('shrub');
    case 'oak_top.jpg':
      return crownSprite(0x3d5c32);
    case 'pine_top.jpg':
      return crownSprite(0x2d4a30);
    case 'maple_top.jpg':
      return crownSprite(0x4a6a30);
    case 'leaves.jpg':
      return leafFill(0x3f5c32);
    case 'needles.jpg':
      return leafFill(0x2d4a30);
    case 'sky.jpg':
    case 'hero.jpg':
      return skyGradient();
    default: {
      const { c, g } = canvas2d();
      const hex = FALLBACK_COLORS[name] || 0x777777;
      g.fillStyle = vary(hex, 0.5, 0);
      g.fillRect(0, 0, SIZE, SIZE);
      return toTex(c);
    }
  }
}

function logMissing(name) {
  if (logged.has(name)) return;
  logged.add(name);
  console.warn(`[harborline] missing texture, using placeholder: ${name}`);
}

export function keyMagenta(texture) {
  const img = texture.image;
  if (!img || !img.width) return texture;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const gv = px[i + 1];
    const b = px[i + 2];
    const pink = r > 150 && b > 110 && gv < 160 && r - gv > 35 && b - gv > 15;
    if (pink && gv < 90) px[i + 3] = 0;
    else if (pink) px[i + 3] = Math.min(px[i + 3], Math.max(0, (gv - 40) * 2));
  }
  g.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.anisotropy = 8;
  return tex;
}

async function probe(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = `${url}?t=${Date.now()}`;
  });
}

export class Assets {
  constructor() {
    this.loader = new THREE.TextureLoader();
    this.loader.setCrossOrigin('anonymous');
    this.real = new Map();
    this.fallback = new Map();
    this.missing = new Set();
    this.listeners = new Set();
    this.maxAniso = 8;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(name, tex) {
    for (const fn of this.listeners) fn(name, tex);
  }

  get(name) {
    return this.real.get(name) || this.fallback.get(name);
  }

  hasReal(name) {
    return this.real.has(name);
  }

  prepareFallbacks() {
    for (const name of Object.keys(ASSET_PATHS)) {
      if (!this.fallback.has(name)) this.fallback.set(name, generateFallback(name));
    }
  }

  async loadOne(name) {
    const url = ASSET_PATHS[name];
    if (!url) return false;
    const ok = await probe(url);
    if (!ok) {
      this.missing.add(name);
      logMissing(name);
      return false;
    }
    try {
      const tex = await this.loader.loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = this.maxAniso;
      tex.needsUpdate = true;
      let ready = tex;
      if (/^(oak|pine|maple|shrub)/.test(name)) {
        ready = keyMagenta(tex);
        ready.wrapS = ready.wrapT = THREE.ClampToEdgeWrapping;
      }
      this.real.set(name, ready);
      this.missing.delete(name);
      this.emit(name, ready);
      return true;
    } catch {
      this.missing.add(name);
      logMissing(name);
      return false;
    }
  }

  async loadAll() {
    this.prepareFallbacks();
    const names = Object.keys(ASSET_PATHS);
    await Promise.all(names.map((n) => this.loadOne(n)));
    if (this.real.has('oak.jpg') && !this.real.has('oak.png')) {
      this.real.set('oak.png', this.real.get('oak.jpg'));
    }
    if (this.real.has('pine.jpg') && !this.real.has('pine.png')) {
      this.real.set('pine.png', this.real.get('pine.jpg'));
    }
    if (this.real.has('maple.jpg') && !this.real.has('maple.png')) {
      this.real.set('maple.png', this.real.get('maple.jpg'));
    }
  }

  async poll() {
    const pending = [...this.missing];
    let any = false;
    for (const name of pending) {
      if (await this.loadOne(name)) any = true;
    }
    return any;
  }
}
