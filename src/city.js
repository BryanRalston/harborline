import { DEFS, refundFor } from './buildings.js';

export const SIZE = 48;
export const CELL = 8;
export const START_TREASURY = 13400;

export function hash(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7 + 19.19) * 43758.5453;
  return n - Math.floor(n);
}

export function shorelineZ(x) {
  const t = x / (SIZE - 1);
  const cove = 1.6 * Math.exp(-((t - 0.34) ** 2) / 0.055);
  return 9.2 + 4.4 * (1 - t) ** 0.85 + cove;
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

export function inlandCells(x, z) {
  return z - shorelineZ(x);
}

export function landField(wx, wz) {
  const c = worldToCellF(wx, wz);
  let inland = inlandCells(c.x, c.z);
  if (inland > 1.4) {
    inland += (hash(c.x * 0.85, 1.7) - 0.5) * 0.08;
    inland += (hash(c.x * 2.4, c.z * 0.4) - 0.5) * 0.05;
  }
  return inland * CELL;
}

export function terrainHeight(wx, wz) {
  const d = landField(wx, wz);
  const micro =
    Math.sin(wx * 0.085) * Math.cos(wz * 0.072) * 0.04 +
    Math.sin(wx * 0.21 + wz * 0.16) * 0.018;
  if (d < -6) return -0.72;
  if (d < 0) {
    const t = (d + 6) / 6;
    const s = t * t * (3 - 2 * t);
    return -0.62 + s * 0.58 + micro * 0.15;
  }
  if (d < 10) {
    const t = d / 10;
    const s = t * t * (3 - 2 * t);
    return 0.08 + s * 0.07 + micro * 0.45;
  }
  return 0.15 + micro * 0.5 + Math.sin(wx * 0.011 + wz * 0.008) * 0.04;
}

export function inBounds(x, z) {
  return x >= 0 && z >= 0 && x < SIZE && z < SIZE;
}

export function idx(x, z) {
  return z * SIZE + x;
}

function isWaterAt(x, z) {
  if (z <= 2) return true;
  return inlandCells(x, z) < -0.02;
}

export function isPaved(kind) {
  return kind === "road" || kind === "cobble";
}

export function isInfra(kind) {
  return isPaved(kind) || kind === "pier";
}

export function cellMinInland(x, z) {
  let m = Infinity;
  for (const dx of [-0.48, 0.48]) {
    for (const dz of [-0.48, 0.48]) {
      m = Math.min(m, inlandCells(x + dx, z + dz));
    }
  }
  return m;
}

export function pastBuildLine(x, z, tile) {
  if (tile?.terrain === "water") return true;
  if (tile?.shoreline) return true;
  return cellMinInland(x, z) < 0.75;
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
  if (inBounds(pierX, landZ) && tiles[idx(pierX, landZ)].terrain !== "water") {
    tiles[idx(pierX, landZ)].terrain = "cobble";
  }

  return tiles;
}

function placeFree(tiles, x, z, kind, facing = 0) {
  if (!inBounds(x, z)) return;
  const t = tiles[idx(x, z)];
  if (t.kind) return;
  if (kind === "pier") {
    if (t.terrain !== "water" && !t.shoreline) return;
  } else if (pastBuildLine(x, z, t)) return;
  t.kind = kind;
  t.facing = facing;
  t.starter = true;
  t.build = 1;
  t.hScale = isPaved(kind) || kind === "park" || kind === "pier" ? 1 : 0.9 + hash(x * 2.1, z * 3.3) * 0.18;
  t.id = -1;
  const def = DEFS[kind];
  if (def?.pop) t.pop = def.pop * 0.45;
  if (def?.jobs) t.jobs = def.jobs * 0.55;
}

export function stampStarter(tiles, scenario = "hamlet") {
  if (scenario === "hamlet") stampHamlet(tiles);
}

function firstLandZ(tiles, x) {
  for (let z = 0; z < SIZE; z++) {
    if (inBounds(x, z) && tiles[idx(x, z)].terrain !== "water") return z;
  }
  return SIZE;
}

function firstBuildableZ(tiles, x) {
  for (let z = 0; z < SIZE; z++) {
    if (inBounds(x, z) && !pastBuildLine(x, z, tiles[idx(x, z)])) return z;
  }
  return SIZE;
}

function stampHamlet(tiles) {
  const ave = 18;
  const shore = firstLandZ(tiles, ave);
  let land = firstBuildableZ(tiles, ave);
  for (let x = 16; x <= 20; x++) land = Math.max(land, firstBuildableZ(tiles, x));
  const layRoad = (x, z) => {
    if (inBounds(x, z) && !pastBuildLine(x, z, tiles[idx(x, z)])) placeFree(tiles, x, z, "road");
  };

  placeFree(tiles, ave, shore, "pier", 0);
  for (let k = 1; k <= 2; k++) placeFree(tiles, ave, shore - k, "pier", 0);

  for (let x = 18; x <= 20; x++) layRoad(x, land);
  for (let z = land; z <= land + 5; z++) layRoad(ave, z);

  const put = (x, z, kind, facing) => {
    if (!inBounds(x, z) || pastBuildLine(x, z, tiles[idx(x, z)])) return;
    placeFree(tiles, x, z, kind, facing);
  };
  put(19, land + 1, "park", 0);
  for (const z of [land + 2, land + 3]) {
    put(17, z, "house", 1);
    put(19, z, "house", 3);
  }
}

export function createCity() {
  const tiles = generateTerrain();
  stampStarter(tiles);
  const city = {
    tiles,
    nextId: 1,
    treasury: START_TREASURY,
    time: 15.2,
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
    lastDigest: null,
    digest: null,
    recapDue: false,
    recapUnread: false,
    holdRecap: false,
    nextRecapTick: 80,
    contractsMissed: 0,
    contractsWon: 0,
    stallTicks: 0,
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
    demand: { home: 0.4, work: 0.4, shop: 0.3, port: 0.3, power: 0, water: 0, sewer: 0 },
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
    n: isPaved(tileAt(city, x, z + 1)?.kind),
    s: isPaved(tileAt(city, x, z - 1)?.kind),
    e: isPaved(tileAt(city, x + 1, z)?.kind),
    w: isPaved(tileAt(city, x - 1, z)?.kind),
  };
}

export function needsRoad(type) {
  return !isPaved(type) && type !== "park" && type !== "pier" && type !== "cable";
}

export function refreshRoadNet(city) {
  const seen = new Set();
  let best = new Set();
  for (const t of city.tiles) {
    if (!isPaved(t.kind)) continue;
    const start = idx(t.x, t.z);
    if (seen.has(start)) continue;
    const comp = new Set();
    const stack = [[t.x, t.z]];
    while (stack.length) {
      const [x, z] = stack.pop();
      const i = idx(x, z);
      if (comp.has(i)) continue;
      const tile = tileAt(city, x, z);
      if (!tile || !isPaved(tile.kind)) continue;
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
    if (n && isPaved(n.kind) && city.roadMain.has(idx(n.x, n.z))) return true;
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
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dz === 0) continue;
      if (Math.max(Math.abs(dx), Math.abs(dz)) > 2) continue;
      const n = tileAt(city, x + dx, z + dz);
      if (!n) continue;
      if (n.terrain === "water" || n.kind === "pier" || n.shoreline) return true;
    }
  }
  return false;
}

