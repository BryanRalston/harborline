import { DEFS, isResidential, isWorkplace } from './buildings.js';
import { forEachInRadius, hasRoadAccess, isPaved, isWaterfront, pushEvent, refreshRoadNet, START_TREASURY, tileAt } from './city.js';
import { isBuilt } from './construction.js';

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function coverage(city, x, z, pred, radius) {
  let best = 0;
  forEachInRadius(city, x, z, radius, (tile, dist) => {
    if (!tile.kind) return;
    if (!pred(tile.kind, DEFS[tile.kind])) return;
    best = Math.max(best, 1 - dist / radius);
  });
  return best;
}

function nearbyPop(city, x, z, radius) {
  let n = 0;
  forEachInRadius(city, x, z, radius, (tile) => {
    if (tile.kind && isResidential(tile.kind)) n += tile.pop;
  });
  return n;
}

function nearbyJobs(city, x, z, radius) {
  let n = 0;
  forEachInRadius(city, x, z, radius, (tile) => {
    if (tile.kind && isWorkplace(tile.kind)) n += tile.jobs || 0;
  });
  return n;
}

function lotSuit(city, x, z) {
  const access = hasRoadAccess(city, x, z) ? 1 : 0;
  const park = coverage(city, x, z, (k) => k === "park", 5);
  const edu = coverage(city, x, z, (_, d) => d.service === "edu", 8);
  const health = coverage(city, x, z, (_, d) => d.service === "health", 10);
  const pol = localPollution(city, x, z);
  const water = isWaterfront(city, x, z) ? 1 : 0;
  const jam = roadLoad(city, x, z);
  const people = nearbyPop(city, x, z, 8);
  const jobs = nearbyJobs(city, x, z, 10);
  const cargo = coverage(city, x, z, (k) => k === "pier" || k === "warehouse", 8);
  return {
    home: clamp(0.12 + access * 0.28 + park * 0.2 + edu * 0.18 + health * 0.1 + water * 0.12 - pol * 0.45 - (jam > 3 ? 0.16 : 0), 0, 1),
    shop: clamp(0.06 + access * 0.2 + people / 22 + (jam > 1.2 ? 0.08 : 0) - pol * 0.15, 0, 1),
    work: clamp(0.08 + access * 0.22 + people / 28 + cargo * 0.18 - pol * 0.08, 0, 1),
    port: clamp(0.05 + cargo * 0.4 + water * 0.35 + jobs / 40, 0, 1),
  };
}

function localPollution(city, x, z) {
  let p = 0;
  forEachInRadius(city, x, z, 8, (tile, dist) => {
    if (!tile.kind) return;
    const pol = DEFS[tile.kind].pollution || 0;
    if (pol) p += pol * (1 - dist / 8);
  });
  if (city.laws?.levy) p *= 0.62;
  return p;
}

export const LAWS = [
  { id: "crews", label: "Road crews", cost: "$0.12 / road", blurb: "Patch the avenues. Jams ease." },
  { id: "festival", label: "Harbor festival", cost: "$6 / tick", blurb: "Tourists fill the promenade." },
  { id: "levy", label: "Smoke levy", cost: "tax on plants", blurb: "Factories pay. The air clears." },
  { id: "nights", label: "Late hours", cost: "$0.18 / shop", blurb: "Shops stay open after dark." },
  { id: "classrooms", label: "Classrooms", cost: "$2.20 / school", blurb: "Extra seats. Families stay." },
];

export function ensureLaws(city) {
  city.laws = {
    crews: false,
    festival: false,
    levy: false,
    nights: false,
    classrooms: false,
    ...(city.laws || {}),
  };
  return city.laws;
}

export function toggleLaw(city, id) {
  const laws = ensureLaws(city);
  if (!Object.prototype.hasOwnProperty.call(laws, id)) return false;
  laws[id] = !laws[id];
  const spec = LAWS.find((l) => l.id === id);
  pushEvent(city, laws[id] ? `${spec.label} is in force.` : `${spec.label} repealed.`);
  return true;
}

function roadLoad(city, x, z) {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let loads = 0;
  let roads = 0;
  for (const [dx, dz] of dirs) {
    const r = tileAt(city, x + dx, z + dz);
    if (!r || !isPaved(r.kind)) continue;
    roads += 1;
    let n = 0;
    for (const [ox, oz] of dirs) {
      const b = tileAt(city, r.x + ox, r.z + oz);
      if (b?.kind && !isPaved(b.kind) && b.kind !== 'park' && b.kind !== 'pier') n += 1;
    }
    loads += n;
  }
  return roads ? loads / roads : 0;
}

