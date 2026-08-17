import { DEFS, refundFor } from './buildings.js';

export const SIZE = 48;
export const CELL = 8;
export const START_TREASURY = 50000;

export function hash(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7 + 19.19) * 43758.5453;
  return n - Math.floor(n);
}

export function shorelineZ(x) {
  const t = x / (SIZE - 1);
  const bay = 6.8 * Math.exp(-((t - 0.26) ** 2) / 0.015);
  const hook = -3.4 * Math.exp(-((t - 0.47) ** 2) / 0.006);
  return 6.2 + 16.4 * (1 - t) ** 0.9 + bay + hook;
}

export function cellToWorld(x, z, target = { x: 0, y: 0, z: 0 }) {
  target.x = (x - (SIZE - 1) / 2) * CELL;
  target.y = 0;
  target.z = (z - (SIZE - 1) / 2) * CELL;
  return target;
}

export function worldToCell(wx, wz) {
  const x = Math.round(wx / CELL + (SIZE - 1) / 2);
  const z = Math.round(wz / CELL + (SIZE - 1) / 2);
  return { x, z };
}

export function worldToCellF(wx, wz) {
  return {
    x: wx / CELL + (SIZE - 1) / 2,
    z: wz / CELL + (SIZE - 1) / 2,
  };
}

export function shorelineWorldZ(wx) {
  const cx = wx / CELL + (SIZE - 1) / 2;
  return (shorelineZ(cx) - (SIZE - 1) / 2) * CELL;
}

export function landField(wx, wz) {
  const c = worldToCellF(wx, wz);
  let inland = c.z - shorelineZ(c.x) + 0.12;
  inland = Math.min(inland, c.z - 4.35);
  const west = Math.min(3.1 - c.x, 22.1 - c.z);
  if (west > 0) inland = Math.min(inland, -west);
  inland += (hash(c.x * 0.85, 1.7) - 0.5) * 0.28;
  inland += (hash(c.x * 2.4, c.z * 0.4) - 0.5) * 0.12;
  return inland * CELL;
}

export function terrainHeight(wx, wz) {
  const d = landField(wx, wz);
  const micro =
    Math.sin(wx * 0.085) * Math.cos(wz * 0.072) * 0.055 +
    Math.sin(wx * 0.21 + wz * 0.16) * 0.025;
  if (d < -6) return -0.95;
  if (d < -1.2) return -0.42 + (d + 6) * 0.05 + micro * 0.2;
  if (d < 7) {
    const t = (d + 1.2) / 8.2;
    const s = t * t * (3 - 2 * t);
    return -0.2 * (1 - s) + 0.045 * s + micro * 0.7;
  }
  return 0.045 + micro * 0.55 + Math.sin(wx * 0.011 + wz * 0.008) * 0.05;
}

export function inBounds(x, z) {
  return x >= 0 && z >= 0 && x < SIZE && z < SIZE;
}

export function idx(x, z) {
  return z * SIZE + x;
}

function isWaterAt(x, z) {
  if (z <= 4) return true;
  if (x < 3 && z < 22) return true;
  return z + 0.15 < shorelineZ(x);
}

