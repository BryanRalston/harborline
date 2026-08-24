import { DEFS, isResidential } from "./buildings.js";
import { forEachInRadius, idx, inBounds, isPaved, isWaterfront, tileAt } from "./city.js";
import { isBuilt } from "./construction.js";

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const LOAD = {
  house: { power: 4, water: 4, sewer: 4, internet: 4 },
  apartment: { power: 16, water: 14, sewer: 14, internet: 12 },
  tower: { power: 40, water: 32, sewer: 32, internet: 24 },
  shop: { power: 6, water: 4, sewer: 5, internet: 6 },
  market: { power: 5, water: 4, sewer: 4, internet: 4 },
  office: { power: 18, water: 8, sewer: 8, internet: 14 },
  warehouse: { power: 8, water: 2, sewer: 3, internet: 2 },
  factory: { power: 22, water: 6, sewer: 10, internet: 4 },
  hospital: { power: 18, water: 14, sewer: 16, internet: 10 },
  clinic: { power: 8, water: 6, sewer: 8, internet: 6 },
  school: { power: 10, water: 6, sewer: 8, internet: 8 },
  civic: { power: 12, water: 6, sewer: 8, internet: 8 },
  fire: { power: 8, water: 4, sewer: 4, internet: 4 },
  pier: { power: 2, water: 0, sewer: 0, internet: 0 },
  park: { power: 1, water: 2, sewer: 0, internet: 0 },
  power: { power: 0, water: 2, sewer: 2, internet: 0 },
  cistern: { power: 6, water: 0, sewer: 1, internet: 0 },
  sewer: { power: 10, water: 2, sewer: 0, internet: 0 },
  exchange: { power: 8, water: 2, sewer: 2, internet: 0 },
};

export const WELL_WATER = 40;
export const LAMP_POWER = 52;
export const PRIVY_SEWER = 48;
export const PIPE_AURA = 3;

function plantCap(kind) {
  return DEFS[kind]?.capacity || 90;
}

function plantRad(kind) {
  return DEFS[kind]?.radius || 8;
}

function loadOf(kind, key) {
  return LOAD[kind]?.[key] || 0;
}

function nearestPlant(t, plants) {
  let best = 999;
  for (const p of plants) {
    const d = Math.hypot(p.x - t.x, p.z - t.z);
    if (d < best) best = d;
  }
  return best;
}

function markReach(city, covered, x, z) {
  if (!inBounds(x, z)) return;
  const t = tileAt(city, x, z);
  if (!t || t.terrain === "water") return;
  covered.add(idx(x, z));
}

function paintReach(city, plants, radius) {
  const paved = new Set();
  const stack = [];
  for (const p of plants) {
    paved.add(idx(p.x, p.z));
    for (const [dx, dz] of DIRS) {
      const n = tileAt(city, p.x + dx, p.z + dz);
      if (n && isPaved(n.kind) && isBuilt(n) && nearestPlant(n, plants) <= radius) stack.push(n);
    }
  }
  while (stack.length) {
    const t = stack.pop();
    const i = idx(t.x, t.z);
    if (paved.has(i)) continue;
    if (!isPaved(t.kind) || !isBuilt(t)) continue;
    if (nearestPlant(t, plants) > radius) continue;
    paved.add(i);
    for (const [dx, dz] of DIRS) {
      const n = tileAt(city, t.x + dx, t.z + dz);
      if (n) stack.push(n);
    }
  }
  const covered = new Set();
  for (const p of plants) {
    forEachInRadius(city, p.x, p.z, radius, (tile) => {
      if (tile.terrain === "water") return;
      covered.add(idx(tile.x, tile.z));
    });
  }
  for (const i of paved) {
    const t = city.tiles[i];
    if (!t) continue;
    covered.add(i);
    if (!isPaved(t.kind)) continue;
    for (let dz = -PIPE_AURA; dz <= PIPE_AURA; dz++) {
      for (let dx = -PIPE_AURA; dx <= PIPE_AURA; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) > PIPE_AURA) continue;
        markReach(city, covered, t.x + dx, t.z + dz);
      }
    }
  }
  return { paved, covered };
}

