import * as THREE from "three";
import { ASSET_PATHS, DEFS } from "./buildings.js";
import { CELL, hash } from "./city.js";

const sideCache = new Map();

function std(map, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: map || null,
    color: extra.color ?? 0xffffff,
    roughness: extra.roughness ?? 0.78,
    metalness: extra.metalness ?? 0.04,
    ...extra,
  });
}

function sideFrom(tex) {
  if (!tex) return null;
  const cached = sideCache.get(tex);
  if (cached && cached.userData.cut) return cached;
  const img = tex.image;
  if (img && img.width) {
    const c = document.createElement("canvas");
    const sw = Math.max(32, Math.floor(img.width * 0.4));
    const sh = Math.max(32, Math.floor(img.height * 0.46));
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, img.width * 0.56, 0, img.width * 0.4, img.height * 0.46, 0, 0, sw, sh);
    const cut = new THREE.CanvasTexture(c);
    cut.colorSpace = THREE.SRGBColorSpace;
    cut.wrapS = cut.wrapT = THREE.RepeatWrapping;
    cut.anisotropy = 8;
    cut.needsUpdate = true;
    cut.userData.cut = true;
    sideCache.set(tex, cut);
    return cut;
  }
  if (cached) return cached;
  const fallback = tex.clone();
  fallback.wrapS = fallback.wrapT = THREE.RepeatWrapping;
  fallback.offset.set(0.55, 0.08);
  fallback.repeat.set(0.42, 0.5);
  fallback.needsUpdate = true;
  sideCache.set(tex, fallback);
  return fallback;
}

function addBox(g, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function quad(mat, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz]),
      3
    )
  );
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function tri(mat, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([ax, ay, az, bx, by, bz, cx, cy, cz]), 3)
  );
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function gable(g, w, d, roofH, mat) {
  const hw = w * 0.5 + 0.08;
  const hd = d * 0.5;
  const y = roofH;
  g.add(quad(mat, -hw, 0, hd, hw, 0, hd, hw, y, 0, -hw, y, 0));
  g.add(quad(mat, hw, 0, -hd, -hw, 0, -hd, -hw, y, 0, hw, y, 0));
  g.add(tri(mat, -hw, 0, -hd, -hw, 0, hd, -hw, y, 0));
  g.add(tri(mat, hw, 0, hd, hw, 0, -hd, hw, y, 0));
}

const HOUSE_FRONTS = [
  "rowhouse.jpg",
  "rowhouse_b.jpg",
  "rowhouse_c.jpg",
  "rowhouse_d.jpg",
  "rowhouse_e.jpg",
];

function houseFront(tile) {
  const i = Math.floor(hash(tile.x * 2.2, tile.z * 4.1) * HOUSE_FRONTS.length);
  return HOUSE_FRONTS[i % HOUSE_FRONTS.length];
}

function faceKit(loadTex, type, w, h, nightMap, tint, tile) {
  const def = DEFS[type];
  const fname = type === "house" ? houseFront(tile || { x: 0, z: 0 }) : def.facade;
  const src = fname ? loadTex(ASSET_PATHS[fname]) : null;
  const frontMap = src ? src.clone() : null;
  if (frontMap) {
    frontMap.wrapS = frontMap.wrapT = THREE.RepeatWrapping;
    if (type === "house" || type === "shop") frontMap.repeat.set(1, 1);
    else frontMap.repeat.set(Math.max(1, w / 6.6), Math.max(1, h / 3.2));
    frontMap.needsUpdate = true;
  }
  const sideMap = src ? (type === "shop" ? src.clone() : sideFrom(src)) : null;
  if (sideMap && type !== "house" && type !== "shop") {
    sideMap.repeat.set(Math.max(1, w / 7), Math.max(1, h / 3.2));
  } else if (sideMap) {
    sideMap.repeat.set(1, Math.max(1, h / 7.2));
  }
  const glass = !!def.glass;
  const front = frontMap
    ? std(frontMap, {
        roughness: glass ? 0.12 : 0.76,
        metalness: glass ? 0.62 : 0.03,
        color: tint,
      })
    : new THREE.MeshStandardMaterial({ color: tint });
  const side = sideMap
    ? std(sideMap, {
        roughness: glass ? 0.14 : 0.8,
        metalness: glass ? 0.55 : 0.03,
        color: tint,
      })
    : front;
  if (def.windows && nightMap) {
    front.emissiveMap = nightMap;
    front.emissive = new THREE.Color(0xffd2a0);
    front.emissiveIntensity = 0;
    side.emissiveMap = nightMap;
    side.emissive = new THREE.Color(0xffd2a0);
    side.emissiveIntensity = 0;
  }
  const roof = std(def.roof ? loadTex(ASSET_PATHS[def.roof]) : null, { roughness: 0.9 });
  const pad = std(loadTex(ASSET_PATHS[type === "house" ? "cobble.jpg" : "concrete.jpg"]), {
    roughness: 0.88,
    color: 0xe8e4dc,
  });
  return { front, side, roof, pad, glass };
}

