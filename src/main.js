import { createCity, isInfra, isWaterfront, pastBuildLine, place as placeTile, placeBlockReason } from "./city.js";
import { tick } from "./economy.js";
import { pushEvent } from "./city.js";
import { bindInput, pumpHover } from "./input.js";
import { advanceConstruction } from "./construction.js";
import {
  buildTerrain,
  createRenderer,
  DEVICE,
  frame,
  invalidateTerrain,
  onGfxChange,
  preload,
  rebuildCityMeshes,
  setDayNight,
  updateBuildSites,
} from "./render.js";
import { hasSave, loadCity, saveCity } from "./save.js";
import { createUI } from "./ui.js";

function showBootError(err) {
  const el = document.getElementById("boot-err");
  const msg = err && err.stack ? err.stack : String(err);
  console.error("[harborline]", err);
  if (el) {
    el.hidden = false;
    el.textContent = msg;
  }
}

window.addEventListener("error", (e) => showBootError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => showBootError(e.reason));

const canvas = document.getElementById("view");
document.body.classList.add(DEVICE.touch ? "is-touch" : "is-pointer", "q-" + DEVICE.quality);
addEventListener("gesturestart", (e) => e.preventDefault());

let city = createCity();
if (hasSave()) loadCity(city);

const state = { tool: null, hover: null, selected: null, facing: 0 };
let ui = { refresh() {}, inspect() {}, setTool() {}, syncTransport() {} };

function paintWorld() {
  buildTerrain(city);
  rebuildCityMeshes(city);
  tick(city);
  setDayNight(city.time);
  ui.refresh();
  ui.syncTransport();
}

function adopt(next) {
  city.tiles = next.tiles;
  city.treasury = next.treasury;
  city.time = next.time;
  city.paused = next.paused;
  city.speed = next.speed;
  city.dayAuto = next.dayAuto;
  city.taxRate = next.taxRate || 1;
  city.nextId = next.nextId;
  city.stats = next.stats;
  city.bankruptWarn = next.bankruptWarn;
  city.seen = next.seen || {};
  city.events = next.events || [];
  city.tickCount = next.tickCount || 0;
  city.undo = [];
  city.lastWeek = next.lastWeek || null;
  city.lastDigest = next.lastDigest || null;
  city.digest = next.digest || null;
  city.recapDue = false;
  city.holdRecap = false;
  city.nextRecapTick = next.nextRecapTick || 80;
  city.contract = next.contract || null;
  city.contractsMissed = next.contractsMissed || 0;
  city.contractsWon = next.contractsWon || 0;
  city.stallTicks = next.stallTicks || 0;
  city.loanTicks = next.loanTicks || 0;
  city.log = next.log || [];
  city.laws = next.laws || { crews: false, festival: false, levy: false, nights: false, classrooms: false };
  city.scenario = next.scenario || "hamlet";
  city.dirty = true;
  Object.assign(state, { tool: null, hover: null, selected: null, facing: 0 });
  document.getElementById("digest")?.classList.add("hidden");
  document.getElementById("pointer-veil")?.classList.add("hidden");
  document.body.classList.remove("digest-open", "recap-hold");
  const view = document.getElementById("view");
  if (view) view.style.pointerEvents = "";
  try {
    invalidateTerrain();
    paintWorld();
  } catch (err) {
    showBootError(err);
  }
  ui.inspect(null);
  ui.setTool(null);
}