export function generateTerrain() {
  const tiles = new Array(SIZE * SIZE);
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const water = isWaterAt(x, z);
      tiles[idx(x, z)] = {
        x,
        z,
        terrain: water ? 'water' : 'grass',
        shoreline: false,
        kind: null,
        id: 0,
        facing: 0,
        hScale: 1,
        pop: 0,
        jobs: 0,
        starter: false,
        build: 1,
      };
    }
  }

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const t = tiles[idx(x, z)];
      if (t.terrain === 'water') continue;
      let adjWater = false;
      for (const [dx, dz] of dirs) {
        const nx = x + dx;
        const nz = z + dz;
        if (!inBounds(nx, nz) || tiles[idx(nx, nz)].terrain === 'water') {
          adjWater = true;
          break;
        }
      }
      if (adjWater) {
        t.terrain = 'sand';
        t.shoreline = true;
      }
    }
  }

  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const t = tiles[idx(x, z)];
      if (t.terrain !== 'grass') continue;
      let adjSand = false;
      for (const [dx, dz] of dirs) {
        const nx = x + dx;
        const nz = z + dz;
        if (inBounds(nx, nz) && tiles[idx(nx, nz)].terrain === 'sand') {
          adjSand = true;
          break;
        }
      }
      const inland = z - shorelineZ(x);
      const n = hash(x, z);
      if (adjSand) t.terrain = 'concrete';
      else if (inland < 5 && n < 0.42) t.terrain = 'dirt';
      else if (n < 0.11) t.terrain = 'dirt';
      else t.terrain = 'grass';
    }
  }

  const pierX = 18;
  const landZ = Math.min(SIZE - 1, Math.max(0, Math.ceil(shorelineZ(pierX))));
  if (inBounds(pierX, landZ) && tiles[idx(pierX, landZ)].terrain !== 'water') {
    tiles[idx(pierX, landZ)].terrain = 'cobble';
  }
  const hookX = 22;
  const hookZ = Math.min(SIZE - 1, Math.max(0, Math.ceil(shorelineZ(hookX))));
  if (inBounds(hookX, hookZ) && tiles[idx(hookX, hookZ)].terrain !== 'water') {
    tiles[idx(hookX, hookZ)].terrain = 'cobble';
  }

  return tiles;
}

function placeFree(tiles, x, z, kind, facing = 0) {
  if (!inBounds(x, z)) return;
  const t = tiles[idx(x, z)];
  if (kind === 'road' && t.terrain === 'water') return;
  if (kind === 'pier' && t.terrain !== 'water' && !t.shoreline) return;
  if (t.kind) return;
  t.kind = kind;
  t.facing = facing;
  t.starter = true;
  t.build = 1;
  t.hScale = kind === 'road' || kind === 'park' || kind === 'pier'
    ? 1
    : 0.9 + hash(x * 2.1, z * 3.3) * 0.18;
  t.id = -1;
  const def = DEFS[kind];
  if (def?.pop) t.pop = def.pop * 0.62;
  if (def?.jobs) t.jobs = def.jobs * 0.55;
}