const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function nextToPier(city, x, z) {
  for (const [dx, dz] of ORTHO) {
    if (tileAt(city, x + dx, z + dz)?.kind === "pier") return true;
  }
  return false;
}

function isDockKind(type) {
  return type === "shop" || type === "market" || type === "warehouse";
}

export function placeBlockReason(city, x, z, type) {
  const t = tileAt(city, x, z);
  if (!t || !DEFS[type]) return "Invalid lot";
  if (type === "bulldoze") return t.kind || t.cable ? null : "Nothing to clear";
  if (type === "cable") {
    if (!t.kind) return "Run the cable along a paved street";
    if (!isPaved(t.kind)) {
      const label = (DEFS[t.kind]?.label || t.kind).toLowerCase();
      return `Occupied — run cable on the street, not over ${label}`;
    }
    if (t.cable) return "Already wired";
    return null;
  }
  if (t.kind) {
    if (isPaved(t.kind) && isPaved(type)) return "Already paved";
    const label = (DEFS[t.kind]?.label || t.kind).toLowerCase();
    const art = /^[aeiou]/.test(label) ? "an" : "a";
    return `Occupied — ${art} ${label} is here. Tap an empty lot.`;
  }
  if (type === "pier") {
    if (!(t.terrain === "water" || t.shoreline)) return "Need shoreline";
    if (t.shoreline) return null;
    for (const [dx, dz] of ORTHO) {
      const n = tileAt(city, x + dx, z + dz);
      if (!n) continue;
      if (n.kind === "pier" || n.shoreline) return null;
    }
    return "Extend from the dock";
  }
  if (t.terrain === "water") {
    if (isDockKind(type)) return "On land by the pier — Pier is the water tool";
    return "That's water — use Pier";
  }
  if (pastBuildLine(x, z, t)) {
    const landfall = nextToPier(city, x, z);
    if (isPaved(type) && landfall) return null;
    if (isDockKind(type) && (landfall || isWaterfront(city, x, z))) {
      if (needsRoad(type) && !hasRoadAccess(city, x, z)) {
        return landfall ? "Pave with Road first" : "Beach — pave it first";
      }
      return null;
    }
    if (t.shoreline || t.terrain === "sand") {
      if (isDockKind(type)) return "Beach — pave it first";
      return "That's beach — stay inland, or pave from the pier";
    }
    if (isDockKind(type)) return "Put this on the landfall by the pier";
    if (isPaved(type)) return "That's beach — stay inland, or pave from the pier";
    return "Stay inland of the beach";
  }
  if (isPaved(type)) return null;
  if (needsRoad(type) && !hasRoadAccess(city, x, z)) {
    const n = neighborsRoad(city, x, z);
    const edged = n.n || n.s || n.e || n.w;
    if (edged && (type === "power" || type === "cistern" || type === "sewer")) return null;
    const open = [];
    if (!n.n) open.push("north");
    if (!n.s) open.push("south");
    if (!n.e) open.push("east");
    if (!n.w) open.push("west");
    if (open.length === 4) return "Needs a road — this lot has no paved edge";
    return "Needs a road on the main street — that paved edge is a spur";
  }
  return null;
}

