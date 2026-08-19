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

const DET = {
  iron: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.42, metalness: 0.45 }),
  plant: new THREE.MeshStandardMaterial({ color: 0x2f4a28, roughness: 0.9 }),
  pot: new THREE.MeshStandardMaterial({ color: 0x7a4030, roughness: 0.8 }),
  lamp: new THREE.MeshStandardMaterial({
    color: 0xffe2b0,
    emissive: 0xffc070,
    emissiveIntensity: 0.25,
  }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x1a2428,
    roughness: 0.12,
    metalness: 0.35,
    envMapIntensity: 1.15,
    emissive: 0xffd2a0,
    emissiveIntensity: 0,
  }),
  grass: new THREE.MeshStandardMaterial({ color: 0x3a522c, roughness: 0.95 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.82 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.72 }),
  hvac: new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.45, metalness: 0.25 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.8 }),
  rust: new THREE.MeshStandardMaterial({ color: 0x6a4030, roughness: 0.7, metalness: 0.15 }),
};
DET.glass.userData.nightGlass = true;

const TREE_GEO = {
  trunk: new THREE.CylinderGeometry(1, 1.38, 1, 7),
  flare: new THREE.CylinderGeometry(1.35, 2.1, 1, 6),
  ico: new THREE.IcosahedronGeometry(1, 1),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  cone: new THREE.ConeGeometry(1, 1, 8),
  shadow: new THREE.CircleGeometry(1, 14),
  crown: new THREE.CircleGeometry(1, 18),
  card: new THREE.PlaneGeometry(1, 1.18),
  pit: new THREE.RingGeometry(0.7, 0.92, 12),
  dirt: new THREE.CircleGeometry(0.7, 12),
};

const barkMat = new THREE.MeshStandardMaterial({ color: 0x5c4634, roughness: 0.94, metalness: 0.02 });
const pineBarkMat = new THREE.MeshStandardMaterial({ color: 0x4a3c2e, roughness: 0.92 });
const shadowMat = new THREE.MeshBasicMaterial({
  color: 0x1a160e,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
});
const pitMat = new THREE.MeshStandardMaterial({ color: 0xc4bfb4, roughness: 0.88 });
const mulchMat = new THREE.MeshStandardMaterial({ color: 0x3d2c1c, roughness: 1 });
const leafCache = new Map();
const billCache = new Map();
const crownCache = new Map();

function leafMat(tex, hex, key) {
  let m = leafCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    map: tex || null,
    color: hex,
    roughness: 0.88,
    metalness: 0.02,
    emissive: new THREE.Color(0x1a2412),
    emissiveIntensity: 0.22,
  });
  leafCache.set(key, m);
  return m;
}

