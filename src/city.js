import { DEFS, refundFor } from './buildings.js';

export const SIZE = 48;
export const CELL = 8;
export const START_TREASURY = 16000;

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
        abandoned: false,
        emptyTicks: 0,
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

export function stampStarter(tiles, scenario = "hamlet") {
  if (scenario === "hamlet") stampHamlet(tiles);
}

function stampHamlet(tiles) {
  const ave = 18;
  const shore = Math.ceil(shorelineZ(ave));
  const layRoad = (x, z) => {
    if (inBounds(x, z) && tiles[idx(x, z)].terrain !== "water") placeFree(tiles, x, z, "road");
  };

  for (let k = 1; k <= 2; k++) placeFree(tiles, ave, shore - k, "pier", 0);

  for (let x = 16; x <= 20; x++) layRoad(x, shore);
  for (let z = shore; z <= shore + 5; z++) layRoad(ave, z);

  placeFree(tiles, 17, shore + 1, "shop", 1);
  placeFree(tiles, 19, shore + 1, "park", 0);
  for (const z of [shore + 2, shore + 3, shore + 4]) {
    placeFree(tiles, 17, z, "house", 1);
    placeFree(tiles, 19, z, "house", 3);
  }
}

export function createCity() {
  const tiles = generateTerrain();
  stampStarter(tiles);
  const city = {
    tiles,
    nextId: 1,
    treasury: START_TREASURY,
    time: 16.7,
    paused: false,
    speed: 1,
    dayAuto: true,
    taxRate: 1,
    dirty: true,
    dirtyCells: new Set(),
    stats: emptyStats(),
    bankruptWarn: false,
    seen: {},
    events: [],
    tickCount: 0,
    undo: [],
    roadMain: new Set(),
    lastWeek: null,
    contract: null,
    loanTicks: 0,
    log: [],
    laws: { crews: false, festival: false, levy: false, nights: false, classrooms: false },
    scenario: "hamlet",
  };
  refreshRoadNet(city);
  return city;
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
    demand: { home: 0.4, work: 0.4, shop: 0.3, port: 0.3 },
    advisor: "Grow the harbor.",
    wageTax: 0,
    property: 0,
    commerce: 0,
    pierBonus: 0,
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

export function needsRoad(type) {
  return type !== 'road' && type !== 'park' && type !== 'pier';
}

export function refreshRoadNet(city) {
  const seen = new Set();
  let best = new Set();
  for (const t of city.tiles) {
    if (t.kind !== 'road') continue;
    const start = idx(t.x, t.z);
    if (seen.has(start)) continue;
    const comp = new Set();
    const stack = [[t.x, t.z]];
    while (stack.length) {
      const [x, z] = stack.pop();
      const i = idx(x, z);
      if (comp.has(i)) continue;
      const tile = tileAt(city, x, z);
      if (!tile || tile.kind !== 'road') continue;
      comp.add(i);
      seen.add(i);
      stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
    }
    if (comp.size > best.size) best = comp;
  }
  city.roadMain = best;
  return best;
}

export function hasRoadAccess(city, x, z) {
  if (!city.roadMain || city.roadMain.size === 0) refreshRoadNet(city);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dz] of dirs) {
    const n = tileAt(city, x + dx, z + dz);
    if (n?.kind === 'road' && city.roadMain.has(idx(n.x, n.z))) return true;
  }
  return false;
}

export function countLostAccess(city) {
  let n = 0;
  for (const t of city.tiles) {
    if (!t.kind || !needsRoad(t.kind)) continue;
    if (!hasRoadAccess(city, t.x, t.z)) n += 1;
  }
  return n;
}

export function isWaterfront(city, x, z) {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dz] of dirs) {
    const n = tileAt(city, x + dx, z + dz);
    if (!n) continue;
    if (n.terrain === 'water' || n.kind === 'pier' || n.shoreline) return true;
  }
  return false;
}

