import { DEFS, isResidential, isWorkplace } from './buildings.js';
import { forEachInRadius, hasRoadAccess, idx, isPaved, isWaterfront, nextToPier, placeBlockReason, pushEvent, refreshRoadNet, START_TREASURY, tileAt } from './city.js';
import { isBuilt } from './construction.js';
import { LOAD, refreshUtilities, utilAt } from './utilities.js';

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function starvedInReach(city, util, flag, reachKey, loadKey) {
  const reach = util?.[reachKey];
  if (!reach || !reach.has) return false;
  for (const t of city.tiles) {
    if (!t.kind || t[flag] || !isBuilt(t) || t.abandoned) continue;
    if (!(LOAD[t.kind] && LOAD[t.kind][loadKey])) continue;
    if (reach.has(idx(t.x, t.z))) return true;
  }
  return false;
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
    shop: clamp(0.06 + access * 0.2 + people / 22 + water * 0.32 + (jam > 1.2 ? 0.08 : 0) - pol * 0.15, 0, 1),
    work: clamp(0.08 + access * 0.22 + people / 28 + cargo * 0.34 - pol * 0.08, 0, 1),
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
  { id: "levy", label: "Smoke levy", cost: "tax on plants", blurb: "Diesel and factories pay. The air clears." },
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
    make: (s) => ({ need: Math.round((s.jobs || 0) + ((s.pop || 0) < 80 ? 18 : 70)) }),
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
    make: (s) => ({ need: Math.round((s.pop || 0) + ((s.pop || 0) < 80 ? 16 : 80)) }),
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
  {
    id: 'power',
    weeks: 6,
    reward: 2400,
    make: () => ({ need: 1 }),
    done: (c, s) => (s.plants || 0) >= c.need,
    label: () => "Light the plant",
  },
  {
    id: 'water',
    weeks: 6,
    reward: 2200,
    make: () => ({ need: 1 }),
    done: (c, s) => (s.towers || 0) >= c.need,
    label: () => "Raise a water tower",
  },
  {
    id: 'sewer',
    weeks: 6,
    reward: 2400,
    make: () => ({ need: 1 }),
    done: (c, s) => (s.works || 0) >= c.need,
    label: () => "Open the works",
  },
  {
    id: 'trade',
    weeks: 6,
    reward: 2600,
    make: (s) => ({ need: Math.max(12, Math.round((s.trade || 0) + 8)) }),
    done: (c, s) => (s.trade || 0) >= c.need,
    label: (c) => `Land $${c.need} trade a tick`,
  },
  {
    id: 'tourists',
    weeks: 6,
    reward: 2600,
    make: (s) => ({ need: Math.max(10, Math.round((s.tourism || 0) + 6)) }),
    done: (c, s) => (s.tourism || 0) >= c.need,
    label: (c) => `Hold $${c.need} tourism a tick`,
  },
  {
    id: 'freight',
    weeks: 6,
    reward: 2400,
    make: () => ({ need: 0.6 }),
    done: (c, s) => (s.mix || 0) >= c.need && (s.warehouses || 0) >= 1,
    label: () => "Make this a cargo dock",
  },
  {
    id: 'promenade',
    weeks: 6,
    reward: 2400,
    make: () => ({ need: 0.35 }),
    done: (c, s) => (s.mix || 1) <= c.need && (s.waterShops || 0) >= 1 && (s.berths || 0) >= 3,
    label: () => "Keep the promenade for visitors",
  },
  {
    id: 'market',
    weeks: 5,
    reward: 2000,
    make: () => ({ need: 1 }),
    done: (c, s) => (s.markets || 0) >= c.need,
    label: () => "Open a fish market",
  },
];

function pickContract(city, s) {
  const last = city.contract?.id;
  const pop = s.pop || 0;
  let pool = CONTRACTS.filter((c) => c.id !== last);
  if (pop < 50) pool = pool.filter((c) => ["homes", "jobs", "shops", "piers", "market"].includes(c.id));
  else if (pop < 80) pool = pool.filter((c) => ["homes", "jobs", "shops", "piers", "market", "trade", "tourists", "power", "water"].includes(c.id));
  const spec = pool[Math.floor(Math.random() * pool.length)] || CONTRACTS[0];
  const extra = spec.make(s);
  return {
    id: spec.id,
    need: extra.need,
    label: spec.label({ ...spec, ...extra }),
    reward: spec.reward,
    weeks: spec.weeks + (pop < 60 ? 6 : 0),
    week0: city.stats?.week || 0,
  };
}