function plateMat(tex, test = 0.28) {
  const key = tex ? `${tex.uuid}:${tex.image && tex.image.width ? tex.image.width : 0}:${test}` : `none:${test}`;
  let m = billCache.get(key);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({
    map: tex || null,
    color: 0xffffff,
    transparent: true,
    alphaTest: test,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  billCache.set(key, m);
  return m;
}

const lumpyCrown = (() => {
  const geo = new THREE.CircleGeometry(1, 22);
  const pos = geo.attributes.position;
  for (let i = 1; i < pos.count; i++) {
    const n = 0.8 + Math.sin(i * 1.7) * 0.1 + Math.cos(i * 2.4) * 0.08;
    pos.setX(i, pos.getX(i) * n);
    pos.setY(i, pos.getY(i) * n);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
})();

function addBox(g, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function addCyl(g, rTop, rBot, h, mat, x, y, z, segs = 6) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

function acUnit(g, x, y, z) {
  addBox(g, 0.55, 0.32, 0.42, DET.hvac, x, y, z);
  addBox(g, 0.5, 0.05, 0.38, DET.iron, x, y + 0.18, z);
}

function dumpster(g, x, z, yaw = 0) {
  const grp = new THREE.Group();
  addBox(grp, 1.15, 0.72, 0.7, new THREE.MeshStandardMaterial({ color: 0x3a5a38, roughness: 0.6 }), 0, 0.38, 0);
  addBox(grp, 1.18, 0.06, 0.72, DET.iron, 0, 0.76, 0);
  addBox(grp, 0.08, 0.28, 0.08, DET.iron, 0.48, 0.86, 0.22);
  grp.position.set(x, 0, z);
  grp.rotation.y = yaw;
  g.add(grp);
}

function palletStack(g, x, z, n = 2) {
  for (let i = 0; i < n; i++) addBox(g, 0.88, 0.12, 0.72, DET.crate, x, 0.1 + i * 0.14, z);
}

function crate(g, x, z, s = 0.55) {
  addBox(g, s, s * 0.85, s * 0.9, DET.crate, x, s * 0.42, z);
}

function flagpole(g, x, z, col = 0x2a3a6a) {
  addCyl(g, 0.035, 0.045, 4.4, DET.iron, x, 2.25, z);
  addBox(g, 0.58, 0.34, 0.04, new THREE.MeshStandardMaterial({ color: col, roughness: 0.55 }), x + 0.34, 3.85, z);
}

function picnic(g, x, z) {
  addBox(g, 1.35, 0.08, 0.7, DET.wood, x, 0.48, z);
  addBox(g, 1.35, 0.06, 0.22, DET.wood, x, 0.32, z + 0.55);
  addBox(g, 1.35, 0.06, 0.22, DET.wood, x, 0.32, z - 0.55);
  addBox(g, 0.08, 0.44, 0.08, DET.wood, x - 0.5, 0.22, z);
  addBox(g, 0.08, 0.44, 0.08, DET.wood, x + 0.5, 0.22, z);
}

function fenceRun(g, len, x, z, yaw) {
  const grp = new THREE.Group();
  const n = Math.max(2, Math.floor(len / 0.7));
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    addBox(grp, 0.05, 0.72, 0.05, DET.wood, -len * 0.5 + u * len, 0.38, 0);
  }
  addBox(grp, len, 0.04, 0.04, DET.wood, 0, 0.68, 0);
  addBox(grp, len, 0.04, 0.04, DET.wood, 0, 0.38, 0);
  grp.position.set(x, 0, z);
  grp.rotation.y = yaw;
  g.add(grp);
}

function gutter(g, w, d, y) {
  addBox(g, w + 0.16, 0.05, 0.07, DET.iron, 0, y, d * 0.5 + 0.06);
  addBox(g, w + 0.16, 0.05, 0.07, DET.iron, 0, y, -d * 0.5 - 0.06);
  addBox(g, 0.05, y * 0.92, 0.05, DET.iron, w * 0.48, y * 0.46, d * 0.5 + 0.05);
  addBox(g, 0.05, y * 0.92, 0.05, DET.iron, -w * 0.48, y * 0.46, -d * 0.5 - 0.05);
}

function vent(g, x, y, z, r = 0.09) {
  addCyl(g, r, r + 0.02, 0.22, DET.iron, x, y, z, 6);
  addCyl(g, r + 0.03, r + 0.03, 0.04, DET.hvac, x, y + 0.12, z, 6);
}

function dressFlatRoof(g, w, d, y, seed) {
  const n = 2 + Math.floor(seed * 3);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.4) / (n + 0.2);
    acUnit(g, (u - 0.5) * w * 0.7, y + 0.2, ((seed * 7 + i) % 1 > 0.5 ? 0.18 : -0.16) * d);
  }
  vent(g, w * 0.22, y + 0.14, d * 0.18, 0.1);
  vent(g, -w * 0.18, y + 0.14, -d * 0.22, 0.08);
  if (seed > 0.4) addCyl(g, 0.28, 0.32, 0.55, DET.hvac, w * 0.28, y + 0.35, -d * 0.12, 8);
  if (seed > 0.62) addBox(g, 0.7, 0.22, 0.5, DET.iron, -w * 0.24, y + 0.18, d * 0.2);
  addBox(g, w + 0.16, 0.1, 0.08, DET.stone, 0, y + 0.08, d * 0.5 + 0.04);
  addBox(g, w + 0.16, 0.1, 0.08, DET.stone, 0, y + 0.08, -d * 0.5 - 0.04);
}

function windowAc(g, x, y, z) {
  addBox(g, 0.42, 0.28, 0.32, DET.hvac, x, y, z);
  addBox(g, 0.38, 0.04, 0.28, DET.iron, x, y + 0.14, z);
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
        roughness: glass ? 0.08 : 0.76,
        metalness: glass ? 0.72 : 0.03,
        envMapIntensity: glass ? 1.35 : 0.85,
        color: tint,
      })
    : new THREE.MeshStandardMaterial({ color: tint });
  const side = sideMap
    ? std(sideMap, {
        roughness: glass ? 0.1 : 0.8,
        metalness: glass ? 0.65 : 0.03,
        envMapIntensity: glass ? 1.2 : 0.8,
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
  if (!def || type === "road" || type === "pier" || type === "bulldoze") return g;
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
    addBox(g, w, wallH, d - 0.16, [kit.side, kit.side, kit.roof, kit.pad, kit.side, kit.side], 0, wallH * 0.5 + 0.06, -0.08);
    addBox(g, w, wallH, 0.1, kit.front, 0, wallH * 0.5 + 0.06, d * 0.5 - 0.05);
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
      addBox(g, 0.36, 1.05, 0.42, kit.side, w * 0.42, wallH + 1.02, -d * 0.08);
      if (seed > 0.38) {
        const ellW = w * 0.46;
        const ellD = d * 0.4;
        const ellH = wallH * 0.68;
        addBox(g, ellW, ellH, ellD, bodyMats(kit), w * 0.22, ellH * 0.5 + 0.06, -d * 0.42);
        const ellRoof = new THREE.Group();
        gable(ellRoof, ellW + 0.08, ellD + 0.06, 0.95, kit.roof);
        ellRoof.position.set(w * 0.22, ellH + 0.06, -d * 0.42);
        g.add(ellRoof);
      }
      if (seed > 0.55) {
        addBox(g, 0.85, 0.7, 0.18, kit.side, w * 0.12, wallH + 0.95, 0);
      }
      const cornice = addBox(g, w + 0.1, 0.14, d + 0.1, marble, 0, wallH + 0.05, 0);
      cornice.castShadow = false;
      addBox(g, w * 0.96, 0.08, 0.06, marble, 0, wallH * 0.52, d * 0.5 + 0.02);
      addBox(g, w * 0.2, 0.82, 0.07, DET.glass, -w * 0.22, wallH * 0.68, d * 0.5 + 0.01);
      addBox(g, w * 0.2, 0.82, 0.07, DET.glass, w * 0.2, wallH * 0.68, d * 0.5 + 0.01);
      addBox(g, w * 0.16, 1.55, 0.1, DET.iron, -w * 0.2, 0.88, d * 0.5 - 0.02);
      if (seed > 0.68) {
        addBox(
          g,
          0.52,
          0.3,
          0.36,
          new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.45, metalness: 0.2 }),
          w * 0.32,
          2.15,
          d * 0.5 + 0.12
        );
      }
      addBox(g, 0.05, wallH * 0.92, 0.05, DET.iron, w * 0.47, wallH * 0.48, d * 0.48);
      addBox(g, 0.42, 0.12, 0.16, DET.pot, w * 0.18, 1.35, d * 0.5 + 0.08);
      addBox(g, 0.38, 0.16, 0.12, DET.plant, w * 0.18, 1.48, d * 0.5 + 0.08);
      const stoopLight = addBox(g, 0.08, 0.1, 0.08, DET.lamp, -w * 0.2, 2.05, d * 0.5 + 0.04);
      stoopLight.userData.lamp = true;
      addBox(g, w + 0.16, 0.05, 0.08, DET.iron, 0, wallH + 1.58, 0);
      addBox(g, 0.05, 1.02, 0.05, DET.iron, w * 0.44, 0.52, d * 0.5 + 0.62);
      addBox(g, 0.16, 0.12, 0.24, DET.iron, w * 0.44, 1.08, d * 0.5 + 0.62);
      addBox(g, 0.18, 0.04, 0.08, new THREE.MeshStandardMaterial({ color: 0xc45a28, roughness: 0.55 }), w * 0.44, 1.16, d * 0.5 + 0.62);
      const yardZ = -d * 0.5 - 1.05;
      addBox(g, w * 0.94, 0.03, 1.7, DET.grass, 0, 0.03, yardZ);
      fenceRun(g, w * 0.92, 0, yardZ - 0.78, 0);
      fenceRun(g, 1.55, -w * 0.46, yardZ, Math.PI * 0.5);
      fenceRun(g, 1.55, w * 0.46, yardZ, Math.PI * 0.5);
      acUnit(g, w * 0.42, 0.28, -d * 0.15);
      addCyl(g, 0.08, 0.1, 0.28, DET.iron, w * 0.18, wallH + 1.72, -d * 0.12, 6);
      addCyl(g, 0.07, 0.09, 0.22, DET.iron, -w * 0.22, wallH + 1.68, d * 0.05, 6);
      if (seed > 0.42) {
        addBox(g, 0.38, 0.22, 0.28, DET.iron, -w * 0.28, 0.22, yardZ - 0.15);
        addBox(g, 0.42, 0.04, 0.32, DET.iron, -w * 0.28, 0.34, yardZ - 0.15);
      }
      if (seed > 0.62) {
        const dish = addBox(g, 0.36, 0.28, 0.08, DET.hvac, w * 0.28, wallH + 1.35, -d * 0.05);
        dish.rotation.x = -0.35;
      }
      addBox(g, 0.55, 0.42, 0.22, DET.plant, w * 0.32, 0.28, yardZ + 0.35);
      addBox(g, 0.42, 0.28, 0.18, DET.plant, -w * 0.38, 0.2, yardZ + 0.2);
      gutter(g, w, d, wallH + 0.08);
      vent(g, -w * 0.32, wallH + 1.72, -d * 0.18, 0.07);
      addBox(g, 0.28, 0.18, 0.04, DET.iron, w * 0.36, 1.55, d * 0.5 + 0.06);
      addBox(g, 0.52, 0.12, 0.16, DET.pot, -w * 0.08, 1.32, d * 0.5 + 0.08);
      addBox(g, 0.46, 0.14, 0.12, DET.plant, -w * 0.08, 1.44, d * 0.5 + 0.08);
    }
    if (type === "school") {
      flagpole(g, -w * 0.38, d * 0.55, 0x8a2030);
      addBox(g, 1.8, 0.04, 2.2, DET.stone, w * 0.28, 0.04, d * 0.55 + 0.4);
      addCyl(g, 0.05, 0.05, 1.6, DET.iron, w * 0.05, 0.85, d * 0.7);
      addCyl(g, 0.05, 0.05, 1.6, DET.iron, w * 0.5, 0.85, d * 0.7);
      addBox(g, 0.48, 0.05, 0.05, DET.iron, w * 0.28, 1.55, d * 0.7);
      addBox(g, 1.1, 0.7, 0.12, DET.stone, 0, 1.15, d * 0.52);
      gutter(g, w, d, wallH + 0.08);
      vent(g, w * 0.2, wallH + 2.05, 0, 0.1);
      acUnit(g, -w * 0.28, wallH + 2.05, d * 0.1);
    }
    return g;
  }

  if (type === "shop") {
    addBox(g, w, h, d, bodyMats(kit), 0, h * 0.5 + 0.06, 0);
    addBox(g, w + 0.2, 0.22, d + 0.2, kit.roof, 0, h + 0.16, 0);
    const signCols = [0x1f4a3a, 0x7a2a24, 0x2a3a5a, 0x6a4a22];
    const sign = signCols[Math.floor(seed * signCols.length)];
    addBox(g, w * 0.94, 0.42, 0.12, new THREE.MeshStandardMaterial({ color: sign, roughness: 0.65 }), 0, 3.55, d * 0.5 + 0.06);
    const pane = new THREE.MeshStandardMaterial({
      color: 0x7a96a0,
      roughness: 0.1,
      metalness: 0.45,
      envMapIntensity: 1.25,
      emissive: 0xffd2a0,
      emissiveIntensity: 0,
    });
    pane.userData.nightGlass = true;
    addBox(g, w * 0.78, 2.05, 0.06, pane, 0, 1.18, d * 0.5 + 0.05);
    const awn = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.92, 0.08, 0.7),
      new THREE.MeshStandardMaterial({ color: sign, roughness: 0.7 })
    );
    awn.position.set(0, 3.15, d * 0.5 + 0.28);
    awn.castShadow = true;
    g.add(awn);
    addBox(g, 0.08, 0.7, 0.42, new THREE.MeshStandardMaterial({ color: sign, roughness: 0.65 }), w * 0.48, 3.4, d * 0.2);
    addBox(g, 0.55, 0.18, 0.22, DET.pot, -w * 0.36, 0.16, d * 0.5 + 0.22);
    addBox(g, 0.48, 0.22, 0.18, DET.plant, -w * 0.36, 0.32, d * 0.5 + 0.22);
    const can = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.18, 0.52, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3e36, roughness: 0.55, metalness: 0.2 })
    );
    can.position.set(w * 0.42, 0.32, d * 0.5 + 0.28);
    can.castShadow = true;
    g.add(can);
    addBox(g, 0.28, 0.04, 0.28, DET.iron, w * 0.42, 0.58, d * 0.5 + 0.28);
    acUnit(g, -w * 0.28, h + 0.38, -d * 0.12);
    acUnit(g, w * 0.18, h + 0.38, d * 0.08);
    dumpster(g, w * 0.42, -d * 0.55, 0.2);
    addBox(g, 0.42, 0.72, 0.08, new THREE.MeshStandardMaterial({ color: sign, roughness: 0.7 }), -w * 0.22, 0.42, d * 0.5 + 0.55);
    addBox(g, 0.55, 0.06, 0.55, DET.wood, w * 0.18, 0.42, d * 0.5 + 0.7);
    addCyl(g, 0.08, 0.08, 0.4, DET.wood, w * 0.18, 0.2, d * 0.5 + 0.7, 6);
    dressFlatRoof(g, w, d, h + 0.22, seed);
    vent(g, 0, h + 0.32, 0, 0.12);
    addBox(g, 0.22, 0.08, 0.55, DET.iron, w * 0.22, 0.1, d * 0.5 + 0.85);
    return g;
  }

  if (type === "tower" || type === "office") {
    const podH = type === "tower" ? 6.4 : 5.2;
    const midH = (h - podH) * 0.58;
    const topH = Math.max(3.2, h - podH - midH);
    const midW = w * (type === "tower" ? 0.78 : 0.86);
    const midD = d * (type === "tower" ? 0.78 : 0.88);
    const topW = midW * 0.74;
    const topD = midD * 0.74;
    addBox(g, w * 1.06, podH, d * 1.06, bodyMats(kit), 0, podH * 0.5 + 0.05, 0);
    addBox(g, midW, midH, midD, bodyMats(kit), 0, podH + midH * 0.5, 0);
    addBox(g, topW, topH, topD, bodyMats(kit), 0, podH + midH + topH * 0.5, 0);
    addBox(g, topW * 0.55, 2.4, topD * 0.5, kit.pad, 0, h + 1.1, 0);
    const mull = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.28, metalness: 0.55 });
    const cols = type === "tower" ? 5 : 4;
    for (let i = 0; i < cols; i++) {
      const x = -midW * 0.42 + (i / (cols - 1)) * midW * 0.84;
      addBox(g, 0.07, h - podH * 0.35, 0.07, mull, x, podH + (h - podH) * 0.48, midD * 0.5 + 0.03);
    }
    if (type === "tower") {
      const steel = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.35, metalness: 0.55 });
      addBox(g, 0.12, 4.6, 0.12, steel, 0.2, h + 3.4, 0.15);
      addBox(g, 1.4, 0.7, 1.1, kit.pad, -topW * 0.18, h + 0.55, 0);
    }
    acUnit(g, topW * 0.22, h + 0.28, -topD * 0.18);
    acUnit(g, -topW * 0.28, h + 0.28, topD * 0.12);
    addBox(g, w * 0.42, 0.18, 0.7, kit.pad, 0, 3.15, d * 0.55);
    addBox(g, 0.7, 0.55, 0.7, DET.plant, -w * 0.42, 0.35, d * 0.58);
    addBox(g, 0.7, 0.55, 0.7, DET.plant, w * 0.42, 0.35, d * 0.58);
    dressFlatRoof(g, topW, topD, h + 0.12, seed);
    addCyl(g, 0.42, 0.48, 0.85, DET.hvac, topW * 0.18, h + 0.55, topD * 0.18, 8);
    addCyl(g, 0.32, 0.36, 0.65, DET.hvac, -topW * 0.22, h + 0.45, -topD * 0.16, 8);
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
    palletStack(g, -w * 0.38, d * 0.55, 3);
    palletStack(g, -w * 0.18, d * 0.62, 2);
    crate(g, w * 0.38, d * 0.58, 0.62);
    crate(g, w * 0.48, d * 0.38, 0.48);
    dumpster(g, -w * 0.42, -d * 0.48, 0.1);
    addCyl(g, 0.16, 0.18, 0.55, DET.rust, w * 0.32, h + 1.55, -d * 0.12);
    addCyl(g, 0.14, 0.16, 0.42, DET.rust, w * 0.18, h + 1.48, d * 0.1);
    fenceRun(g, w * 0.7, -w * 0.15, d * 0.72, 0);
    vent(g, -w * 0.28, h + 1.48, d * 0.12, 0.11);
    vent(g, w * 0.12, h + 1.48, -d * 0.2, 0.09);
    addBox(g, 1.1, 0.35, 0.7, DET.crate, w * 0.28, 0.24, d * 0.62);
    return g;
  }

  if (type !== "apartment") {
    addBox(g, w, h, d, bodyMats(kit), 0, h * 0.5 + 0.06, 0);
    addBox(g, w + 0.2, 0.28, d + 0.2, kit.roof, 0, h + 0.18, 0);
  }
  if (type === "civic") {
    addBox(g, w * 0.4, 1.1, d * 0.4, kit.side, 0, h + 0.95, 0);
    const col = new THREE.MeshStandardMaterial({ color: 0xe8e0d2, roughness: 0.62 });
    for (const ox of [-w * 0.32, 0, w * 0.32]) {
      addBox(g, 0.38, h * 0.55, 0.38, col, ox, h * 0.28, d * 0.52);
    }
    addBox(g, w * 0.92, 0.22, 0.7, kit.pad, 0, h * 0.58, d * 0.52);
    flagpole(g, -w * 0.42, d * 0.62, 0x2a3a6a);
    addBox(g, 0.72, 0.5, 0.72, DET.plant, w * 0.4, 0.32, d * 0.62);
    dressFlatRoof(g, w * 0.86, d * 0.86, h + 0.32, seed);
  }
  if (type === "hospital") {
    const cross = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 1.15, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xb83a32, roughness: 0.5, emissive: 0x3a1010 })
    );
    cross.position.set(0, h * 0.7, d * 0.5 + 0.05);
    g.add(cross);
    addBox(g, w * 0.55, 0.16, 1.4, kit.pad, 0, 3.4, d * 0.55);
    flagpole(g, w * 0.42, d * 0.62, 0xb83a32);
    acUnit(g, -w * 0.28, h + 0.42, -d * 0.2);
    acUnit(g, w * 0.22, h + 0.42, d * 0.1);
    dressFlatRoof(g, w * 0.8, d * 0.8, h + 0.32, seed);
    vent(g, 0, h + 0.42, -d * 0.18, 0.12);
  }
  if (type === "apartment") {
    addBox(g, w, h, d - 0.14, [kit.side, kit.side, kit.roof, kit.pad, kit.side, kit.side], 0, h * 0.5 + 0.06, -0.06);
    addBox(g, w, h, 0.1, kit.front, 0, h * 0.5 + 0.06, d * 0.5 - 0.04);
    for (let i = 1; i <= 3; i++) {
      addBox(g, w * 0.72, 0.55, 0.07, DET.glass, 0, 1.4 + i * 2.05, d * 0.5 + 0.02);
    }
    addBox(g, w * 0.86, 1.6, d * 0.86, kit.side, 0, h + 0.7, 0);
    addBox(g, w + 0.12, 0.22, d + 0.12, kit.pad, 0, h + 0.08, 0);
    addBox(g, w + 0.06, 1.15, d + 0.06, kit.side, 0, 0.7, 0);
    const rail = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.45, metalness: 0.35 });
    for (let i = 1; i < 5; i++) {
      addBox(g, w * 0.72, 0.08, 0.12, rail, 0, 2.15 * i, d * 0.5 + 0.08);
    }
    addBox(g, 0.08, h * 0.72, 0.08, rail, w * 0.5 + 0.06, h * 0.4, d * 0.18);
    addBox(g, 0.08, h * 0.72, 0.08, rail, w * 0.5 + 0.06, h * 0.4, -d * 0.18);
    addBox(g, 0.06, 0.06, d * 0.42, rail, w * 0.5 + 0.06, h * 0.72, 0);
    addBox(g, 0.7, 0.28, 0.42, DET.iron, -w * 0.28, h + 1.55, d * 0.2);
    acUnit(g, w * 0.22, h + 1.85, -d * 0.15);
    acUnit(g, -w * 0.18, h + 1.85, d * 0.12);
    dumpster(g, w * 0.42, -d * 0.48, 0.15);
    addBox(g, w * 0.36, 0.16, 0.7, kit.pad, -w * 0.12, 0.14, d * 0.55);
    addBox(g, 0.85, 0.7, 0.85, DET.plant, -w * 0.4, 0.4, d * 0.55);
    for (let i = 1; i <= 4; i++) {
      windowAc(g, -w * 0.28, 1.55 + i * 2.05, d * 0.5 + 0.18);
      if (seed + i * 0.13 > 0.55) windowAc(g, w * 0.26, 1.7 + i * 2.05, d * 0.5 + 0.18);
      addBox(g, 0.48, 0.1, 0.16, DET.pot, w * 0.18, 2.15 * i + 0.12, d * 0.5 + 0.16);
      addBox(g, 0.42, 0.12, 0.12, DET.plant, w * 0.18, 2.15 * i + 0.22, d * 0.5 + 0.16);
    }
    vent(g, w * 0.12, h + 1.85, -d * 0.22, 0.1);
    addBox(g, w + 0.14, 0.08, 0.08, DET.stone, 0, h + 0.18, d * 0.5 + 0.04);
  }
  return g;
}

