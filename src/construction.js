import * as THREE from "three";
import { ASSET_PATHS, DEFS } from "./buildings.js";
import { CELL, isInfra, tileAt } from "./city.js";

export const BUILD_SEC = {
  road: 4,
  cobble: 5,
  park: 7,
  house: 9,
  shop: 10,
  market: 9,
  apartment: 16,
  office: 18,
  warehouse: 12,
  factory: 16,
  hospital: 20,
  clinic: 12,
  school: 14,
  civic: 18,
  fire: 13,
  tower: 26,
  power: 16,
  cistern: 13,
  sewer: 15,
  exchange: 14,
  pier: 5,
};

export function isBuilt(t) {
  if (!t || !t.kind) return false;
  return (t.build ?? 1) >= 1;
}

export function buildLabel(type, p) {
  const n = type;
  if (p >= 1) return "Complete";
  if (n === "road" || n === "cobble") {
    if (p < 0.35) return "Cutting grade";
    if (p < 0.7) return "Stone base";
    return n === "cobble" ? "Setting stones" : "Paving";
  }
  if (n === "park") {
    if (p < 0.3) return "Site fence";
    if (p < 0.65) return "Grading";
    return "Sod and trees";
  }
  if (n === "pier") {
    if (p < 0.4) return "Driving piles";
    if (p < 0.75) return "Laying deck";
    return "Fitting dock";
  }
  if (n === "house" || n === "shop" || n === "market" || n === "school" || n === "clinic") {
    if (p < 0.22) return "Excavation";
    if (p < 0.5) return "Framing";
    if (p < 0.75) return "Sheathing";
    return "Brick and roof";
  }
  if (n === "tower" || n === "office") {
    if (p < 0.18) return "Foundations";
    if (p < 0.55) return "Steel rising";
    if (p < 0.78) return "Floors";
    return "Curtain wall";
  }
  if (n === "apartment" || n === "hospital" || n === "civic") {
    if (p < 0.2) return "Excavation";
    if (p < 0.55) return "Concrete core";
    if (p < 0.8) return "Floors";
    return "Cladding";
  }
  if (n === "warehouse" || n === "factory" || n === "fire" || n === "power" || n === "sewer") {
    if (p < 0.25) return "Slab";
    if (p < 0.65) return "Steel bays";
    return "Siding";
  }
  if (n === "cistern") {
    if (p < 0.28) return "Footings";
    if (p < 0.7) return "Raising tank";
    return "Fitting mains";
  }
  if (n === "exchange") {
    if (p < 0.28) return "Footings";
    if (p < 0.7) return "Racking frames";
    return "Cutting over";
  }
  return "Building";
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function rise(p, a, b) {
  return clamp01((p - a) / (b - a));
}

function std(map, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    roughness: extra.roughness ?? 0.82,
    metalness: extra.metalness ?? 0.04,
    ...extra,
  });
}

function mats(loadTex) {
  return {
    ply: std(loadTex(ASSET_PATHS["plywood.jpg"])),
    steel: std(loadTex(ASSET_PATHS["steel.jpg"]), { metalness: 0.62, roughness: 0.42 }),
    lumber: std(loadTex(ASSET_PATHS["lumber.jpg"])),
    tarp: std(loadTex(ASSET_PATHS["tarp.jpg"]), { roughness: 0.62 }),
    fence: std(loadTex(ASSET_PATHS["silt_fence.jpg"]), { roughness: 0.7 }),
    scaf: std(loadTex(ASSET_PATHS["scaffold.jpg"]), { metalness: 0.35, roughness: 0.5 }),
    dirt: std(loadTex(ASSET_PATHS["dirt.jpg"])),
    conc: std(loadTex(ASSET_PATHS["concrete.jpg"])),
    gravel: std(loadTex(ASSET_PATHS["dirt.jpg"]), { color: 0xb8b0a4 }),
    asph: std(loadTex(ASSET_PATHS["asphalt.jpg"])),
    wood: std(loadTex(ASSET_PATHS["wood_dock.jpg"])),
    grass: std(loadTex(ASSET_PATHS["grass.jpg"])),
  };
}

