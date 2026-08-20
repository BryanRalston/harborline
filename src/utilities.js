import { DEFS, isResidential } from "./buildings.js";
import { idx, isPaved, isWaterfront, tileAt } from "./city.js";
import { isBuilt } from "./construction.js";

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const LOAD = {
  house: { power: 4, water: 4, sewer: 4 },
  apartment: { power: 16, water: 14, sewer: 14 },
  tower: { power: 40, water: 32, sewer: 32 },
  shop: { power: 6, water: 4, sewer: 5 },
  office: { power: 18, water: 8, sewer: 8 },
  warehouse: { power: 8, water: 2, sewer: 3 },
  factory: { power: 22, water: 6, sewer: 10 },
  hospital: { power: 18, water: 14, sewer: 16 },
  clinic: { power: 8, water: 6, sewer: 8 },
  school: { power: 10, water: 6, sewer: 8 },
  civic: { power: 12, water: 6, sewer: 8 },
  fire: { power: 8, water: 4, sewer: 4 },
  pier: { power: 2, water: 0, sewer: 0 },
  park: { power: 1, water: 2, sewer: 0 },
  power: { power: 0, water: 2, sewer: 2 },
  cistern: { power: 6, water: 0, sewer: 1 },
  sewer: { power: 10, water: 2, sewer: 0 },
};

export const WELL_WATER = 40;
export const LAMP_POWER = 52;
export const PRIVY_SEWER = 48;

function loadOf(kind, key) {
  return LOAD[kind]?.[key] || 0;
}

function floodPaved(city, plants, into) {
  const stack = [];
  for (const p of plants) {
    for (const [dx, dz] of DIRS) {
      const n = tileAt(city, p.x + dx, p.z + dz);
      if (n && isPaved(n.kind) && isBuilt(n)) stack.push(n);
    }
  }
  while (stack.length) {
    const t = stack.pop();
    const i = idx(t.x, t.z);
    if (into.has(i)) continue;
    if (!isPaved(t.kind) || !isBuilt(t)) continue;
    into.add(i);
    for (const [dx, dz] of DIRS) {
      const n = tileAt(city, t.x + dx, t.z + dz);
      if (n) stack.push(n);
    }
  }
  return into;
}

function onNet(city, t, paved) {
  if (isPaved(t.kind) && paved.has(idx(t.x, t.z))) return true;
  for (const [dx, dz] of DIRS) {
    const n = tileAt(city, t.x + dx, t.z + dz);
    if (n && paved.has(idx(n.x, n.z))) return true;
  }
  return false;
}

function plantsOf(city, kind) {
  const out = [];
  for (const t of city.tiles) {
    if (t.kind === kind && isBuilt(t) && !t.abandoned) out.push(t);
  }
  return out;
}

function nearestPlant(t, plants) {
  let best = 999;
  for (const p of plants) {
    const d = Math.abs(p.x - t.x) + Math.abs(p.z - t.z);
    if (d < best) best = d;
  }
  return best;
}

function fillService(city, plants, key, flag, src, cap, pred) {
  const paved = floodPaved(city, plants, new Set());
  const demanders = [];
  for (const t of city.tiles) {
    if (!t.kind || t[flag]) continue;
    if (!isBuilt(t) || t.abandoned) continue;
    if (pred && !pred(t)) continue;
    const load = loadOf(t.kind, key);
    if (!load) continue;
    if (!onNet(city, t, paved)) continue;
    demanders.push({ t, load, dist: nearestPlant(t, plants) });
  }
  demanders.sort((a, b) => a.dist - b.dist);
  let used = 0;
  for (const d of demanders) {
    if (used + d.load > cap) continue;
    used += d.load;
    d.t[flag] = true;
    d.t[src] = "mains";
  }
  return used;
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
    t.powerSrc = null;
    t.waterSrc = null;
    t.sewerSrc = null;
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
  const powerCap = powerPlants.length * (DEFS.power.capacity || 90);
  if (powerPlants.length) fillService(city, powerPlants, "power", "powered", "powerSrc", powerCap);
  else {
    fillFallback(
      city,
      "power",
      "powered",
      "powerSrc",
      "lamp",
      LAMP_POWER,
      (t) => t.kind === "house" || t.kind === "shop" || t.kind === "park" || t.kind === "pier",
    );
  }

  const cisterns = plantsOf(city, "cistern").filter((t) => t.powered && t.powerSrc === "mains");
  const waterCap = cisterns.length * (DEFS.cistern.capacity || 80);
  if (cisterns.length) fillService(city, cisterns, "water", "watered", "waterSrc", waterCap);
  fillFallback(
    city,
    "water",
    "watered",
    "waterSrc",
    "well",
    WELL_WATER,
    (t) => isResidential(t.kind) || t.kind === "shop" || t.kind === "park",
  );

  const sewers = plantsOf(city, "sewer").filter((t) => t.powered && t.powerSrc === "mains");
  const sewerCap = sewers.length * (DEFS.sewer.capacity || 90);
  if (sewers.length) fillService(city, sewers, "sewer", "sewered", "sewerSrc", sewerCap);
  fillFallback(
    city,
    "sewer",
    "sewered",
    "sewerSrc",
    "privy",
    PRIVY_SEWER,
    (t) => isResidential(t.kind) || t.kind === "shop",
  );

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
  };
  return city.utilities;
}

export function utilAt(tile) {
  if (!tile) return null;
  return {
    powered: !!tile.powered,
    watered: !!tile.watered,
    sewered: !!tile.sewered,
    powerSrc: tile.powerSrc,
    waterSrc: tile.waterSrc,
    sewerSrc: tile.sewerSrc,
  };
}