function parkBits(g) {
  const hedge = new THREE.MeshStandardMaterial({ color: 0x314a2a, roughness: 0.92 });
  const path = new THREE.MeshStandardMaterial({ color: 0xb7a88c, roughness: 0.9 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.8 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.72 });
  addBox(g, 6.2, 0.04, 1.05, path, 0, 0.04, 0);
  addBox(g, 1.05, 0.04, 6.2, path, 0, 0.04, 0);
  for (const [ox, oz, rx, rz] of [
    [-2.2, 2.0, 0.95, 0.55],
    [2.15, -1.6, 0.75, 0.62],
    [0.2, 2.45, 0.58, 0.42],
    [-2.15, -2.1, 0.7, 0.5],
  ]) {
    const bush = new THREE.Mesh(TREE_GEO.ico, hedge);
    bush.scale.set(rx, 0.4, rz);
    bush.position.set(ox, 0.34, oz);
    bush.castShadow = true;
    g.add(bush);
  }
  addBox(g, 1.55, 0.08, 0.42, wood, -0.55, 0.42, 0.85);
  addBox(g, 1.55, 0.44, 0.07, wood, -0.55, 0.68, 0.62);
  addBox(g, 0.07, 0.4, 0.07, DET.iron, -1.2, 0.2, 0.98);
  addBox(g, 0.07, 0.4, 0.07, DET.iron, 0.1, 0.2, 0.98);
  addBox(g, 0.07, 0.4, 0.07, DET.iron, -1.2, 0.2, 0.68);
  addBox(g, 0.07, 0.4, 0.07, DET.iron, 0.1, 0.2, 0.68);
  addBox(g, 1.2, 0.08, 0.38, wood, 1.45, 0.4, -1.85);
  addBox(g, 0.06, 0.38, 0.06, DET.iron, 0.98, 0.2, -1.7);
  addBox(g, 0.06, 0.38, 0.06, DET.iron, 1.92, 0.2, -1.7);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.45, 6), DET.iron);
  pole.position.set(2.25, 1.25, 1.85);
  pole.castShadow = true;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), DET.lamp);
  bulb.position.set(2.25, 2.5, 1.85);
  bulb.userData.lamp = true;
  const pglow = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 10),
    new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.12, depthWrite: false })
  );
  pglow.rotation.x = -Math.PI / 2;
  pglow.position.set(2.25, 0.06, 1.85);
  pglow.userData.lampGlow = true;
  g.add(pglow);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.94, 0.28, 12), stone);
  basin.position.set(0, 0.18, 0);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(0.68, 12),
    new THREE.MeshStandardMaterial({ color: 0x4a7a82, roughness: 0.14, metalness: 0.28 })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.33, 0);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.46, 8), stone);
  spout.position.set(0, 0.5, 0);
  const spray = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.08, 0.85, 6),
    new THREE.MeshStandardMaterial({ color: 0xa8c4c8, roughness: 0.2, transparent: true, opacity: 0.45 })
  );
  spray.position.set(0, 1.05, 0);
  g.add(pole, bulb, basin, pool, spout, spray);
  picnic(g, -1.8, -0.4);
  addCyl(g, 0.14, 0.16, 0.48, DET.iron, 2.4, 0.28, -0.4);
  addBox(g, 1.4, 0.04, 1.4, DET.stone, 1.9, 0.04, 0.2);
  addCyl(g, 0.04, 0.04, 1.35, DET.iron, 1.55, 0.72, 0.05);
  addCyl(g, 0.04, 0.04, 1.35, DET.iron, 2.25, 0.72, 0.35);
  addBox(g, 0.72, 0.04, 0.04, DET.iron, 1.9, 1.35, 0.2);
  addBox(g, 0.55, 0.35, 0.55, DET.plant, -2.4, 0.22, 0.15);
  return g;
}