export function placeBlockReason(city, x, z, type) {
  const t = tileAt(city, x, z);
  if (!t || !DEFS[type]) return 'Invalid lot';
  if (t.kind) return 'Occupied';
  if (type === "bulldoze") return t.kind ? null : "Nothing to clear";
  if (type === 'road') return t.terrain === 'water' ? 'Need land' : null;
  if (type === 'pier') return t.terrain === 'water' || t.shoreline ? null : 'Need shoreline';
  if (t.terrain === 'water') return 'Need land';
  if (needsRoad(type) && !hasRoadAccess(city, x, z)) return 'Needs a road';
  return null;
}

export function canPlace(city, x, z, type) {
  return !placeBlockReason(city, x, z, type);
}

export function lineCells(x0, z0, x1, z1) {
  const cells = [];
  let dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  let dz = Math.abs(z1 - z0);
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  let x = x0;
  let z = z0;
  for (let i = 0; i < SIZE * 2; i++) {
    cells.push({ x, z });
    if (x === x1 && z === z1) break;
    const e2 = 2 * err;
    if (e2 > -dz) {
      err -= dz;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      z += sz;
    }
  }
  return cells;
}

export function paintsAsLine(type) {
  return type === "road" || type === "pier" || type === "park" || type === "bulldoze";
}

export function beginStroke(city) {
  city._stroke = [];
}

export function placeOnStroke(city, x, z, type, facing = 0) {
  if (!city._stroke) beginStroke(city);
  if (city._stroke.some((c) => c.x === x && c.z === z)) return false;
  const cost = DEFS[type]?.cost || 0;
  if (!place(city, x, z, type, facing)) return false;
  if (city.undo && city.undo.length && city.undo[city.undo.length - 1].op === "place") city.undo.pop();
  city._stroke.push({ x, z, kind: type, cost });
  return true;
}

export function endStroke(city) {
  const cells = city._stroke || [];
  city._stroke = null;
  if (!cells.length) return 0;
  if (!city.undo) city.undo = [];
  const demo = !!cells[0]?.demo;
  city.undo.push({ op: demo ? "demo-stroke" : "stroke", cells });
  if (city.undo.length > 20) city.undo.shift();
  return cells.length;
}

export function reopenLot(city, x, z) {
  const t = tileAt(city, x, z);
  if (!t?.abandoned || !t.kind) return false;
  if (!hasRoadAccess(city, x, z)) return false;
  const fee = 180;
  if (city.treasury < fee) return false;
  city.treasury -= fee;
  t.abandoned = false;
  t.emptyTicks = 0;
  t.recoverTicks = 0;
  city.dirty = true;
  pushEvent(city, `A ${DEFS[t.kind]?.label || "building"} was reopened.`);
  city.meshDirty = true;
  return true;
}

export function creditScore(city) {
  const s = city.stats || {};
  let n = 72;
  if (city.treasury < 0) n -= 22;
  n -= Math.min(18, (s.abandoned || 0) * 2);
  if ((s.happiness || 50) < 40) n -= 10;
  if ((city.loanTicks || 0) > 0) n -= 16;
  if (city.treasury > 25000) n += 6;
  return Math.max(15, Math.min(99, Math.round(n)));
}

export function bondOffer(city) {
  const score = creditScore(city);
  if (score < 35) return 0;
  if (score > 70) return 8000;
  if (score > 50) return 5000;
  return 3000;
}

export function takeLoan(city) {
  if ((city.loanTicks || 0) > 0) return false;
  const amt = bondOffer(city);
  if (!amt) {
    pushEvent(city, "The bond market won't touch this city.");
    return false;
  }
  city.treasury += amt;
  city.loanTicks = 100;
  city.lastBond = amt;
  pushEvent(city, `Bond issued: $${amt.toLocaleString("en-US")}. Payments come out of the treasury each tick.`);
  return true;
}

export function pushEvent(city, msg) {
  if (!msg) return;
  city.events = city.events || [];
  city.events.push(msg);
  city.log = city.log || [];
  city.log.unshift({ week: Math.floor((city.tickCount || 0) / 20), msg });
  if (city.log.length > 24) city.log.length = 24;
}