const CONTRACTS = [
  {
    id: 'jobs',
    weeks: 6,
    reward: 3200,
    make: (s) => ({ need: Math.round(s.jobs + 70) }),
    done: (c, s) => s.jobs >= c.need,
    label: (c) => `Fill ${c.need} jobs`,
  },
  {
    id: 'shops',
    weeks: 5,
    reward: 2400,
    make: (s) => ({ need: (s.shops || 0) + 3 }),
    done: (c, s) => s.shops >= c.need,
    label: (c) => `Operate ${c.need} shops`,
  },
  {
    id: 'mood',
    weeks: 5,
    reward: 2200,
    make: () => ({ need: 58 }),
    done: (c, s) => s.happiness >= c.need,
    label: (c) => `Hold mood at ${c.need}%`,
  },
  {
    id: 'piers',
    weeks: 6,
    reward: 2800,
    make: (s) => ({ need: (s.piers || 0) + 2 }),
    done: (c, s) => s.piers >= c.need,
    label: (c) => `Berth ${c.need} pier tiles`,
  },
  {
    id: 'homes',
    weeks: 6,
    reward: 2600,
    make: (s) => ({ need: Math.round((s.pop || 0) + ((s.pop || 0) < 80 ? 40 : 80)) }),
    done: (c, s) => s.pop >= c.need,
    label: (c) => `Reach ${c.need} residents`,
  },
  {
    id: 'commute',
    weeks: 5,
    reward: 2100,
    make: () => ({ need: 16 }),
    done: (c, s) => (s.commute || 99) <= c.need,
    label: (c) => `Hold commute at ${c.need} min or less`,
  },
  {
    id: 'school',
    weeks: 5,
    reward: 2400,
    make: (s) => ({ need: Math.max(1, (s.schools || 0) + 1) }),
    done: (c, s) => (s.schools || 0) >= c.need,
    label: (c) => `Open ${c.need} schools`,
  },
  {
    id: 'clinic',
    weeks: 5,
    reward: 1800,
    make: (s) => ({ need: (s.clinics || 0) + 1 }),
    done: (c, s) => (s.clinics || 0) >= c.need,
    label: (c) => `Open ${c.need} clinic${c.need > 1 ? "s" : ""}`,
  },
];

function pickContract(city, s) {
  const last = city.contract?.id;
  const pop = s.pop || 0;
  let pool = CONTRACTS.filter((c) => c.id !== last);
  if (pop < 50) pool = pool.filter((c) => ["homes", "jobs", "shops", "piers"].includes(c.id));
  else if (pop < 80) pool = pool.filter((c) => ["homes", "jobs", "shops", "piers"].includes(c.id));
  const spec = pool[Math.floor(Math.random() * pool.length)] || CONTRACTS[0];
  const extra = spec.make(s);
  return {
    id: spec.id,
    need: extra.need,
    label: spec.label({ ...spec, ...extra }),
    reward: spec.reward,
    weeks: spec.weeks,
    week0: city.stats?.week || 0,
  };
}

function advanceContract(city, s) {
  if ((city.tickCount || 0) < 8) return;
  if (!city.contract) {
    city.contract = pickContract(city, s);
    pushEvent(city, `Contract: ${city.contract.label}.`);
    return;
  }
  const spec = CONTRACTS.find((c) => c.id === city.contract.id);
  if (spec && spec.done(city.contract, s)) {
    city.treasury += city.contract.reward;
    pushEvent(city, `Contract done. +$${city.contract.reward.toLocaleString('en-US')}.`);
    city.contract = pickContract(city, s);
    pushEvent(city, `Next: ${city.contract.label}.`);
    return;
  }
  if (city.tickCount >= 20 && city.tickCount % 20 === 0) {
    city.contract.weeks -= 1;
    if (city.contract.weeks <= 0) {
      pushEvent(city, 'Contract expired.');
      city.contract = pickContract(city, s);
      pushEvent(city, `Next: ${city.contract.label}.`);
    }
  }
}

export function skipContract(city) {
  if (!city.contract) return false;
  city.treasury -= 250;
  pushEvent(city, `Passed on the job. -$250. Next: wait.`);
  const s = city.stats;
  city.contract = pickContract(city, s || {});
  pushEvent(city, `Next: ${city.contract.label}.`);
  if (city.stats) city.stats.contract = city.contract;
  return true;
}