export function createTree(kind, scale, seed = 0.5, plates = {}, opts = {}) {
  const g = new THREE.Group();
  const sc = Math.max(1.4, scale);
  const isPine = kind === "pine";
  const isShrub = kind === "shrub";
  const rich = opts.quality !== "low";
  g.userData.phase = seed * Math.PI * 2;

  const sh = new THREE.Mesh(TREE_GEO.shadow, shadowMat);
  sh.rotation.x = -Math.PI / 2;
  sh.position.y = 0.02;
  const shR = isShrub ? sc * 0.4 : isPine ? sc * 0.26 : sc * 0.38;
  sh.scale.set(shR, shR, 1);
  sh.renderOrder = 1;
  g.add(sh);

  if (opts.pit) {
    const pit = new THREE.Mesh(TREE_GEO.pit, pitMat);
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = 0.035;
    const dirt = new THREE.Mesh(TREE_GEO.dirt, mulchMat);
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.y = 0.028;
    g.add(pit, dirt);
  }

  const sway = new THREE.Group();
  g.add(sway);
  g.userData.sway = sway;

  if (!isShrub) {
    const trunkH = isPine ? sc * 0.4 : sc * 0.32;
    const trunkR = isPine ? sc * 0.024 : sc * 0.034;
    const trunk = new THREE.Mesh(TREE_GEO.trunk, isPine ? pineBarkMat : barkMat);
    trunk.scale.set(trunkR, trunkH, trunkR);
    trunk.position.y = trunkH * 0.5;
    trunk.castShadow = opts.quality !== "low";
    g.add(trunk);
    const flare = new THREE.Mesh(TREE_GEO.flare, isPine ? pineBarkMat : barkMat);
    flare.scale.set(trunkR, sc * 0.05, trunkR);
    flare.position.y = sc * 0.026;
    g.add(flare);
  }

  const mapped = !!(plates.leaves || plates.needles);
  const tints = mapped
    ? {
        oak: [0xd8e0c4, 0xc8d4b0, 0xe0d8b0],
        maple: [0xe0d8a8, 0xd0d8b0, 0xe8d090],
        pine: [0xb8c4a8, 0xa8b898, 0xc4d0b0],
        shrub: [0xb8c8a0, 0xa8bc90],
      }
    : {
        oak: [0x3f5c32, 0x4a6a38, 0x35542c],
        maple: [0x4a6a30, 0x5a7234, 0x6a6828],
        pine: [0x2d4a30, 0x355438, 0x243c28],
        shrub: [0x314a2a, 0x3a552e],
      };
  const palette = tints[kind] || tints.oak;
  const tint = palette[Math.floor(seed * palette.length) % palette.length];
  const foliage = isPine ? plates.needles || plates.leaves : plates.leaves;
  const mat = leafMat(foliage, tint, `${kind}:${tint}:${foliage && foliage.uuid ? foliage.uuid : "x"}`);
  mat.emissive = new THREE.Color(0x1c2414);
  mat.emissiveIntensity = 0.16;

  if (isPine) {
    const layers = rich ? 6 : 4;
    for (let i = 0; i < layers; i++) {
      const u = layers === 1 ? 0 : i / (layers - 1);
      const cone = new THREE.Mesh(TREE_GEO.cone, mat);
      const r = sc * (0.3 - u * 0.2) * (0.92 + ((i * 17) % 7) * 0.02);
      const h = sc * (0.22 - u * 0.02);
      cone.scale.set(r, h, r);
      cone.position.set(
        Math.sin(seed * 8 + i) * sc * 0.03,
        sc * (0.26 + u * 0.5),
        Math.cos(seed * 6 + i) * sc * 0.03
      );
      cone.rotation.y = seed * 6 + i * 0.55;
      cone.rotation.z = (seed - 0.5) * 0.08;
      cone.castShadow = opts.quality === "high" && i === 1;
      sway.add(cone);
    }
    addBox(sway, sc * 0.03, sc * 0.14, sc * 0.03, pineBarkMat, sc * 0.04, sc * 0.42, 0);
  } else if (isShrub) {
    const n = rich ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const blob = new THREE.Mesh(TREE_GEO.sphere, mat);
      const r = sc * (0.4 - i * 0.07);
      blob.scale.set(r * 1.15, r * 0.62, r);
      blob.position.set((seed - 0.5) * sc * 0.14 * (i + 1), sc * (0.28 + i * 0.06), (i - 1) * sc * 0.07);
      blob.rotation.set(seed * 0.5, seed * 4 + i, seed * 0.3);
      blob.castShadow = i === 0;
      sway.add(blob);
    }
    if (plates.side) {
      const disc = new THREE.Mesh(lumpyCrown, plateMat(plates.side, 0.28));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = sc * 0.4;
      disc.scale.set(sc * 0.48, sc * 0.44, 1);
      sway.add(disc);
    }
  } else {
    const canopy = plates.leaves ? plateMat(plates.leaves, 0.02) : mat;
    const blobs = rich
      ? [
          [0, 0.52, 0, 0.34, 0.16, 0.32],
          [0.17, 0.49, 0.12, 0.2, 0.12, 0.18],
          [-0.18, 0.48, -0.1, 0.19, 0.11, 0.17],
          [0.07, 0.47, -0.17, 0.18, 0.11, 0.17],
          [-0.09, 0.6, 0.06, 0.16, 0.1, 0.15],
          [0.11, 0.58, -0.08, 0.14, 0.09, 0.13],
          [-0.04, 0.44, 0.14, 0.15, 0.09, 0.14],
        ]
      : [
          [0, 0.52, 0, 0.34, 0.16, 0.32],
          [0.14, 0.49, 0.09, 0.18, 0.11, 0.16],
        ];
    for (let i = 0; i < blobs.length; i++) {
      const [x, y, z, sx, sy, sz] = blobs[i];
      const blob = new THREE.Mesh(TREE_GEO.sphere, canopy);
      blob.scale.set(sc * sx, sc * sy, sc * sz);
      blob.position.set(sc * (x + (seed - 0.5) * 0.05), sc * y, sc * z);
      blob.rotation.set(seed * 0.4, seed * 5 + i, seed * 0.3);
      blob.castShadow = opts.quality === "high" && i === 0;
      sway.add(blob);
    }
    addBox(sway, sc * 0.04, sc * 0.16, sc * 0.04, barkMat, sc * 0.08, sc * 0.4, sc * 0.04);
    addBox(sway, sc * 0.035, sc * 0.12, sc * 0.035, barkMat, -sc * 0.07, sc * 0.38, -sc * 0.03);
    if (plates.crown) {
      const pmat = plateMat(plates.crown, 0.3);
      for (const [x, y, z, r] of [
        [0.02, 0.56, 0, 0.2],
        [0.12, 0.54, 0.08, 0.14],
        [-0.1, 0.53, -0.07, 0.13],
      ]) {
        const disc = new THREE.Mesh(lumpyCrown, pmat);
        disc.rotation.x = -Math.PI / 2;
        disc.rotation.z = seed * 4 + r * 8;
        disc.position.set(sc * x, sc * y, sc * z);
        disc.scale.set(sc * r, sc * r * 0.88, 1);
        sway.add(disc);
      }
    }
  }

  return g;
}