export function stampStarter(tiles) {
  const aveA = 18;
  const aveB = 30;
  const aveC = 38;
  const shoreA = Math.ceil(shorelineZ(aveA));
  const shoreB = Math.ceil(shorelineZ(aveB));
  const shoreC = Math.ceil(shorelineZ(aveC));

  for (let k = 1; k <= 6; k++) placeFree(tiles, aveA, shoreA - k, 'pier', 0);
  for (let k = 1; k <= 4; k++) placeFree(tiles, 13, Math.ceil(shorelineZ(13)) - k, 'pier', 0);
  for (let k = 1; k <= 4; k++) placeFree(tiles, 22, Math.ceil(shorelineZ(22)) - k, 'pier', 0);

  const layRoad = (x, z) => {
    if (inBounds(x, z) && tiles[idx(x, z)].terrain !== 'water') placeFree(tiles, x, z, 'road');
  };

  for (let z = shoreA; z <= 45; z++) layRoad(aveA, z);
  for (let z = shoreB; z <= 42; z++) layRoad(aveB, z);
  for (let z = shoreC; z <= 40; z++) layRoad(aveC, z);

  const crossZ = Math.min(43, shoreA + 9);
  const crossZ2 = Math.min(45, shoreA + 17);
  for (let x = 8; x <= 42; x++) {
    layRoad(x, crossZ);
    layRoad(x, crossZ2);
  }

  for (let x = 8; x <= 42; x++) {
    const z = Math.ceil(shorelineZ(x));
    layRoad(x, z);
  }

  const skip = (z) => z === crossZ || z === crossZ2;
  for (let z = shoreA + 2; z <= shoreA + 15; z++) {
    if (skip(z)) continue;
    placeFree(tiles, 15, z, 'house', 1);
    placeFree(tiles, 16, z, 'house', 1);
    placeFree(tiles, 17, z, 'house', 1);
    placeFree(tiles, 19, z, 'house', 3);
    if (z !== shoreA + 4 && z !== shoreA + 8) placeFree(tiles, 20, z, 'house', 3);
  }
  for (let z = shoreB + 2; z <= 34; z++) {
    if (skip(z)) continue;
    placeFree(tiles, 28, z, 'house', 1);
    placeFree(tiles, 29, z, 'house', 1);
    placeFree(tiles, 31, z, 'house', 3);
    if (z % 2 === 0) placeFree(tiles, 32, z, 'house', 3);
  }
  for (let z = shoreC + 2; z <= 30; z++) {
    if (skip(z)) continue;
    placeFree(tiles, 37, z, 'house', 1);
    placeFree(tiles, 39, z, 'house', 3);
  }

  const promenadeShop = (x, facing) => {
    const z = Math.ceil(shorelineZ(x)) + 1;
    placeFree(tiles, x, z, 'shop', facing);
  };
  promenadeShop(16, 2);
  promenadeShop(20, 2);
  promenadeShop(24, 2);
  placeFree(tiles, 32, shoreB + 3, 'shop', 3);
  placeFree(tiles, 21, crossZ + 1, 'shop', 0);
  placeFree(tiles, 33, crossZ - 1, 'shop', 2);

  for (let x = 21; x <= 24; x++) {
    for (let z = shoreA + 2; z <= shoreA + 6; z++) {
      if (skip(z)) continue;
      placeFree(tiles, x, z, 'park', 0);
    }
  }
  placeFree(tiles, 33, shoreB + 6, 'park', 0);
  placeFree(tiles, 34, shoreB + 6, 'park', 0);
  for (let z = shoreA + 8; z <= shoreA + 15; z++) {
    if (skip(z)) continue;
    placeFree(tiles, 21, z, 'house', 3);
    placeFree(tiles, 22, z, 'house', 3);
  }
  for (let z = shoreA + 2; z <= shoreA + 14; z++) {
    if (skip(z)) continue;
    placeFree(tiles, 23, z, 'house', 1);
    placeFree(tiles, 25, z, z % 3 === 0 ? 'shop' : 'house', 3);
    placeFree(tiles, 27, z, z % 4 === 0 ? 'office' : 'house', 1);
  }
  placeFree(tiles, 26, shoreA + 9, 'shop', 0);
  placeFree(tiles, 26, shoreA + 10, 'shop', 0);

  placeFree(tiles, 24, shoreA + 3, 'apartment', 0);
  placeFree(tiles, 25, shoreA + 6, 'apartment', 0);
  placeFree(tiles, 26, shoreA + 5, 'office', 0);
  placeFree(tiles, 35, crossZ + 3, 'office', 0);
  placeFree(tiles, 23, shoreA + 7, 'tower', 0);
  placeFree(tiles, 20, shoreA + 8, 'school', 0);
  placeFree(tiles, 27, crossZ + 2, 'hospital', 0);
  placeFree(tiles, 34, crossZ + 2, 'civic', 0);

  const pierLand = Math.ceil(shorelineZ(13)) + 1;
  placeFree(tiles, 14, pierLand, 'warehouse', 0);
  placeFree(tiles, 12, pierLand, 'warehouse', 0);
  placeFree(tiles, 11, pierLand + 2, 'factory', 0);
  placeFree(tiles, 12, pierLand + 3, 'warehouse', 0);
}

export function createCity() {
  const tiles = generateTerrain();
  stampStarter(tiles);
  return {
    tiles,
    nextId: 1,
    treasury: START_TREASURY,
    time: 16.7,
    paused: false,
    speed: 1,
    dayAuto: true,
    dirty: true,
    dirtyCells: new Set(),
    stats: emptyStats(),
    bankruptWarn: false,
  };
}

export function emptyStats() {
  return {
    pop: 0,
    popCap: 0,
    jobs: 0,
    jobCap: 0,
    happiness: 50,
    income: 0,
    upkeep: 0,
    employed: 0,
    shops: 0,
    piers: 0,
    civics: 0,
  };
}

export function tileAt(city, x, z) {
  if (!inBounds(x, z)) return null;
  return city.tiles[idx(x, z)];
}

export function neighborsRoad(city, x, z) {
  return {
    n: tileAt(city, x, z + 1)?.kind === 'road',
    s: tileAt(city, x, z - 1)?.kind === 'road',
    e: tileAt(city, x + 1, z)?.kind === 'road',
    w: tileAt(city, x - 1, z)?.kind === 'road',
  };
}

