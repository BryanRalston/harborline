import { DEFS, TOOLS } from "./buildings.js";
import {
  beginStroke,
  canPlace,
  countLostAccess,
  demolish,
  endStroke,
  inBounds,
  lineCells,
  paintsAsLine,
  place,
  placeBlockReason,
  placeOnStroke,
  tileAt,
  undoLast,
} from "./city.js";
import {
  buildTerrain,
  focusCell,
  pickBuilding,
  pickCell,
  rebuildCityMeshes,
  setGhost,
  setOrbitLock,
} from "./render.js";

export function bindInput(city, state, ui) {
  const canvas = document.getElementById("view");
  state.facing = state.facing || 0;
  let down = null;
  let hold = 0;
  let stroke = null;

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
    if (stroke && state.hover) {
      let placed = 0;
      for (const c of lineCells(stroke.x, stroke.z, state.hover.x, state.hover.z)) {
        if (placeOnStroke(city, c.x, c.z, stroke.type, state.facing)) placed += 1;
      }
      if (placed) refreshWorld(stroke.type === "road" || stroke.type === "pier");
    }
    syncGhost();
  });

  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
    clearTimeout(hold);
    if (e.button === 0 && state.tool && paintsAsLine(state.tool)) {
      const cell = pickCell(e);
      if (cell && inBounds(cell.x, cell.z)) {
        beginStroke(city);
        stroke = { x: cell.x, z: cell.z, type: state.tool };
        setOrbitLock(true);
        if (city.treasury < DEFS[state.tool].cost) {
          ui.toast("Not enough in the treasury.");
        } else if (placeOnStroke(city, cell.x, cell.z, state.tool, state.facing)) {
          refreshWorld(state.tool === "road" || state.tool === "pier");
        }
      }
    }
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
          if (kind === "road") {
            const lost = countLostAccess(city);
            ui.toast(lost ? `Demolished. ${lost} lots lost the main road.` : "Demolished.");
          } else ui.toast("Demolished.");
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
    if (stroke) {
      const n = endStroke(city);
      setOrbitLock(false);
      stroke = null;
      if (n > 1) ui.toast(`${n} lots.`);
      syncGhost();
      ui.refresh();
      return;
    }
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
        if (kind === "road") {
          const lost = countLostAccess(city);
          ui.toast(lost ? `Demolished. ${lost} lots lost the main road.` : "Demolished.");
        }
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
        } else ui.toast(placeBlockReason(city, cell.x, cell.z, state.tool) || "Cannot build there.");
      }
      return;
    }

    state.selected = tileAt(city, cell.x, cell.z);
    focusCell(cell.x, cell.z);
    ui.inspect(state.selected);
  });

  canvas.addEventListener("pointercancel", () => {
    if (stroke) {
      endStroke(city);
      setOrbitLock(false);
      stroke = null;
    }
    down = null;
    clearTimeout(hold);
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  addEventListener("keydown", (e) => {
    if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault();
      const undone = undoLast(city);
      if (!undone) {
        ui.toast("Nothing to undo.");
        return;
      }
      refreshWorld(undone.infra);
      ui.toast("Undone.");
      return;
    }
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
    } else if (e.code.startsWith("Digit") || e.code.startsWith("Numpad")) {
      const n = Number(e.code.replace("Digit", "").replace("Numpad", ""));
      if (n >= 1 && n <= TOOLS.length) {
        const id = TOOLS[n - 1];
        state.tool = state.tool === id ? null : id;
        ui.setTool(state.tool);
        syncGhost();
      }
    }
  });
}