export function createBoat(seed = Math.random()) {
  const g = new THREE.Group();
  const hulls = [0x243038, 0x1e2c28, 0x3a241c, 0x2a3038, 0x8a2a1c];
  const hullMat = new THREE.MeshStandardMaterial({
    color: hulls[Math.floor(seed * hulls.length)],
    roughness: 0.48,
    metalness: 0.12,
  });
  const work = seed > 0.55;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(work ? 5.6 : 4.4, 0.55, work ? 1.55 : 1.28), hullMat);
  hull.position.y = 0.08;
  hull.castShadow = true;
  const bow = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.4, work ? 0.9 : 0.72), hullMat);
  bow.position.set(work ? 2.55 : 2.05, 0.12, 0);
  bow.castShadow = true;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(work ? 1.7 : 1.25, work ? 0.82 : 0.62, work ? 1.12 : 0.92),
    new THREE.MeshStandardMaterial({ color: seed > 0.7 ? 0xc8b89a : 0xd8d2c6, roughness: 0.6 })
  );
  cabin.position.set(work ? -0.65 : -0.4, work ? 0.78 : 0.66, 0);
  cabin.castShadow = true;
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.38, work ? 1.0 : 0.82),
    new THREE.MeshStandardMaterial({ color: 0x6a8490, roughness: 0.2, metalness: 0.4 })
  );
  glass.position.set(work ? -0.2 : -0.05, work ? 1.02 : 0.88, 0);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(work ? 5.0 : 3.9, 0.06, work ? 1.62 : 1.34), DET.iron);
  rail.position.y = 0.38;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, work ? 2.8 : 2.1, 6), DET.iron);
  mast.position.set(work ? 0.9 : 0.65, work ? 1.7 : 1.35, 0);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), DET.lamp);
  light.position.set(work ? -0.65 : -0.4, work ? 1.28 : 1.08, 0);
  light.userData.lamp = true;
  addCyl(g, 0.07, 0.07, 0.32, DET.rust, work ? 1.6 : 1.2, 0.22, work ? 0.82 : 0.68);
  addCyl(g, 0.07, 0.07, 0.32, DET.rust, work ? 1.6 : 1.2, 0.22, work ? -0.82 : -0.68);
  if (work) crate(g, -1.8, 0.15, 0.38);
  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(work ? 7.2 : 5.6, work ? 1.6 : 1.25),
    new THREE.MeshBasicMaterial({
      color: 0xc5d2ce,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    })
  );
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(-0.8, 0.03, 0);
  g.add(hull, bow, cabin, glass, rail, mast, light, wake);
  return g;
}

