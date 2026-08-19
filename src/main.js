import { createCity, place as placeTile, placeBlockReason } from "./city.js";
import { tick } from "./economy.js";
import { pushEvent } from "./city.js";
import { bindInput } from "./input.js";
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
  city.contract = next.contract || null;
  city.loanTicks = next.loanTicks || 0;
  city.log = next.log || [];
  city.laws = next.laws || { crews: false, festival: false, levy: false, nights: false, classrooms: false };
  city.scenario = next.scenario || "hamlet";
  city.dirty = true;
  Object.assign(state, { tool: null, hover: null, selected: null, facing: 0 });
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
      };
    },
    build(kind, x, z) {
      const ok = placeTile(city, x, z, kind, 0);
      if (!ok) return { ok: false, why: placeBlockReason(city, x, z, kind) };
      if (kind === "road" || kind === "pier") buildTerrain(city);
      rebuildCityMeshes(city);
      return { ok: true, treasury: Math.round(city.treasury) };
    },
  });
}

try {
  createRenderer(canvas);
  attachPlay();
  ui = createUI(city, state, () => adopt(createCity()));
  bindInput(city, state, ui);
  onGfxChange(() => {
    invalidateTerrain();
    paintWorld();
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
    if (!city.paused) {
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
