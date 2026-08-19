import { DEFS, isResidential, isWorkplace } from './buildings.js';
import { forEachInRadius, hasRoadAccess, isWaterfront, pushEvent, refreshRoadNet, tileAt } from './city.js';
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

function localPollution(city, x, z) {
  let p = 0;
  forEachInRadius(city, x, z, 8, (tile, dist) => {
    if (!tile.kind) return;
    const pol = DEFS[tile.kind].pollution || 0;
    if (pol) p += pol * (1 - dist / 8);
  });
  return p;
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
    if (!r || r.kind !== 'road') continue;
    roads += 1;
    let n = 0;
    for (const [ox, oz] of dirs) {
      const b = tileAt(city, r.x + ox, r.z + oz);
      if (b?.kind && b.kind !== 'road' && b.kind !== 'park' && b.kind !== 'pier') n += 1;
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
    label: (c) => `Run ${c.need} piers`,
  },
  {
    id: 'homes',
    weeks: 6,
    reward: 2600,
    make: (s) => ({ need: Math.round(s.pop + 80) }),
    done: (c, s) => s.pop >= c.need,
    label: (c) => `Reach ${c.need} residents`,
  },
];

function pickContract(city, s) {
  const last = city.contract?.id;
  const pool = CONTRACTS.filter((c) => c.id !== last);
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
  const access = t.kind === 'road' || t.kind === 'pier' || t.kind === 'park' || hasRoadAccess(city, x, z);
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
    congestion: roadLoad(city, x, z),
    abandoned: !!t.abandoned,
    value: t.value || 0,
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
  return "";
}

function advisorFor(broke, unemp, pop, popCap, happiness, demand, extra) {
  if (broke && !extra.loan) return 'Treasury is empty. Pause growth, add jobs, or float a bond.';
  if (broke) return 'The bond is covering a hole. Cut costs or grow the tax base.';
  if (extra.abandoned) return `${extra.abandoned} homes are abandoned. Reconnect the road or reopen them.`;
  if (extra.eduOver > 0.25) return 'Schools are packed. Build another school.';
  if (extra.healthOver > 0.25) return 'The hospital is overrun. Add a clinic or hospital.';
  if (extra.congested > 12) return 'Avenues are jammed. Add roads to spread the load.';
  if (unemp > 0.38) return 'Too few jobs. Build shops, offices, or the harbor.';
  if (popCap > 8 && pop / popCap > 0.9) return 'Homes are full. Zone more housing.';
  if (happiness < 38) return 'Mood is low. Add parks, a school, or cut pollution.';
  if (demand.shop > 0.72) return 'People need shops along the avenues.';
  if (demand.home > 0.72) return 'Families want rowhouses near work.';
  if (demand.work > 0.7) return 'Job demand is high. Add workplaces.';
  if (demand.port > 0.68) return 'The harbor can earn more. Extend a pier.';
  return 'The harbor is steady. Grow what the meters ask for.';
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
    if (t.kind === 'shop') shops += 1;
    if (t.kind === 'pier') piers += 1;
    if (t.kind === 'civic') civics += 1;
    if (t.kind === 'park') parks += 1;
    if (t.kind === 'factory') factories += 1;
    if (t.kind === 'school') schools += 1;
    if (t.kind === 'hospital') hospitals += 1;
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
  const seats = schools * (DEFS.school.seats || 90);
  const beds = hospitals * (DEFS.hospital.beds || 120);
  const kids = pop * 0.18;
  const patients = pop * 0.08;
  const eduOver = seats > 0 ? clamp((kids - seats) / Math.max(kids, 1), 0, 1) : kids > 4 ? 0.55 : 0;
  const healthOver = beds > 0 ? clamp((patients - beds) / Math.max(patients, 1), 0, 1) : pop > 40 ? 0.4 : 0;

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
    const pol = localPollution(city, t.x, t.z);
    const access = hasRoadAccess(city, t.x, t.z);
    const water = isWaterfront(city, t.x, t.z);
    const jam = roadLoad(city, t.x, t.z);
    if (jam > 3.2) congested += 1;
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
      demand = clamp(near / 8, 0.12, 1) * (daytime ? 1.08 : 0.7) * (1 + strip * 0.1);
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
    }
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
  const pierBonus = piers * (shops > 0 ? 6.5 : 1.6);
  const civicBonus = civics * 8;
  const shipping = factories * Math.max(1, piers) * 1.35;
  const tourism = parks * 0.45 + (piers >= 4 ? 7 : 0) + (happiness > 56 ? 5 : 0);
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
  const income = wageTax + property + commerce + pierBonus + civicBonus + shipping + tourism;
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
    port: clamp((shops + factories) * 0.14 - piers * 0.1 + 0.18, 0, 1),
    edu: eduOver,
    health: healthOver,
  };

  const extra = { abandoned, eduOver, healthOver, congested, loan: (city.loanTicks || 0) > 0 };
  const advisor = advisorFor(broke, unemp, pop, popCap, happiness, demand, extra);

  note(city, 'p100', pop >= 100, '100 residents. The neighborhood is real.', 1500);
  note(city, 'p500', pop >= 500, '500 residents. The tax base is holding.', 3500);
  note(city, 'p1000', pop >= 1000, '1,000 residents. A real harbor town.', 8000);
  note(city, 'jobs200', jobs >= 200, '200 jobs filled.', 2000);
  note(city, 'school', schools >= 1, 'A school is open. Families will stay.');
  note(city, 'hospital', hospitals >= 1, 'The hospital is open.');
  note(city, 'piers6', piers >= 8, 'A working waterfront.', 2500);
  note(city, 'mood70', happiness >= 70, 'Mood is high. People want to stay.', 1000);
  note(city, 'tipDemand', city.tickCount === 6, 'Watch the demand meters. Build what is short.');
  note(city, 'tipRoad', city.tickCount === 10, 'Homes and jobs need a road on the main network.');
  if (city.tickCount >= 20 && city.tickCount % 20 === 0) {
    const week = city.tickCount / 20;
    const prev = city.lastWeek || { pop, treasury: city.treasury };
    const dp = pop - prev.pop;
    const dc = city.treasury - prev.treasury;
    const people = `${dp >= 0 ? '+' : ''}${Math.round(dp)} people`;
    const cash = `${dc >= 0 ? '+' : '-'}$${Math.abs(Math.round(dc)).toLocaleString('en-US')}`;
    pushEvent(city, `Week ${week}: ${people}, ${cash}. Mood ${Math.round(happiness)}%.`);
    rollHarborEvent(city, {
      pop,
      happiness,
      piers,
      factories,
      parks,
      shops,
    });
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
    civics,
    demand,
    advisor,
    wageTax,
    property,
    commerce,
    pierBonus,
    shipping,
    tourism,
    week: Math.floor((city.tickCount || 0) / 20),
    schools,
    hospitals,
    seats,
    kids,
    beds,
    abandoned,
    congested,
    eduOver,
    healthOver,
    contract: city.contract,
    loanTicks: city.loanTicks || 0,
    loanPay,
  };
  advanceContract(city, city.stats);
  city.stats.contract = city.contract;
  city.bankruptWarn = city.treasury < 0;
  return city.stats;
}