function box(g, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function fenceRing(g, m, s, h, mat) {
  const f = mat || m.fence;
  const t = 0.08;
  box(g, new THREE.BoxGeometry(s, h, t), f, 0, h * 0.5, s * 0.5);
  box(g, new THREE.BoxGeometry(s, h, t), f, 0, h * 0.5, -s * 0.5);
  box(g, new THREE.BoxGeometry(t, h, s), f, s * 0.5, h * 0.5, 0);
  box(g, new THREE.BoxGeometry(t, h, s), f, -s * 0.5, h * 0.5, 0);
}

function dirtPile(g, m, x, z, s) {
  box(g, new THREE.BoxGeometry(s, s * 0.35, s * 0.8), m.dirt, x, s * 0.16, z);
}

function lumberStack(g, m, x, z) {
  box(g, new THREE.BoxGeometry(1.6, 0.7, 0.7), m.lumber, x, 0.38, z);
}

function siteBase(g, m, p, size) {
  fenceRing(g, m, size, 1.4, m.ply);
  if (p < 0.55) dirtPile(g, m, size * 0.42, -size * 0.38, 1.2);
}

export function makeConstruction(tile, loadTex) {
  const g = new THREE.Group();
  g.userData.kind = tile.kind;
  fillSite(g, tile, loadTex);
  return g;
}

export function syncConstruction(g, tile, loadTex) {
  const step = Math.floor((tile.build || 0) * 20);
  if (g.userData.kind === tile.kind && g.userData.step === step) return;
  g.clear();
  g.userData.kind = tile.kind;
  g.userData.step = step;
  fillSite(g, tile, loadTex);
}

function fillSite(g, tile, loadTex) {
  const p = tile.build || 0;
  const def = DEFS[tile.kind];
  if (!def) return;
  const m = mats(loadTex);
  const fp = (def.footprint || 0.8) * CELL;
  const H = def.height * (tile.hScale || 1);
  switch (tile.kind) {
    case "road":
    case "cobble":
      roadSite(g, m, p);
      break;
    case "park":
      parkSite(g, m, p, fp);
      break;
    case "pier":
      pierSite(g, m, p);
      break;
    case "house":
    case "shop":
    case "market":
    case "school":
      woodSite(g, m, p, fp, H, tile.kind, loadTex);
      break;
    case "tower":
    case "office":
      steelSite(g, m, p, fp, H, tile.kind, loadTex);
      break;
    case "warehouse":
    case "factory":
    case "fire":
    case "power":
    case "sewer":
      shedSite(g, m, p, fp, H, tile.kind, loadTex);
      break;
    default:
      concreteSite(g, m, p, fp, H, tile.kind, loadTex);
  }
}

function roadSite(g, m, p) {
  const cut = rise(p, 0, 0.35);
  box(g, new THREE.BoxGeometry(CELL * 0.92, 0.12, CELL * 0.92), m.dirt, 0, -0.02, 0);
  if (cut > 0) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.78, 0.08, CELL * 0.78), m.gravel);
    base.position.y = 0.02;
    base.scale.set(1, 1, 0.2 + cut * 0.8);
    base.receiveShadow = true;
    g.add(base);
  }
  const pave = rise(p, 0.55, 1);
  if (pave > 0) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.62, 0.07, CELL * 0.62), m.asph);
    a.position.y = 0.06;
    a.scale.set(1, 1, pave);
    a.receiveShadow = true;
    g.add(a);
  }
}

function parkSite(g, m, p, fp) {
  if (p < 0.92) fenceRing(g, m, fp * 0.95, 0.9);
  box(g, new THREE.BoxGeometry(fp * 0.9, 0.06, fp * 0.9), m.dirt, 0, 0.03, 0);
  const sod = rise(p, 0.45, 0.9);
  if (sod > 0) {
    for (const [ox, oz] of [
      [-1.4, -1.1],
      [1.2, -0.8],
      [-0.4, 1.3],
      [1.5, 1.2],
    ]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 1.3), m.grass);
      s.position.set(ox, 0.07, oz);
      s.scale.set(sod, 1, sod);
      g.add(s);
    }
  }
}

function pierSite(g, m, p) {
  const piles = Math.ceil(rise(p, 0, 0.45) * 4);
  for (let i = 0; i < piles; i++) {
    const ox = ((i % 2) * 2 - 1) * 2.4;
    const oz = (Math.floor(i / 2) - 0.5) * 2.6;
    box(g, new THREE.CylinderGeometry(0.16, 0.2, 2.1, 6), m.wood, ox, -0.7, oz);
  }
  const deck = rise(p, 0.4, 0.9);
  if (deck > 0) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.85, 0.14, CELL * 0.85), m.wood);
    d.position.y = 0.1;
    d.scale.set(1, 1, 0.15 + deck * 0.85);
    d.castShadow = true;
    g.add(d);
  }
}