function bodyMats(kit) {
  return [kit.side, kit.side, kit.roof, kit.pad, kit.front, kit.side];
}

function tintFor(type, seed) {
  if (type === "house") {
    const brick = [0xffffff, 0xf3e6d8, 0xe8d2c4, 0xd9c4b0, 0xf0ebe4];
    return brick[Math.floor(seed * brick.length)];
  }
  if (type === "shop") return seed > 0.5 ? 0xfff6ee : 0xffffff;
  if (DEFS[type]?.glass) return seed > 0.55 ? 0xe8f0f4 : 0xffffff;
  return 0xffffff;
}

export function createBuilding(type, tile, loadTex, nightMap) {
  const def = DEFS[type];
  const g = new THREE.Group();
  if (!def || type === "road" || type === "pier") return g;
  const seed = hash(tile.x * 3.1, tile.z * 5.7);
  const h = def.height * (tile.hScale || 1);
  const terrace = type === "house";
  const w = terrace ? CELL * 0.995 : def.footprint * CELL * (0.94 + seed * 0.08);
  const d = terrace
    ? CELL * (0.5 + seed * 0.16)
    : w * (type === "warehouse" || type === "factory" ? 0.95 : 0.88);
  const kit = faceKit(loadTex, type, w, h, nightMap, tintFor(type, seed), tile);

  if (type === "park") return parkBits(g);

  if (!terrace) {
    const lot = addBox(g, w + 0.7, 0.05, d + 0.9, kit.pad, 0, 0.03, 0.08);
    lot.castShadow = false;
  }

  if (type === "house" || type === "school") {
    const wallH = type === "house" ? h * 0.78 : h * 0.82;
    addBox(g, w, wallH, d, bodyMats(kit), 0, wallH * 0.5 + 0.06, 0);
    const roofG = new THREE.Group();
    gable(roofG, w + 0.12, d + 0.08, type === "house" ? 1.55 : 1.9, kit.roof);
    roofG.position.y = wallH + 0.06;
    g.add(roofG);
    if (type === "house") {
      const marble = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.55 });
      addBox(g, w * 0.3, 0.18, 0.72, marble, -w * 0.2, 0.12, d * 0.5 + 0.34);
      addBox(g, w * 0.24, 0.12, 0.48, marble, -w * 0.2, 0.26, d * 0.5 + 0.22);
      addBox(g, 0.08, 0.42, 0.08, marble, -w * 0.2 - 0.16, 0.42, d * 0.5 + 0.58);
      addBox(g, 0.08, 0.42, 0.08, marble, -w * 0.2 + 0.16, 0.42, d * 0.5 + 0.58);
      if (seed > 0.32) {
        addBox(g, 0.34, 0.95, 0.4, kit.side, w * 0.28, wallH + 0.95, -d * 0.12);
      }
      if (seed > 0.62) {
        addBox(g, 0.28, 0.7, 0.32, kit.side, -w * 0.22, wallH + 0.82, d * 0.08);
      }
      const cornice = addBox(g, w + 0.1, 0.14, d + 0.1, marble, 0, wallH + 0.05, 0);
      cornice.castShadow = false;
    }
    return g;
  }

  if (type === "shop") {
    addBox(g, w, h, d, bodyMats(kit), 0, h * 0.5 + 0.06, 0);
    addBox(g, w + 0.16, 0.2, d + 0.16, kit.roof, 0, h + 0.14, 0);
    const awnCols = [0x1f4a3a, 0x7a2a24, 0x2a3a5a, 0x6a4a22];
    const awn = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.92, 0.08, 0.7),
      new THREE.MeshStandardMaterial({ color: awnCols[Math.floor(seed * awnCols.length)], roughness: 0.7 })
    );
    awn.position.set(0, 3.15, d * 0.5 + 0.28);
    awn.castShadow = true;
    g.add(awn);
    return g;
  }

  if (type === "tower" || type === "office") {
    const podH = type === "tower" ? 7.2 : 5.4;
    const shaftW = w * (type === "tower" ? 0.72 : 0.82);
    const shaftD = d * (type === "tower" ? 0.72 : 0.84);
    addBox(g, w * 1.05, podH, d * 1.05, bodyMats(kit), 0, podH * 0.5 + 0.05, 0);
    addBox(g, shaftW, h - podH, shaftD, bodyMats(kit), 0, podH + (h - podH) * 0.5, 0);
    addBox(g, shaftW * 0.62, 2.2, shaftD * 0.62, kit.pad, 0, h + 1.0, 0);
    return g;
  }

  if (type === "warehouse" || type === "factory") {
    addBox(g, w, h, d, bodyMats(kit), 0, h * 0.5 + 0.06, 0);
    const roofG = new THREE.Group();
    gable(roofG, w + 0.1, d + 0.06, 1.35, kit.roof);
    roofG.position.y = h + 0.06;
    g.add(roofG);
    if (type === "factory") {
      const stack = new THREE.MeshStandardMaterial({ color: 0x4a433c, roughness: 0.7, metalness: 0.15 });
      addBox(g, 0.7, h * 0.7, 0.7, stack, w * 0.3, h + h * 0.25, d * 0.18);
      addBox(g, 0.52, h * 0.45, 0.52, stack, w * 0.12, h + h * 0.16, d * 0.28);
    }
    addBox(g, w * 0.28, h * 0.42, 0.12, kit.side, 0, h * 0.28, d * 0.5 + 0.02);
    addBox(g, w * 0.34, 0.18, 1.1, kit.pad, w * 0.18, 0.12, d * 0.5 + 0.55);
    return g;
  }

  addBox(g, w, h, d, bodyMats(kit), 0, h * 0.5 + 0.06, 0);
  addBox(g, w + 0.2, 0.28, d + 0.2, kit.roof, 0, h + 0.18, 0);
  if (type === "civic") {
    addBox(g, w * 0.4, 1.1, d * 0.4, kit.side, 0, h + 0.95, 0);
  }
  if (type === "hospital") {
    const cross = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 1.15, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xb83a32, roughness: 0.5, emissive: 0x3a1010 })
    );
    cross.position.set(0, h * 0.7, d * 0.5 + 0.05);
    g.add(cross);
  }
  if (type === "apartment") {
    addBox(g, w * 0.86, 1.6, d * 0.86, kit.side, 0, h + 0.7, 0);
    const rail = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.45, metalness: 0.35 });
    for (let i = 1; i < 4; i++) {
      addBox(g, w * 0.72, 0.08, 0.12, rail, 0, 2.2 * i, d * 0.5 + 0.08);
    }
  }
  return g;
}