function contractTell(city, msg) {
  if ((city.tickCount || 0) >= 80) {
    pushEvent(city, msg);
    return;
  }
  city.log = city.log || [];
  city.log.unshift({ week: Math.floor((city.tickCount || 0) / 20), msg });
  if (city.log.length > 24) city.log.length = 24;
}

function advanceContract(city, s) {
  if ((city.tickCount || 0) < 8) return;
  if (!city.contract) {
    city.contract = pickContract(city, s);
    if ((s.markets || 0) >= 1) contractTell(city, `Contract: ${city.contract.label}.`);
    return;
  }
  const spec = CONTRACTS.find((c) => c.id === city.contract.id);
  if (spec && spec.done(city.contract, s)) {
    city.treasury += city.contract.reward;
    city.contractsWon = (city.contractsWon || 0) + 1;
    const tried = (city.contractsWon || 0) + (city.contractsMissed || 0);
    contractTell(city, `Contract done. +$${city.contract.reward.toLocaleString('en-US')}. ${city.contractsWon} of ${tried} jobs met.`);
    city.contract = pickContract(city, s);
    contractTell(city, `Next: ${city.contract.label}.`);
    return;
  }
  if (city.tickCount >= 20 && city.tickCount % 20 === 0) {
    city.contract.weeks -= 1;
    if (city.contract.weeks === 1) {
      contractTell(city, `Last week on “${city.contract.label}”.`);
    }
    if (city.contract.weeks <= 0) {
      const dead = city.contract.label;
      const first =
        !city.seen?.firstJobGrace && (city.contractsWon || 0) + (city.contractsMissed || 0) === 0;
      if (first) {
        city.seen = city.seen || {};
        city.seen.firstJobGrace = true;
        city.contract = pickContract(city, s);
        contractTell(city, `First job lapsed — no mark. Next: ${city.contract.label}.`);
      } else {
        city.contractsMissed = (city.contractsMissed || 0) + 1;
        const tried = (city.contractsWon || 0) + city.contractsMissed;
        city.contract = pickContract(city, s);
        contractTell(
          city,
          `Contract expired unmet — “${dead}”. ${city.contractsWon || 0} of ${tried} jobs met. Next: ${city.contract.label}.`
        );
      }
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
  const fire = coverage(city, x, z, (k) => k === 'fire', 9);
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
    fire,
    cargo,
    pollution,
    access,
    waterfront: water,
    nearbyPop: nearbyPop(city, x, z, 8),
    nearbyJobs: nearbyJobs(city, x, z, 10),
    congestion: roadLoad(city, x, z),
    abandoned: !!t.abandoned,
    util: utilAt(t),
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
  if (c.id === "power") return `${s.plants || 0}/${c.need}`;
  if (c.id === "water") return `${s.towers || 0}/${c.need}`;
  if (c.id === "sewer") return `${s.works || 0}/${c.need}`;
  if (c.id === "trade") return `${Math.round(s.trade || 0)}/${c.need}`;
  if (c.id === "tourists") return `${Math.round(s.tourism || 0)}/${c.need}`;
  if (c.id === "freight") return (s.mix || 0) >= 0.6 ? "Cargo" : "Not yet";
  if (c.id === "promenade") return (s.mix || 1) <= 0.35 ? "Visitors" : "Not yet";
  if (c.id === "market") return `${s.markets || 0}/${c.need}`;
  return "";
}

function contractNudge(c) {
  if (!c) return "";
  switch (c.id) {
    case "shops":
      return "The job is shops. Build shops along the avenue.";
    case "piers":
      return "The job is berths. Push the pier into the harbor.";
    case "jobs":
      return "The job is work. Add shops, offices, or the harbor.";
    case "homes":
      return "The job is people. Zone Rowhouse inland of the beach.";
    case "market":
      return "The job is a fish market. Harbor → Market on the landfall.";
    case "trade":
      return "The job is trade. A warehouse on the landfall mints cargo.";
    case "tourists":
      return "The job is visitors. Put a shop on the water.";
    case "power":
      return "The job is power. Build a plant inland — not on the cove.";
    case "water":
      return "The job is water. Raise a tower on the avenue.";
    case "sewer":
      return "The job is the works. Keep the outfall off the cove.";
    case "mood":
      return "The job is mood. Add a park or a school.";
    case "commute":
      return "The job is commute. Add streets so people can get to work.";
    case "school":
      return "The job is a school. Build one near the houses.";
    case "clinic":
      return "The job is care. Add a clinic or hospital.";
    case "freight":
      return "The job is cargo. A warehouse on the landfall makes this a freight dock.";
    case "promenade":
      return "The job is the promenade. Keep warehouses off the tourist pier.";
    default:
      return c.label ? `The job is “${c.label}”.` : "";
  }
}

function advisorFor(broke, unemp, pop, popCap, happiness, demand, extra) {
  if (broke && !extra.loan) return 'Treasury is empty. Pause growth, add jobs, or float a bond.';
  if (broke) return 'The bond is covering a hole. Cut costs or grow the tax base.';
  if (extra.abandoned) return `${extra.abandoned} homes are abandoned. Reconnect the road or reopen them.`;
  const dockUnfinished = (extra.markets || 0) < 1 && (extra.waterShops || 0) < 1;
  if (dockUnfinished && extra.vacantWater && !extra.linked) {
    return 'The lot by the dock is empty. Road or Cobble on the landfall, then Harbor → Market — not on the sand.';
  }
  if (dockUnfinished && (extra.berths || 0) >= 2) {
    return 'The boats need a market on the landfall. Catch has to land somewhere.';
  }
  if ((extra.offices || 0) >= 1 && (extra.plants || 0) < 1) {
    return 'The office is on kerosene. Tap this chip for a plant inland of the cove.';
  }
  if ((extra.plants || 0) >= 1 && (extra.cisterns || 0) < 1) {
    return 'The office is dry. Tap this chip for a water tower on the avenue.';
  }
  if ((extra.cisterns || 0) >= 1 && (extra.works || 0) < 1) {
    return 'The office has no outfall. Tap this chip for works inland of the cove.';
  }
  if (pop < 55 && extra.tick < 20) {
    if ((extra.markets || 0) >= 1) return 'The market is buying. Grow inland — homes and shops along the avenue.';
    if ((extra.berths || 0) < 4) return 'Push the pier into the harbor. Trade and boats follow the slips you paint.';
    return 'A small harbor town. Extend the road, then add homes and shops.';
  }
  if (popCap > 8 && pop / popCap > 0.9) {
    const stalled = Math.floor((extra.stallTicks || 0) / 20);
    const popN = Math.round(pop);
    const capN = Math.round(popCap);
    if (stalled >= 2) {
      const lines = [
        `Still ${popN} / ${capN} people after ${stalled} weeks. Homes are full. Tap this chip for Rowhouse inland of the beach.`,
        `Homes are full at ${popN} / ${capN}. Tap here — Rowhouse. Zone the next street inland.`,
        `${stalled} weeks with no room. Homes are full. Tap this chip to zone more houses.`,
        `Nobody new moves in at ${popN} / ${capN}. Homes are full. Tap for Rowhouse, or Apartments if the lots are tight.`,
      ];
      return lines[stalled % lines.length];
    }
    return 'Homes are full. Tap this chip for Rowhouse — zone inland of the beach.';
  }
  if (extra.contract && extra.tick >= 80) {
    const n = contractNudge(extra.contract);
    if (n) return n;
  }
  if (extra.brown && (extra.plants || 0) < 1) return 'The hamlet is on kerosene. Build a plant inland — smoke on the cove kills the catch.';
  if (extra.brown && extra.powerFull) return 'The plant is full. Build another inland — smoke on the cove kills the catch.';
  if (extra.brown) return 'Lights are failing. Keep lots in range of a plant, or pave the mains to them.';
  if (extra.dry && (extra.cisterns || 0) < 1) return 'Wells are dry. Raise a water tower on the avenue. It needs power to pump.';
  if (extra.dry && extra.waterFull) return 'The tower is full. Raise another on the avenue.';
  if (extra.dry) return 'The tower is dry. Power it, and keep lots in range of the tower or the pipes.';
  if (extra.raw && extra.sewerFull) return 'The works are full. Build another inland.';
  if (extra.raw) return 'Privies will not hold. A treatment works inland keeps the promenade from fouling.';
  if ((extra.berths || 0) > 0 && !extra.linked) {
    return 'Pave the landfall with Road or Cobble so trucks can reach the slips.';
  }
  if ((extra.foul || 0) > 0.45) return 'The sewer outfall sits on the tourist water. Move the works off the cove.';
  if (extra.dockPower) return 'The diesel plant is on the water. Catch will thin.';
  if ((extra.mix || 0) > 0.62 && (extra.waterShops || 0) < 1) return 'This dock is freight. Cargo pays. Visitors will not walk it.';
  if ((extra.mix || 0) < 0.28 && (extra.warehouses || 0) < 1 && (extra.berths || 0) >= 4) {
    return 'Pretty slips, empty holds. A warehouse on the landfall would mint trade — and sour the promenade.';
  }
  if (
    (extra.mix || 0) > 0.32 &&
    (extra.mix || 0) < 0.72 &&
    (extra.groups || 1) < 2 &&
    extra.dockWarehouses &&
    extra.waterShops
  ) {
    return 'Freight and visitors share one pier. Lay a second slip and keep cargo off the promenade.';
  }
  if (extra.eduOver > 0.25) return 'Schools are packed. Build another school or pass Classrooms.';
  if (extra.healthOver > 0.25) return 'Clinics are short. Add a clinic or hospital.';
  if ((extra.factories || extra.plants) && extra.fires < 1) return 'Industry has no firehouse. One spark and the plant is gone.';
  if ((extra.congested > 12 || extra.commute > 22) && !extra.crews) return 'Avenues are jammed. Pass road crews, or add streets.';
  if (extra.congested > 12 || extra.commute > 22) return 'Avenues are jammed. Add roads to spread the load.';
  if (unemp > 0.38) return 'Too few jobs. Build shops, offices, or the harbor.';
  if (happiness < 38) return 'Mood is low. Add parks, a school, or cut pollution.';
  if (pop > 40 && extra.unwired > 2 && (extra.exchanges || 0) < 1) {
    return 'People want a line. Raise an Exchange, then click Cable along the street to the houses.';
  }
  if (pop > 40 && (extra.deadCable || 0) > 0) {
    return 'Dead copper on the street. Connect it to an Exchange — the line does not jump lots.';
  }
  if (pop > 40 && extra.unwired > 3) {
    return 'The exchange is up. Click Cable along the street those lots sit on — not a radius, a line.';
  }
  if (demand.shop > 0.72) return 'People need shops along the avenues.';
  if (demand.home > 0.72) return 'Families want rowhouses near work.';
  if (demand.work > 0.7) return 'Job demand is high. Add workplaces.';
  if (demand.port > 0.55) return 'Ships are waiting. Drag the pier farther into the harbor.';
  if ((extra.berths || 0) >= 3 && (extra.warehouses || 0) < 1) return 'Cargo is stacking on the dock. Build a warehouse next to the water.';
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
  const util = refreshUtilities(city);

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
  let offices = 0;
  let waterShops = 0;
  let markets = 0;
  let plants = 0;
  let cisterns = 0;
  let sewerWorks = 0;
  const laws = ensureLaws(city);
  const homes = [];
  const works = [];

  for (const t of city.tiles) {
    if (!t.kind) continue;
    const def = DEFS[t.kind];
    if (t.kind === "shop") {
      shops += 1;
      if (isWaterfront(city, t.x, t.z)) waterShops += 1;
    }
    if (t.kind === "market") {
      markets += 1;
      if (isWaterfront(city, t.x, t.z)) waterShops += 1;
    }
    if (t.kind === "pier") {
      piers += 1;
      if (t.terrain === "water") berths += 1;
    }
    if (t.kind === "warehouse") warehouses += 1;
    if (t.kind === "office") offices += 1;
    if (!isBuilt(t)) {
      upkeep += def.upkeep * 0.35;
      continue;
    }
    upkeep += def.upkeep;
    if (t.kind === 'civic') civics += 1;
    if (t.kind === 'park') parks += 1;
    if (t.kind === 'factory') factories += 1;
    if (t.kind === 'school') schools += 1;
    if (t.kind === 'hospital') hospitals += 1;
    if (t.kind === 'clinic') clinics += 1;
    if (t.kind === 'fire') fires += 1;
    if (t.kind === "power") plants += 1;
    if (t.kind === "cistern") cisterns += 1;
    if (t.kind === "sewer") sewerWorks += 1;
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
  const healthOver = clamp(
    (beds > 0
      ? clamp((patients - beds) / Math.max(patients, 1), 0, 1)
      : patients > 12 ? 0.45 : 0) + (util.raw ? 0.22 : 0) + (util.foul > 0.4 ? 0.08 : 0),
    0,
    1,
  );

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
    const powered = !!t.powered;
    const watered = !!t.watered;
    const sewered = !!t.sewered;
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
        (powered ? 0 : 10) -
        (watered ? 0 : 16) -
        (sewered ? 0 : util.raw ? 14 : 6) -
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

    let soft = !access ? def.pop * 0.28 : jobs < 1 ? def.pop * 0.4 : !watered ? def.pop * 0.38 : def.pop;
    if (t.starter && isResidential(t.kind) && (city.stats?.markets || 0) < 1) {
      soft = Math.min(soft, def.pop * 0.55);
    }
    const growOk = local > 28 && !broke && city.treasury > -2500 && access;
    const rate = 0.22 * (edu > 0.15 ? 1.35 : 1) * (water ? 1.12 : 1) * (powered ? 1 : 0.62) * (local / 70);
    if (growOk && t.pop < soft) t.pop = Math.min(soft, t.pop + rate * def.pop);
    else if ((local < 18 || broke || !access) && t.pop > 0) t.pop = Math.max(0, t.pop - 0.08);
    t.pop = clamp(t.pop, 0, def.pop);

    if (t.pop < def.pop * 0.12 && (!access || broke)) t.emptyTicks = (t.emptyTicks || 0) + 1;
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
    if (t.kind === 'shop' || t.kind === 'market') {
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
    if ((t.kind === 'shop' || t.kind === 'market') && isWaterfront(city, t.x, t.z)) demand *= 1.16;
    if (t.kind === 'market') demand *= 0.7 + Math.min(berths, 8) * 0.06;
    if (!t.powered && t.kind !== 'park' && t.kind !== 'pier') demand *= 0.28;
    if (!t.watered && (t.kind === 'shop' || t.kind === 'hospital' || t.kind === 'clinic' || t.kind === 'factory')) demand *= 0.72;
    if (!access) demand *= 0.22;
    if (broke) demand *= 0.35;
    const target = def.jobs * demand;
    if (t.jobs < target) t.jobs = Math.min(target, t.jobs + def.jobs * 0.2);
    else t.jobs = Math.max(target, t.jobs - def.jobs * 0.08);
    t.jobs = clamp(t.jobs, 0, def.jobs);
    if (!access && t.jobs < def.jobs * 0.15) t.emptyTicks = (t.emptyTicks || 0) + 1;
    else t.emptyTicks = 0;
    if (t.emptyTicks >= 18 && (t.kind === "shop" || t.kind === "office" || t.kind === "market")) {
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

  const commerce = (shops * 3.6 + markets * 2.8) * clamp(pop / 16, 0.2, 1.4);
  const civicBonus = civics * 8;
  let smokeAmt = 0;
  for (const t of city.tiles) {
    if (t.kind === "factory" || t.kind === "warehouse" || t.kind === "power") smokeAmt += DEFS[t.kind].pollution || 0;
  }
  const market = clamp(pop / 22, 0.45, 1.55);
  const linked = util.linked || dockIsLinked(city);
  const mix = util.mix || 0;
  const health = util.harborHealth ?? 1;
  const dockWh = util.dockWarehouses || 0;
  const waterParks = util.waterParks || 0;
  const trade =
    berths * (linked ? 3.2 : 0.85) * market * (0.32 + Math.min(warehouses, 6) * 0.24 + Math.min(factories, 4) * 0.16) +
    dockWh * Math.min(berths, 10) * 2.55 +
    Math.max(0, warehouses - dockWh) * Math.min(berths, 8) * 0.7 +
    factories * Math.min(berths, 10) * 1.55 * (linked ? 1 : 0.4) +
    markets * Math.min(berths, 6) * 1.05 * (linked ? 1 : 0.45);
  const pierBonus = trade;
  const shipping = factories * Math.max(1, berths) * 0.85 * clamp(1 - smokeAmt * 0.08, 0.45, 1) * health;
  const tourism =
    (waterShops * 3.9 +
      waterParks * 1.3 +
      parks * 0.28 +
      berths * (mix < 0.42 ? 0.72 : 0.14) +
      (happiness > 56 ? 3 : 0)) *
    clamp(happiness / 62, 0.45, 1.25) *
    clamp(1 - mix * 0.64, 0.22, 1) *
    clamp(1 - smokeAmt * 0.1, 0.4, 1) *
    health *
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
  const levy = laws.levy ? factories * 2.8 + plants * 2.2 : 0;
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
    power: clamp((util.powerLoad - util.powerUsed) / Math.max(util.powerLoad, 24), 0, 1),
    water: clamp((util.waterLoad - util.waterUsed) / Math.max(util.waterLoad, 20), 0, 1),
    sewer: clamp((util.sewerLoad - util.sewerUsed) / Math.max(util.sewerLoad, 20), 0, 1),
    internet: pop > 24 ? clamp((util.internetLoad - (util.internetUsed || 0)) / Math.max(util.internetLoad || 1, 16), 0, 1) : 0,
    freight: berths > 0 ? mix : 0,
    visit: berths > 0 ? clamp(1 - mix, 0, 1) : 0,
  };

  const commute = Math.round(7 + congested * 0.45 + smokeAmt * 0.8);
  let vacantWater = false;
  for (const t of city.tiles) {
    if (t.kind || t.terrain === "water") continue;
    if (isWaterfront(city, t.x, t.z) && hasRoadAccess(city, t.x, t.z)) {
      vacantWater = true;
      break;
    }
  }
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
    markets,
    vacantWater,
    tick: city.tickCount || 0,
    loan: (city.loanTicks || 0) > 0,
    linked,
    plants,
    offices,
    cisterns,
    works: sewerWorks,
    brown: !!util.brown,
    dry: !!util.dry,
    raw: !!util.raw,
    powerFull: starvedInReach(city, util, "powered", "reachPower", "power"),
    waterFull: starvedInReach(city, util, "watered", "reachWater", "water"),
    sewerFull: starvedInReach(city, util, "sewered", "reachSewer", "sewer"),
    foul: util.foul || 0,
    mix,
    groups: util.groups || 1,
    dockWarehouses: dockWh,
    dockPower: util.dockPower || 0,
    stallTicks: city.stallTicks || 0,
    homesFullAck: !!(city.seen && city.seen.homesFullAck),
    contract: city.contract || null,
    cables: util.cables || 0,
    deadCable: util.deadCable || 0,
    exchanges: util.exchanges || 0,
    unwired: Math.max(0, (util.wiredNeed || 0) - (util.wiredHave || 0)),
  };
  const weekNow = Math.floor((city.tickCount || 0) / 20);
  if (weekNow >= 4 && popCap > 8 && pop / popCap > 0.9 && Math.round(pop) === Math.round(city._stallPop ?? pop)) {
    city.stallTicks = (city.stallTicks || 0) + 1;
  } else if (!(popCap > 8 && pop / popCap > 0.88)) {
    city.stallTicks = 0;
  }
  city._stallPop = Math.round(pop);
  extra.stallTicks = city.stallTicks || 0;
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
  note(city, 'tipHamlet', city.tickCount === 28 && markets >= 1, 'This is a fishing hamlet. Stretch the pier, then the road, then grow.');
  note(city, 'tipDemand', city.tickCount === 36, 'Watch the demand meters. Build what is short.');
  note(city, 'tipRoad', city.tickCount === 48, 'Homes and jobs need a road on the main network.');
  note(city, 'tipMains', city.tickCount === 56, 'Houses run on wells and kerosene. A plant, a tower, and a works keep a real town alive.');
  note(city, 'week2', city.tickCount === 40 && !linked, 'Week 2. The empty lot by the dock is still the point.');
  note(city, 'week3', city.tickCount === 60 && !linked, 'Week 3. Pave the landfall if trucks cannot reach the pier.');
  note(city, 'freightDock', mix > 0.65 && dockWh > 0, 'This is a cargo dock now. The promenade is dead.');
  note(city, 'prettyDock', mix < 0.28 && waterShops > 0 && warehouses < 1 && berths >= 3, 'Visitors fill the slips. Cargo is not landing.');
  note(city, 'plantOn', plants >= 1, 'The plant is online. Lots in range get mains — the rest stay dark.');
  note(city, 'towerOn', (util.towers || 0) >= 1, 'The tower is pumping. Keep it powered.');
  note(city, 'towerEmpty', (util.idleTowers || 0) >= 1, 'This tower serves nobody. Nothing is in range — move it nearer homes.');
  note(city, 'worksOn', (util.works || 0) >= 1, 'The works are treating. Keep the outfall off the cove.');
  note(city, 'marketOn', markets >= 1, 'The market is buying. Catch lands on the landfall.');
  const splashUp = !document.getElementById("splash")?.classList.contains("gone");
  if (splashUp || weekNow < 4) {
    if (city.tickCount % 20 === 0) city.lastWeek = { pop, treasury: city.treasury };
  } else {
    const due = Number.isFinite(city.nextRecapTick) ? city.nextRecapTick : 80;
    if (!city.digest && city.tickCount >= due) {
      const already = city.lastDigest && city.lastDigest.week === weekNow;
      if (!already) {
        const prev = city.lastWeek || { pop: 0, treasury: START_TREASURY };
        const dp = pop - prev.pop;
        const dc = city.treasury - prev.treasury;
        const people = `${dp >= 0 ? "+" : ""}${Math.round(dp)} people`;
        const cash = `${dc >= 0 ? "+" : "-"}$${Math.abs(Math.round(dc)).toLocaleString("en-US")}`;
        pushEvent(city, `Week ${weekNow}: ${people}, ${cash}. Mood ${Math.round(happiness)}%.`);
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
          markets,
          waterParks,
          mix,
          health,
          plants,
          raw: !!util.raw,
        });
        let extra = city.log?.[0]?.msg !== before ? city.log[0].msg : "";
        if (city.contract && city.contract.weeks <= 2) {
          extra = `${extra ? extra + " " : ""}Last week${city.contract.weeks === 1 ? "" : "s"} on “${city.contract.label}”.`;
        }
        const tried = (city.contractsWon || 0) + (city.contractsMissed || 0);
        if (tried) {
          extra = `${extra ? extra + " " : ""}${city.contractsWon || 0} of ${tried} jobs met.`;
        }
        const stalled = Math.floor((city.stallTicks || 0) / 20);
        if (stalled >= 2 && popCap > 8 && pop / popCap > 0.9) {
          extra = `${extra ? extra + " " : ""}No growth for ${stalled} weeks — homes are full (${Math.round(pop)}/${Math.round(popCap)}). Zone more houses so people can move in.`;
        }
        let verdict = "A quiet week.";
        if (dc > 2500) verdict = "A fat week.";
        else if (dc > 800) verdict = "The till grew.";
        else if (dc < -1500) verdict = "A bad week.";
        else if (dc < -80) verdict = "The till shrank.";
        const nudge =
          verdict === "A quiet week." ? advisor || "Pave the landfall, then Harbor → Market." : "";
        city.lastDigest = {
          week: weekNow,
          people,
          cash,
          mood: Math.round(happiness),
          verdict,
          extra,
          commute,
          nudge,
        };
        city.lastWeek = { pop, treasury: city.treasury };
        city.seen = city.seen || {};
        city.seen.recap = true;
      }
      city.nextRecapTick = city.tickCount + 40;
      if (!city.recapUnread) city.recapDue = true;
    }
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
    markets,
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
    mix,
    harborHealth: health,
    plants,
    cisterns,
    towers: util.towers || 0,
    works: sewerWorks,
    powerLoad: util.powerLoad,
    powerCap: util.powerCap,
    powerUsed: util.powerUsed,
    waterLoad: util.waterLoad,
    waterCap: util.waterCap,
    waterUsed: util.waterUsed,
    sewerLoad: util.sewerLoad,
    sewerCap: util.sewerCap,
    sewerUsed: util.sewerUsed,
    internetLoad: util.internetLoad,
    internetCap: util.internetCap,
    internetUsed: util.internetUsed,
    exchanges: util.exchanges || 0,
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
  const mix = s.mix || 0;
  const health = s.health ?? 1;
  if (r < 0.16 && (s.factories > 0 || s.plants > 0) && !(s.fires > 0)) {
    city.treasury -= 720;
    pushEvent(city, "A plant burned. No engine company nearby. -$720.");
    return;
  }
  if (r < 0.18 && (s.berths || s.piers) > 5) {
    city.treasury -= 380;
    pushEvent(city, "A squall chewed the docks. -$380.");
    return;
  }
  if (r < 0.22 && s.raw) {
    city.treasury -= 310;
    pushEvent(city, "Raw sewage on the tide. Visitors left. -$310.");
    return;
  }
  if (r < 0.34 && (s.berths || 0) > 0) {
    const catch$ = Math.max(40, Math.round((180 + (s.berths || 1) * 55 + (s.markets || 0) * 70) * health * (1 - mix * 0.48)));
    city.treasury += catch$;
    if (health < 0.55 || mix > 0.7) pushEvent(city, `The catch was thin. Smoke on the water. +$${catch$}.`);
    else pushEvent(city, `The boats brought a catch. +$${catch$}.`);
    return;
  }
  if (r < 0.5 && s.happiness > 52) {
    if (mix > 0.65) {
      const drip = 40 + Math.round((s.waterShops || 0) * 12);
      city.treasury += drip;
      pushEvent(city, `Tourists turned back at the warehouses. +$${drip}.`);
      return;
    }
    const visit =
      220 +
      Math.round((s.waterShops || 0) * 90 + (s.waterParks || 0) * 40 + (s.berths || 0) * (mix < 0.4 ? 35 : 8));
    city.treasury += visit;
    pushEvent(city, `Weekend tourists filled the waterfront. +$${visit}.`);
    return;
  }
  if (r < 0.55 && (s.factories > 0 || s.plants > 0)) {
    city.treasury -= 240;
    pushEvent(city, "A plant fined for smoke. -$240. Keep plants 3 lots inland of the cove.");
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
  if (!t) return null;
  if (typeof mode === "string" && mode.startsWith("place:")) {
    const kind = mode.slice(6);
    if (!kind || t.kind) return null;
    if (placeBlockReason(city, x, z, kind)) return null;
    const hour = ((city.time % 24) + 24) % 24;
    const night = hour < 6.8 || hour > 18.2;
    return { color: night ? 0xffe070 : 0xf0c44a, opacity: night ? 0.94 : 0.88, ontop: true };
  }
  if (t.terrain === "water") return null;
  if (mode === "landfall") {
    if (t.kind) return null;
    if (!nextToPier(city, x, z)) return null;
    let byRoad = false;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = tileAt(city, x + dx, z + dz);
      if (n && isPaved(n.kind)) byRoad = true;
    }
    if (!byRoad) return null;
    if (!placeBlockReason(city, x, z, "road") || !placeBlockReason(city, x, z, "market")) {
      return { color: 0xffd24a, opacity: 0.9, ontop: true };
    }
    return null;
  }
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
    const park = coverage(city, x, z, (k) => k === "park", 5);
    const edu = coverage(city, x, z, (_, d) => d.service === "edu", 8);
    const health = coverage(city, x, z, (_, d) => d.service === "health", 10);
    const fire = coverage(city, x, z, (k) => k === "fire", 9);
    const v = Math.max(edu, health, fire, park);
    if (v < 0.08) return { color: 0x6a5040, opacity: 0.16 };
    const color =
      fire >= edu && fire >= health && fire >= park ? 0xd45a28
      : edu >= health && edu >= park ? 0x4a88d4
      : health >= park ? 0xd45a6a
      : 0x2fdd8a;
    return { color, opacity: 0.16 + v * 0.28 };
  }
  if (mode === "traffic") {
    if (!isPaved(t.kind)) return null;
    const jam = t.traffic || 0;
    if (jam < 0.45) return { color: 0x3aaa62, opacity: 0.2 };
    if (jam < 2.2) return { color: 0xc4a428, opacity: 0.26 };
    return { color: 0xc44a18, opacity: 0.3 + Math.min(jam, 6) * 0.035 };
  }
  if (mode === "mains") {
    const u = city.utilities || {};
    const i = idx(x, z);
    const inP = !!(u.reachPower && u.reachPower.has && u.reachPower.has(i));
    const inW = !!(u.reachWater && u.reachWater.has && u.reachWater.has(i));
    const inS = !!(u.reachSewer && u.reachSewer.has && u.reachSewer.has(i));
    if (!t.kind) {
      if (inW) return { color: 0x4aa6ff, opacity: 0.16 };
      if (inP) return { color: 0xffd27a, opacity: 0.14 };
      if (inS) return { color: 0x8ab87a, opacity: 0.12 };
      return null;
    }
    if (isPaved(t.kind) || t.kind === "park" || t.kind === "pier") {
      if (t.cable) {
        const live = !!(u.liveCable && u.liveCable.has && u.liveCable.has(i));
        return { color: live ? 0xc4a46a : 0x6a5040, opacity: live ? 0.34 : 0.22 };
      }
      return null;
    }
    if (t.kind === "exchange") {
      return { color: t.powered && t.servedLoad > 0 ? 0xc4a46a : 0xc49a28, opacity: 0.38 };
    }
    if (t.kind === "power" || t.kind === "cistern" || t.kind === "sewer") {
      return { color: t.powered ? 0x4aa6ff : 0xc49a28, opacity: 0.38 };
    }
    const needP = (DEFS[t.kind] && (t.kind === "house" || t.kind === "shop" || t.kind === "market" || t.kind === "office" || t.kind === "apartment" || t.kind === "tower" || t.kind === "factory" || t.kind === "warehouse" || t.kind === "school" || t.kind === "hospital" || t.kind === "clinic" || t.kind === "civic" || t.kind === "fire"));
    if (!needP) return null;
    const n = (t.powered ? 1 : 0) + (t.watered ? 1 : 0) + (t.sewered ? 1 : 0) + (t.wired ? 1 : 0);
    if (n >= 3) return { color: 0x2fdd8a, opacity: 0.28 };
    if (n === 2) return { color: 0xc4a428, opacity: 0.28 };
    if (n === 1) return { color: 0xc47a28, opacity: 0.3 };
    return { color: 0xff5348, opacity: 0.34 };
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