export function createCar(seed, kind = "car") {
  const g = new THREE.Group();
  const paints = [0x2a2c30, 0x5a5e62, 0x7a2a24, 0x1c2a38, 0xc8c4bc, 0x2a4a38, 0x6a3a18, 0x1a3a5c];
  const bus = kind === "bus";
  const paint = bus ? 0xc9b25a : paints[Math.floor(seed * paints.length)];
  const bodyMat = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.38, metalness: 0.25 });
  const pickup = !bus && seed > 0.72;
  const len = bus ? 3.55 : pickup ? 2.35 : 2.15;
  const wid = bus ? 1.18 : pickup ? 0.98 : 0.92;
  const body = new THREE.Mesh(new THREE.BoxGeometry(len, bus ? 0.62 : 0.42, wid), bodyMat);
  body.position.y = bus ? 0.52 : 0.36;
  body.castShadow = true;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(bus ? 2.4 : pickup ? 0.85 : 1.05, bus ? 0.55 : 0.36, bus ? 1.1 : pickup ? 0.9 : 0.84),
    new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.18, metalness: 0.35 })
  );
  cabin.position.set(bus ? -0.15 : pickup ? -0.45 : -0.12, bus ? 0.98 : 0.68, 0);
  if (pickup) addBox(g, 0.95, 0.22, 0.88, DET.iron, 0.55, 0.48, 0);
  addBox(g, 0.08, 0.26, bus ? 1.0 : pickup ? 0.82 : 0.76, DET.glass, bus ? 1.05 : pickup ? -0.02 : 0.4, bus ? 0.98 : 0.74, 0);
  addBox(
    g,
    0.12,
    0.1,
    bus ? 0.9 : 0.7,
    new THREE.MeshStandardMaterial({ color: 0xf2e6c4, roughness: 0.35, emissive: 0xf2e6c4, emissiveIntensity: 0.22 }),
    len * 0.48,
    bus ? 0.42 : 0.32,
    0
  );
  addBox(
    g,
    0.1,
    0.08,
    bus ? 0.82 : 0.62,
    new THREE.MeshStandardMaterial({ color: 0x8a1c16, roughness: 0.45, emissive: 0x4a0808, emissiveIntensity: 0.2 }),
    -len * 0.48,
    bus ? 0.42 : 0.32,
    0
  );
  addBox(g, 0.16, 0.08, wid + 0.04, DET.iron, len * 0.5, 0.22, 0);
  addBox(g, 0.14, 0.08, wid + 0.04, DET.iron, -len * 0.5, 0.22, 0);
  const axles = bus
    ? [
        [-1.2, 0.52],
        [0.15, 0.52],
        [1.2, 0.52],
        [-1.2, -0.52],
        [0.15, -0.52],
        [1.2, -0.52],
      ]
    : [
        [-0.7, 0.42],
        [0.7, 0.42],
        [-0.7, -0.42],
        [0.7, -0.42],
      ];
  const wheels = [];
  for (const [ox, oz] of axles) {
    const hub = new THREE.Group();
    hub.position.set(ox, 0.16, oz);
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8), DET.rubber);
    wh.rotation.x = Math.PI * 0.5;
    hub.add(wh);
    g.add(hub);
    wheels.push(hub);
  }
  g.add(body, cabin);
  g.userData.wheels = wheels;
  g.userData.kind = kind;
  return g;
}
