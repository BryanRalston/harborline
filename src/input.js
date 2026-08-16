import { DEFS } from "./buildings.js";
import { canPlace, demolish, inBounds, place, tileAt } from "./city.js";
import {
  buildTerrain,
  focusCell,
  pickBuilding,
  pickCell,
  rebuildCityMeshes,
  setGhost,
} from "./render.js";

export function bindInput(city, state, ui) {
  const canvas = document.getElementById("view");
  state.facing = state.facing || 0;
  let down = null;
  let hold = 0;

  function syncGhost() {
    const cell = state.hover;
    if (!state.tool || !cell || !inBounds(cell.x, cell.z)) {
      setGhost(null);
      ui.hint(null, false);
      return;
    }
    const valid =
      canPlace(city, cell.x, cell.z, state.tool) && city.treasury >= DEFS[state.tool].cost;
    setGhost(state.tool, cell.x, cell.z, valid, state.facing);
    ui.hint(cell, valid);
  }

  function refreshWorld(terrain = false) {
    if (terrain) buildTerrain(city);
    rebuildCityMeshes(city);
    ui.refresh();
  }

  canvas.addEventListener("pointermove", (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) clearTimeout(hold);
    state.hover = pickCell(e);
    syncGhost();
  });

  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
    clearTimeout(hold);
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      hold = setTimeout(() => {
        if (!down) return;
        const ev = { clientX: down.x, clientY: down.y };
        const cell = pickBuilding(ev) || pickCell(ev);
        const existing = cell ? tileAt(city, cell.x, cell.z) : null;
        if (existing?.kind) {
          const kind = existing.kind;
          demolish(city, cell.x, cell.z);
          if (state.selected && state.selected.x === cell.x && state.selected.z === cell.z) {
            state.selected = null;
            ui.inspect(null);
          }
          refreshWorld(kind === "road" || kind === "pier");
          ui.toast("Demolished.");
        }
        down = null;
      }, 520);
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    clearTimeout(hold);
    const click =
      down &&
      Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 &&
      performance.now() - down.t < 500;
    const button = down ? down.button : e.button;
    down = null;
    if (!click) return;

    if (button === 2) {
      const cell = pickBuilding(e) || pickCell(e);
      const existing = cell ? tileAt(city, cell.x, cell.z) : null;
      if (existing?.kind) {
        const kind = existing.kind;
        demolish(city, cell.x, cell.z);
        if (state.selected && state.selected.x === cell.x && state.selected.z === cell.z) {
          state.selected = null;
          ui.inspect(null);
        }
        refreshWorld(kind === "road" || kind === "pier");
      }
      return;
    }
    if (button !== 0) return;

    const built = pickBuilding(e);
    if (built && (!state.tool || tileAt(city, built.x, built.z)?.kind)) {
      state.selected = tileAt(city, built.x, built.z);
      focusCell(built.x, built.z);
      ui.inspect(state.selected);
      return;
    }

    const cell = pickCell(e);
    if (!cell || !inBounds(cell.x, cell.z)) return;

    if (state.tool) {
      if (city.treasury < DEFS[state.tool].cost) {
        ui.toast("Not enough in the treasury.");
        return;
      }
      const ok = place(city, cell.x, cell.z, state.tool, state.facing);
      if (ok) {
        state.selected = tileAt(city, cell.x, cell.z);
        ui.inspect(state.selected);
        refreshWorld(state.tool === "road" || state.tool === "pier");
        syncGhost();
      } else {
        const t = tileAt(city, cell.x, cell.z);
        if (t?.kind) {
          state.selected = t;
          focusCell(t.x, t.z);
          ui.inspect(t);
        } else ui.toast("Cannot build there.");
      }
      return;
    }

    state.selected = tileAt(city, cell.x, cell.z);
    focusCell(cell.x, cell.z);
    ui.inspect(state.selected);
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  addEventListener("keydown", (e) => {
    if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.key === "r" || e.key === "R") {
      state.facing = ((state.facing || 0) + 1) & 3;
      syncGhost();
    } else if (e.key === "Escape") {
      state.tool = null;
      state.selected = null;
      setGhost(null);
      ui.setTool(null);
      ui.inspect(null);
    } else if ((e.key === "Delete" || e.key === "Backspace") && state.selected) {
      const kind = state.selected.kind;
      if (demolish(city, state.selected.x, state.selected.z)) {
        state.selected = null;
        ui.inspect(null);
        refreshWorld(kind === "road" || kind === "pier");
      }
    } else if (e.code === "Space") {
      e.preventDefault();
      city.paused = !city.paused;
      ui.syncTransport();
    }
  });
}