function plantsOf(city, kind) {
  const out = [];
  for (const t of city.tiles) {
    if (t.kind === kind && isBuilt(t) && !t.abandoned) out.push(t);
  }
  return out;
}

export function capacityHomes(kind) {
  const key = kind === "power" ? "power" : kind === "cistern" ? "water" : kind === "exchange" ? "internet" : "sewer";
  const cap = DEFS[kind]?.capacity || 0;
  const load = LOAD.house[key] || 4;
  return Math.max(1, Math.round(cap / load));
}

function floodCable(city, exchanges) {
  const live = new Set();
  const stack = [];
  for (const p of exchanges) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dz) continue;
        const n = tileAt(city, p.x + dx, p.z + dz);
        if (n && isPaved(n.kind) && n.cable && isBuilt(n)) stack.push(n);
      }
    }
  }
  while (stack.length) {
    const t = stack.pop();
    const i = idx(t.x, t.z);
    if (live.has(i)) continue;
    if (!isPaved(t.kind) || !t.cable || !isBuilt(t)) continue;
    live.add(i);
    for (const [dx, dz] of DIRS) {
      const n = tileAt(city, t.x + dx, t.z + dz);
      if (n) stack.push(n);
    }
  }
  return live;
}

function onLiveCable(city, t, live) {
  for (const [dx, dz] of DIRS) {
    const n = tileAt(city, t.x + dx, t.z + dz);
    if (n && live.has(idx(n.x, n.z))) return true;
  }
  return false;
}

function fillInternet(city, exchanges) {
  if (!exchanges.length) return { used: 0, live: new Set(), covered: new Set() };
  const live = floodCable(city, exchanges);
  const covered = new Set(live);
  for (const i of live) {
    const t = city.tiles[i];
    if (!t) continue;
    for (const [dx, dz] of DIRS) {
      const n = tileAt(city, t.x + dx, t.z + dz);
      if (!n || n.terrain === "water") continue;
      if (!n.kind || isPaved(n.kind) || n.kind === "pier" || n.kind === "park" || n.kind === "bulldoze") continue;
      covered.add(idx(n.x, n.z));
    }
  }
  const slots = exchanges.map((p) => ({ p, left: plantCap(p.kind), used: 0 }));
  const demanders = [];
  for (const t of city.tiles) {
    if (!t.kind || t.wired) continue;
    if (!isBuilt(t) || t.abandoned) continue;
    const load = loadOf(t.kind, "internet");
    if (!load) continue;
    if (!covered.has(idx(t.x, t.z)) || !onLiveCable(city, t, live)) continue;
    demanders.push({ t, load, dist: nearestPlant(t, exchanges) });
  }
  demanders.sort((a, b) => a.dist - b.dist);
  let used = 0;
  for (const d of demanders) {
    let best = null;
    let bestD = 999;
    for (const s of slots) {
      if (s.left < d.load) continue;
      const dist = Math.hypot(s.p.x - d.t.x, s.p.z - d.t.z);
      if (dist < bestD) {
        best = s;
        bestD = dist;
      }
    }
    if (!best) continue;
    best.left -= d.load;
    best.used += d.load;
    used += d.load;
    d.t.wired = true;
    d.t.internetSrc = "line";
  }
  for (const s of slots) s.p.servedLoad = s.used;
  return { used, live, covered };
}