function rollHarborEvent(city, s) {
  const roll = Math.sin((city.tickCount || 1) * 12.9898) * 43758.5453;
  const r = roll - Math.floor(roll);
  if (r < 0.22 && s.piers > 0) {
    city.treasury -= 380;
    pushEvent(city, "A squall chewed the docks. -$380.");
    return;
  }
  if (r < 0.4 && s.happiness > 58) {
    city.treasury += 520;
    pushEvent(city, "Weekend tourists filled the promenade. +$520.");
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
    if (!t.kind || t.kind === "road" || t.kind === "park" || t.kind === "pier") return null;
    if (t.abandoned) return { color: 0xb8862a, opacity: 0.4 };
    return { color: hasRoadAccess(city, x, z) ? 0x2fdd8a : 0xff5348, opacity: 0.34 };
  }
  if (mode === "pollution") {
    const p = localPollution(city, x, z);
    if (p < 0.07) return null;
    return { color: p > 0.55 ? 0xc44a18 : 0xc49a28, opacity: 0.16 + p * 0.38 };
  }
  if (mode === "value") {
    const park = coverage(city, x, z, (k) => k === "park", 5);
    const edu = coverage(city, x, z, (_, d) => d.service === "edu", 8);
    const health = coverage(city, x, z, (_, d) => d.service === "health", 10);
    const access = !t.kind || t.kind === "road" || t.kind === "park" || t.kind === "pier" || hasRoadAccess(city, x, z);
    const v = clamp(park * 0.28 + edu * 0.22 + health * 0.18 + (access ? 0.2 : 0) + (isWaterfront(city, x, z) ? 0.12 : 0) - localPollution(city, x, z) * 0.35, 0, 1);
    return { color: v > 0.58 ? 0x4aa6ff : v > 0.32 ? 0x6aaa62 : 0x8a6a40, opacity: 0.2 + v * 0.16 };
  }
  return null;
}