function woodSite(g, m, p, fp, H, kind, loadTex) {
  siteBase(g, m, p, fp + 1.1);
  box(g, new THREE.BoxGeometry(fp * 0.95, 0.12, fp * 0.95), m.conc, 0, -0.04, 0);
  lumberStack(g, m, fp * 0.48, fp * 0.4);
  const fr = rise(p, 0.18, 0.5);
  if (fr > 0) {
    const fh = Math.max(0.4, H * fr);
    for (let i = -1; i <= 1; i++) {
      box(g, new THREE.BoxGeometry(0.12, fh, 0.12), m.lumber, i * fp * 0.32, fh * 0.5, fp * 0.38);
      box(g, new THREE.BoxGeometry(0.12, fh, 0.12), m.lumber, i * fp * 0.32, fh * 0.5, -fp * 0.38);
    }
    box(g, new THREE.BoxGeometry(fp * 0.78, 0.1, 0.12), m.lumber, 0, fh, 0);
  }
  const sh = rise(p, 0.45, 0.72);
  if (sh > 0) {
    const hh = H * (0.35 + sh * 0.5);
    box(g, new THREE.BoxGeometry(fp * 0.88, hh, fp * 0.88), m.ply, 0, hh * 0.5, 0);
  }
  const clad = rise(p, 0.68, 1);
  if (clad > 0) {
    const face = DEFS[kind]?.facade && ASSET_PATHS[DEFS[kind].facade];
    const mat = face ? std(loadTex(face), { roughness: 0.72 }) : m.conc;
    const hh = H * clad;
    const body = new THREE.Mesh(new THREE.BoxGeometry(fp * 0.9, hh, fp * 0.9), mat);
    body.position.y = hh * 0.5 + 0.05;
    body.castShadow = true;
    g.add(body);
    if (clad > 0.75) {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(fp * 0.96, 0.22, fp * 0.96),
        std(loadTex(ASSET_PATHS[DEFS[kind].roof] || ASSET_PATHS["steel.jpg"]))
      );
      roof.position.y = H * 0.98;
      g.add(roof);
    }
  }
}

function steelSite(g, m, p, fp, H, kind, loadTex) {
  siteBase(g, m, p, fp + 1.2);
  box(g, new THREE.BoxGeometry(fp * 0.92, 0.18, fp * 0.92), m.conc, 0, 0.05, 0);
  const st = rise(p, 0.14, 0.55);
  if (st > 0) {
    const hh = Math.max(1, H * st);
    const inset = fp * 0.34;
    for (const [x, z] of [
      [-inset, -inset],
      [inset, -inset],
      [-inset, inset],
      [inset, inset],
    ]) {
      box(g, new THREE.BoxGeometry(0.22, hh, 0.22), m.steel, x, hh * 0.5, z);
    }
    const floors = Math.max(1, Math.floor(st * 8));
    for (let i = 1; i <= floors; i++) {
      const y = (hh * i) / (floors + 0.2);
      box(g, new THREE.BoxGeometry(fp * 0.78, 0.1, fp * 0.78), m.conc, 0, y, 0);
    }
    if (p < 0.82) {
      const wrap = new THREE.Mesh(new THREE.BoxGeometry(fp * 0.95, hh * 0.7, fp * 0.95), m.scaf);
      wrap.position.y = hh * 0.4;
      wrap.castShadow = true;
      g.add(wrap);
    }
  }
  const glass = rise(p, 0.72, 1);
  if (glass > 0) {
    const face = DEFS[kind]?.facade && ASSET_PATHS[DEFS[kind].facade];
    const mat = face ? std(loadTex(face), { roughness: 0.16, metalness: 0.55 }) : m.steel;
    const hh = H * glass;
    const body = new THREE.Mesh(new THREE.BoxGeometry(fp * 0.86, hh, fp * 0.86), mat);
    body.position.y = hh * 0.5 + 0.1;
    body.castShadow = true;
    g.add(body);
  }
}