export function canPlace(city, x, z, type) {
  return !placeBlockReason(city, x, z, type);
}

export function pickLegalLot(city, kind, cash, prefer) {
  if (!kind || !DEFS[kind]) return null;
  const cost = DEFS[kind].cost || 0;
  if (Number.isFinite(cash) && cash < cost) return null;
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (const t of city.tiles) {
    if (!t.kind) continue;
    if (!isPaved(t.kind) && t.kind !== "house" && t.kind !== "pier") continue;
    cx += t.x;
    cz += t.z;
    n += 1;
  }
  if (n) {
    cx /= n;
    cz /= n;
  } else {
    cx = 18;
    cz = 20;
  }
  let best = null;
  let bestScore = -Infinity;
  for (const t of city.tiles) {
    if (kind === "cable") {
      if (!isPaved(t.kind) || t.cable) continue;
    } else if (t.kind) continue;
    if (!canPlace(city, t.x, t.z, kind)) continue;
    const roads = neighborsRoad(city, t.x, t.z);
    const edge = roads.n || roads.s || roads.e || roads.w;
    const main = hasRoadAccess(city, t.x, t.z);
    const dist = Math.abs(t.x - cx) + Math.abs(t.z - cz);
    let score = 80 - dist;
    if (isPaved(kind)) {
      if (nextToPier(city, t.x, t.z)) score += 400;
      else if (main) score += 120;
      else if (edge) score += 40;
      else score -= 400;
    } else if (kind === "market") {
      if (nextToPier(city, t.x, t.z)) score += 400;
      else if (isWaterfront(city, t.x, t.z)) score += 80;
      let landfallRoad = false;
      for (const [dx, dz] of ORTHO) {
        const n = tileAt(city, t.x + dx, t.z + dz);
        if (n && isPaved(n.kind) && nextToPier(city, n.x, n.z)) landfallRoad = true;
      }
      if (landfallRoad) score += 350;
      if (main) score += 120;
      else if (edge) score += 20;
    } else if (kind === "shop") {
      if (nextToPier(city, t.x, t.z)) score -= 120;
      const inland = inlandCells(t.x, t.z);
      if (inland >= 2) score += 90;
      let nearHome = false;
      let onAve = false;
      for (const [dx, dz] of ORTHO) {
        const n = tileAt(city, t.x + dx, t.z + dz);
        if (!n) continue;
        if (n.kind === "house" || n.kind === "apartment") nearHome = true;
        if (isPaved(n.kind) && inlandCells(n.x, n.z) >= 2) onAve = true;
      }
      if (nearHome) score += 220;
      if (onAve) score += 80;
      if (main) score += 140;
      else if (edge) score += 30;
    } else if (kind === "power") {
      if (nextToPier(city, t.x, t.z) || isWaterfront(city, t.x, t.z)) score -= 220;
      if (inlandCells(t.x, t.z) >= 2) score += 90;
      const rad = DEFS.power?.radius || 8;
      for (const o of city.tiles) {
        if (o.kind !== "office") continue;
        const d = Math.hypot(o.x - t.x, o.z - t.z);
        if (d <= rad) score += 200 - d * 10;
      }
      if (main) score += 140;
      else if (edge) score += 40;
    } else if (kind === "cistern") {
      if (nextToPier(city, t.x, t.z) || isWaterfront(city, t.x, t.z)) score -= 180;
      if (inlandCells(t.x, t.z) >= 2) score += 80;
      const rad = DEFS.cistern?.radius || 8;
      const plantRad = DEFS.power?.radius || 8;
      for (const p of city.tiles) {
        if (p.kind !== "power") continue;
        const d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d <= plantRad + 3) score += 180 - d * 8;
      }
      for (const o of city.tiles) {
        if (o.kind !== "office") continue;
        const d = Math.hypot(o.x - t.x, o.z - t.z);
        if (d <= rad) score += 90 - d * 6;
      }
      if (main) score += 140;
      else if (edge) score += 40;
    } else if (kind === "sewer") {
      if (nextToPier(city, t.x, t.z) || isWaterfront(city, t.x, t.z)) score -= 240;
      if (inlandCells(t.x, t.z) >= 3) score += 100;
      const rad = DEFS.sewer?.radius || 8;
      const plantRad = DEFS.power?.radius || 8;
      for (const p of city.tiles) {
        if (p.kind !== "power") continue;
        const d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d <= plantRad + 3) score += 160 - d * 8;
      }
      for (const o of city.tiles) {
        if (o.kind !== "office" && o.kind !== "house") continue;
        const d = Math.hypot(o.x - t.x, o.z - t.z);
        if (d <= rad) score += 70 - d * 5;
      }
      if (main) score += 140;
      else if (edge) score += 40;
    } else if (kind === "house" || kind === "apartment" || kind === "tower") {
      if (nextToPier(city, t.x, t.z) || isWaterfront(city, t.x, t.z)) score -= 420;
      if (inlandCells(t.x, t.z) < 2.2) score -= 280;
      if (inlandCells(t.x, t.z) >= 3) score += 40;
      const u = city.utilities || {};
      const i = idx(t.x, t.z);
      if (u.reachPower && u.reachPower.has(i)) score += 110;
      else if ((u.plants || 0) >= 1) score -= 50;
      if (u.reachWater && u.reachWater.has(i)) score += 50;
      if (u.reachSewer && u.reachSewer.has(i)) score += 40;
      if (main) score += 120;
      else if (edge) score += 20;
    } else if (main) score += 120;
    else if (edge) score += 20;
    if (typeof prefer === "function") score += prefer(t.x, t.z);
    if (score > bestScore) {
      bestScore = score;
      best = { x: t.x, z: t.z };
    }
  }
  return best;
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
  return isPaved(type) || type === "pier" || type === "park" || type === "bulldoze" || type === "cable";
}