export function inspectLocal(city, x, z) {
  const t = tileAt(city, x, z);
  if (!t) return null;
  const def = t.kind ? DEFS[t.kind] : null;
  const park = coverage(city, x, z, (k) => k === 'park', 5);
  const edu = coverage(city, x, z, (_, d) => d.service === 'edu', 8);
  const health = coverage(city, x, z, (_, d) => d.service === 'health', 10);
  const civic = coverage(city, x, z, (_, d) => d.service === 'civic', 12);
  const cargo = coverage(city, x, z, (k) => k === 'pier' || k === 'warehouse', 8);
  const pollution = localPollution(city, x, z);
  const access = isPaved(t.kind) || t.kind === 'pier' || t.kind === 'park' || hasRoadAccess(city, x, z);
  const water = isWaterfront(city, x, z);
  return {
    tile: t,
    def,
    park,
    edu,
    health,
    civic,
    cargo,
    pollution,
    access,
    waterfront: water,
    nearbyPop: nearbyPop(city, x, z, 8),
    nearbyJobs: nearbyJobs(city, x, z, 10),
    congestion: roadLoad(city, x, z),
    abandoned: !!t.abandoned,
    value: t.value || 0,
    commute: city.stats?.commute || 0,
    suit: lotSuit(city, x, z),
    upgrade: t.kind ? DEFS[t.kind].upgrade : null,
    upgradeCost: t.kind ? DEFS[t.kind].upgradeCost : null,
  };
}

function note(city, id, cond, msg, bonus = 0) {
  if (!cond || city.seen[id]) return;
  city.seen[id] = true;
  if ((city.tickCount || 0) < 4) return;
  pushEvent(city, msg);
  if (bonus) city.treasury += bonus;
}

export function contractProgress(c, s) {
  if (!c || !s) return "";
  if (c.id === "homes") return `${Math.round(s.pop)}/${c.need}`;
  if (c.id === "jobs") return `${Math.round(s.jobs)}/${c.need}`;
  if (c.id === "shops") return `${s.shops || 0}/${c.need}`;
  if (c.id === "piers") return `${s.piers || 0}/${c.need}`;
  if (c.id === "mood") return `${Math.round(s.happiness)}/${c.need}`;
  if (c.id === "commute") return `${s.commute || 0}/${c.need} min`;
  if (c.id === "school") return `${s.schools || 0}/${c.need}`;
  if (c.id === "clinic") return `${s.clinics || 0}/${c.need}`;
  return "";
}

function advisorFor(broke, unemp, pop, popCap, happiness, demand, extra) {
  if (broke && !extra.loan) return 'Treasury is empty. Pause growth, add jobs, or float a bond.';
  if (broke) return 'The bond is covering a hole. Cut costs or grow the tax base.';
  if (extra.abandoned) return `${extra.abandoned} homes are abandoned. Reconnect the road or reopen them.`;
  if (pop < 55 && extra.tick < 16) {
    if ((extra.berths || 0) < 4) return 'A fishing hamlet. Push the pier into the harbor — trade and visitors follow the dock.';
    return 'A small harbor town. Extend the road, then add homes and shops.';
  }
  if (extra.eduOver > 0.25) return 'Schools are packed. Build another school or pass Classrooms.';
  if (extra.healthOver > 0.25) return 'Clinics are short. Add a clinic or hospital.';
  if (extra.factories && extra.fires < 1) return 'Industry has no firehouse. One spark and the plant is gone.';
  if ((extra.congested > 12 || extra.commute > 22) && !extra.crews) return 'Avenues are jammed. Pass road crews, or add streets.';
  if (extra.congested > 12 || extra.commute > 22) return 'Avenues are jammed. Add roads to spread the load.';
  if (unemp > 0.38) return 'Too few jobs. Build shops, offices, or the harbor.';
  if (popCap > 8 && pop / popCap > 0.9) return 'Homes are full. Zone more housing.';
  if (happiness < 38) return 'Mood is low. Add parks, a school, or cut pollution.';
  if (demand.shop > 0.72) return 'People need shops along the avenues.';
  if (demand.home > 0.72) return 'Families want rowhouses near work.';
  if (demand.work > 0.7) return 'Job demand is high. Add workplaces.';
  if (demand.port > 0.55) return 'Ships are waiting. Drag the pier farther into the harbor.';
  if ((extra.berths || 0) >= 4 && (extra.warehouses || 0) < 1) return 'Cargo is stacking on the dock. A warehouse near the water will move it.';
  if ((extra.berths || 0) >= 3 && (extra.waterShops || 0) < 1) return 'Tourists walk the dock with nowhere to spend. Put a shop on the water.';
  if (demand.port > 0.35) return 'The harbor can earn more. Extend a pier.';
  return 'The harbor is steady. Grow what the meters ask for.';
}