function shedSite(g, m, p, fp, H, kind, loadTex) {
  siteBase(g, m, p, fp + 1.0);
  box(g, new THREE.BoxGeometry(fp * 0.96, 0.14, fp * 0.96), m.conc, 0, 0.04, 0);
  const bay = rise(p, 0.22, 0.62);
  if (bay > 0) {
    const hh = Math.max(1.2, H * (0.4 + bay * 0.6));
    for (let i = -1; i <= 1; i++) {
      box(g, new THREE.BoxGeometry(0.18, hh, 0.18), m.steel, i * fp * 0.32, hh * 0.5, fp * 0.36);
      box(g, new THREE.BoxGeometry(0.18, hh, 0.18), m.steel, i * fp * 0.32, hh * 0.5, -fp * 0.36);
      box(g, new THREE.BoxGeometry(0.16, 0.16, fp * 0.74), m.steel, i * fp * 0.32, hh, 0);
    }
  }
  const side = rise(p, 0.58, 1);
  if (side > 0) {
    const face = DEFS[kind]?.facade && ASSET_PATHS[DEFS[kind].facade];
    const mat = face ? std(loadTex(face), { roughness: 0.7 }) : m.steel;
    const hh = H * side;
    const body = new THREE.Mesh(new THREE.BoxGeometry(fp * 0.92, hh, fp * 0.92), mat);
    body.position.y = hh * 0.5 + 0.08;
    body.castShadow = true;
    g.add(body);
    if (kind === "factory" && side > 0.7) {
      box(g, new THREE.CylinderGeometry(0.38, 0.46, H * 0.5, 8), m.steel, fp * 0.28, H * 0.7, fp * 0.2);
    }
  } else if (p > 0.3 && p < 0.7) {
    box(g, new THREE.BoxGeometry(fp * 0.7, 0.08, fp * 0.7), m.tarp, 0, 0.22, 0);
  }
}

function concreteSite(g, m, p, fp, H, kind, loadTex) {
  siteBase(g, m, p, fp + 1.15);
  box(g, new THREE.BoxGeometry(fp * 0.94, 0.16, fp * 0.94), m.conc, 0, 0.04, 0);
  const core = rise(p, 0.18, 0.58);
  if (core > 0) {
    const hh = H * core * 0.85;
    box(g, new THREE.BoxGeometry(fp * 0.7, hh, fp * 0.7), m.conc, 0, hh * 0.5, 0);
    if (p < 0.8) {
      const sc = new THREE.Mesh(new THREE.BoxGeometry(fp * 0.92, hh * 0.65, fp * 0.92), m.scaf);
      sc.position.y = hh * 0.38;
      g.add(sc);
    }
  }
  const clad = rise(p, 0.7, 1);
  if (clad > 0) {
    const face = DEFS[kind]?.facade && ASSET_PATHS[DEFS[kind].facade];
    const mat = face ? std(loadTex(face), { roughness: 0.7 }) : m.conc;
    const hh = H * clad;
    const body = new THREE.Mesh(new THREE.BoxGeometry(fp * 0.88, hh, fp * 0.88), mat);
    body.position.y = hh * 0.5 + 0.08;
    body.castShadow = true;
    g.add(body);
  }
}

export function rushCost(tile) {
  if (!tile?.kind || (tile.build ?? 1) >= 1) return 0;
  const left = 1 - (tile.build || 0);
  return Math.max(80, Math.round(left * (DEFS[tile.kind].cost || 400) * 0.32));
}

export function rushBuild(city, x, z) {
  const t = tileAt(city, x, z);
  const fee = rushCost(t);
  if (!fee || city.treasury < fee) return 0;
  city.treasury -= fee;
  t.build = 1;
  city.meshDirty = true;
  city.dirty = true;
  return fee;
}

export function advanceConstruction(city, dt) {
  const out = { finished: false, infra: false, opened: 0, kinds: [] };
  if (city.paused) return out;
  for (const t of city.tiles) {
    if (!t.kind || (t.build ?? 1) >= 1) continue;
    const sec = BUILD_SEC[t.kind] || 10;
    t.build = Math.min(1, t.build + (dt * city.speed) / sec);
    if (t.build >= 1) {
      t.build = 1;
      out.finished = true;
      out.opened += 1;
      out.kinds.push(t.kind);
      if (isInfra(t.kind)) out.infra = true;
    }
  }
  return out;
}

export function finishLine(built) {
  if (!built?.opened) return "";
  if (built.opened > 1) return `${built.opened} buildings opened.`;
  const k = built.kinds?.[0];
  if (k === "power") return "The plant is up. Lots in range have lights.";
  if (k === "cistern") return "The tower is up. It pumps if the plant is lit.";
  if (k === "sewer") return "The works are up. Lots in range have treatment.";
  if (k === "exchange") return "The exchange is up. Click Cable along the street.";
  if (k === "market") return "The market is open. Catch can land.";
  if (k === "cable") return "Cable is in.";
  return "Construction finished.";
}
