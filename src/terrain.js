import * as THREE from "three";
import { ASSET_PATHS } from "./buildings.js";
import { CELL, SIZE, landField, shorelineWorldZ, terrainHeight } from "./city.js";

const SEG = 96;
const PAD = 8;
const BAKE = 384;

function smooth(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

function imgOf(tex) {
  const img = tex?.image;
  return img && img.width ? img : null;
}

function tileInto(ctx, img, w, h, tint) {
  if (img) {
    const tw = Math.max(48, img.width * 0.45);
    const th = Math.max(48, img.height * 0.45);
    for (let y = -8; y < h; y += th) {
      for (let x = -8; x < w; x += tw) ctx.drawImage(img, x, y, tw, th);
    }
  } else {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
  }
}

function bakeGroundAlbedo(loadTex) {
  const grass = imgOf(loadTex(ASSET_PATHS["grass.jpg"]));
  const sand = imgOf(loadTex(ASSET_PATHS["sand.jpg"]));
  const dirt = imgOf(loadTex(ASSET_PATHS["dirt.jpg"]));
  const conc = imgOf(loadTex(ASSET_PATHS["concrete.jpg"]));

  const layers = [
    { img: grass, tint: "#4d5e38" },
    { img: sand, tint: "#c2b089" },
    { img: dirt, tint: "#6a5344" },
    { img: conc, tint: "#8e8a82" },
  ].map((src) => {
    const c = document.createElement("canvas");
    c.width = c.height = BAKE;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    tileInto(ctx, src.img, BAKE, BAKE, src.tint);
    return ctx.getImageData(0, 0, BAKE, BAKE).data;
  });

  const out = document.createElement("canvas");
  out.width = out.height = BAKE;
  const ctx = out.getContext("2d");
  const dst = ctx.createImageData(BAKE, BAKE);
  const px = dst.data;
  const span = (SIZE - 1 + PAD * 2) * CELL;

  for (let py = 0; py < BAKE; py++) {
    for (let pxI = 0; pxI < BAKE; pxI++) {
      const wx = (pxI / (BAKE - 1) - 0.5) * span;
      const wz = (py / (BAKE - 1) - 0.5) * span;
      const d = landField(wx, wz);
      const sandW = (1 - smooth((d - 0.05) / 4.4)) * smooth((d + 3.2) / 2.8);
      const concW = smooth((d - 2.4) / 3.2) * (1 - smooth((d - 8.5) / 5));
      const mott = 0.5 + 0.5 * Math.sin(wx * 0.07) * Math.cos(wz * 0.055);
      let dirtW = smooth((d - 5) / 8) * (1 - smooth((d - 26) / 16));
      dirtW += mott * 0.28 * smooth((d - 7) / 10);
      let grassW = smooth((d - 6.5) / 10) * (0.72 + (1 - mott) * 0.28);
      if (d < -1.4) {
        grassW = 0;
      }
      const wet = 1 - smooth((d + 1.1) / 2.4);
      const sum = sandW + concW + dirtW + grassW + 1e-4;
      const w0 = grassW / sum;
      const w1 = sandW / sum;
      const w2 = dirtW / sum;
      const w3 = concW / sum;
      const i = (py * BAKE + pxI) * 4;
      for (let c = 0; c < 3; c++) {
        let v = layers[0][i + c] * w0 + layers[1][i + c] * w1 + layers[2][i + c] * w2 + layers[3][i + c] * w3;
        if (c === 1) v *= 0.93;
        if (c === 2) v *= 0.88;
        v = v * (1 - wet * 0.38) + (c === 0 ? 58 : c === 1 ? 64 : 58) * wet * 0.38;
        const rim = Math.max(Math.abs(wx), Math.abs(wz)) / (span * 0.5);
        const fade = rim > 0.82 ? (rim - 0.82) / 0.18 : 0;
        const fogC = c === 0 ? 158 : c === 1 ? 176 : 190;
        v = v * (1 - fade) + fogC * fade;
        px[i + c] = v;
      }
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function createLandMesh(loadTex) {
  const minC = -PAD;
  const maxC = SIZE - 1 + PAD;
  const span = maxC - minC;
  const geo = new THREE.PlaneGeometry(span * CELL, span * CELL, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const half = ((SIZE - 1) / 2) * CELL;

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wz = pos.getZ(i);
    let y = terrainHeight(wx, wz);
    const edge = Math.max(Math.abs(wx) - half + CELL * 3, Math.abs(wz) - half + CELL * 3);
    if (edge > 0) y -= edge * 0.08;
    if (!Number.isFinite(y)) y = -1;
    pos.setY(i, y);

    const d = landField(wx, wz);
    const sand = 1 - smooth((d - 0.4) / 9);
    const conc = smooth((d - 2.2) / 4) * (1 - smooth((d - 8) / 7));
    const dirt = smooth((d - 6) / 10) * (1 - smooth((d - 26) / 16));
    const grassW = smooth((d - 12) / 16);
    const sum = sand + conc + dirt + grassW + 1e-4;
    const r = (0.96 * sand + 0.9 * dirt + 0.97 * conc + 0.92 * grassW) / sum;
    const gch = (0.93 * sand + 0.86 * dirt + 0.96 * conc + 0.94 * grassW) / sum;
    const b = (0.86 * sand + 0.8 * dirt + 0.94 * conc + 0.84 * grassW) / sum;
    colors[i * 3] = r;
    colors[i * 3 + 1] = gch;
    colors[i * 3 + 2] = b;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: bakeGroundAlbedo(loadTex),
    color: 0xd2c89a,
    roughness: 0.96,
    metalness: 0.02,
    vertexColors: true,
  });

  const group = new THREE.Group();
  group.name = "land";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  group.add(mesh);
  group.add(createShoreBands(loadTex));
  return group;
}

function inlandDir(wx, wz) {
  const e = 1.6;
  const dx = landField(wx + e, wz) - landField(wx - e, wz);
  const dz = landField(wx, wz + e) - landField(wx, wz - e);
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

function createShoreBands(loadTex) {
  const group = new THREE.Group();
  group.name = "shore-bands";
  const sandMat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["sand.jpg"], [10, 1.4]),
    color: 0xc8b894,
    roughness: 0.96,
    metalness: 0.0,
  });
  const wetMat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["sand.jpg"], [12, 1.6]),
    color: 0x7a6a52,
    roughness: 0.72,
    metalness: 0.06,
  });
  const wrackMat = new THREE.MeshStandardMaterial({
    color: 0x3a3424,
    roughness: 0.95,
  });
  const concMat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["concrete.jpg"], [8, 1]),
    color: 0xd8d4cc,
    roughness: 0.9,
    metalness: 0.03,
  });
  const cobbleMat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["cobble.jpg"], [6, 1]),
    color: 0xcfc8bc,
    roughness: 0.88,
    metalness: 0.04,
  });

  const south = sampleShore((t) => {
    const minX = (-PAD - (SIZE - 1) / 2) * CELL;
    const maxX = (SIZE - 1 + PAD - (SIZE - 1) / 2) * CELL;
    const wx = minX + t * (maxX - minX);
    const wz = shorelineWorldZ(wx);
    return [wx, wz];
  }, 150);

  const west = sampleShore((t) => {
    const wx = (3.05 - (SIZE - 1) / 2) * CELL;
    const wz = ((4 + t * 20) - (SIZE - 1) / 2) * CELL;
    return [wx, wz];
  }, 40);

  const foamMat = new THREE.MeshBasicMaterial({
    color: 0xd8e4e6,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  if (south.length > 3) {
    group.add(bandFrom(south, 5.6, 3.4, 0.03, sandMat, 1.1));
    group.add(bandFrom(south, 2.8, 1.15, 0.018, wetMat, 0.55));
    group.add(bandFrom(south, 0.7, 1.85, 0.04, wrackMat, 0.35));
    group.add(bandFrom(south, 5.4, 9.4, 0.055, concMat, 0.4));
    group.add(bandFrom(south, 3.2, 12.6, 0.07, cobbleMat, 0.25));
    group.add(bandFrom(south, 2.2, -1.05, 0.01, foamMat, 0.45));
  }
  if (west.length > 3) {
    group.add(bandFrom(west, 4.8, 3.0, 0.03, sandMat, 0.8));
    group.add(bandFrom(west, 2.4, 1.1, 0.018, wetMat, 0.4));
    group.add(bandFrom(west, 4.4, 8.2, 0.055, concMat, 0.3));
  }
  return group;
}

function sampleShore(fn, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const [wx, wz] = fn(i / n);
    const d = landField(wx, wz);
    if (d < -14 || d > 18) continue;
    pts.push({ x: wx, z: wz });
  }
  return pts;
}