function dockIsLinked(city) {
  for (const t of city.tiles) {
    if (t.kind !== "pier" || !isBuilt(t)) continue;
    if (!t.shoreline && t.terrain !== "water") continue;
    if (hasRoadAccess(city, t.x, t.z)) return true;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const n = tileAt(city, t.x + dx, t.z + dz);
      if (n && isPaved(n.kind) && isBuilt(n)) return true;
    }
  }
  return false;
}

export function tick(city) {
  city.tickCount = (city.tickCount || 0) + 1;
  if (!city.seen) city.seen = {};
  if (!city.events) city.events = [];
  refreshRoadNet(city);

  let pop = 0;
  let popCap = 0;
  let jobs = 0;
  let jobCap = 0;
  let upkeep = 0;
  let shops = 0;
  let piers = 0;
  let civics = 0;
  let parks = 0;
  let factories = 0;
  let schools = 0;
  let hospitals = 0;
  let clinics = 0;
  let fires = 0;
  let roads = 0;
  let berths = 0;
  let warehouses = 0;
  let waterShops = 0;
  const laws = ensureLaws(city);
  const homes = [];
  const works = [];

  for (const t of city.tiles) {
    if (!t.kind) continue;
    const def = DEFS[t.kind];
    if (!isBuilt(t)) {
      upkeep += def.upkeep * 0.35;
      continue;
    }
    upkeep += def.upkeep;
    if (t.kind === 'shop') {
      shops += 1;
      if (isWaterfront(city, t.x, t.z)) waterShops += 1;
    }
    if (t.kind === 'pier') {
      piers += 1;
      if (t.terrain === 'water') berths += 1;
    }
    if (t.kind === 'warehouse') warehouses += 1;
    if (t.kind === 'civic') civics += 1;
    if (t.kind === 'park') parks += 1;
    if (t.kind === 'factory') factories += 1;
    if (t.kind === 'school') schools += 1;
    if (t.kind === 'hospital') hospitals += 1;
    if (t.kind === 'clinic') clinics += 1;
    if (t.kind === 'fire') fires += 1;
    if (isPaved(t.kind)) roads += 1;
    if (isResidential(t.kind)) {
      if (!t.abandoned) {
        popCap += def.pop;
        pop += t.pop;
      }
      homes.push(t);
    }
    if (isWorkplace(t.kind)) {
      if (!t.abandoned) {
        jobCap += def.jobs;
        jobs += t.jobs;
      }
      works.push(t);
    }
  }

  const jobRatio = pop > 0 ? jobs / pop : jobs > 0 ? 1 : 0.5;
  const unemp = pop > 0 ? clamp(1 - jobRatio, 0, 1) : 0;
  const broke = city.treasury < 0;
  let seats = schools * (DEFS.school.seats || 90);
  if (laws.classrooms) seats = Math.round(seats * 1.22);
  const beds = hospitals * (DEFS.hospital.beds || 120) + clinics * (DEFS.clinic.beds || 40);
  const kids = pop * 0.18;
  const patients = pop * 0.08;
  const eduOver = seats > 0
    ? clamp((kids - seats) / Math.max(kids, 1), 0, 1)
    : kids > 16 ? clamp((kids - 16) / Math.max(kids, 1), 0, 1) : 0;
  const healthOver = beds > 0
    ? clamp((patients - beds) / Math.max(patients, 1), 0, 1)
    : patients > 12 ? 0.45 : 0;

  let hapSum = 0;
  let hapN = 0;
  let congested = 0;
  let abandoned = 0;

  for (const t of homes) {
    const def = DEFS[t.kind];
    if (t.abandoned) {
      abandoned += 1;
      t.pop = 0;
      t.jobs = 0;
      const back = hasRoadAccess(city, t.x, t.z) && !broke;
      if (back) {
        t.recoverTicks = (t.recoverTicks || 0) + 1;
        if (t.recoverTicks >= 5) {
          t.abandoned = false;
          t.emptyTicks = 0;
          t.recoverTicks = 0;
          pushEvent(city, `A ${def.label.toLowerCase()} was reoccupied.`);
          city.meshDirty = true;
        }
      } else t.recoverTicks = 0;
      if (t.abandoned) continue;
    }
    const park = coverage(city, t.x, t.z, (k) => k === 'park', 5);
    const edu = coverage(city, t.x, t.z, (_, d) => d.service === 'edu', 8);
    const health = coverage(city, t.x, t.z, (_, d) => d.service === 'health', 10);
    const civic = coverage(city, t.x, t.z, (_, d) => d.service === 'civic', 12);
    const fireNear = coverage(city, t.x, t.z, (k) => k === 'fire', 9);
    const pol = localPollution(city, t.x, t.z);
    const access = hasRoadAccess(city, t.x, t.z);
    const water = isWaterfront(city, t.x, t.z);
    const jam = roadLoad(city, t.x, t.z) * (laws.crews ? 0.62 : 1);
    if (jam > 3.2) congested += 1;
    const lastCommute = city.stats?.commute || 10;
    const local = clamp(
      52 +
        park * 14 +
        edu * 11 +
        health * 10 +
        civic * 8 +
        (water ? 6 : 0) -
        pol * 22 -
        unemp * 16 -
        (access ? 0 : 18) -
        (broke ? 14 : 0) -
        (jam > 3.2 ? 9 : 0) -
        (lastCommute > 18 ? 7 : lastCommute > 14 ? 3 : 0) -
        (laws.nights ? 3 : 0) -
        (pol > 0.35 && fireNear < 0.12 ? 5 : 0) -
        eduOver * 14 -
        healthOver * 10 -
        (city.taxRate > 1 ? (city.taxRate - 1) * 28 : 0) +
        (city.taxRate < 1 ? (1 - city.taxRate) * 10 : 0),
      0,
      100,
    );
    hapSum += local;
    hapN += 1;
    t.value = clamp(
      park * 0.3 + edu * 0.22 + health * 0.18 + civic * 0.12 + (water ? 0.12 : 0) + (access ? 0.12 : 0) - pol * 0.4,
      0,
      1,
    );

    const soft = !access ? def.pop * 0.28 : jobs < 1 ? def.pop * 0.4 : def.pop;
    const growOk = local > 28 && !broke && city.treasury > -2500 && access;
    const rate = 0.22 * (edu > 0.15 ? 1.35 : 1) * (water ? 1.12 : 1) * (local / 70);
    if (growOk && t.pop < soft) t.pop = Math.min(soft, t.pop + rate * def.pop);
    else if ((local < 18 || broke || !access) && t.pop > 0) t.pop = Math.max(0, t.pop - 0.08);
    t.pop = clamp(t.pop, 0, def.pop);

    if (t.pop < def.pop * 0.12) t.emptyTicks = (t.emptyTicks || 0) + 1;
    else t.emptyTicks = 0;
    if (t.emptyTicks >= 16) {
      t.abandoned = true;
      t.pop = 0;
      abandoned += 1;
      pushEvent(city, `A ${def.label.toLowerCase()} was abandoned.`);
      city.meshDirty = true;
    }
  }

  for (const t of works) {
    const def = DEFS[t.kind];
    if (t.abandoned) {
      t.jobs = 0;
      if (hasRoadAccess(city, t.x, t.z) && !broke) {
        t.recoverTicks = (t.recoverTicks || 0) + 1;
        if (t.recoverTicks >= 6) {
          t.abandoned = false;
          t.emptyTicks = 0;
          t.recoverTicks = 0;
          city.meshDirty = true;
          pushEvent(city, `A ${def.label.toLowerCase()} reopened.`);
        }
      } else t.recoverTicks = 0;
      continue;
    }
    if (def.jobs <= 0) {
      t.jobs = 0;
      continue;
    }
    const access = t.kind === 'pier' || t.kind === 'park' || hasRoadAccess(city, t.x, t.z);
    let demand = pop > 0 ? 1 : 0;
    const hour = ((city.time % 24) + 24) % 24;
    const daytime = hour >= 7 && hour < 19;
    if (t.kind === 'shop') {
      const near = nearbyPop(city, t.x, t.z, def.radius || 7);
      let strip = 0;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (tileAt(city, t.x + dx, t.z + dz)?.kind === 'shop') strip += 1;
      }
      demand = clamp(near / 8, 0.12, 1) * (daytime ? 1.08 : laws.nights ? 1.12 : 0.7) * (1 + strip * 0.1);
    }
    if (t.kind === 'office') {
      demand *= clamp((hapN ? hapSum / hapN : 50) / 68, 0.4, 1);
      demand *= daytime ? 1.04 : 0.52;
      demand *= clamp(nearbyPop(city, t.x, t.z, 10) / 22, 0.28, 1);
    }
    if (t.kind === 'factory' || t.kind === 'warehouse') {
      const cargo = coverage(city, t.x, t.z, (k) => k === 'pier' || k === 'warehouse', 8);
      demand *= 0.42 + cargo * 0.58;
      demand *= clamp(nearbyPop(city, t.x, t.z, 12) / 18, 0.3, 1);
      demand *= 0.7 + Math.min(berths, 10) * 0.05;
      if (t.kind === 'factory' && laws.levy) demand *= 0.86;
    }
    if (t.kind === 'pier') {
      demand = clamp(0.5 + berths * 0.07 + shops * 0.04, 0.35, 1);
    }
    if (t.kind === 'shop' && isWaterfront(city, t.x, t.z)) demand *= 1.16;
    if (!access) demand *= 0.22;
    if (broke) demand *= 0.35;
    const target = def.jobs * demand;
    if (t.jobs < target) t.jobs = Math.min(target, t.jobs + def.jobs * 0.2);
    else t.jobs = Math.max(target, t.jobs - def.jobs * 0.08);
    t.jobs = clamp(t.jobs, 0, def.jobs);
    if (!access && t.jobs < def.jobs * 0.15) t.emptyTicks = (t.emptyTicks || 0) + 1;
    else t.emptyTicks = 0;
    if (t.emptyTicks >= 18 && (t.kind === "shop" || t.kind === "office")) {
      t.abandoned = true;
      t.jobs = 0;
      city.meshDirty = true;
      pushEvent(city, `A ${def.label.toLowerCase()} shut its doors.`);
    }
  }

  for (const t of city.tiles) {
    if (isPaved(t.kind)) t.traffic = roadLoad(city, t.x, t.z);
  }

  pop = 0;
  jobs = 0;
  for (const t of homes) pop += t.pop;
  for (const t of works) jobs += t.jobs;
  const employedNow = Math.min(pop, jobs);
  const happiness =
    hapN === 0
      ? clamp(50 + parks * 2 + (broke ? -20 : 0), 0, 100)
      : hapSum / hapN;

  const commerce = shops * 3.6 * clamp(pop / 16, 0.2, 1.4);
  const civicBonus = civics * 8;
  let smokeAmt = 0;
  for (const t of city.tiles) {
    if (t.kind === "factory" || t.kind === "warehouse") smokeAmt += DEFS[t.kind].pollution || 0;
  }
  const market = clamp(pop / 22, 0.45, 1.55);
  const linked = dockIsLinked(city);
  const trade =
    berths * (linked ? 5.8 : 1.6) * market +
    warehouses * Math.min(berths, 8) * 1.15 +
    factories * Math.min(berths, 10) * 1.4;
  const pierBonus = trade;
  const shipping = factories * Math.max(1, berths) * 0.85 * clamp(1 - smokeAmt * 0.08, 0.45, 1);
  const tourism =
    (berths * 1.85 + waterShops * 2.6 + parks * 0.55 + (happiness > 56 ? 3 : 0)) *
    clamp(happiness / 62, 0.45, 1.25) *
    clamp(1 - smokeAmt * 0.12, 0.4, 1) *
    (laws.festival ? 1.45 : 1);
  upkeep += congested * 0.32;
  if (laws.crews) upkeep += roads * 0.12;
  if (laws.festival) upkeep += 6;
  if (laws.nights) upkeep += shops * 0.18;
  if (laws.classrooms) upkeep += schools * 2.2;
  const tax = Number.isFinite(city.taxRate) ? city.taxRate : 1;
  const wageTax = employedNow * 2.45 * tax;
  let property = 0;
  for (const t of homes) {
    if (t.abandoned) continue;
    property += t.pop * 0.4 * (0.62 + (t.value || 0.25) * 0.7 + happiness / 280);
  }
  property *= tax;
  const loanPay = (city.loanTicks || 0) > 0 ? 9 : 0;
  if (loanPay) {
    city.loanTicks -= 1;
    upkeep += loanPay;
  }
  const levy = laws.levy ? factories * 2.8 : 0;
  const income = wageTax + property + commerce + pierBonus + civicBonus + shipping + tourism + levy;
  const net = income - upkeep;
  city.treasury += net;

  const demand = {
    home: clamp(
      (jobRatio > 0.75 ? 0.35 : 0.08) +
        (happiness > 48 ? 0.22 : 0) +
        (popCap > 0 && pop / popCap > 0.8 ? 0.48 : popCap < 24 ? 0.28 : 0.12) -
        (broke ? 0.45 : 0) -
        (unemp > 0.4 ? 0.2 : 0),
      0,
      1,
    ),
    work: clamp(unemp * 1.15 + (pop > 30 && jobCap < pop * 0.75 ? 0.35 : 0), 0, 1),
    shop: clamp((pop / 18 - shops) / 4, 0, 1),
    port: clamp((pop / 14 + shops * 0.45 + factories * 0.7 + warehouses * 0.55) / 6 - berths * 0.11, 0, 1),
    edu: eduOver,
    health: healthOver,
  };

  const commute = Math.round(7 + congested * 0.45 + smokeAmt * 0.8);
  const extra = {
    abandoned,
    eduOver,
    healthOver,
    congested,
    commute,
    crews: !!laws.crews,
    factories,
    fires,
    berths,
    warehouses,
    waterShops,
    tick: city.tickCount || 0,
    loan: (city.loanTicks || 0) > 0,
  };
  const advisor = advisorFor(broke, unemp, pop, popCap, happiness, demand, extra);

  note(city, 'p100', pop >= 100, '100 residents. The neighborhood is real.', 1500);
  note(city, 'p500', pop >= 500, '500 residents. The tax base is holding.', 3500);
  note(city, 'p1000', pop >= 1000, '1,000 residents. A real harbor town.', 8000);
  note(city, 'jobs200', jobs >= 200, '200 jobs filled.', 2000);
  note(city, 'school', schools >= 1, 'A school is open. Families will stay.');
  note(city, 'hospital', hospitals >= 1, 'The hospital is open.');
  note(city, 'piers6', berths >= 6, 'A working waterfront. Trade is landing.', 2500);
  note(city, 'berthGrow', berths >= 4 && piers > 3, 'The dock is growing. Boats follow the berths.');
  note(city, 'mood70', happiness >= 70, 'Mood is high. People want to stay.', 1000);
  note(city, 'tipHamlet', city.tickCount === 3, 'This is a fishing hamlet. Stretch the pier, then the road, then grow.');
  note(city, 'tipDemand', city.tickCount === 6, 'Watch the demand meters. Build what is short.');
  note(city, 'tipRoad', city.tickCount === 10, 'Homes and jobs need a road on the main network.');
  if (city.tickCount >= 20 && city.tickCount % 20 === 0) {
    const week = city.tickCount / 20;
    const prev = city.lastWeek || { pop: 0, treasury: START_TREASURY };
    const dp = pop - prev.pop;
    const dc = city.treasury - prev.treasury;
    const people = `${dp >= 0 ? "+" : ""}${Math.round(dp)} people`;
    const cash = `${dc >= 0 ? "+" : "-"}$${Math.abs(Math.round(dc)).toLocaleString("en-US")}`;
    pushEvent(city, `Week ${week}: ${people}, ${cash}. Mood ${Math.round(happiness)}%.`);
    const before = city.log?.[0]?.msg || "";
    rollHarborEvent(city, {
      pop,
      happiness,
      piers,
      berths,
      factories,
      parks,
      shops,
      fires,
      waterShops,
    });
    const extra = city.log?.[0]?.msg !== before ? city.log[0].msg : "";
    city.digest = {
      week,
      people,
      cash,
      mood: Math.round(happiness),
      extra,
      abandoned,
      congested,
      commute,
    };
    city.lastWeek = { pop, treasury: city.treasury };
  }

  city.stats = {
    pop,
    popCap,
    jobs,
    jobCap,
    happiness,
    income,
    upkeep,
    employed: employedNow,
    shops,
    piers,
    berths,
    warehouses,
    waterShops,
    civics,
    demand,
    advisor,
    wageTax,
    property,
    commerce,
    pierBonus,
    trade,
    shipping,
    tourism,
    levy,
    laws: { ...laws },
    week: Math.floor((city.tickCount || 0) / 20),
    schools,
    hospitals,
    clinics,
    fires,
    seats,
    kids,
    beds,
    abandoned,
    congested,
    commute,
    eduOver,
    healthOver,
    contract: city.contract,
    loanTicks: city.loanTicks || 0,
    loanPay,
    lastBond: city.lastBond || 0,
  };
  advanceContract(city, city.stats);
  city.stats.contract = city.contract;
  city.bankruptWarn = city.treasury < 0;
  return city.stats;
}