export function upgradeLot(city, x, z) {
  const t = tileAt(city, x, z);
  if (!t?.kind || t.abandoned || (t.build ?? 1) < 1) return false;
  const def = DEFS[t.kind];
  const next = def?.upgrade;
  const cost = def?.upgradeCost;
  if (!next || !DEFS[next] || !Number.isFinite(cost)) return false;
  if (needsRoad(next) && !hasRoadAccess(city, x, z)) return false;
  if (city.treasury < cost) return false;
  const snap = snapshotTile(t);
  city.treasury -= cost;
  t.kind = next;
  t.build = 0.28;
  t.hScale = 0.88 + hash(x * 3.1, z * 5.7) * 0.28;
  t.pop = Math.min(t.pop, DEFS[next].pop * 0.45);
  t.jobs = Math.min(t.jobs, DEFS[next].jobs || 0);
  t.starter = false;
  t.emptyTicks = 0;
  city.dirty = true;
  city.meshDirty = true;
  if (!city.undo) city.undo = [];
  city.undo.push({ op: "upgrade", x, z, snap, cost, next });
  if (city.undo.length > 20) city.undo.shift();
  pushEvent(city, `${def.label} upgrading to ${DEFS[next].label}.`);
  return true;
}

export function demolishOnStroke(city, x, z) {
  if (!city._stroke) beginStroke(city);
  if (city._stroke.some((c) => c.x === x && c.z === z)) return false;
  const t = tileAt(city, x, z);
  if (!t?.kind) return false;
  const snap = snapshotTile(t);
  const refund = t.starter ? 0 : refundFor(t.kind);
  if (!demolish(city, x, z)) return false;
  if (city.undo && city.undo.length && city.undo[city.undo.length - 1].op === "demo") city.undo.pop();
  city._stroke.push({ x, z, snap, refund, kind: snap.kind, demo: true });
  return true;
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
  t.abandoned = false;
  t.emptyTicks = 0;
  city.dirty = true;
  city.dirtyCells.add(idx(x, z));
  if (!city.undo) city.undo = [];
  city.undo.push({ op: 'place', x, z, kind: type, cost: def.cost });
  if (city.undo.length > 20) city.undo.shift();
  if (type === 'road' || type === 'pier') refreshRoadNet(city);
  return true;
}

function snapshotTile(t) {
  return {
    kind: t.kind,
    facing: t.facing,
    hScale: t.hScale,
    id: t.id,
    pop: t.pop,
    jobs: t.jobs,
    starter: t.starter,
    build: t.build,
    abandoned: t.abandoned,
    emptyTicks: t.emptyTicks,
  };
}

export function demolish(city, x, z) {
  const t = tileAt(city, x, z);
  if (!t || !t.kind) return false;
  const snap = snapshotTile(t);
  const refund = t.starter ? 0 : refundFor(t.kind);
  if (refund) city.treasury += refund;
  t.kind = null;
  t.id = 0;
  t.pop = 0;
  t.jobs = 0;
  t.facing = 0;
  t.hScale = 1;
  t.starter = false;
  t.build = 1;
  t.abandoned = false;
  t.emptyTicks = 0;
  city.dirty = true;
  city.dirtyCells.add(idx(x, z));
  if (!city.undo) city.undo = [];
  city.undo.push({ op: 'demo', x, z, snap, refund });
  if (city.undo.length > 20) city.undo.shift();
  if (snap.kind === 'road' || snap.kind === 'pier') refreshRoadNet(city);
  return true;
}