function bandFrom(samples, width, inset, lift, mat, jitter = 0) {
  const pts = samples.map((s) => {
    const dir = inlandDir(s.x, s.z);
    const j = jitter ? Math.sin(s.x * 0.13 + s.z * 0.09) * jitter : 0;
    const x = s.x + dir.x * (inset + j);
    const z = s.z + dir.z * (inset + j);
    return new THREE.Vector3(x, Math.max(terrainHeight(x, z), -0.04) + lift, z);
  });
  return ribbon(pts, width, 0.05, mat, false);
}

export function createSeawallMesh(loadTex) {
  const N = 110;
  const minX = (-PAD - (SIZE - 1) / 2) * CELL;
  const maxX = (SIZE - 1 + PAD - (SIZE - 1) / 2) * CELL;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const wx = minX + (i / N) * (maxX - minX);
    const wz = shorelineWorldZ(wx);
    const d = landField(wx, wz);
    if (d < -10 || d > 14) continue;
    const dir = inlandDir(wx, wz);
    const x = wx + dir.x * 0.9;
    const z = wz + dir.z * 0.9;
    pts.push(new THREE.Vector3(x, Math.max(terrainHeight(x, z), -0.05) + 0.02, z));
  }
  const west = [];
  for (let i = 0; i <= 28; i++) {
    const cz = 5 + (i / 28) * 16;
    const wx = (3 - (SIZE - 1) / 2) * CELL;
    const wz = (cz - (SIZE - 1) / 2) * CELL;
    west.push(new THREE.Vector3(wx, 0.08, wz));
  }

  const mat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["concrete.jpg"], [4, 1]),
    roughness: 0.86,
    metalness: 0.04,
    color: 0xd8d4cc,
  });
  const group = new THREE.Group();
  group.name = "seawall";
  if (pts.length > 2) group.add(ribbon(pts, 0.42, 0.78, mat, true));
  if (west.length > 2) group.add(ribbon(west, 0.42, 0.78, mat, true));
  return group;
}

function ribbon(pts, width, height, mat, walls) {
  const clean = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  if (clean.length < 3) return new THREE.Group();
  const n = clean.length;
  pts = clean;
  const pos = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const idx = [];
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len;
    const nz = tx / len;
    if (i > 0) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const hw = width * 0.5;
    const corners = [
      [p.x - nx * hw, p.y, p.z - nz * hw],
      [p.x + nx * hw, p.y, p.z + nz * hw],
      [p.x - nx * hw, p.y + height, p.z - nz * hw],
      [p.x + nx * hw, p.y + height, p.z + nz * hw],
    ];
    for (let k = 0; k < 4; k++) {
      const o = (i * 4 + k) * 3;
      pos[o] = corners[k][0];
      pos[o + 1] = corners[k][1];
      pos[o + 2] = corners[k][2];
      const uo = (i * 4 + k) * 2;
      uv[uo] = dist * 0.12;
      uv[uo + 1] = k < 2 ? 0 : 1;
    }
    if (i < n - 1) {
      const a = i * 4;
      const b = (i + 1) * 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
      idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
      if (walls) {
        idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
        idx.push(a, a + 2, b, b, a + 2, b + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = walls;
  mesh.receiveShadow = true;
  return mesh;
}