export function ghostUtilHint(city, x, z, kind) {
  if (kind === "cable") {
    const exchanges = plantsOf(city, "exchange").filter((t) => t.powered && t.powerSrc === "mains");
    if (!exchanges.length) return "Dead copper — needs an Exchange on the line.";
    const live = floodCable(city, exchanges);
    if (live.has(idx(x, z))) return null;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dz) continue;
        const n = tileAt(city, x + dx, z + dz);
        if (!n) continue;
        if (live.has(idx(n.x, n.z))) return null;
        if (n.kind === "exchange" && isBuilt(n) && n.powered && n.powerSrc === "mains") return null;
      }
    }
    return "Dead copper — this street does not reach an Exchange.";
  }
  if (kind === "exchange") {
    const plants = plantsOf(city, "power");
    const lit = plants.some((p) => Math.hypot(p.x - x, p.z - z) <= plantRad("power") + PIPE_AURA);
    if (!lit) return "Idle here — needs a plant in range.";
    const live = floodCable(city, [{ x, z, kind: "exchange" }]);
    let demand = 0;
    for (const t of city.tiles) {
      if (!t.kind || isPaved(t.kind) || t.kind === "exchange") continue;
      if (!isBuilt(t) || t.abandoned) continue;
      const load = loadOf(t.kind, "internet");
      if (!load) continue;
      if (onLiveCable(city, t, live)) demand += load;
    }
    if (!demand) return "Idle here — click Cable along the street to the houses.";
    return null;
  }
  if (kind === "fire" || kind === "school" || kind === "clinic" || kind === "hospital" || kind === "park") {
    const radius = DEFS[kind]?.radius || 8;
    let homes = 0;
    forEachInRadius(city, x, z, radius, (t) => {
      if (t.kind && isResidential(t.kind) && isBuilt(t)) homes += 1;
    });
    if (!homes) return "Idle here — no homes in range.";
    return null;
  }
  if (kind !== "power" && kind !== "cistern" && kind !== "sewer") return null;
  const radius = plantRad(kind);
  if (kind === "cistern" || kind === "sewer") {
    const plants = plantsOf(city, "power");
    const lit = plants.some((p) => Math.hypot(p.x - x, p.z - z) <= plantRad("power") + PIPE_AURA);
    if (!lit) return "Idle here — needs a plant in range.";
  }
  const key = kind === "power" ? "power" : kind === "cistern" ? "water" : "sewer";
  const { covered } = paintReach(city, [{ x, z, kind }], radius);
  let demand = 0;
  for (const t of city.tiles) {
    if (!t.kind || t.kind === "power" || t.kind === "cistern" || t.kind === "sewer") continue;
    if (!isBuilt(t) || t.abandoned) continue;
    if (!covered.has(idx(t.x, t.z))) continue;
    demand += loadOf(t.kind, key);
  }
  if (!demand) return "Idle here — no lots in range.";
  return null;
}

export function plantWhyIdle(tile) {
  if (!tile || (tile.kind !== "power" && tile.kind !== "cistern" && tile.kind !== "sewer" && tile.kind !== "exchange")) return null;
  if (!isBuilt(tile)) return "Still building.";
  if (tile.kind !== "power" && !(tile.powered && tile.powerSrc === "mains")) {
    if (tile.kind === "cistern") return "Idle — needs a plant in range before it can pump.";
    if (tile.kind === "exchange") return "Idle — needs a plant in range before it can feed the line.";
    return "Idle — needs a plant in range before it can treat.";
  }
  if ((tile.servedLoad || 0) <= 0) {
    if (tile.kind === "exchange") return "No line. Click Cable from this lot along the street to the houses.";
    return "No lots in range. Move closer, or pave toward homes.";
  }
  return null;
}

export function reachAt(city, x, z) {
  const t = { x, z };
  const power = plantsOf(city, "power");
  const water = plantsOf(city, "cistern");
  const sewer = plantsOf(city, "sewer");
  return {
    power: power.length ? nearestPlant(t, power) <= (DEFS.power.radius || 10) : false,
    water: water.length ? nearestPlant(t, water) <= (DEFS.cistern.radius || 10) : false,
    sewer: sewer.length ? nearestPlant(t, sewer) <= (DEFS.sewer.radius || 10) : false,
  };
}

