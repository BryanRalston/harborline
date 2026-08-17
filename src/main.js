import { createCity } from "./city.js";
import { tick } from "./economy.js";
import { bindInput } from "./input.js";
import { advanceConstruction } from "./construction.js";
import {
  buildTerrain,
  createRenderer,
  DEVICE,
  frame,
  invalidateTerrain,
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

try {
  createRenderer(canvas);
  ui = createUI(city, state, () => adopt(createCity()));
  bindInput(city, state, ui);
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
          city.events.push(built.opened === 1 ? "Construction finished." : `${built.opened} buildings opened.`);
        }
        hud = 1;
      }
      acc += dt * city.speed;
      while (acc >= 1) {
        tick(city);
        acc -= 1;
        hud = 1;
      }
      if (city.dayAuto) city.time = (city.time + dt * city.speed * 0.12) % 24;
      autoSave += dt;
      if (autoSave > 20) {
        saveCity(city);
        autoSave = 0;
      }
    }
    if (Math.abs(city.time - lastHour) > 0.01) {
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