export function undoLast(city) {
  if (!city.undo || !city.undo.length) return null;
  const a = city.undo.pop();
  if (a.op === "stroke" && a.cells) {
    let infra = false;
    for (const c of a.cells) {
      const cell = tileAt(city, c.x, c.z);
      if (!cell || cell.kind !== c.kind) continue;
      city.treasury += c.cost || 0;
      cell.kind = null;
      cell.id = 0;
      cell.pop = 0;
      cell.jobs = 0;
      cell.build = 1;
      if (c.kind === "road" || c.kind === "pier") infra = true;
    }
    if (infra) refreshRoadNet(city);
    city.dirty = true;
    return { kind: a.cells[0]?.kind, infra };
  }
  if (a.op === "demo-stroke" && a.cells) {
    let infra = false;
    for (const c of a.cells) {
      const cell = tileAt(city, c.x, c.z);
      if (!cell || !c.snap) continue;
      city.treasury -= c.refund || 0;
      Object.assign(cell, c.snap);
      if (c.snap.kind === "road" || c.snap.kind === "pier") infra = true;
    }
    if (infra) refreshRoadNet(city);
    city.dirty = true;
    return { kind: a.cells[0]?.kind, infra };
  }
  const t = tileAt(city, a.x, a.z);
  if (!t) return null;
  if (a.op === "upgrade" && a.snap) {
    city.treasury += a.cost || 0;
    Object.assign(t, a.snap);
    city.dirty = true;
    city.meshDirty = true;
    return { kind: t.kind, infra: false };
  }
  if (a.op === 'place') {
    if (t.kind !== a.kind) return null;
    city.treasury += a.cost || 0;
    t.kind = null;
    t.id = 0;
    t.pop = 0;
    t.jobs = 0;
    t.facing = 0;
    t.hScale = 1;
    t.starter = false;
    t.build = 1;
    if (a.kind === 'road' || a.kind === 'pier') refreshRoadNet(city);
    city.dirty = true;
    return { kind: a.kind, infra: a.kind === 'road' || a.kind === 'pier' };
  }
  if (a.op === 'demo' && a.snap) {
    city.treasury -= a.refund || 0;
    Object.assign(t, a.snap);
    if (t.kind === 'road' || t.kind === 'pier') refreshRoadNet(city);
    city.dirty = true;
    return { kind: t.kind, infra: t.kind === 'road' || t.kind === 'pier' };
  }
  return null;
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
      abandoned: !!t.abandoned,
      emptyTicks: t.emptyTicks || 0,
    });
  }
  return {
    v: 1,
    treasury: city.treasury,
    time: city.time,
    paused: city.paused,
    speed: city.speed,
    dayAuto: city.dayAuto,
    taxRate: city.taxRate || 1,
    nextId: city.nextId,
    seen: city.seen || {},
    tickCount: city.tickCount || 0,
    contract: city.contract || null,
    loanTicks: city.loanTicks || 0,
    laws: city.laws || { crews: false, festival: false, levy: false, nights: false, classrooms: false },
    scenario: city.scenario || "hamlet",
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
    t.abandoned = false;
    t.emptyTicks = 0;
  }
  city.treasury = Number.isFinite(data.treasury) ? data.treasury : START_TREASURY;
  city.time = Number.isFinite(data.time) ? data.time : 16.7;
  city.paused = !!data.paused;
  city.speed = data.speed >= 2 && data.speed <= 4 ? data.speed : 1;
  city.dayAuto = data.dayAuto !== false;
  city.taxRate = Number.isFinite(data.taxRate) ? Math.min(1.4, Math.max(0.65, data.taxRate)) : 1;
  city.nextId = Number.isFinite(data.nextId) ? data.nextId : 1;
  city.seen = data.seen && typeof data.seen === 'object' ? data.seen : {};
  city.tickCount = Number.isFinite(data.tickCount) ? data.tickCount : 0;
  city.events = [];
  city.contract = data.contract || null;
  city.loanTicks = Number.isFinite(data.loanTicks) ? data.loanTicks : 0;
  city.laws = {
    crews: !!data.laws?.crews,
    festival: !!data.laws?.festival,
    levy: !!data.laws?.levy,
    nights: !!data.laws?.nights,
    classrooms: !!data.laws?.classrooms,
  };
  city.scenario = data.scenario || "hamlet";
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
    t.abandoned = !!b.abandoned;
    t.emptyTicks = Number.isFinite(b.emptyTicks) ? b.emptyTicks : 0;
    if (t.id >= city.nextId) city.nextId = t.id + 1;
  }
  city.dirty = true;
  city.undo = [];
  refreshRoadNet(city);
  return true;
}