function attachPlay() {
  if (!window.__harbor) return;
  Object.assign(window.__harbor, {
    snapshot() {
      const kinds = {};
      for (const t of city.tiles) if (t.kind) kinds[t.kind] = (kinds[t.kind] || 0) + 1;
      return {
        pop: Math.round(city.stats?.pop || 0),
        popCap: Math.round(city.stats?.popCap || 0),
        jobs: Math.round(city.stats?.jobs || 0),
        treasury: Math.round(city.treasury),
        advisor: city.stats?.advisor || "",
        kinds,
        demand: city.stats?.demand || {},
        berths: city.tiles.filter((t) => t.kind === "pier" && t.terrain === "water").length,
        trade: Math.round(city.stats?.trade || city.stats?.pierBonus || 0),
        tourism: Math.round(city.stats?.tourism || 0),
        mix: city.stats?.mix || 0,
        harborHealth: city.stats?.harborHealth || 1,
        plants: city.stats?.plants || 0,
        towers: city.stats?.towers || 0,
        works: city.stats?.works || 0,
        markets: city.stats?.markets || 0,
        week: Math.floor((city.tickCount || 0) / 20),
        tick: city.tickCount || 0,
        digest: city.digest ? city.digest.week : null,
        nextRecapTick: city.nextRecapTick || 80,
        paused: !!city.paused,
        power: { load: city.stats?.powerLoad || 0, cap: city.stats?.powerCap || 0, used: city.stats?.powerUsed || 0 },
        water: { load: city.stats?.waterLoad || 0, cap: city.stats?.waterCap || 0, used: city.stats?.waterUsed || 0 },
      };
    },
    tile(x, z) {
      const t = city.tiles.find((tile) => tile.x === x && tile.z === z);
      if (!t) return null;
      return {
        kind: t.kind,
        powered: !!t.powered,
        watered: !!t.watered,
        sewered: !!t.sewered,
        powerSrc: t.powerSrc,
        waterSrc: t.waterSrc,
        sewerSrc: t.sewerSrc,
        servedLoad: t.servedLoad || 0,
        build: t.build,
      };
    },
    findKind(kind) {
      const t = city.tiles.find((tile) => tile.kind === kind);
      return t ? { x: t.x, z: t.z, kind: t.kind } : null;
    },
    setTime(hour) {
      city.time = hour;
      city.dayAuto = false;
      setDayNight(city.time);
      return city.time;
    },
    reset() {
      adopt(createCity());
      return this.snapshot();
    },
    digest() {
      return city.digest || null;
    },
    step(n = 1) {
      city.holdRecap = !!(state.tool || city.seen?.recap);
      for (let i = 0; i < n; i++) tick(city);
      ui.refresh();
      return this.snapshot();
    },
    forceDigest(d) {
      city.digest = d || { week: 28, people: "+0 people", cash: "+$0", mood: 50 };
      ui.refresh();
      return city.digest;
    },
    expireJob() {
      city.contractsWon = 0;
      city.contractsMissed = 4;
      city.contract = { id: "shops", label: "Operate 3 shops", weeks: 1, need: 3, reward: 2400, week0: 0 };
      city.tickCount = 19;
      tick(city);
      ui.refresh();
      return {
        msg: (city.log || []).map((e) => e.msg).join(" "),
        missed: city.contractsMissed,
        won: city.contractsWon,
      };
    },
    select(x, z) {
      const t = city.tiles.find((tile) => tile.x === x && tile.z === z) || null;
      state.selected = t;
      ui.inspect(t);
      return !!t;
    },
    held() {
      const modal =
        document.body.classList.contains("menu-open") || document.body.classList.contains("sheet-open");
      return !!(city.paused || city.digest || modal);
    },
    why(kind, x, z) {
      return placeBlockReason(city, x, z, kind);
    },
    waterfront(x, z) {
      return isWaterfront(city, x, z);
    },
    build(kind, x, z) {
      const ok = placeTile(city, x, z, kind, 0);
      if (!ok) return { ok: false, why: placeBlockReason(city, x, z, kind) };
      if (isInfra(kind)) buildTerrain(city);
      rebuildCityMeshes(city);
      tick(city);
      return { ok: true, treasury: Math.round(city.treasury), berths: city.stats?.berths, trade: Math.round(city.stats?.trade || 0), tourism: Math.round(city.stats?.tourism || 0) };
    },
    finish(x, z) {
      const t = city.tiles.find((tile) => tile.x === x && tile.z === z);
      if (!t?.kind) return false;
      t.build = 1;
      city.meshDirty = true;
      rebuildCityMeshes(city);
      tick(city);
      return true;
    },
    auditCoast() {
      const bad = [];
      const shore = [];
      for (const t of city.tiles) {
        if (t.shoreline || t.terrain === "water") {
          if (t.kind && t.kind !== "pier") {
            bad.push({ x: t.x, z: t.z, kind: t.kind, terrain: t.terrain, shore: !!t.shoreline });
          }
        }
        if (t.kind && t.kind !== "pier" && pastBuildLine(t.x, t.z, t)) {
          if (!bad.some((b) => b.x === t.x && b.z === t.z)) {
            bad.push({ x: t.x, z: t.z, kind: t.kind, terrain: t.terrain, shore: !!t.shoreline });
          }
        }
        if (t.kind) shore.push({ x: t.x, z: t.z, kind: t.kind, terrain: t.terrain, shore: !!t.shoreline });
      }
      return { bad, lots: shore.filter((s) => s.kind === "road" || s.kind === "cobble" || s.kind === "house" || s.kind === "shop") };
    },
  });
}

try {
  createRenderer(canvas);
  attachPlay();
  ui = createUI(city, state, () => adopt(createCity()));
  bindInput(city, state, ui);
  onGfxChange((q) => {
    invalidateTerrain();
    paintWorld();
    if (q === "restore") ui.toast?.("Graphics recovered — quality dropped so the town stays up.");
  });
  paintWorld();
} catch (err) {
  showBootError(err);
}

let acc = 0;
let autoSave = 0;
let hud = 0;
let lastHour = -1;

function loop() {
  requestAnimationFrame(loop);
  try {
    const dt = frame();
    const splashUp = !document.getElementById("splash")?.classList.contains("gone");
    city.holdRecap = !!(state.tool || city.seen?.recap || window.__inputHeld);
    const recapHold = !!city.digest;
    const modalHold =
      document.body.classList.contains("menu-open") || document.body.classList.contains("sheet-open");
    if (!city.paused && !recapHold && !splashUp && !modalHold) {
      const built = advanceConstruction(city, dt);
      updateBuildSites(city);
      if (built.finished) {
        if (built.infra) buildTerrain(city);
        rebuildCityMeshes(city);
        if (built.opened) {
          city.events = city.events || [];
          pushEvent(city, built.opened === 1 ? "Construction finished." : `${built.opened} buildings opened.`);
        }
        hud = 1;
      }
      acc += dt * city.speed;
      while (acc >= 1) {
        tick(city);
        acc -= 1;
        hud = 1;
      }
      if (city.meshDirty) {
        rebuildCityMeshes(city);
        city.meshDirty = false;
      }
      if (city.dayAuto) city.time = (city.time + dt * city.speed * 0.12) % 24;
      autoSave += dt;
      if (autoSave > 20) {
        saveCity(city);
        autoSave = 0;
      }
    }
    if (Math.abs(city.time - lastHour) > 0.08) {
      setDayNight(city.time);
      lastHour = city.time;
    }
    hud += dt;
    if (hud > 0.25) {
      ui.refresh();
      hud = 0;
    }
    pumpHover();
  } catch (err) {
    showBootError(err);
  }
}

loop();

preload().then(() => {
  try {
    invalidateTerrain();
    buildTerrain(city);
    rebuildCityMeshes(city);
    setDayNight(city.time);
  } catch (err) {
    showBootError(err);
  }
});
