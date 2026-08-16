import { DEFS, isResidential, isWorkplace } from './buildings.js';
import { forEachInRadius, tileAt } from './city.js';
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

export function inspectLocal(city, x, z) {
  const t = tileAt(city, x, z);
  if (!t) return null;
  const def = t.kind ? DEFS[t.kind] : null;
  const park = coverage(city, x, z, (k) => k === 'park', 5);
  const edu = coverage(city, x, z, (_, d) => d.service === 'edu', 8);
  const health = coverage(city, x, z, (_, d) => d.service === 'health', 10);
  const civic = coverage(city, x, z, (_, d) => d.service === 'civic', 12);
  const pollution = localPollution(city, x, z);
  return {
    tile: t,
    def,
    park,
    edu,
    health,
    civic,
    pollution,
    nearbyPop: nearbyPop(city, x, z, 8),
  };
}

export function tick(city) {
  let pop = 0;
  let popCap = 0;
  let jobs = 0;
  let jobCap = 0;
  let upkeep = 0;
  let shops = 0;
  let piers = 0;
  let civics = 0;
  let parks = 0;
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
    if (isResidential(t.kind)) {
      popCap += def.pop;
      pop += t.pop;
      homes.push(t);
    }
    if (isWorkplace(t.kind)) {
      jobCap += def.jobs;
      jobs += t.jobs;
      works.push(t);
    }
  }

  const employed = Math.min(pop, jobs);
  const jobRatio = pop > 0 ? jobs / pop : jobs > 0 ? 1 : 0.5;
  const unemp = pop > 0 ? clamp(1 - jobRatio, 0, 1) : 0;
  const broke = city.treasury < 0;

  let hapSum = 0;
  let hapN = 0;

  for (const t of homes) {
    const def = DEFS[t.kind];
    const park = coverage(city, t.x, t.z, (k) => k === 'park', 5);
    const edu = coverage(city, t.x, t.z, (_, d) => d.service === 'edu', 8);
    const health = coverage(city, t.x, t.z, (_, d) => d.service === 'health', 10);
    const civic = coverage(city, t.x, t.z, (_, d) => d.service === 'civic', 12);
    const pol = localPollution(city, t.x, t.z);
    const local = clamp(
      52 +
        park * 14 +
        edu * 11 +
        health * 10 +
        civic * 8 -
        pol * 22 -
        unemp * 16 -
        (broke ? 14 : 0),
      0,
      100,
    );
    hapSum += local;
    hapN += 1;

    const soft = jobs < 1 ? def.pop * 0.4 : def.pop;
    const growOk = local > 28 && !broke && city.treasury > -2500;
    const rate = 0.22 * (edu > 0.15 ? 1.35 : 1) * (local / 70);
    if (growOk && t.pop < soft) t.pop = Math.min(soft, t.pop + rate * def.pop);
    else if ((local < 18 || broke) && t.pop > 0) t.pop = Math.max(0, t.pop - 0.12);
    t.pop = clamp(t.pop, 0, def.pop);
  }

  for (const t of works) {
    const def = DEFS[t.kind];
    if (def.jobs <= 0) {
      t.jobs = 0;
      continue;
    }
    let demand = pop > 0 ? 1 : 0;
    if (t.kind === 'shop') {
      const near = nearbyPop(city, t.x, t.z, def.radius || 7);
      demand = clamp(near / 8, 0.15, 1);
    }
    if (broke) demand *= 0.35;
    const target = def.jobs * demand;
    if (t.jobs < target) t.jobs = Math.min(target, t.jobs + def.jobs * 0.2);
    else t.jobs = Math.max(target, t.jobs - def.jobs * 0.08);
    t.jobs = clamp(t.jobs, 0, def.jobs);
  }

  pop = 0;
  jobs = 0;
  for (const t of homes) pop += t.pop;
  for (const t of works) jobs += t.jobs;
  const employedNow = Math.min(pop, jobs);

  const commerce = shops * 3.6 * clamp(pop / 16, 0.2, 1.4);
  const pierBonus = piers * (shops > 0 ? 6.5 : 1.6);
  const civicBonus = civics * 8;
  const wageTax = employedNow * 2.45;
  const property = pop * 0.38;
  const income = wageTax + property + commerce + pierBonus + civicBonus;
  const net = income - upkeep;
  city.treasury += net;

  const happiness =
    hapN === 0
      ? clamp(50 + parks * 2 + (broke ? -20 : 0), 0, 100)
      : hapSum / hapN;

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
  };
  city.bankruptWarn = city.treasury < 0;
  return city.stats;
}