export function canPlace(city, x, z, type) {
  const t = tileAt(city, x, z);
  if (!t || !DEFS[type]) return false;
  if (type === 'road') {
    if (t.kind) return false;
    return t.terrain !== 'water';
  }
  if (type === 'pier') {
    if (t.kind) return false;
    return t.terrain === 'water' || t.shoreline;
  }
  if (t.kind) return false;
  return t.terrain !== 'water';
}

export function place(city, x, z, type, facing = 0) {
  if (!canPlace(city, x, z, type)) return false;
  const def = DEFS[type];
  if (city.treasury < def.cost) return false;
  const t = tileAt(city, x, z);
  if (t.kind === 'road' && type === 'road') return false;
  city.treasury -= def.cost;
  t.kind = type;
  t.facing = facing & 3;
  t.hScale = type === 'road' || type === 'park' || type === 'pier'
    ? 1
    : 0.88 + hash(x * 3.1, z * 5.7) * 0.28;
  t.id = city.nextId++;
  t.pop = 0;
  t.jobs = 0;
  t.starter = false;
  t.build = 0;
  city.dirty = true;
  city.dirtyCells.add(idx(x, z));
  return true;
}

export function demolish(city, x, z) {
  const t = tileAt(city, x, z);
  if (!t || !t.kind) return false;
  if (!t.starter) city.treasury += refundFor(t.kind);
  t.kind = null;
  t.id = 0;
  t.pop = 0;
  t.jobs = 0;
  t.facing = 0;
  t.hScale = 1;
  t.starter = false;
  t.build = 1;
  city.dirty = true;
  city.dirtyCells.add(idx(x, z));
  return true;
}

export function forEachInRadius(city, cx, cz, radius, fn) {
  const r = Math.ceil(radius);
  for (let z = cz - r; z <= cz + r; z++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!inBounds(x, z)) continue;
      const dist = Math.hypot(x - cx, z - cz);
      if (dist > radius) continue;
      fn(city.tiles[idx(x, z)], dist);
    }
  }
}

export function serializeCity(city) {
  const buildings = [];
  for (const t of city.tiles) {
    if (!t.kind) continue;
    buildings.push({
      x: t.x,
      z: t.z,
      kind: t.kind,
      facing: t.facing,
      hScale: t.hScale,
      id: t.id,
      pop: t.pop,
      jobs: t.jobs,
      starter: t.starter,
      build: t.build ?? 1,
    });
  }
  return {
    v: 1,
    treasury: city.treasury,
    time: city.time,
    paused: city.paused,
    speed: city.speed,
    dayAuto: city.dayAuto,
    nextId: city.nextId,
    buildings,
  };
}

export function applySave(city, data) {
  if (!data || data.v !== 1 || !Array.isArray(data.buildings)) return false;
  for (const t of city.tiles) {
    t.kind = null;
    t.id = 0;
    t.pop = 0;
    t.jobs = 0;
    t.facing = 0;
    t.hScale = 1;
    t.starter = false;
    t.build = 1;
  }
  city.treasury = Number.isFinite(data.treasury) ? data.treasury : START_TREASURY;
  city.time = Number.isFinite(data.time) ? data.time : 16.7;
  city.paused = !!data.paused;
  city.speed = data.speed === 2 || data.speed === 3 ? data.speed : 1;
  city.dayAuto = data.dayAuto !== false;
  city.nextId = Number.isFinite(data.nextId) ? data.nextId : 1;
  for (const b of data.buildings) {
    if (!inBounds(b.x, b.z) || !DEFS[b.kind]) continue;
    const t = city.tiles[idx(b.x, b.z)];
    t.kind = b.kind;
    t.facing = (b.facing || 0) & 3;
    t.hScale = b.hScale || 1;
    t.id = b.id || city.nextId++;
    t.pop = b.pop || 0;
    t.jobs = b.jobs || 0;
    t.starter = !!b.starter;
    t.build = Number.isFinite(b.build) ? b.build : 1;
    if (t.id >= city.nextId) city.nextId = t.id + 1;
  }
  city.dirty = true;
  return true;
}