function fillService(city, plants, key, flag, src, pred) {
  if (!plants.length) return { used: 0, covered: new Set() };
  const radius = plantRad(plants[0].kind);
  const { covered } = paintReach(city, plants, radius);
  const slots = plants.map((p) => ({ p, left: plantCap(p.kind), used: 0 }));
  const demanders = [];
  for (const t of city.tiles) {
    if (!t.kind || t[flag]) continue;
    if (!isBuilt(t) || t.abandoned) continue;
    if (pred && !pred(t)) continue;
    const load = loadOf(t.kind, key);
    if (!load) continue;
    if (!covered.has(idx(t.x, t.z))) continue;
    demanders.push({ t, load, dist: nearestPlant(t, plants) });
  }
  demanders.sort((a, b) => a.dist - b.dist);
  let used = 0;
  for (const d of demanders) {
    let best = null;
    let bestD = 999;
    for (const s of slots) {
      if (s.left < d.load) continue;
      const dist = Math.hypot(s.p.x - d.t.x, s.p.z - d.t.z);
      if (dist < bestD) {
        best = s;
        bestD = dist;
      }
    }
    if (!best) continue;
    best.left -= d.load;
    best.used += d.load;
    used += d.load;
    d.t[flag] = true;
    d.t[src] = "mains";
  }
  for (const s of slots) s.p.servedLoad = s.used;
  return { used, covered };
}

function fillFallback(city, key, flag, prop, label, cap, pred) {
  const demanders = [];
  for (const t of city.tiles) {
    if (!t.kind || t[flag]) continue;
    if (!isBuilt(t) || t.abandoned) continue;
    if (pred && !pred(t)) continue;
    const load = loadOf(t.kind, key);
    if (!load) continue;
    demanders.push({ t, load });
  }
  let used = 0;
  for (const d of demanders) {
    if (used + d.load > cap) continue;
    used += d.load;
    d.t[flag] = true;
    d.t[prop] = label;
  }
  return used;
}

export function pierGroups(city) {
  const seen = new Set();
  let n = 0;
  for (const t of city.tiles) {
    if (t.kind !== "pier") continue;
    const start = idx(t.x, t.z);
    if (seen.has(start)) continue;
    n += 1;
    const stack = [[t.x, t.z]];
    while (stack.length) {
      const [x, z] = stack.pop();
      const i = idx(x, z);
      if (seen.has(i)) continue;
      const tile = tileAt(city, x, z);
      if (!tile || tile.kind !== "pier") continue;
      seen.add(i);
      for (const [dx, dz] of DIRS) stack.push([x + dx, z + dz]);
    }
  }
  return n;
}

export function landfallLinked(city) {
  for (const t of city.tiles) {
    if (t.kind !== "pier") continue;
    if (!t.shoreline && t.terrain !== "water") continue;
    for (const [dx, dz] of DIRS) {
      const n = tileAt(city, t.x + dx, t.z + dz);
      if (n && isPaved(n.kind)) return true;
    }
  }
  return false;
}

export function dockMix(city) {
  let warehouses = 0;
  let factories = 0;
  let dockWarehouses = 0;
  let dockFactories = 0;
  let dockPower = 0;
  let waterShops = 0;
  let waterParks = 0;
  let berths = 0;
  for (const t of city.tiles) {
    if (t.kind === "warehouse") {
      warehouses += 1;
      if (isWaterfront(city, t.x, t.z)) dockWarehouses += 1;
    } else if (t.kind === "factory") {
      factories += 1;
      if (isWaterfront(city, t.x, t.z)) dockFactories += 1;
    } else if (t.kind === "power" && isWaterfront(city, t.x, t.z)) dockPower += 1;
    else if (t.kind === "shop" && isWaterfront(city, t.x, t.z)) waterShops += 1;
    else if (t.kind === "market") {
      if (isWaterfront(city, t.x, t.z)) waterShops += 1;
    }
    else if (t.kind === "park" && isWaterfront(city, t.x, t.z)) waterParks += 1;
    else if (t.kind === "pier" && t.terrain === "water") berths += 1;
  }
  const freight = dockWarehouses * 1.45 + warehouses * 0.5 + dockFactories * 1.7 + factories * 0.35 + dockPower * 1.1;
  const pretty = waterShops * 1.85 + waterParks * 1.15 + (berths > 0 && dockWarehouses === 0 ? berths * 0.18 : 0);
  const mix = freight / Math.max(freight + pretty, 0.01);
  return {
    warehouses,
    factories,
    dockWarehouses,
    dockFactories,
    dockPower,
    waterShops,
    waterParks,
    berths,
    freight,
    pretty,
    mix,
    groups: pierGroups(city),
  };
}

