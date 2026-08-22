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
import { ghostUtilHint } from "./utilities.js";
import {
  buildTerrain,
  cellToScreen,
  DEVICE,
  isFocusing,
  pickBuilding,
  pickCell,
  rebuildCityMeshes,
  setGhost,
  setOrbitLock,
  watchCamera,
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
  let dragged = false;
  let pathLen = 0;
  let lastMove = null;
  const pointers = new Map();
  let looking = false;
  let lookedUntil = 0;
  let touchFingers = 0;
  function phoneCam() {
    return DEVICE.touch || DEVICE.phone || innerWidth <= 820;
  }
  function isHudNode(hit) {
    if (!hit || hit === canvas || hit.id === "view" || hit.id === "ghost-why" || hit.id === "pointer-veil") {
      return false;
    }
    if (hit === document.body || hit === document.documentElement) return false;
    return !!(
      hit.id === "recap-wait" ||
      hit.closest?.("#recap-wait") ||
      hit.id === "placing" ||
      hit.closest?.("#placing") ||
      hit.id === "inspect" ||
      hit.closest?.("#inspect") ||
      hit.id === "rail-fold" ||
      hit.closest?.("#tools") ||
      hit.closest?.("footer.dock") ||
      hit.id === "toast" ||
      hit.closest?.("#toast") ||
      hit.id === "advisor" ||
      hit.closest?.(".banners")
    );
  }
  function overHudChip(e) {
    return isHudNode(document.elementFromPoint(e.clientX, e.clientY));
  }
  function isPlacingNode(hit) {
    return !!(hit && (hit.id === "placing" || hit.closest?.("#placing")));
  }
  function leavingToPlacing(e) {
    if (isPlacingNode(e?.relatedTarget)) return true;
    const x = Number.isFinite(e?.clientX) ? e.clientX : lastPtr?.clientX;
    const y = Number.isFinite(e?.clientY) ? e.clientY : lastPtr?.clientY;
    if (Number.isFinite(x) && Number.isFinite(y) && isPlacingNode(document.elementFromPoint(x, y))) return true;
    return false;
  }
  function gripCell(cell) {
    if (cell && Number.isFinite(cell.x) && Number.isFinite(cell.z)) {
      state.aim = { x: cell.x, z: cell.z };
    }
  }
  function mapFrozen() {
    return !!(
      city.digest ||
      isFocusing() ||
      performance.now() < (window.__veilUntil || 0) ||
      document.body.classList.contains("recap-hold")
    );
  }
  function tapSlop() {
    return phoneCam() ? 10 : 8;
  }
  function noteMove(e) {
    if (!down) return;
    if (lastMove) pathLen += Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y);
    lastMove = { x: e.clientX, y: e.clientY };
    const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    if (pathLen > tapSlop() || dist > tapSlop() || (phoneCam() && dt > 220 && pathLen > 4)) {
      dragged = true;
      clearTimeout(hold);
    }
  }
  watchCamera(() => {
    if (down && pathLen > 3) dragged = true;
    if (looking || touchFingers >= 2) dragged = true;
  });

  function armLook() {
    looking = true;
    lookedUntil = performance.now() + 800;
    clearTimeout(hold);
    if (stroke) {
      endStroke(city);
      setOrbitLock(false);
      stroke = null;
    }
    down = null;
    dragged = true;
    pathLen = 99;
    lastMove = null;
    window.__inputHeld = false;
    ui.whyChip?.(null);
  }
  function stillLooking() {
    return looking || touchFingers >= 2 || pointers.size >= 2 || performance.now() < lookedUntil;
  }

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
    const idle = valid ? ghostUtilHint(city, cell.x, cell.z, state.tool) : null;
    setGhost(state.tool, cell.x, cell.z, valid, state.facing, !!idle);
    ui.hint(cell, valid);
    if (chipHold || mapFrozen()) {
      ui.whyChip?.(null);
      return;
    }
    const chip = !valid
      ? placeBlockReason(city, cell.x, cell.z, state.tool)
      : idle;
    if (chip) {
      if (ui.whyAtCell) ui.whyAtCell(chip, cell, e?.clientX, e?.clientY);
      else ui.whyChip?.(chip, e?.clientX, e?.clientY);
    } else ui.whyChip?.(null);
  }

  function refreshWorld(terrain = false) {
    if (terrain) buildTerrain(city);
    rebuildCityMeshes(city);
    tick(city);
    ui.refresh();
  }

  function pullingCable(t) {
    return !!(t && t.cable && isPaved(t.kind));
  }

  function toastCablePulled() {
    ui.toast("Cable pulled. The street stays.");
  }

  function pickWorkCell(e, aimed) {
    const ground = pickCell(e);
    const built = pickBuilding(e);
    if (state.tool !== "bulldoze") return ground;
    const from = aimed && inBounds(aimed.x, aimed.z) ? aimed : null;
    const fromTile = from ? tileAt(city, from.x, from.z) : null;
    const groundTile = ground ? tileAt(city, ground.x, ground.z) : null;
    if (pullingCable(fromTile)) {
      if (!ground || (ground.x === from.x && ground.z === from.z)) return from;
      const a = cellToScreen(from.x, from.z);
      const g = ground ? cellToScreen(ground.x, ground.z) : null;
      if (a && g) {
        const da = Math.hypot(e.clientX - a.x, e.clientY - a.y);
        const dg = Math.hypot(e.clientX - g.x, e.clientY - g.y);
        if (da <= dg + 6) return from;
      } else {
        const ortho = ground && Math.abs(ground.x - from.x) + Math.abs(ground.z - from.z) === 1;
        if (ortho && (!groundTile?.kind || isPaved(groundTile.kind))) return from;
      }
    }
    if (pullingCable(groundTile)) return ground;
    if (built) {
      const bt = tileAt(city, built.x, built.z);
      if (pullingCable(bt)) return built;
    }
    return ground || from || built || null;
  }

  function toastDemoStroke(cells, n) {
    if (n <= 0) return false;
    if (cells.every((c) => c.demo && c.kind === "cable")) {
      toastCablePulled();
      return true;
    }
    if (n > 1) {
      ui.toast(`${n} lots.`);
      return true;
    }
    const kind = cells[0]?.kind;
    if (isPaved(kind)) {
      const lost = countLostAccess(city);
      ui.toast(lost ? `Demolished. ${lost} lots lost the main road.` : "Demolished.");
    } else ui.toast("Demolished.");
    return true;
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      lastPtr = e;
      noteMove(e);
    },
    { passive: true }
  );

  canvas.addEventListener("pointerleave", (e) => {
    if (stroke) return;
    if (leavingToPlacing(e)) return;
    state.hover = null;
    state.aim = null;
    syncGhost();
  });

  canvas.addEventListener("pointermove", (e) => {
    lastPtr = e;
    chipHold = false;
    if (mapFrozen() || overHudChip(e)) {
      ui.whyChip?.(null);
      return;
    }
    state.hover = pickCell(e);
    gripCell(state.hover);
    if (stillLooking()) return;
    if (stroke && state.hover) {
      const dist = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0;
      if (!dragged && dist < tapSlop()) {
        syncGhost(e);
        return;
      }
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
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 || touchFingers >= 2) {
      armLook();
      return;
    }
    if (document.body.classList.contains("menu-open")) {
      ui.setMenu?.(false);
      window.__veilUntil = Math.max(window.__veilUntil || 0, performance.now() + 400);
      down = null;
      dragged = false;
      pathLen = 0;
      lastMove = null;
      window.__inputHeld = false;
      return;
    }
    if (mapFrozen() || overHudChip(e)) {
      down = null;
      dragged = false;
      pathLen = 0;
      lastMove = null;
      window.__inputHeld = false;
      ui.whyChip?.(null);
      return;
    }
    window.__pointerKind = e.pointerType || "mouse";
    const aimed = state.aim ? { x: state.aim.x, z: state.aim.z } : null;
    state.hover = pickCell(e);
    gripCell(state.hover);
    syncGhost(e);
    dragged = false;
    pathLen = 0;
    lastMove = { x: e.clientX, y: e.clientY };
    const work = pickWorkCell(e, aimed);
    down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now(), cell: work };
    window.__inputHeld = true;
    clearTimeout(hold);
    if (!state.tool && ui.recapWaiting?.()) {
      return;
    }
    if (e.button === 2) {
      return;
    }
    if (e.button === 0 && state.tool && paintsAsLine(state.tool) && !phoneCam()) {
      const cell = work;
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
        } else {
          ui.toast(placeBlockReason(city, cell.x, cell.z, state.tool) || "Cannot build there.");
        }
      }
    }
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      hold = setTimeout(() => {
        if (!down || stroke) return;
        const ev = { clientX: down.x, clientY: down.y };
        const cell = down.cell || pickBuilding(ev) || pickCell(ev);
        const existing = cell ? tileAt(city, cell.x, cell.z) : null;
        if (existing?.kind) {
          const kind = existing.kind;
          const pulled = pullingCable(existing);
          demolish(city, cell.x, cell.z);
          if (state.selected && state.selected.x === cell.x && state.selected.z === cell.z) {
            state.selected = null;
            ui.inspect(null);
          }
          refreshWorld(isInfra(kind));
          if (pulled) toastCablePulled();
          else if (isPaved(kind)) {
            const lost = countLostAccess(city);
            ui.toast(lost ? `Demolished. ${lost} lots lost the main road.` : "Demolished.");
          } else ui.toast("Demolished.");
        }
        down = null;
      }, 520);
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    pointers.delete(e.pointerId);
    window.__inputHeld = false;
    if (stillLooking()) {
      lookedUntil = Math.max(lookedUntil, performance.now() + 500);
      if (pointers.size === 0 && touchFingers === 0) looking = false;
      down = null;
      dragged = false;
      pathLen = 0;
      lastMove = null;
      return;
    }
    if (city.digest) {
      down = null;
      dragged = false;
      pathLen = 0;
      lastMove = null;
      ui.refresh?.();
      return;
    }
    if (mapFrozen() || overHudChip(e)) {
      if (stroke) {
        const cells = city._stroke || [];
        const n = endStroke(city);
        setOrbitLock(false);
        stroke = null;
        toastDemoStroke(cells, n);
      }
      down = null;
      dragged = false;
      pathLen = 0;
      lastMove = null;
      ui.whyChip?.(null);
      return;
    }
    clearTimeout(hold);
    noteMove(e);
    const dist = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0;
    const dt = down ? performance.now() - down.t : 0;
    if (phoneCam() && (pathLen > 8 || dist > 10 || dt > 240)) dragged = true;
    else if (dist > tapSlop()) dragged = true;
    const tapMs = phoneCam() ? 240 : 500;
    const click = !!(down && !dragged && dist < tapSlop() && dt < tapMs);
    const button = down ? down.button : e.button;
    const pressed =
      down?.cell && inBounds(down.cell.x, down.cell.z) ? { x: down.cell.x, z: down.cell.z } : null;
    down = null;
    dragged = false;
    pathLen = 0;
    lastMove = null;
    if (stroke) {
      const cells = city._stroke || [];
      const n = endStroke(city);
      setOrbitLock(false);
      stroke = null;
      if (n > 0) {
        chipHold = true;
        ui.whyChip?.(null);
        syncGhost(e);
        ui.refresh();
        toastDemoStroke(cells, n);
        return;
      }
    }
    if (!click) return;
    if (!state.tool && ui.openHeldRecap?.()) return;

    if (button === 2) {
      const cell = pressed || pickBuilding(e) || pickCell(e);
      const existing = cell ? tileAt(city, cell.x, cell.z) : null;
      if (existing?.kind) {
        const kind = existing.kind;
        const pulled = pullingCable(existing);
        demolish(city, cell.x, cell.z);
        if (state.selected && state.selected.x === cell.x && state.selected.z === cell.z) {
          state.selected = null;
          ui.inspect(null);
        }
        refreshWorld(isInfra(kind));
        if (pulled) toastCablePulled();
        else if (isPaved(kind)) {
          const lost = countLostAccess(city);
          ui.toast(lost ? `Demolished. ${lost} lots lost the main road.` : "Demolished.");
        }
      }
      return;
    }
    if (button !== 0) return;

    const cell = pressed || pickCell(e);
    if (state.tool) {
      if (!cell || !inBounds(cell.x, cell.z)) return;
      if (state.tool !== "bulldoze" && city.treasury < DEFS[state.tool].cost) {
        ui.toast("Not enough in the treasury.");
        return;
      }
      const target = tileAt(city, cell.x, cell.z);
      const pullCable = pullingCable(target);
      const ok = place(city, cell.x, cell.z, state.tool, state.facing);
      if (ok) {
        state.selected = null;
        ui.inspect(null);
        refreshWorld(isInfra(state.tool) || state.tool === "cable" || state.tool === "bulldoze");
        if (state.tool === "bulldoze") {
          if (pullCable) toastCablePulled();
          else ui.toast("Demolished.");
        }
        if (state.tool === "cable") {
          ui.toast(
            ghostUtilHint(city, cell.x, cell.z, "cable") ||
              "Cable. It only carries a line from an Exchange — no wireless."
          );
        }
        if (state.tool === "exchange") {
          ui.toast(
            ghostUtilHint(city, cell.x, cell.z, "exchange") ||
              "Exchange. Paint Cable along the street to the houses."
          );
        }
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
          ui.toast(isWaterfront(city, cell.x, cell.z) ? "Smoke on the cove. The catch will thin." : "The plant lights lots in range, then a little along those streets.");
        }
        if (state.tool === "cistern") {
          ui.toast(
            ghostUtilHint(city, cell.x, cell.z, "cistern") ||
              "The tower waters lots in range while the plant is lit. Too far, and it serves nobody."
          );
        }
        if (state.tool === "sewer") {
          ui.toast(isWaterfront(city, cell.x, cell.z) ? "Outfall on the promenade. Visitors will leave." : "The works serve lots in range. Keep the outfall off the cove.");
        }
        chipHold = true;
        ui.whyChip?.(null);
        syncGhost(e);
        const spec = DEFS[state.tool];
        const flavor =
          state.tool === "pier" ||
          state.tool === "shop" ||
          state.tool === "market" ||
          state.tool === "warehouse" ||
          state.tool === "power" ||
          state.tool === "cistern" ||
          state.tool === "sewer" ||
          state.tool === "cable" ||
          state.tool === "exchange";
        if (!flavor && spec && state.tool !== "road" && state.tool !== "cobble" && state.tool !== "bulldoze") {
          ui.toast(`${spec.label}.`);
        }
      } else {
        const why = placeBlockReason(city, cell.x, cell.z, state.tool) || "Cannot build there.";
        ui.toast(why);
        if (ui.whyAtCell) ui.whyAtCell(why, cell, e.clientX, e.clientY);
        else ui.whyChip?.(why, e.clientX, e.clientY);
      }
      return;
    }

    const built = pickBuilding(e);
    if (built) {
      state.selected = tileAt(city, built.x, built.z);
      ui.inspect(state.selected);
      return;
    }
    if (!cell || !inBounds(cell.x, cell.z)) return;

    state.selected = tileAt(city, cell.x, cell.z);
    ui.inspect(state.selected);
  });

  canvas.addEventListener("pointercancel", (e) => {
    if (e?.pointerId != null) pointers.delete(e.pointerId);
    if (pointers.size === 0 && touchFingers === 0) looking = false;
    else lookedUntil = Math.max(lookedUntil, performance.now() + 500);
    if (stroke) {
      endStroke(city);
      setOrbitLock(false);
      stroke = null;
    }
    down = null;
    dragged = false;
    pathLen = 0;
    lastMove = null;
    window.__inputHeld = false;
    clearTimeout(hold);
  });
  canvas.addEventListener(
    "touchstart",
    (e) => {
      touchFingers = e.touches?.length || 0;
      if (touchFingers >= 2) armLook();
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      touchFingers = e.touches?.length || 0;
      if (touchFingers >= 2) armLook();
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchend",
    (e) => {
      touchFingers = e.touches?.length || 0;
      if (looking || touchFingers >= 1) lookedUntil = Math.max(lookedUntil, performance.now() + 500);
      if (touchFingers === 0 && pointers.size === 0) looking = false;
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchcancel",
    (e) => {
      touchFingers = e.touches?.length || 0;
      lookedUntil = Math.max(lookedUntil, performance.now() + 500);
      if (touchFingers === 0 && pointers.size === 0) looking = false;
    },
    { passive: true }
  );
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
      state.hover = null;
      state.aim = null;
      setGhost(null);
      ui.setTool(null);
      ui.inspect(null);
    } else if ((e.key === "Delete" || e.key === "Backspace") && state.selected) {
      const kind = state.selected.kind;
      const pulled = pullingCable(state.selected);
      if (demolish(city, state.selected.x, state.selected.z)) {
        state.selected = null;
        ui.inspect(null);
        refreshWorld(isInfra(kind));
        if (pulled) toastCablePulled();
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
    if (!state.tool || stroke) return;
    if (mapFrozen()) {
      ui.whyChip?.(null);
      return;
    }
    if (lastPtr) {
      const hit = document.elementFromPoint(lastPtr.clientX, lastPtr.clientY);
      const onHud =
        hit &&
        hit !== canvas &&
        hit.id !== "view" &&
        hit.id !== "pointer-veil" &&
        hit.id !== "ghost-why";
      if (onHud) {
        if (!(hit.id === "placing" || hit.closest?.("#placing"))) ui.whyChip?.(null);
        return;
      }
      state.hover = pickCell(lastPtr);
      gripCell(state.hover);
    }
    syncGhost(lastPtr);
  };
}