function rollHarborEvent(city, s) {
  const roll = Math.sin((city.tickCount || 1) * 12.9898) * 43758.5453;
  const r = roll - Math.floor(roll);
  if (r < 0.16 && s.factories > 0 && !(s.fires > 0)) {
    city.treasury -= 720;
    pushEvent(city, "A plant burned. No engine company nearby. -$720.");
    return;
  }
  if (r < 0.18 && (s.berths || s.piers) > 5) {
    city.treasury -= 380;
    pushEvent(city, "A squall chewed the docks. -$380.");
    return;
  }
  if (r < 0.34 && (s.berths || 0) > 0) {
    const catch$ = 180 + Math.round((s.berths || 1) * 55);
    city.treasury += catch$;
    pushEvent(city, `The boats brought a catch. +$${catch$}.`);
    return;
  }
  if (r < 0.5 && s.happiness > 52) {
    const visit = 220 + Math.round((s.berths || 0) * 40 + (s.waterShops || 0) * 80);
    city.treasury += visit;
    pushEvent(city, `Weekend tourists filled the waterfront. +$${visit}.`);
    return;
  }
  if (r < 0.55 && s.factories > 0) {
    city.treasury -= 240;
    pushEvent(city, "A plant fined for smoke. -$240.");
    return;
  }
  if (r < 0.7 && s.parks > 2) {
    city.treasury += 280;
    pushEvent(city, "The parks hosted a neighborhood market. +$280.");
    return;
  }
  if (s.shops > 4) {
    city.treasury += 160;
    pushEvent(city, "Avenue shops had a good week. +$160.");
  }
}