export function beginStroke(city) {
  city._stroke = [];
}

export function placeOnStroke(city, x, z, type, facing = 0) {
  if (!city._stroke) beginStroke(city);
  if (city._stroke.some((c) => c.x === x && c.z === z)) return false;
  const cost = DEFS[type]?.cost || 0;
  if (!place(city, x, z, type, facing)) return false;
  const last = city.undo?.[city.undo.length - 1];
  if (last && (last.op === "place" || last.op === "cable")) city.undo.pop();
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
  if (!t || (!t.kind && !t.cable)) return false;
  const snap = snapshotTile(t);
  const hadCable = !!t.cable && isPaved(t.kind);
  const refund = hadCable ? refundFor("cable") : t.starter ? 0 : refundFor(t.kind);
  if (!demolish(city, x, z)) return false;
  const last = city.undo?.[city.undo.length - 1];
  if (last && (last.op === "demo" || last.op === "uncable")) city.undo.pop();
  city._stroke.push({ x, z, snap, refund, kind: hadCable ? "cable" : snap.kind, demo: true });
  return true;
}

export function place(city, x, z, type, facing = 0) {
  if (!canPlace(city, x, z, type)) return false;
  const def = DEFS[type];
  if (city.treasury < def.cost) return false;
  const t = tileAt(city, x, z);
  if (type === "cable") {
    city.treasury -= def.cost;
    t.cable = 1;
    city.dirty = true;
    city.meshDirty = true;
    city.dirtyCells.add(idx(x, z));
    if (!city.undo) city.undo = [];
    city.undo.push({ op: "cable", x, z, cost: def.cost });
    if (city.undo.length > 20) city.undo.shift();
    return true;
  }
  if (type === "bulldoze") return demolish(city, x, z);
  city.treasury -= def.cost;
  t.kind = type;
  t.facing = facing & 3;
  t.hScale = isPaved(type) || type === "park" || type === "pier" ? 1 : 0.88 + hash(x * 3.1, z * 5.7) * 0.28;
  t.id = city.nextId++;
  t.pop = 0;
  t.jobs = 0;
  t.starter = false;
  t.build = type === "pier" ? 1 : 0;
  t.abandoned = false;
  t.emptyTicks = 0;
  city.dirty = true;
  city.dirtyCells.add(idx(x, z));
  if (!city.undo) city.undo = [];
  city.undo.push({ op: 'place', x, z, kind: type, cost: def.cost });
  if (city.undo.length > 20) city.undo.shift();
  if (isInfra(type)) refreshRoadNet(city);
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
    cable: t.cable || 0,
  };
}

