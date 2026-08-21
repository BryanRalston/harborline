import { DEFS, TOOLS } from "./buildings.js";
import {
  beginStroke,
  canPlace,
  countLostAccess,
  demolish,
  demolishOnStroke,
  endStroke,
  inBounds,
  isInfra,
  isPaved,
  lineCells,
  paintsAsLine,
  place,
  placeBlockReason,
  placeOnStroke,
  isWaterfront,
  tileAt,
  undoLast,
  upgradeLot,
} from "./city.js";
import { tick } from "./economy.js";
import {
  buildTerrain,
  focusCell,
  pickBuilding,
  pickCell,
  rebuildCityMeshes,
  setGhost,
  setOrbitLock,
} from "./render.js";

let pump = () => {};
export function pumpHover() {
  pump();
}

export function bindInput(city, state, ui) {
  const canvas = document.getElementById("view");
  state.facing = state.facing || 0;
  let down = null;
  let hold = 0;
  let stroke = null;
  let chipHold = false;
  let lastPtr = null;

  function syncGhost(e) {
    const cell = state.hover;
    if (!state.tool || !cell || !inBounds(cell.x, cell.z)) {
      setGhost(null);
      ui.hint(null, false);
      ui.whyChip?.(null);
      return;
    }
    const valid =
      canPlace(city, cell.x, cell.z, state.tool) && city.treasury >= DEFS[state.tool].cost;
    setGhost(state.tool, cell.x, cell.z, valid, state.facing);
    ui.hint(cell, valid);
    if (chipHold) {
      ui.whyChip?.(null);
      return;
    }
    if (!valid) {
      ui.whyChip?.(placeBlockReason(city, cell.x, cell.z, state.tool), e?.clientX, e?.clientY);
    } else ui.whyChip?.(null);
  }

  function refreshWorld(terrain = false) {
    if (terrain) buildTerrain(city);
    rebuildCityMeshes(city);
    tick(city);
    ui.refresh();
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      lastPtr = e;
    },
    { passive: true }
  );

  canvas.addEventListener("pointerleave", () => {
    if (stroke) return;
    state.hover = null;
    syncGhost();
  });

  canvas.addEventListener("pointermove", (e) => {
    lastPtr = e;
    chipHold = false;
    if (city.digest || performance.now() < (window.__veilUntil || 0)) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) clearTimeout(hold);
    state.hover = pickCell(e);
    if (stroke && state.hover) {
      let placed = 0;
      for (const c of lineCells(stroke.x, stroke.z, state.hover.x, state.hover.z)) {
        if (stroke.type === "demo") {
          if (demolishOnStroke(city, c.x, c.z)) placed += 1;
        } else if (placeOnStroke(city, c.x, c.z, stroke.type, state.facing)) placed += 1;
      }
      if (placed) {
        refreshWorld(isInfra(stroke.type) || stroke.type === "demo");
        if (stroke.type !== "demo") {
          const cost = (city._stroke || []).reduce((n, c) => n + (c.cost || 0), 0);
          ui.hint(state.hover, true, `${city._stroke.length} lots · $${cost.toLocaleString("en-US")}`);
        }
      }
    }
    syncGhost(e);
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (document.body.classList.contains("menu-open")) {
      ui.setMenu?.(false);
      window.__veilUntil = Math.max(window.__veilUntil || 0, performance.now() + 400);
      down = null;
      return;
    }
    if (city.digest || performance.now() < (window.__veilUntil || 0)) return;
    window.__pointerKind = e.pointerType || "mouse";
    down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
    clearTimeout(hold);
    if (e.button === 2) {
      return;
    }
    if (e.button === 0 && state.tool && paintsAsLine(state.tool)) {
      const cell = pickCell(e);
      if (cell && inBounds(cell.x, cell.z)) {
        beginStroke(city);
        const demo = state.tool === "bulldoze";
        stroke = { x: cell.x, z: cell.z, type: demo ? "demo" : state.tool };
        setOrbitLock(true);
        if (demo) {
          if (demolishOnStroke(city, cell.x, cell.z)) {
            const last = city._stroke[city._stroke.length - 1];
            refreshWorld(isInfra(last?.kind));
          }
        } else if (city.treasury < DEFS[state.tool].cost) {
          ui.toast("Not enough in the treasury.");
        } else if (placeOnStroke(city, cell.x, cell.z, state.tool, state.facing)) {
          refreshWorld(isInfra(state.tool));
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
          refreshWorld(isInfra(kind));
          if (isPaved(kind)) {
            const lost = countLostAccess(city);
            ui.toast(lost ? `Demolished. ${lost} lots lost the main road.` : "Demolished.");
          } else ui.toast("Demolished.");
        }
        down = null;
      }, 520);
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (city.digest || performance.now() < (window.__veilUntil || 0)) {
      down = null;
      return;
    }
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
      chipHold = true;
      ui.whyChip?.(null);
      syncGhost(e);
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
        refreshWorld(isInfra(kind));
        if (isPaved(kind)) {
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
        refreshWorld(isInfra(state.tool));
        if (state.tool === "pier") ui.toast("A new berth. Boats will use it.");
        if (state.tool === "shop" && isWaterfront(city, cell.x, cell.z)) ui.toast("Tourists will find this. Warehouses on this dock will drive them off.");
        if (state.tool === "market") {
          ui.toast(isWaterfront(city, cell.x, cell.z) ? "The catch will land here." : "Far from the water — little catch will sell.");
        }
        if (state.tool === "warehouse") {
          const dock = isWaterfront(city, cell.x, cell.z);
          ui.toast(dock ? "Cargo will mint here. Tourists will not walk a freight dock." : "Far from the dock — little cargo will land here.");
        }
        if (state.tool === "power") {
          ui.toast(isWaterfront(city, cell.x, cell.z) ? "Smoke on the cove. The catch will thin." : "The plant lights lots in range, then along the streets.");
        }
        if (state.tool === "cistern") ui.toast("The tower waters lots in range while the plant is lit.");
        if (state.tool === "sewer") {
          ui.toast(isWaterfront(city, cell.x, cell.z) ? "Outfall on the promenade. Visitors will leave." : "The works serve lots in range. Keep the outfall off the cove.");
        }
        chipHold = true;
        ui.whyChip?.(null);
        syncGhost(e);
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
      if (city.digest) {
        ui.fileRecap?.();
        return;
      }
      if (document.body.classList.contains("menu-open")) {
        ui.setMenu?.(false);
        return;
      }
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
        refreshWorld(isInfra(kind));
      }
    } else if (e.key === "g" || e.key === "G") ui.setMap?.("access");
    else if (e.key === "h" || e.key === "H") ui.setMap?.("pollution");
    else if (e.key === "v" || e.key === "V") ui.setMap?.("value");
    else if (e.key === "k" || e.key === "K") ui.setMap?.("cover");
    else if (e.key === "t" || e.key === "T") ui.setMap?.("traffic");
    else if (e.key === "m" || e.key === "M") ui.setMap?.("mains");
    else if (e.key === "p" || e.key === "P") ui.toggleLaws?.();
    else if (e.key === "b" || e.key === "B") {
      state.tool = state.tool === "bulldoze" ? null : "bulldoze";
      ui.setTool(state.tool);
      syncGhost();
    } else if ((e.key === "u" || e.key === "U") && state.selected?.kind) {
      if (upgradeLot(city, state.selected.x, state.selected.z)) {
        refreshWorld(false);
        ui.inspect(tileAt(city, state.selected.x, state.selected.z));
        ui.toast("Upgrade started.");
      }
    } else if (e.code === "Space") {
      e.preventDefault();
      city.paused = !city.paused;
      ui.syncTransport();
    } else if (e.key === "e" || e.key === "E") {
      const t = state.selected;
      if (t?.kind && DEFS[t.kind] && t.kind !== "bulldoze") {
        state.tool = t.kind;
        ui.setTool(state.tool);
        syncGhost();
        ui.toast(`${DEFS[t.kind].label} tool.`);
      }
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

  pump = () => {
    if (!lastPtr || !state.tool || stroke) return;
    if (city.digest || performance.now() < (window.__veilUntil || 0)) return;
    const hit = document.elementFromPoint(lastPtr.clientX, lastPtr.clientY);
    if (hit && hit !== canvas && hit.id !== "view" && hit.id !== "pointer-veil") return;
    state.hover = pickCell(lastPtr);
    syncGhost(lastPtr);
  };
}