export function overlaySample(city, x, z, mode) {
  const t = tileAt(city, x, z);
  if (!t || t.terrain === "water") return null;
  if (mode === "access") {
    if (!t.kind || isPaved(t.kind) || t.kind === "park" || t.kind === "pier") return null;
    if (t.abandoned) return { color: 0xb8862a, opacity: 0.4 };
    return { color: hasRoadAccess(city, x, z) ? 0x2fdd8a : 0xff5348, opacity: 0.34 };
  }
  if (mode === "pollution") {
    const p = localPollution(city, x, z);
    if (p < 0.07) return null;
    return { color: p > 0.55 ? 0xc44a18 : 0xc49a28, opacity: 0.16 + p * 0.38 };
  }
  if (mode === "cover") {
    const edu = coverage(city, x, z, (_, d) => d.service === "edu", 8);
    const health = coverage(city, x, z, (_, d) => d.service === "health", 10);
    const fire = coverage(city, x, z, (k) => k === "fire", 9);
    const v = Math.max(edu, health, fire);
    if (v < 0.08) return { color: 0x6a5040, opacity: 0.16 };
    const color = fire >= edu && fire >= health ? 0xd45a28 : edu >= health ? 0x4a88d4 : 0xd45a6a;
    return { color, opacity: 0.16 + v * 0.28 };
  }
  if (mode === "traffic") {
    if (!isPaved(t.kind)) return null;
    const jam = t.traffic || 0;
    if (jam < 0.45) return { color: 0x3aaa62, opacity: 0.2 };
    if (jam < 2.2) return { color: 0xc4a428, opacity: 0.26 };
    return { color: 0xc44a18, opacity: 0.3 + Math.min(jam, 6) * 0.035 };
  }
  if (mode === "value") {
    const park = coverage(city, x, z, (k) => k === "park", 5);
    const edu = coverage(city, x, z, (_, d) => d.service === "edu", 8);
    const health = coverage(city, x, z, (_, d) => d.service === "health", 10);
    const access = !t.kind || isPaved(t.kind) || t.kind === "park" || t.kind === "pier" || hasRoadAccess(city, x, z);
    const v = clamp(park * 0.28 + edu * 0.22 + health * 0.18 + (access ? 0.2 : 0) + (isWaterfront(city, x, z) ? 0.12 : 0) - localPollution(city, x, z) * 0.35, 0, 1);
    return { color: v > 0.58 ? 0x4aa6ff : v > 0.32 ? 0x6aaa62 : 0x8a6a40, opacity: 0.2 + v * 0.16 };
  }
  return null;
}