export function demolish(city, x, z) {
  const t = tileAt(city, x, z);
  if (!t || (!t.kind && !t.cable)) return false;
  if (t.cable && isPaved(t.kind)) {
    const refund = refundFor("cable");
    if (refund) city.treasury += refund;
    t.cable = 0;
    city.dirty = true;
    city.meshDirty = true;
    city.dirtyCells.add(idx(x, z));
    if (!city.undo) city.undo = [];
    city.undo.push({ op: "uncable", x, z, refund });
    if (city.undo.length > 20) city.undo.shift();
    return true;
  }
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
  t.cable = 0;
  city.dirty = true;
  city.dirtyCells.add(idx(x, z));
  if (!city.undo) city.undo = [];
  city.undo.push({ op: 'demo', x, z, snap, refund });
  if (city.undo.length > 20) city.undo.shift();
  if (isInfra(snap.kind)) refreshRoadNet(city);
  return true;
}

export function undoLast(city) {
  if (!city.undo || !city.undo.length) return null;
  const a = city.undo.pop();
  if (a.op === "stroke" && a.cells) {
    let infra = false;
    for (const c of a.cells) {
      const cell = tileAt(city, c.x, c.z);
      if (!cell) continue;
      if (c.kind === "cable") {
        if (!cell.cable) continue;
        city.treasury += c.cost || 0;
        cell.cable = 0;
        city.meshDirty = true;
        continue;
      }
      if (cell.kind !== c.kind) continue;
      city.treasury += c.cost || 0;
      cell.kind = null;
      cell.id = 0;
      cell.pop = 0;
      cell.jobs = 0;
      cell.build = 1;
      cell.cable = 0;
      if (isInfra(c.kind)) infra = true;
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
      if (isInfra(c.snap.kind)) infra = true;
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
  if (a.op === "cable") {
    if (!t.cable) return null;
    city.treasury += a.cost || 0;
    t.cable = 0;
    city.dirty = true;
    city.meshDirty = true;
    return { kind: "cable", infra: false };
  }
  if (a.op === "uncable") {
    city.treasury -= a.refund || 0;
    t.cable = 1;
    city.dirty = true;
    city.meshDirty = true;
    return { kind: "cable", infra: false };
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
    t.cable = 0;
    if (isInfra(a.kind)) refreshRoadNet(city);
    city.dirty = true;
    return { kind: a.kind, infra: isInfra(a.kind) };
  }
  if (a.op === 'demo' && a.snap) {
    city.treasury -= a.refund || 0;
    Object.assign(t, a.snap);
    if (isInfra(t.kind)) refreshRoadNet(city);
    city.dirty = true;
    return { kind: t.kind, infra: isInfra(t.kind) };
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
      cable: t.cable ? 1 : 0,
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
    contractsMissed: city.contractsMissed || 0,
    contractsWon: city.contractsWon || 0,
    stallTicks: city.stallTicks || 0,
    loanTicks: city.loanTicks || 0,
    laws: city.laws || { crews: false, festival: false, levy: false, nights: false, classrooms: false },
    scenario: city.scenario || "hamlet",
    lastWeek: city.lastWeek || null,
    lastDigest: city.lastDigest || null,
    nextRecapTick: city.nextRecapTick || 80,
    recapDue: !!city.recapDue,
    recapUnread: !!city.recapUnread,
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
    t.cable = 0;
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
  city.digest = null;
  city.recapDue = !!data.recapDue;
  city.recapUnread = !!data.recapUnread;
  city.holdRecap = false;
  city.nextRecapTick = Number.isFinite(data.nextRecapTick)
    ? data.nextRecapTick
    : Math.max(80, (city.tickCount || 0) + 40);
  city.contract = data.contract || null;
  city.contractsMissed = Number.isFinite(data.contractsMissed) ? data.contractsMissed : 0;
  city.contractsWon = Number.isFinite(data.contractsWon) ? data.contractsWon : 0;
  city.stallTicks = Number.isFinite(data.stallTicks) ? data.stallTicks : 0;
  city.loanTicks = Number.isFinite(data.loanTicks) ? data.loanTicks : 0;
  city.laws = {
    crews: !!data.laws?.crews,
    festival: !!data.laws?.festival,
    levy: !!data.laws?.levy,
    nights: !!data.laws?.nights,
    classrooms: !!data.laws?.classrooms,
  };
  city.scenario = data.scenario || "hamlet";
  city.lastWeek =
    data.lastWeek && Number.isFinite(data.lastWeek.treasury)
      ? { pop: data.lastWeek.pop || 0, treasury: data.lastWeek.treasury }
      : { pop: 0, treasury: city.treasury };
  city.lastDigest =
    data.lastDigest && Number.isFinite(data.lastDigest.week)
      ? {
          week: data.lastDigest.week,
          people: data.lastDigest.people || "",
          cash: data.lastDigest.cash || "",
          mood: data.lastDigest.mood,
          verdict: data.lastDigest.verdict || "",
          extra: data.lastDigest.extra || "",
          commute: data.lastDigest.commute,
          nudge: data.lastDigest.nudge || "",
        }
      : null;
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
    t.cable = b.cable ? 1 : 0;
    if (t.id >= city.nextId) city.nextId = t.id + 1;
  }
  city.dirty = true;
  city.undo = [];
  refreshRoadNet(city);
  return true;
}