function parkBits(g) {
  const hedge = new THREE.MeshStandardMaterial({ color: 0x314a2a, roughness: 0.92 });
  const path = new THREE.MeshStandardMaterial({ color: 0xb7a88c, roughness: 0.9 });
  addBox(g, 6.2, 0.04, 1.05, path, 0, 0.04, 0);
  addBox(g, 1.05, 0.04, 6.2, path, 0, 0.04, 0);
  for (const [ox, oz, sx, sz] of [
    [-2.2, 2.0, 1.7, 0.7],
    [2.15, -1.6, 1.3, 0.85],
    [0.2, 2.4, 1.1, 0.55],
    [-2.1, -2.1, 1.2, 0.6],
  ]) {
    addBox(g, sx, 0.5, sz, hedge, ox, 0.28, oz);
  }
  addBox(g, 1.45, 0.16, 0.36, new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.8 }), -0.5, 0.22, 0.15);
  return g;
}

export function createTree(tex, scale) {
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(scale * 0.78, scale);
  for (let i = 0; i < 2; i++) {
    const p = new THREE.Mesh(geo, mat);
    p.rotation.y = (i * Math.PI) / 2;
    p.position.y = scale * 0.5;
    p.castShadow = false;
    g.add(p);
  }
  return g;
}

export function createBoat() {
  const g = new THREE.Group();
  const hulls = [0x243038, 0x1e2c28, 0x3a241c, 0x2a3038];
  const hullMat = new THREE.MeshStandardMaterial({
    color: hulls[Math.floor(Math.random() * hulls.length)],
    roughness: 0.48,
    metalness: 0.12,
  });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.55, 1.45), hullMat);
  hull.position.y = 0.08;
  hull.castShadow = true;
  const bow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 0.85), hullMat);
  bow.position.set(2.4, 0.12, 0);
  bow.castShadow = true;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.72, 1.05),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.6 })
  );
  cabin.position.set(-0.55, 0.72, 0);
  cabin.castShadow = true;
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.38, 0.95),
    new THREE.MeshStandardMaterial({ color: 0x6a8490, roughness: 0.2, metalness: 0.4 })
  );
  glass.position.set(-0.15, 0.95, 0);
  g.add(hull, bow, cabin, glass);
  return g;
}

export function createCar(seed) {
  const g = new THREE.Group();
  const paints = [0x2a2c30, 0x5a5e62, 0x7a2a24, 0x1c2a38, 0xc8c4bc];
  const paint = paints[Math.floor(seed * paints.length)];
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.15, 0.42, 0.92),
    new THREE.MeshStandardMaterial({ color: paint, roughness: 0.38, metalness: 0.25 })
  );
  body.position.y = 0.36;
  body.castShadow = true;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.36, 0.84),
    new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.18, metalness: 0.35 })
  );
  cabin.position.set(-0.12, 0.68, 0);
  g.add(body, cabin);
  return g;
}