function outfallFoul(city, sewers) {
  if (!sewers.length) return 0;
  let worst = 0;
  for (const s of sewers) {
    let near = 0;
    for (const t of city.tiles) {
      if (!t.kind) continue;
      const dock = t.kind === "pier" || (t.kind === "shop" && isWaterfront(city, t.x, t.z));
      if (!dock) continue;
      const d = Math.max(Math.abs(t.x - s.x), Math.abs(t.z - s.z));
      if (d <= 6) near = Math.max(near, 1 - d / 7);
    }
    if (isWaterfront(city, s.x, s.z)) near = Math.max(near, 0.85);
    worst = Math.max(worst, near);
  }
  return worst;
}

export function refreshUtilities(city) {
  for (const t of city.tiles) {
    t.powered = false;
    t.watered = false;
    t.sewered = false;
    t.wired = false;
    t.powerSrc = null;
    t.waterSrc = null;
    t.sewerSrc = null;
    t.internetSrc = null;
    t.servedLoad = 0;
  }

  let powerLoad = 0;
  let waterLoad = 0;
  let sewerLoad = 0;
  for (const t of city.tiles) {
    if (!t.kind || !isBuilt(t) || t.abandoned) continue;
    powerLoad += loadOf(t.kind, "power");
    waterLoad += loadOf(t.kind, "water");
    sewerLoad += loadOf(t.kind, "sewer");
  }

  const powerPlants = plantsOf(city, "power");
  const powerCap = powerPlants.length * plantCap("power");
  let powerFill = { used: 0, covered: new Set() };
  if (powerPlants.length) powerFill = fillService(city, powerPlants, "power", "powered", "powerSrc");
  else {
    fillFallback(
      city,
      "power",
      "powered",
      "powerSrc",
      "lamp",
      LAMP_POWER,
      (t) => t.kind === "house" || t.kind === "shop" || t.kind === "market" || t.kind === "park" || t.kind === "pier",
    );
  }

  const cisterns = plantsOf(city, "cistern").filter((t) => t.powered && t.powerSrc === "mains");
  const waterCap = cisterns.length * plantCap("cistern");
  let waterFill = { used: 0, covered: new Set() };
  if (cisterns.length) waterFill = fillService(city, cisterns, "water", "watered", "waterSrc");
  else {
    fillFallback(
      city,
      "water",
      "watered",
      "waterSrc",
      "well",
      WELL_WATER,
      (t) => isResidential(t.kind) || t.kind === "shop" || t.kind === "market" || t.kind === "park",
    );
  }

  const sewers = plantsOf(city, "sewer").filter((t) => t.powered && t.powerSrc === "mains");
  const sewerCap = sewers.length * plantCap("sewer");
  let sewerFill = { used: 0, covered: new Set() };
  if (sewers.length) sewerFill = fillService(city, sewers, "sewer", "sewered", "sewerSrc");
  else {
    fillFallback(
      city,
      "sewer",
      "sewered",
      "sewerSrc",
      "privy",
      PRIVY_SEWER,
      (t) => isResidential(t.kind) || t.kind === "shop" || t.kind === "market",
    );
  }

  let internetLoad = 0;
  for (const t of city.tiles) {
    if (!t.kind || !isBuilt(t) || t.abandoned) continue;
    internetLoad += loadOf(t.kind, "internet");
  }
  const exchanges = plantsOf(city, "exchange").filter((t) => t.powered && t.powerSrc === "mains");
  const internetCap = exchanges.length * plantCap("exchange");
  const netFill = fillInternet(city, exchanges);
  let cables = 0;
  let deadCable = 0;
  for (const t of city.tiles) {
    if (!t.cable || !isPaved(t.kind) || !isBuilt(t)) continue;
    cables += 1;
    if (!netFill.live.has(idx(t.x, t.z))) deadCable += 1;
  }
  let wiredNeed = 0;
  let wiredHave = 0;
  for (const t of city.tiles) {
    if (!t.kind || isPaved(t.kind) || t.kind === "pier" || t.kind === "park" || t.kind === "bulldoze" || t.kind === "exchange") continue;
    if (!isBuilt(t) || t.abandoned) continue;
    if (!loadOf(t.kind, "internet")) continue;
    wiredNeed += 1;
    if (t.wired) wiredHave += 1;
  }

  const mix = dockMix(city);
  const foul = outfallFoul(city, plantsOf(city, "sewer"));
  const raw = sewerLoad > PRIVY_SEWER && sewers.length === 0;
  let powerServed = 0;
  let waterServed = 0;
  let sewerServed = 0;
  let dark = 0;
  let thirsty = 0;
  let unsanitary = 0;
  for (const t of city.tiles) {
    if (!t.kind || !isBuilt(t) || t.abandoned) continue;
    const pl = loadOf(t.kind, "power");
    const wl = loadOf(t.kind, "water");
    const sl = loadOf(t.kind, "sewer");
    if (pl) {
      if (t.powered) powerServed += pl;
      else dark += 1;
    }
    if (wl) {
      if (t.watered) waterServed += wl;
      else thirsty += 1;
    }
    if (sl) {
      if (t.sewered) sewerServed += sl;
      else unsanitary += 1;
    }
  }
  const brown = dark > 0;
  const dry = thirsty > 0;
  const harborHealth = Math.max(
    0.16,
    Math.min(
      1,
      1 -
        mix.dockFactories * 0.12 -
        mix.dockPower * 0.2 -
        foul * 0.38 -
        (raw ? 0.42 : 0) -
        mix.dockWarehouses * 0.04,
    ),
  );

  city.utilities = {
    powerLoad,
    powerCap: powerCap + (powerPlants.length ? 0 : LAMP_POWER),
    powerUsed: powerServed,
    plants: powerPlants.length,
    waterLoad,
    waterCap: waterCap + (cisterns.length ? 0 : WELL_WATER),
    waterUsed: waterServed,
    towers: cisterns.length,
    cisterns: plantsOf(city, "cistern").length,
    sewerLoad,
    sewerCap: sewerCap + (sewers.length ? 0 : PRIVY_SEWER),
    sewerUsed: sewerServed,
    works: sewers.length,
    lamp: !powerPlants.length,
    well: !cisterns.length,
    privy: !sewers.length,
    brown,
    dry,
    raw,
    dark,
    thirsty,
    unsanitary,
    foul,
    harborHealth,
    mix: mix.mix,
    freight: mix.freight,
    pretty: mix.pretty,
    dockWarehouses: mix.dockWarehouses,
    dockFactories: mix.dockFactories,
    dockPower: mix.dockPower,
    waterShops: mix.waterShops,
    waterParks: mix.waterParks,
    groups: mix.groups,
    linked: landfallLinked(city),
    reachPower: powerFill.covered,
    reachWater: waterFill.covered,
    reachSewer: sewerFill.covered,
    cables,
    deadCable,
    wiredNeed,
    wiredHave,
    internetLoad,
    internetCap,
    internetUsed: netFill.used,
    exchanges: exchanges.length,
    liveCable: netFill.live,
    reachInternet: netFill.covered,
    idleExchanges: exchanges.filter((p) => (p.servedLoad || 0) <= 0).length,
    idlePlants: powerPlants.filter((p) => (p.servedLoad || 0) <= 0).length,
    idleTowers: cisterns.filter((p) => (p.servedLoad || 0) <= 0).length,
    idleWorks: sewers.filter((p) => (p.servedLoad || 0) <= 0).length,
  };
  return city.utilities;
}

export function utilAt(tile) {
  if (!tile) return null;
  return {
    powered: !!tile.powered,
    watered: !!tile.watered,
    sewered: !!tile.sewered,
    wired: !!tile.wired,
    powerSrc: tile.powerSrc,
    waterSrc: tile.waterSrc,
    sewerSrc: tile.sewerSrc,
    internetSrc: tile.internetSrc,
  };
}
