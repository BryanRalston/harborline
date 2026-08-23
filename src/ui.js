import { DEFS, TOOLS, refundFor } from "./buildings.js";
import { LOAD, capacityHomes, ghostUtilHint, plantWhyIdle } from "./utilities.js";
import { bondOffer, canPlace, creditScore, demolish, hasRoadAccess, idx, isInfra, isPaved, pickLegalLot, placeBlockReason, reopenLot, takeLoan, tileAt, undoLast, upgradeLot } from "./city.js";
import { buildLabel, finishLine, isBuilt, rushBuild, rushCost } from "./construction.js";
import { contractProgress, inspectLocal, skipContract, LAWS, toggleLaw, tick } from "./economy.js";
import { clearSave, hasSave, loadCity, saveCity } from "./save.js";
import { applyQuality, buildTerrain, cellToScreen, DEVICE, focusCell, rebuildCityMeshes, refreshOverlay, setDayNight, setGhost, setGhostDamping, setOrbitLock, setOverlayMode, setRangeHalo } from "./render.js";
import { gfxPref } from "./device.js";

const ICONS = {
  road: '<svg viewBox="0 0 24 24"><path d="M9 3v18M15 3v18M12 8v.01M12 12v.01M12 16v.01"/></svg>',
  cobble: '<svg viewBox="0 0 24 24"><path d="M4 7h6v5H4zM14 7h6v5h-6zM9 12h6v5H9zM4 17h6v4H4zM14 17h6v4h-6z"/></svg>',
  park: '<svg viewBox="0 0 24 24"><path d="M12 20V11M7 20h10M12 11c-4-1-5-5-3-8 4 1 6 4 6 7 2-1 4 1 3 3-3 1-5-1-6-2z"/></svg>',
  house: '<svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5V20H4zM10 20v-6h4v6"/></svg>',
  apartment: '<svg viewBox="0 0 24 24"><path d="M6 21V5h12v16M9 8h.01M12 8h.01M15 8h.01M9 12h.01M12 12h.01M15 12h.01"/></svg>',
  tower: '<svg viewBox="0 0 24 24"><path d="M8 22V4h8v18M8 8h8M8 13h8M8 18h8"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M4 10h16v10H4zM4 10l1.2-5h13.6L20 10M8 14h8"/></svg>',
  office: '<svg viewBox="0 0 24 24"><path d="M5 21V4h9v17M14 9h5v12M8 8h.01M11 8h.01M8 12h.01M11 12h.01"/></svg>',
  warehouse: '<svg viewBox="0 0 24 24"><path d="M3 20V10l9-6 9 6v10H3zM9 20v-6h6v6"/></svg>',
  factory: '<svg viewBox="0 0 24 24"><path d="M3 21V10l6 4V10l6 4V8l6 3v10H3z"/></svg>',
  hospital: '<svg viewBox="0 0 24 24"><path d="M4 21V5h16v16M12 8v8M8 12h8"/></svg>',
  clinic: '<svg viewBox="0 0 24 24"><path d="M5 21V8h14v13M12 11v6M9 14h6"/></svg>',
  school: '<svg viewBox="0 0 24 24"><path d="M3 10 12 5l9 5-9 5-9-5zM6 12v5c3 2 9 2 12 0v-5"/></svg>',
  civic: '<svg viewBox="0 0 24 24"><path d="M4 20h16M6 20V10h12v10M12 4l9 6H3z"/></svg>',
  fire: '<svg viewBox="0 0 24 24"><path d="M12 3c2 4-1 5 1 8 2 2 4 3 4 6a5 5 0 0 1-10 0c0-3 3-5 3-8 0-2 1-4 2-6z"/></svg>',
  pier: '<svg viewBox="0 0 24 24"><path d="M3 11h18M6 11v8M12 11v8M18 11v8M3 19h18"/></svg>',
  market: '<svg viewBox="0 0 24 24"><path d="M4 10h16l-1 10H5zM4 10l2-5h12l2 5M8 14v3M12 14v3M16 14v3"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M4 20V11l5 3V10l6 4V9l5 3v8H4zM14 4l-2 5h3l-4 7"/></svg>',
  cistern: '<svg viewBox="0 0 24 24"><path d="M8 20V9h8v11M7 9c0-4 10-4 10 0M10 20h4"/></svg>',
  sewer: '<svg viewBox="0 0 24 24"><path d="M4 18h16M6 18V10h4v8M14 18V8h4v10M8 8a3 3 0 1 0 0-2M16 6a3 3 0 1 0 0-2"/></svg>',
  cable: '<svg viewBox="0 0 24 24"><path d="M4 12h16M7 9v6M12 9v6M17 9v6"/></svg>',
  exchange: '<svg viewBox="0 0 24 24"><path d="M5 20V8h14v12M9 12h6M9 16h6M8 8V5h8v3"/></svg>',
  bulldoze: '<svg viewBox="0 0 24 24"><path d="M4 15h11l3-4h2v8H4zM7 15V9h4"/></svg>',
};

function money(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
}

function clockLabel(h) {
  const hr = Math.floor(((h % 24) + 24) % 24);
  const min = Math.floor((h - Math.floor(h)) * 60);
  const am = hr < 12;
  const h12 = hr % 12 || 12;
  return `${h12}:${String(min).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

export function createUI(city, state, onReset) {
  const hero = document.getElementById("hero-img");
  if (hero) hero.src = `${import.meta.env.BASE_URL}assets/env/hero.jpg`;
  const rail = document.getElementById("tools");
  rail.innerHTML = "";
  const GROUPS = [
    { id: "street", label: "Street", tools: ["road", "cobble", "bulldoze"] },
    { id: "harbor", label: "Harbor", tools: ["pier", "market"] },
    { id: "homes", label: "Homes", tools: ["house", "apartment", "tower", "park"] },
    { id: "work", label: "Work", tools: ["shop", "office", "warehouse", "factory"] },
    { id: "mains", label: "Mains", tools: ["power", "cistern", "sewer", "exchange", "cable"] },
    { id: "civic", label: "Civic", tools: ["clinic", "school", "hospital", "fire", "civic"] },
  ];
  const tabs = document.createElement("div");
  tabs.className = "rail-tabs";
  const body = document.createElement("div");
  body.className = "rail-body";
  const fold = document.createElement("button");
  fold.type = "button";
  fold.id = "rail-fold";
  fold.textContent = "Hide tools";
  function syncFold() {
    const shut = document.body.classList.contains("rail-shut");
    const name = state.tool && DEFS[state.tool] ? DEFS[state.tool].label : "";
    fold.textContent = shut ? (name ? `Show · ${name}` : "Show tools") : "Hide tools";
  }
  let foldFromPtr = 0;
  function toggleFold() {
    document.body.classList.toggle("rail-shut");
    syncFold();
    holdCanvas(700);
    swallowLeftover(800);
  }
  fold.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    holdCanvas(700);
  });
  fold.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    foldFromPtr = performance.now();
    toggleFold();
  });
  fold.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() - foldFromPtr < 450) return;
    toggleFold();
  });
  rail.appendChild(fold);
  rail.appendChild(tabs);
  rail.appendChild(body);
  let openGroup = "street";
  function setOpen(id) {
    openGroup = id;
    for (const g of GROUPS) {
      const head = tabs.querySelector(`[data-group="${g.id}"]`);
      const pack = body.querySelector(`[data-pack="${g.id}"]`);
      const on = g.id === id;
      head?.classList.toggle("on", on);
      pack?.classList.toggle("shut", !on);
    }
    syncPlacing();
  }
  function groupFor(toolId) {
    return GROUPS.find((g) => g.tools.includes(toolId))?.id || "street";
  }
  for (const g of GROUPS) {
    const head = document.createElement("button");
    head.type = "button";
    head.className = g.id === "street" ? "rail-head on" : "rail-head";
    head.dataset.group = g.id;
    head.textContent = g.label;
    head.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      setOpen(g.id);
    });
    head.addEventListener("click", (e) => {
      e.preventDefault();
      setOpen(g.id);
    });
    tabs.appendChild(head);
    const wrap = document.createElement("div");
    wrap.className = g.id === "street" ? "rail-pack" : "rail-pack shut";
    wrap.dataset.pack = g.id;
    for (const id of g.tools) {
      if (!DEFS[id]) continue;
      const spec = DEFS[id];
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.tool = id;
      b.innerHTML = `${ICONS[id] || ""}<span class="t-copy"><span class="t-name">${spec.label}</span><span class="t-cost">${money(spec.cost)}</span></span>`;
      b.addEventListener("click", () => {
        state.tool = state.tool === id ? null : id;
        setTool(state.tool);
      });
      wrap.appendChild(b);
    }
    body.appendChild(wrap);
  }
  function markChrome(e) {
    if (e.target?.id === "view") return;
    holdCanvas(320);
  }
  rail.addEventListener("pointerdown", markChrome);
  document.querySelector(".dock")?.addEventListener("pointerdown", markChrome);
  document.getElementById("coach")?.addEventListener("pointerdown", markChrome);

  const splashCoach = document.getElementById("splash-coach");
  if (splashCoach) {
    splashCoach.textContent = DEVICE.touch
      ? "Drag to pan. Two-finger looks. Tap to build. Gold lots by the dock are the landfall."
      : "Right-click to look. Left-click to build. Gold lots by the dock are the landfall.";
  }
  const begin = document.getElementById("btn-begin");
  const fresh = document.getElementById("btn-fresh");
  if (hasSave()) {
    if (begin) begin.textContent = "Continue.";
    fresh?.classList.remove("hidden");
  }
  begin?.addEventListener("click", () => {
    document.getElementById("splash").classList.add("gone");
    maybeCoach(false);
  });
  fresh?.addEventListener("click", () => {
    const week = Math.floor((city.tickCount || 0) / 20);
    if (hasSave() && !window.confirm(`Abandon this harbor at week ${week}?`)) return;
    clearSave();
    onReset();
    document.getElementById("splash").classList.add("gone");
    sessionStorage.removeItem("harborline-coach");
    maybeCoach(true);
    toast("A new harbor.");
  });
  document.getElementById("day").addEventListener("input", (e) => {
    city.dayAuto = false;
    city.time = Number(e.target.value);
    setDayNight(city.time);
    syncTransport();
    refresh();
  });
  document.getElementById("tax").addEventListener("input", (e) => {
    city.taxRate = Number(e.target.value);
    syncTransport();
    refresh();
  });
  document.getElementById("btn-auto").addEventListener("click", () => {
    city.dayAuto = !city.dayAuto;
    syncTransport();
  });
  document.getElementById("btn-pause").addEventListener("click", () => {
    city.paused = !city.paused;
    syncTransport();
  });
  document.querySelectorAll(".speeds button").forEach((b) => {
    b.addEventListener("click", () => {
      city.speed = Number(b.dataset.speed);
      syncTransport();
    });
  });
  function gfxLabel() {
    const pref = gfxPref();
    const fps = window.__harbor?.perf?.().fps;
    const tag = pref === "auto" ? `auto/${DEVICE.quality}` : DEVICE.quality;
    return fps ? `Gfx ${tag} · ${fps}` : `Gfx ${tag}`;
  }
  const gfxBtn = document.getElementById("btn-gfx");
  if (gfxBtn) {
    gfxBtn.textContent = gfxLabel();
    gfxBtn.addEventListener("click", () => {
      const order = ["auto", "high", "mid", "low"];
      const cur = gfxPref();
      const next = order[(Math.max(0, order.indexOf(cur)) + 1) % order.length];
      applyQuality(next);
      gfxBtn.textContent = gfxLabel();
      toast(`Graphics ${next}${next === "auto" ? ` (${DEVICE.quality})` : ""}.`);
    });
  }
  let overlay = null;
  function digestOpen() {
    return !!city.digest && !document.getElementById("digest")?.classList.contains("hidden");
  }
  function restoreWash() {
    setOverlayMode(overlay || toolOverlay(state.tool));
    refreshOverlay(city);
  }
  function closeInspect() {
    document.getElementById("inspect")?.classList.remove("show");
    state.selected = null;
    setRangeHalo(null);
    restoreWash();
    setChrome();
  }
  function setChrome() {
    const menuEl = document.getElementById("city-menu");
    const menuOn = !!(menuEl && !menuEl.classList.contains("hidden"));
    const inspectOn = !!document.getElementById("inspect")?.classList.contains("show");
    const sheetOn = ["books", "laws", "log"].some((id) => document.getElementById(id)?.classList.contains("show"));
    document.body.classList.toggle("menu-open", menuOn);
    document.body.classList.toggle("inspect-open", inspectOn);
    document.body.classList.toggle("sheet-open", sheetOn);
    document.body.classList.toggle("digest-open", digestOpen());
  }
  function closeSheets() {
    document.getElementById("books")?.classList.remove("show");
    document.getElementById("laws")?.classList.remove("show");
    document.getElementById("log")?.classList.remove("show");
    document.getElementById("btn-books")?.classList.remove("on");
    document.getElementById("btn-laws")?.classList.remove("on");
    document.getElementById("btn-log")?.classList.remove("on");
    setChrome();
  }
  function maybeCoach(force) {
    const el = document.getElementById("coach");
    if (!el) return;
    if (city.digest) return;
    if (!force && sessionStorage.getItem("harborline-coach")) return;
    const copy = document.getElementById("coach-copy");
    if (copy) {
      copy.textContent = DEVICE.touch
        ? "Drag to pan. Two-finger looks. Tap to build. Gold lots by the dock are the landfall. Recaps live in Menu and Log after week 4."
        : "Right-click look. Left-click build. Gold lots by the dock are the landfall. Recaps live in Menu and Log after week 4.";
    }
    el.classList.remove("hidden");
  }
  document.getElementById("coach-ok")?.addEventListener("click", () => {
    document.getElementById("coach")?.classList.add("hidden");
    sessionStorage.setItem("harborline-coach", "1");
  });
  function toolOverlay(id) {
    if (!id) return null;
    if (id === "power" || id === "cistern" || id === "sewer" || id === "exchange" || id === "cable") return "mains";
    if (id === "road" || id === "cobble") return "landfall";
    if (id === "bulldoze") return null;
    return "place:" + id;
  }
  const MAP_LEGEND = {
    mains: "Mains. Gold street is live copper. Brown is dead. Red lots still need plants.",
    access: "Access. Green has a road. Red is cut off.",
    pollution: "Smoke. Darker lots are fouled.",
    value: "Value. Blue is worth more.",
    cover: "Care. School, clinic, and fire range.",
    traffic: "Jam. Green flows. Red is packed.",
  };
  const MAP_DOCK = {
    mains: "Mains · gold live copper · brown dead · red still dark",
    access: "Access · green has a road · red is cut off",
    pollution: "Smoke · darker is fouled",
    value: "Value · blue is worth more",
    cover: "Care · school, clinic, and fire",
    traffic: "Jam · green flows · red is packed",
  };
  function setMap(mode) {
    overlay = overlay === mode ? null : mode;
    setOverlayMode(overlay || toolOverlay(state.tool));
    refreshOverlay(city);
    document.getElementById("map-access").classList.toggle("on", overlay === "access");
    document.getElementById("map-pollution").classList.toggle("on", overlay === "pollution");
    document.getElementById("map-value").classList.toggle("on", overlay === "value");
    document.getElementById("map-cover")?.classList.toggle("on", overlay === "cover");
    document.getElementById("map-traffic")?.classList.toggle("on", overlay === "traffic");
    document.getElementById("map-mains")?.classList.toggle("on", overlay === "mains");
    setMenu(false);
    if (overlay && MAP_LEGEND[overlay]) toast(MAP_LEGEND[overlay]);
    hint(state.hover, false);
  }
  document.getElementById("map-access").addEventListener("click", () => setMap("access"));
  document.getElementById("map-pollution").addEventListener("click", () => setMap("pollution"));
  document.getElementById("map-value").addEventListener("click", () => setMap("value"));
  document.getElementById("map-cover")?.addEventListener("click", () => setMap("cover"));
  document.getElementById("map-traffic")?.addEventListener("click", () => setMap("traffic"));
  document.getElementById("map-mains")?.addEventListener("click", () => setMap("mains"));
  function renderLaws() {
    const panel = document.getElementById("laws");
    if (!panel) return;
    const on = city.laws || {};
    panel.innerHTML =
      `<h3>Laws</h3><p>Ordinances for the harbor.</p>` +
      LAWS.map((l) => {
        const active = !!on[l.id];
        return `<button type="button" class="law${active ? " on" : ""}" data-law="${l.id}">${l.label}${active ? " · on" : ""}<small>${l.cost} · ${l.blurb}</small></button>`;
      }).join("");
    panel.querySelectorAll("button.law").forEach((b) => {
      b.addEventListener("click", () => {
        toggleLaw(city, b.dataset.law);
        renderLaws();
        refresh();
        const spec = LAWS.find((l) => l.id === b.dataset.law);
        toast(city.laws[b.dataset.law] ? `${spec.label} is in force.` : `${spec.label} repealed.`);
      });
    });
  }
  function toggleLaws() {
    if (city.digest) dismissDigest();
    const panel = document.getElementById("laws");
    const on = !panel.classList.contains("show");
    closeSheets();
    closeInspect();
    panel.classList.toggle("show", on);
    document.getElementById("btn-laws")?.classList.toggle("on", on);
    if (on) {
      setMenu(false);
      renderLaws();
    }
    setChrome();
  }
  const menuBtn = document.getElementById("btn-menu");
  const menu = document.getElementById("city-menu");
  function setMenu(on) {
    if (on) {
      if (city.digest) dismissDigest();
      closeSheets();
      closeInspect();
      document.getElementById("coach")?.classList.add("hidden");
    }
    menu?.classList.toggle("hidden", !on);
    menuBtn?.classList.toggle("on", !!on);
    setChrome();
  }
  let menuFromPointer = 0;
  function toggleMenu() {
    setMenu(menu.classList.contains("hidden"));
  }
  menuBtn?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    menuFromPointer = performance.now();
    toggleMenu();
  });
  menuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (performance.now() - menuFromPointer < 450) return;
    toggleMenu();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu || menu.classList.contains("hidden")) return;
    if (menu.contains(e.target) || menuBtn.contains(e.target)) return;
    setMenu(false);
    holdCanvas(400);
  });
  document.addEventListener("click", (e) => {
    if (!menu || menu.classList.contains("hidden")) return;
    if (menu.contains(e.target) || menuBtn.contains(e.target)) return;
    setMenu(false);
    holdCanvas(400);
  });
  document.getElementById("btn-laws")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLaws();
  });
  function recapBody(recap) {
    if (!recap) return "";
    return (
      `${recap.people || ""}${recap.people ? ". " : ""}${recap.cash || ""}${recap.cash ? "." : ""}` +
      `${recap.verdict ? " " + recap.verdict : ""}` +
      `${Number.isFinite(recap.mood) ? ` Mood ${recap.mood}%.` : ""}` +
      `${recap.commute ? ` Commute ${recap.commute} min.` : ""}` +
      `${recap.extra ? ` ${recap.extra}` : ""}` +
      `${recap.nudge ? ` ${recap.nudge}` : ""}`
    );
  }
  function renderLog() {
    const panel = document.getElementById("log");
    if (!panel || !panel.classList.contains("show")) return;
    const recap = city.lastDigest;
    const waiting = recapWaiting();
    const pin = recap
      ? `<li class="log-recap${waiting ? " log-recap-wait" : ""}"${waiting ? ' data-open-recap="1"' : ""}><span>${waiting ? "Recap waiting" : "Last recap"} · W${recap.week}</span>${recapBody(recap)}</li>`
      : waiting
        ? `<li class="log-recap log-recap-wait" data-open-recap="1"><span>Recap waiting</span>Tap to read the week.</li>`
        : "";
    const rows =
      pin + ((city.log || []).map((ev) => `<li><span>W${ev.week}</span>${ev.msg}</li>`).join("") || (pin ? "" : "<li>No events yet.</li>"));
    panel.innerHTML = `<h3>Harbor log</h3><ul class="log-list">${rows}</ul>`;
    panel.querySelector("[data-open-recap]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openHeldRecap();
    });
  }
  function toggleLog() {
    if (city.digest) dismissDigest();
    const panel = document.getElementById("log");
    const on = !panel.classList.contains("show");
    closeSheets();
    closeInspect();
    panel.classList.toggle("show", on);
    document.getElementById("btn-log")?.classList.toggle("on", on);
    document.getElementById("btn-log-dock")?.classList.toggle("on", on);
    if (on) {
      setMenu(false);
      recapUnread = false;
      city.recapUnread = false;
      if (recapWaiting()) city.recapDue = false;
      renderLog();
    }
    setChrome();
    if (on) refresh();
  }
  document.getElementById("btn-log")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLog();
  });
  document.getElementById("btn-log-dock")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLog();
  });
  function openRecapMenu() {
    toggleLog();
  }
  document.getElementById("btn-recap")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openRecapMenu();
  });
  function renderBooks() {
    const panel = document.getElementById("books");
    const s = city.stats || {};
    const rows = [
      ["Wages", money(s.wageTax || 0)],
      ["Property", money(s.property || 0)],
      ["Shops", money(s.commerce || 0)],
      ["Trade", money((s.trade || s.pierBonus || 0) + (s.shipping || 0))],
      ["Tourism", money(s.tourism || 0)],
      ["Catch health", `${Math.round((s.harborHealth || 1) * 100)}%`],
      ["Dock mix", (s.mix || 0) > 0.55 ? "Freight" : (s.mix || 0) < 0.35 ? "Visitors" : "Split"],
      ["Power", `${Math.round(s.powerLoad || 0)} / ${Math.round(s.powerCap || 0)}`],
      ["Water", `${Math.round(s.waterLoad || 0)} / ${Math.round(s.waterCap || 0)}`],
      ["Works", `${Math.round(s.sewerLoad || 0)} / ${Math.round(s.sewerCap || 0)}`],
      ["Line", `${Math.round(s.internetUsed || 0)} / ${Math.round(s.internetCap || 0)}`],
      ["Upkeep", money(s.upkeep || 0)],
      ["Bond left", s.loanTicks ? `${s.loanTicks} ticks` : "None"],
      ["Commute", s.commute ? `${s.commute} min` : "—"],
      ["Jammed streets", String(s.congested || 0)],
      ["Smoke levy", money(s.levy || 0)],
      ["Credit", `${creditScore(city)} / 99`],
    ];
    const recap = city.lastDigest;
    if (recap) {
      const waiting = recapWaiting();
      rows.unshift([
        waiting ? "Recap waiting" : "Last recap",
        `W${recap.week} · ${recap.verdict || recap.people || "filed"}${Number.isFinite(recap.mood) ? ` · mood ${recap.mood}%` : ""}`,
      ]);
    } else if (recapWaiting()) {
      rows.unshift(["Recap waiting", "Open Log to read it"]);
    }
    panel.innerHTML = `<h3>Books</h3><dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  }
  function toggleBooks() {
    if (city.digest) dismissDigest();
    const panel = document.getElementById("books");
    const on = !panel.classList.contains("show");
    closeSheets();
    closeInspect();
    panel.classList.toggle("show", on);
    document.getElementById("btn-books")?.classList.toggle("on", on);
    if (on) {
      setMenu(false);
      if (recapWaiting()) city.recapDue = false;
      renderBooks();
    }
    setChrome();
    if (on) refresh();
  }
  document.getElementById("btn-books")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBooks();
  });
  document.getElementById("btn-loan").addEventListener("click", () => {
    if ((city.loanTicks || 0) > 0) {
      toast(`${city.loanTicks} payments left on the bond.`);
      return;
    }
    const amt = bondOffer(city);
    if (!takeLoan(city)) {
      toast(amt ? "A bond is already open." : "Credit is too weak for a bond.");
      return;
    }
    refresh();
    toast(`Bond issued: ${money(city.lastBond || amt)}.`);
  });
  document.getElementById("btn-undo").addEventListener("click", () => {
    const undone = undoLast(city);
    if (!undone) {
      toast("Nothing to undo.");
      return;
    }
    if (undone.infra) buildTerrain(city);
    rebuildCityMeshes(city);
    refresh();
    toast("Undone.");
  });
  document.getElementById("btn-save").addEventListener("click", () => {
    saveCity(city);
    toast("City saved.");
  });
  document.getElementById("btn-load").addEventListener("click", () => {
    if (loadCity(city)) {
      city.digest = null;
      document.getElementById("digest")?.classList.add("hidden");
      buildTerrain(city);
      rebuildCityMeshes(city);
      setDayNight(city.time);
      inspect(null);
      refresh();
      syncTransport();
      toast("City loaded.");
    } else toast("No save yet.");
  });
  function bindHudTap(el, fn) {
    if (!el) return;
    let fromPtr = 0;
    el.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      fromPtr = performance.now();
      fn();
    });
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (performance.now() - fromPtr < 450) return;
      fn();
    });
  }
  bindHudTap(document.getElementById("stat-money")?.parentElement, () => toggleBooks());
  document.getElementById("stat-money")?.parentElement?.setAttribute("title", "Books");
  bindHudTap(document.getElementById("stat-week")?.parentElement, () => setMenu(true));
  document.getElementById("stat-week")?.parentElement?.setAttribute("title", "Jobs, mood, hour");
  bindHudTap(document.getElementById("stat-pop")?.parentElement, () => setMenu(true));
  document.getElementById("stat-pop")?.parentElement?.setAttribute("title", "Jobs, mood, hour");
  document.getElementById("contract")?.addEventListener("click", () => {
    if (!city.contract) return;
    if (!window.confirm(`Pass on “${city.contract.label}” for $250?`)) return;
    skipContract(city);
    refresh();
    toast("Passed. New job posted.");
  });
  let digestTimer = 0;
  let logNeedUntil = 0;
  let pendingFile = false;
  let swallowUntil = 0;
  let recapHoldUntil = 0;
  let inspectTouchUntil = 0;
  let recapArmUntil = 0;
  let recapUnread = false;
  const recapPtr = { x: 0, y: 0, seen: false };
  const leftoverTypes = [
    "pointerdown",
    "pointerup",
    "pointermove",
    "pointerover",
    "pointerenter",
    "click",
    "auxclick",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchend",
  ];
  window.addEventListener(
    "pointermove",
    (e) => {
      recapPtr.x = e.clientX;
      recapPtr.y = e.clientY;
      recapPtr.seen = true;
    },
    { passive: true }
  );
  function leftoverMap(t) {
    if (!t || t === document || t === window || t === document.body || t === document.documentElement) return true;
    if (t.id === "view" || t.id === "ghost-why" || t.id === "pointer-veil") return true;
    return !!t.closest?.("#view");
  }
  function leftoverEat(e) {
    if (performance.now() >= swallowUntil) return;
    if (!leftoverMap(e.target)) return;
    whyChip(null);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
  function swallowLeftover(ms = 1100, recap = false) {
    swallowUntil = Math.max(swallowUntil, performance.now() + ms);
    window.__veilUntil = Math.max(window.__veilUntil || 0, swallowUntil);
    if (recap) {
      recapHoldUntil = Math.max(recapHoldUntil, swallowUntil);
      document.body.classList.add("recap-hold");
    }
    whyChip(null);
    if (!swallowLeftover._on) {
      swallowLeftover._on = true;
      for (const t of leftoverTypes) window.addEventListener(t, leftoverEat, { capture: true, passive: false });
    }
    clearTimeout(swallowLeftover._t);
    const wait = Math.max(0, swallowUntil - performance.now()) + 40;
    swallowLeftover._t = setTimeout(() => {
      if (performance.now() < swallowUntil) {
        swallowLeftover(0, recap);
        return;
      }
      if (performance.now() >= recapHoldUntil) document.body.classList.remove("recap-hold");
      whyChip(null);
      if (!swallowLeftover._on) return;
      for (const t of leftoverTypes) window.removeEventListener(t, leftoverEat, { capture: true });
      swallowLeftover._on = false;
    }, wait);
  }
  function holdCanvas(ms = 280) {
    window.__veilUntil = Math.max(window.__veilUntil || 0, performance.now() + ms);
  }
  function pointerOnRecap() {
    const box = document.getElementById("digest");
    if (!box || box.classList.contains("hidden")) return false;
    if (!recapPtr.seen) return true;
    const hit = document.elementFromPoint(recapPtr.x, recapPtr.y);
    if (!hit) return true;
    return hit === box || box.contains(hit) || hit.id === "pointer-veil";
  }
  function armPointerVeil(ms = 2000) {
    window.__veilUntil = performance.now() + ms;
    const veil = document.getElementById("pointer-veil");
    const view = document.getElementById("view");
    if (veil) {
      veil.classList.remove("hidden");
      veil.setAttribute("aria-hidden", "false");
    }
    if (view) view.style.pointerEvents = "none";
    state.selected = null;
    document.getElementById("inspect")?.classList.remove("show");
    setOrbitLock(true);
    clearTimeout(armPointerVeil._t);
    armPointerVeil._t = setTimeout(() => {
      veil?.classList.add("hidden");
      veil?.setAttribute("aria-hidden", "true");
      if (view) view.style.pointerEvents = "";
      if (!city.digest) setOrbitLock(false);
    }, ms);
  }
  function keepLastDigest(src) {
    if (!src) return;
    city.lastDigest = {
      week: src.week,
      people: src.people || "",
      cash: src.cash || "",
      mood: src.mood,
      verdict: src.verdict || "",
      extra: src.extra || "",
      commute: src.commute,
      nudge: src.nudge || "",
    };
  }
  function cardFromLast(src) {
    if (!src) return null;
    return {
      week: src.week,
      people: src.people || "",
      cash: src.cash || "",
      mood: src.mood,
      verdict: src.verdict || "",
      extra: src.extra || "",
      commute: src.commute,
      nudge: src.nudge || "",
      held: true,
    };
  }
  function dismissDigest(fromAuto) {
    const had = city.digest;
    if (had) {
      keepLastDigest(had);
      armPointerVeil(2000);
      swallowLeftover(900, true);
    }
    city.digest = null;
    city.recapDue = false;
    pendingFile = false;
    document.getElementById("digest")?.classList.add("hidden");
    document.body.classList.remove("digest-open");
    clearTimeout(digestTimer);
    const ok = document.getElementById("digest-ok");
    if (ok) {
      ok.textContent = "Continue";
      delete ok.dataset.counting;
    }
    if (fromAuto && had) {
      toast("Week recap is in Log.");
      pulseLog(2400);
    }
  }
  function fileRecap(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const t = e?.target;
    if (performance.now() < recapArmUntil && t && t.id !== "digest-ok" && !t.closest?.("#digest-ok")) return;
    dismissDigest();
    if (resumeTool && DEFS[resumeTool]) {
      const id = resumeTool;
      resumeTool = null;
      state.tool = id;
      setTool(id);
    } else resumeTool = null;
    maybeCoach(false);
  }
  document.getElementById("digest")?.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (!city.digest) return;
    if (performance.now() < recapArmUntil) return;
    pendingFile = true;
    armPointerVeil(2000);
  });
  document.getElementById("digest")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    if (!pendingFile && e.target?.id !== "digest-ok" && !e.target?.closest?.("#digest-ok")) return;
    pendingFile = false;
    fileRecap(e);
  });
  document.getElementById("digest-ok")?.addEventListener("click", fileRecap);
  function eatVeil(e) {
    e.preventDefault();
    e.stopPropagation();
    if (pendingFile) {
      pendingFile = false;
      fileRecap(e);
    }
  }
  document.getElementById("pointer-veil")?.addEventListener("pointerdown", eatVeil);
  document.getElementById("pointer-veil")?.addEventListener("pointerup", eatVeil);
  document.getElementById("pointer-veil")?.addEventListener("click", eatVeil);
  document.getElementById("btn-new").addEventListener("click", (e) => {
    e.stopPropagation();
    if (city.digest) {
      dismissDigest();
      toast("Recap is in Log. New Harbor is still in Menu if you mean it.");
      return;
    }
    const week = Math.floor((city.tickCount || 0) / 20);
    if (!window.confirm(`Abandon this harbor at week ${week}?`)) return;
    clearSave();
    onReset();
    document.getElementById("splash").classList.remove("gone");
  });

  let resumeTool = null;
  function recapWaiting() {
    if (city.digest) return false;
    if (Math.floor((city.tickCount || 0) / 20) < 4) return false;
    return !!city.recapDue;
  }
  function pulseLog(ms = 2400) {
    logNeedUntil = Math.max(logNeedUntil, performance.now() + ms);
  }
  function fileWaitChip() {
    if (!recapWaiting()) return false;
    holdCanvas(900);
    swallowLeftover(1100, true);
    whyChip(null);
    recapUnread = true;
    city.recapUnread = true;
    city.recapDue = false;
    pulseLog(2400);
    toast("Week recap is in Log.");
    refresh();
    return true;
  }
  function armRecapAutoFile() {
    if (armRecapAutoFile._on) return;
    armRecapAutoFile._on = true;
    clearTimeout(armRecapAutoFile._t);
    armRecapAutoFile._t = setTimeout(() => {
      armRecapAutoFile._on = false;
      fileWaitChip();
    }, 20000);
  }
  function openRecapLog() {
    holdCanvas(800);
    swallowLeftover(1000, true);
    whyChip(null);
    recapUnread = false;
    city.recapUnread = false;
    const log = document.getElementById("log");
    if (log && !log.classList.contains("show")) toggleLog();
    else {
      if (recapWaiting()) city.recapDue = false;
      renderLog();
      refresh();
    }
  }
  function openHeldRecap() {
    if (city.digest) {
      recapArmUntil = performance.now() + 800;
      refresh();
      return true;
    }
    if (!recapWaiting()) return false;
    if (state.tool) resumeTool = state.tool;
    state.tool = null;
    setTool(null);
    if (!city.lastDigest) {
      city.holdRecap = true;
      tick(city);
      if (!city.lastDigest) tick(city);
    }
    city.digest = cardFromLast(city.lastDigest);
    if (city.digest) city.digest.held = true;
    city.holdRecap = true;
    recapArmUntil = performance.now() + 800;
    refresh();
    return !!city.digest;
  }
  function syncPlacing() {
    const el = document.getElementById("placing");
    if (!el) return;
    const inRow = !!(state.tool && groupFor(state.tool) === openGroup);
    const on = inRow && !city.digest;
    el.classList.toggle("hidden", !on);
    if (on) {
      const name = DEFS[state.tool]?.label || "tool";
      el.textContent =
        state.tool === "cable"
          ? DEVICE.phone || innerWidth <= 820
            ? `Placing: ${name} · tap a street`
            : `Placing: ${name} · click a street or drag`
          : DEVICE.phone || innerWidth <= 820
            ? `Placing: ${name} · tap to find a lot`
            : `Placing: ${name} · click an empty lot`;
    }
  }
  function findPlaceable(kind) {
    const grip = state.hover || state.aim;
    if (
      grip &&
      canPlace(city, grip.x, grip.z, kind) &&
      city.treasury >= (DEFS[kind]?.cost || 0)
    ) {
      return { x: grip.x, z: grip.z };
    }
    return pickLegalLot(city, kind, city.treasury);
  }
  function setTool(id) {
    if (!id && state.tool && !city.digest && recapWaiting()) resumeTool = state.tool;
    for (const el of rail.querySelectorAll("button[data-tool]")) {
      el.classList.toggle("on", el.dataset.tool === id);
    }
    document.body.classList.toggle("tool-armed", !!id);
    if (DEVICE.phone || innerWidth <= 820) {
      document.body.classList.toggle("rail-shut", !!id || !!resumeTool || !!city.digest);
      if (id) {
        holdCanvas(700);
        swallowLeftover(800);
      }
    }
    if (id) {
      setOpen(groupFor(id));
      document.getElementById("coach")?.classList.add("hidden");
      city.seen = city.seen || {};
      city.seen.coach = true;
      if (id === "house" || id === "apartment" || id === "tower") city.seen.homesFullAck = true;
    } else if (city.digest) {
      refresh();
    }
    if (!overlay) {
      setOverlayMode(toolOverlay(id));
      refreshOverlay(city);
    }
    syncPlacing();
    setGhostDamping(!!id);
    if (!id || !state.hover) state.aim = null;
    const cell = state.hover;
    if (!id || !cell) {
      setGhost(null);
      hint(null, false, null, id);
    } else {
      const valid = canPlace(city, cell.x, cell.z, id) && city.treasury >= (DEFS[id]?.cost || 0);
      const idle = valid ? ghostUtilHint(city, cell.x, cell.z, id) : null;
      setGhost(id, cell.x, cell.z, valid, state.facing || 0, !!idle);
      if (idle) whyAtCell(idle, cell);
      else if (!valid) whyAtCell(placeBlockReason(city, cell.x, cell.z, id), cell);
      else whyChip(null);
      hint(cell, valid, null, id);
    }
    syncFold();
  }
  document.getElementById("advisor")?.addEventListener("click", () => {
    if (city.digest) fileRecap();
    const msg = document.getElementById("advisor")?.textContent || "";
    if (/Raise an Exchange|needs an Exchange|dead copper/i.test(msg)) {
      state.tool = "exchange";
      setTool("exchange");
      toast("Exchange — then click Cable along the street. No wireless.");
      return;
    }
    if (/cable on the avenue|paint Cable|click Cable|Run Cable|no cable/i.test(msg)) {
      state.tool = "cable";
      setTool("cable");
      toast("Cable — click a street or drag along it from the Exchange.");
      return;
    }
    if (/Homes are full|zone more houses/i.test(msg)) {
      city.seen = city.seen || {};
      city.seen.homesFullAck = true;
      state.tool = "house";
      setTool("house");
      toast("Rowhouse. Zone inland of the beach.");
      return;
    }
    if (/plant is full/i.test(msg)) {
      state.tool = "power";
      setTool("power");
      toast("Plant — another inland. The last one is full.");
      return;
    }
    if (/tower is full/i.test(msg)) {
      state.tool = "cistern";
      setTool("cistern");
      toast("Water tower — another on the avenue. The last one is full.");
      return;
    }
    if (/works are full/i.test(msg)) {
      state.tool = "sewer";
      setTool("sewer");
      toast("Works — another inland. The last one is full.");
      return;
    }
    if (/Pave the landfall|Road or Cobble/i.test(msg)) {
      if (state.tool === "road" || state.tool === "cobble") {
        state.tool = "market";
        setTool("market");
        toast("Harbor → Market. After the gold lots are paved.");
        return;
      }
      state.tool = "road";
      setTool("road");
      toast("Road — gold lots are the landfall. Tap again for Market.");
      return;
    }
    if (/Harbor → Market|fish market|Market/i.test(msg)) {
      if (state.tool === "market") {
        state.tool = "road";
        setTool("road");
        toast("Road first if the landfall is still dirt.");
        return;
      }
      state.tool = "market";
      setTool("market");
      toast("Market — on the landfall, not the sand.");
      return;
    }
    const arm = [
      [/shop/i, "shop", "Shop along the avenue."],
      [/pier|berth/i, "pier", "Pier — push into the harbor."],
      [/workplace|offices, or the harbor/i, "shop", "Shop — or Harbor for jobs."],
      [/warehouse|cargo dock/i, "warehouse", "Warehouse on the landfall."],
      [/plant inland|kerosene|lights are failing|range of a plant/i, "power", "Plant inland of the cove."],
      [/water tower|wells are dry|tower is dry/i, "cistern", "Water tower on the avenue."],
      [/works inland|privy|outfall/i, "sewer", "Works inland of the cove."],
      [/school/i, "school", "School near the houses."],
      [/clinic|hospital/i, "clinic", "Clinic."],
      [/park or a school|lift mood/i, "park", "Park."],
    ];
    for (const [re, id, note] of arm) {
      if (re.test(msg) && DEFS[id]) {
        state.tool = id;
        setTool(id);
        toast(note);
        return;
      }
    }
  });

  function syncTransport() {
    document.getElementById("btn-pause").textContent = city.paused ? "Play" : "Pause";
    document.getElementById("btn-pause").classList.toggle("on", city.paused);
    document.getElementById("btn-auto").classList.toggle("on", city.dayAuto);
    document.getElementById("day").value = String(city.time);
    const hourMenu = document.getElementById("menu-hour");
    if (hourMenu) hourMenu.textContent = clockLabel(city.time);
    const tax = Number.isFinite(city.taxRate) ? city.taxRate : 1;
    document.getElementById("tax").value = String(tax);
    document.getElementById("tax-lbl").textContent = `${Math.round(tax * 100)}%`;
    document.querySelectorAll(".speeds button").forEach((b) => {
      b.classList.toggle("on", Number(b.dataset.speed) === city.speed);
    });
  }

  function refresh() {
    const s = city.stats;
    if (gfxBtn) gfxBtn.textContent = gfxLabel();
    const cash = document.getElementById("stat-money");
    const net = (s.income || 0) - (s.upkeep || 0);
    const netLabel = (net >= 0 ? "+" : "") + money(net);
    cash.textContent = `${money(city.treasury)}  ${netLabel}`;
    cash.classList.toggle("bad", city.treasury < 0 || net < 0);
    document.getElementById("stat-pop").textContent =
      `${Math.round(s.pop)} / ${Math.round(s.popCap)}`;
    document.getElementById("stat-jobs").textContent =
      `${Math.round(s.jobs)} / ${Math.round(s.jobCap)}`;
    document.getElementById("stat-happy").textContent = `${Math.round(s.happiness)}%`;
    document.getElementById("stat-clock").textContent = clockLabel(city.time);
    const jobsMenu = document.getElementById("menu-jobs");
    const moodMenu = document.getElementById("menu-mood");
    const hourMenu = document.getElementById("menu-hour");
    if (jobsMenu) jobsMenu.textContent = `${Math.round(s.jobs)} / ${Math.round(s.jobCap)}`;
    if (moodMenu) moodMenu.textContent = `${Math.round(s.happiness)}%`;
    if (hourMenu) hourMenu.textContent = clockLabel(city.time);
    const weekEl = document.getElementById("stat-week");
    if (weekEl) weekEl.textContent = String(s.week || 0);
    const eta = document.getElementById("recap-eta");
    if (eta) {
      const week = Math.floor((city.tickCount || 0) / 20);
      const due = Number.isFinite(city.nextRecapTick) ? city.nextRecapTick : 80;
      const dueWeek = Math.max(4, Math.floor(due / 20));
      if (week < 4) eta.textContent = "recap 4";
      else if (city.digest) eta.textContent = "recap now";
      else if (city.recapDue || city.tickCount >= due) eta.textContent = "recap due";
      else eta.textContent = `recap ${dueWeek}`;
    }
    document.getElementById("warn").classList.toggle("hidden", !city.bankruptWarn);
    const demand = s.demand || {};
    for (const key of ["home", "work", "shop", "port", "visit", "freight", "edu", "health", "power", "water", "sewer", "internet"]) {
      const el = document.querySelector(`#demand [data-d="${key}"] i`);
      if (el) el.style.setProperty("--p", `${Math.round((demand[key] || 0) * 100)}%`);
    }
    const adv = document.getElementById("advisor");
    if (adv) {
      let copy = s.advisor || "";
      if (state.tool === "house" && /Homes are full|Tap this chip for Rowhouse/i.test(copy)) {
        copy = "Rowhouse is armed. Tap a glowing empty lot inland of the beach.";
      }
      adv.textContent = copy;
    }
    const con = document.getElementById("contract");
    if (con) {
      const c = s.contract;
      if (!c) con.textContent = "";
      else {
        const prog = contractProgress(c, s);
        const lastLabel = c.weeks <= 1 ? "Last week · " : c.weeks <= 2 ? "2 wk left · " : "";
        const phone = DEVICE.phone || innerWidth <= 820;
        con.textContent = phone
          ? `${lastLabel}${c.label}${prog ? ` · ${prog}` : ""} · ${c.weeks} wk · pass`
          : `${lastLabel}${c.label}${prog ? ` · ${prog}` : ""} · ${c.weeks} wk · win $${c.reward.toLocaleString("en-US")} · pass job −$250`;
      }
      con.classList.toggle("urgent", !!(c && c.weeks <= 2));
    }
    const bud = document.getElementById("budget");
    if (bud && s) {
      const loan = s.loanTicks ? ` · bond ${s.loanTicks}` : "";
      bud.textContent = `In ${money(s.income || 0)} · out ${money(s.upkeep || 0)}${loan}`;
    }
    const loanBtn = document.getElementById("btn-loan");
    if (loanBtn) {
      const offer = bondOffer(city);
      loanBtn.classList.toggle("on", (city.loanTicks || 0) > 0);
      if ((city.loanTicks || 0) > 0) loanBtn.textContent = `Bond ${city.loanTicks}`;
      else loanBtn.textContent = offer ? `Bond $${Math.round(offer / 1000)}k` : "No credit";
    }
    const d = s.demand || {};
    for (const el of rail.querySelectorAll("button[data-tool]")) {
      const id = el.dataset.tool;
      const spec = DEFS[id];
      el.classList.toggle("poor", !!(spec && spec.cost > 0 && city.treasury < spec.cost));
      const need =
        (d.home > 0.62 && (id === "house" || id === "apartment" || id === "tower")) ||
        (d.work > 0.62 && (id === "office" || id === "warehouse" || id === "factory")) ||
        (d.shop > 0.62 && id === "shop") ||
        (d.port > 0.62 && (id === "pier" || id === "market")) ||
        (d.freight > 0.72 && id === "warehouse") ||
        (d.edu > 0.18 && id === "school") ||
        (d.health > 0.18 && (id === "hospital" || id === "clinic")) ||
        (d.power > 0.35 && id === "power") ||
        (d.water > 0.35 && id === "cistern") ||
        (d.sewer > 0.35 && id === "sewer") ||
        (d.internet > 0.35 && (id === "cable" || id === "exchange")) ||
        ((city.stats?.fires || 0) < 1 && ((city.stats?.factories || 0) > 0 || (city.stats?.plants || 0) > 0) && id === "fire");
      el.classList.toggle("need", need);
    }
    for (const g of GROUPS) {
      const head = tabs.querySelector(`[data-group="${g.id}"]`);
      const pack = body.querySelector(`[data-pack="${g.id}"]`);
      const hungry = !!(pack && pack.querySelector("button.need"));
      head?.classList.toggle("need", hungry);
    }
    if (city.events && city.events.length) {
      const msg = city.events.shift();
      if (msg) toast(msg);
    }
    if (!city.lastDigest) {
      recapUnread = false;
      city.recapUnread = false;
    } else if (city.recapUnread) recapUnread = true;
    const waitEl = document.getElementById("recap-wait");
    const waiting = recapWaiting();
    const showWait = waiting || recapUnread;
    waitEl?.classList.toggle("hidden", !showWait);
    waitEl?.classList.toggle("recap-dot", !waiting && recapUnread);
    if (waiting && waitEl) {
      waitEl.textContent = "Recap waiting — tap to read";
      waitEl.setAttribute("aria-label", "Recap waiting — tap to read");
    } else if (recapUnread && waitEl) {
      waitEl.textContent = "Recap waiting — tap to read";
      waitEl.setAttribute("aria-label", "Week recap is in Log. Tap to read.");
    }
    if (waiting) armRecapAutoFile();
    else {
      armRecapAutoFile._on = false;
      clearTimeout(armRecapAutoFile._t);
    }
    const recapBtn = document.getElementById("btn-recap");
    if (recapBtn) {
      recapBtn.textContent = waiting ? "Recap due" : recapUnread ? "Recap in Log" : "Recap";
      recapBtn.classList.toggle("need", waiting || recapUnread);
    }
    const logNeed = waiting || recapUnread || performance.now() < logNeedUntil;
    document.getElementById("btn-log-dock")?.classList.toggle("need", logNeed);
    document.getElementById("btn-log")?.classList.toggle("need", logNeed);
    syncPlacing();
    if (city.digest) {
      const box = document.getElementById("digest");
      if (box && box.classList.contains("hidden")) {
        setMenu(false);
        closeSheets();
        document.getElementById("inspect")?.classList.remove("show");
        state.selected = null;
        document.getElementById("coach")?.classList.add("hidden");
        document.getElementById("ghost-why")?.classList.add("hidden");
        waitEl?.classList.add("hidden");
        document.body.classList.add("digest-open");
        setOrbitLock(true);
        document.getElementById("digest-title").textContent = `Week ${city.digest.week}`;
        document.getElementById("digest-body").textContent =
          `${city.digest.people}. ${city.digest.cash}.` +
          (city.digest.verdict ? ` ${city.digest.verdict}` : "") +
          ` Mood ${city.digest.mood}%.` +
          (city.digest.commute ? ` Commute ${city.digest.commute} min.` : "") +
          (city.digest.extra ? ` ${city.digest.extra}` : "") +
          (city.digest.nudge ? ` ${city.digest.nudge}` : "");
        const hint = document.getElementById("digest-hint");
        const shown = Number(city.digest.week) || 0;
        const nextWk = shown >= 4 ? shown + 2 : 6;
        if (hint) {
          hint.textContent = `Next recap around week ${nextWk}. This one stays in Log. Continue or Esc files it.`;
        }
        box.classList.remove("hidden");
        setChrome();
        const ok = document.getElementById("digest-ok");
        clearTimeout(digestTimer);
        if ((city.speed || 1) >= 4 && ok && !ok.dataset.counting && !city.digest.held) {
          ok.dataset.counting = "1";
          let remain = 7000;
          const tick = () => {
            if (!city.digest) {
              ok.textContent = "Continue";
              delete ok.dataset.counting;
              return;
            }
            const attending = pointerOnRecap();
            if (!attending) remain -= 200;
            if (remain <= 0) {
              dismissDigest(true);
              return;
            }
            ok.textContent = attending ? "Continue" : `Continue · ${Math.ceil(remain / 1000)}s`;
            digestTimer = setTimeout(tick, 200);
          };
          ok.textContent = pointerOnRecap() ? "Continue" : "Continue · 7s";
          digestTimer = setTimeout(tick, 200);
        } else if (ok && !ok.dataset.counting) ok.textContent = "Continue";
      }
    } else {
      document.getElementById("digest")?.classList.add("hidden");
    }
    if (city.dayAuto) document.getElementById("day").value = String(city.time);
    refreshOverlay(city);
    if (state.selected && !city.digest && performance.now() >= (window.__veilUntil || 0)) inspect(state.selected);
  }

  const inspectPanel = document.getElementById("inspect");
  inspectPanel?.addEventListener(
    "wheel",
    (e) => {
      e.stopPropagation();
      const list = inspectPanel.querySelector("dl");
      if (!list) return;
      list.scrollTop += e.deltaY;
      e.preventDefault();
    },
    { passive: false }
  );
  inspectPanel?.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    inspectTouchUntil = performance.now() + 1400;
    holdCanvas(800);
  });

  function inspectSig(tile) {
    if (!tile) return "";
    return [
      tile.x,
      tile.z,
      tile.kind || "",
      Math.round((tile.build || 1) * 8),
      tile.abandoned ? 1 : 0,
      isBuilt(tile) ? 1 : 0,
      Math.round(tile.servedLoad || 0),
      Math.round(tile.pop || 0),
      Math.round(tile.jobs || 0),
    ].join(":");
  }

  function inspect(tile, force) {
    const panel = document.getElementById("inspect");
    if (!tile || city.digest) {
      panel.classList.remove("show");
      if (!tile) state.selected = null;
      setRangeHalo(null);
      restoreWash();
      setChrome();
      return;
    }
    if (!force && performance.now() < (window.__veilUntil || 0)) {
      if (!panel.classList.contains("show")) state.selected = null;
      return;
    }
    const busy =
      panel.matches(":hover") ||
      panel.matches(":active") ||
      panel.contains(document.activeElement) ||
      performance.now() < inspectTouchUntil;
    const sig = inspectSig(tile);
    if (!force && panel.classList.contains("show") && panel.dataset.sig === sig) return;
    if (!force && busy && panel.classList.contains("show") && panel.dataset.at === `${tile.x},${tile.z}`) {
      if (isBuilt(tile)) {
        const rush = panel.querySelector("#rush-lot");
        if (rush) rush.textContent = "It's up";
        panel.dataset.sig = sig;
      }
      return;
    }
    const scroll = panel.querySelector("dl")?.scrollTop || 0;
    setMenu(false);
    closeSheets();
    document.getElementById("coach")?.classList.add("hidden");
    const info = inspectLocal(city, tile.x, tile.z);
    const spec = tile.kind ? DEFS[tile.kind] : null;
    const title = spec ? spec.label : tile.terrain === "water" ? "Harbor" : "Vacant lot";
    const rows = [];
    rows.push(["Terrain", tile.terrain]);
    if (!spec) {
      if (tile.terrain === "sand" || tile.shoreline) {
        rows.push(["Beach", "Piers only. Build on the landfall."]);
      } else if (info?.waterfront && tile.terrain !== "water") {
        rows.push(["Waterfront", "A shop or market here pulls catch and tourists"]);
      }
      if (info?.suit && tile.terrain !== "water" && tile.terrain !== "sand" && !tile.shoreline) {
        const ranked = [
          ["Homes", info.suit.home],
          ["Shops", info.suit.shop],
          ["Jobs", info.suit.work],
          ["Harbor", info.suit.port],
        ].sort((a, b) => b[1] - a[1]);
        rows.push(["Best here", `${ranked[0][0]} ${Math.round(ranked[0][1] * 100)}%`]);
      }
    }
    if (spec && !isBuilt(tile)) {
      rows.push(["Status", buildLabel(tile.kind, tile.build || 0)]);
      rows.push(["Progress", `${Math.round((tile.build || 0) * 100)}%`]);
      rows.push(["Rush", money(rushCost(tile))]);
    }
    if (spec) {
      if (tile.kind === "road" || tile.kind === "cobble") {
        const live = !!(city.utilities?.liveCable && city.utilities.liveCable.has && city.utilities.liveCable.has(idx(tile.x, tile.z)));
        rows.push([
          "Cable",
          tile.cable
            ? live
              ? "Live — carries a line from the Exchange"
              : "Dead copper — no Exchange on this line"
            : "None — click Cable along this street from an Exchange",
        ]);
      }
      if (spec.pop) {
        rows.push(["Residents", `${tile.pop.toFixed(1)} / ${spec.pop}`]);
        let grow = "Steady";
        if (info && !info.access) grow = "No road";
        else if (tile.pop >= spec.pop - 0.05) grow = "Full";
        else if (city.treasury < 0) grow = "Broke";
        else if (info && info.util && !info.util.watered) grow = "No water";
        else if (info && info.util && !info.util.powered) grow = "No power";
        else if (info && info.pollution > 0.6) grow = "Pollution";
        else if (tile.pop < spec.pop * 0.9) grow = "Growing";
        rows.push(["Households", grow]);
      }
      if (info?.abandoned) rows.push(["Status", "Abandoned — reconnect the road or reopen"]);
      if (info && Number.isFinite(info.value) && info.value > 0) rows.push(["Land value", `${Math.round(info.value * 100)}%`]);
      if (spec.upgrade && DEFS[spec.upgrade]) {
        rows.push(["Upgrade", `${DEFS[spec.upgrade].label} · $${spec.upgradeCost.toLocaleString("en-US")}`]);
      }
      if (info && info.congestion > 0) {
        const jam = info.congestion;
        rows.push(["Traffic", jam > 3.2 ? `Jammed ${jam.toFixed(1)}` : jam > 1.6 ? `Busy ${jam.toFixed(1)}` : jam.toFixed(1)]);
      }
      if (info?.commute && spec.pop) rows.push(["Commute", `${info.commute} min`]);
      if (tile.kind === "school") {
        rows.push(["Seats", `${Math.round(city.stats.kids || 0)} kids / ${city.stats.seats || 0}`]);
      }
      if (tile.kind === "hospital" || tile.kind === "clinic") {
        rows.push(["Beds", `${Math.round((city.stats.pop || 0) * 0.08)} need / ${city.stats.beds || 0}`]);
      }
      if (tile.kind === "fire") {
        rows.push(["Companies", String(city.stats.fires || 1)]);
      }
      if (tile.kind === "market") {
        rows.push(["Catch", "Boats sell here. Tourists still walk the dock."]);
        rows.push(["Trade / tick", money(city.stats?.trade || 0)]);
        rows.push(["Tourism / tick", money(city.stats?.tourism || 0)]);
      }
      if (tile.kind === "pier") {
        rows.push(["Slip", tile.terrain === "water" ? "Berth" : "Landfall"]);
        rows.push(["Harbor", `${city.stats?.berths || 0} berths · ${city.stats?.piers || 0} tiles`]);
        rows.push(["Trade / tick", money(city.stats?.trade || city.stats?.pierBonus || 0)]);
        rows.push(["Tourism / tick", money(city.stats?.tourism || 0)]);
        const mix = city.stats?.mix || 0;
        rows.push(["Dock", mix > 0.55 ? "Freight" : mix < 0.35 ? "Visitors" : "Split — cargo and guests fight"]);
      }
      if (tile.kind === "power") {
        rows.push(["This plant", `${Math.round(tile.servedLoad || 0)} / ${spec.capacity} · ~${capacityHomes("power")} homes`]);
        rows.push(["Town grid", `${Math.round(city.stats?.powerUsed || 0)} / ${Math.round(city.stats?.powerCap || 0)}`]);
        rows.push(["Range", `${spec.radius} lots, then 3 lots off streets inside that ring`]);
        const idle = plantWhyIdle(tile);
        rows.push(["Serving", idle || "Lots in the ring, then a little along those streets"]);
        rows.push(["Note", "Smoke on the cove kills the catch."]);
      }
      if (tile.kind === "cistern") {
        rows.push(["This tower", `${Math.round(tile.servedLoad || 0)} / ${spec.capacity} · ~${capacityHomes("cistern")} homes`]);
        rows.push(["Town mains", `${Math.round(city.stats?.waterUsed || 0)} / ${Math.round(city.stats?.waterCap || 0)}`]);
        rows.push(["Range", `${spec.radius} lots, then 3 lots off streets inside that ring`]);
        rows.push(["Pumps", tile.powered && tile.powerSrc === "mains" ? "Powered" : "Dark — needs a plant in range"]);
        const idle = plantWhyIdle(tile);
        if (idle) rows.push(["Serving", idle]);
      }
      if (tile.kind === "exchange") {
        rows.push(["This exchange", `${Math.round(tile.servedLoad || 0)} / ${spec.capacity} · ~${capacityHomes("exchange")} homes`]);
        rows.push(["Town line", `${Math.round(city.stats?.internetUsed || 0)} / ${Math.round(city.stats?.internetCap || 0)}`]);
        rows.push(["Feed", "Along Cable only — not a radius"]);
        rows.push(["Pumps", tile.powered && tile.powerSrc === "mains" ? "Powered" : "Dark — needs a plant in range"]);
        const idle = plantWhyIdle(tile);
        if (idle) rows.push(["Serving", idle]);
      }
      if (tile.kind === "sewer") {
        rows.push(["This works", `${Math.round(tile.servedLoad || 0)} / ${spec.capacity} · ~${capacityHomes("sewer")} homes`]);
        rows.push(["Town load", `${Math.round(city.stats?.sewerUsed || 0)} / ${Math.round(city.stats?.sewerCap || 0)}`]);
        rows.push(["Range", `${spec.radius} lots, then 3 lots off streets inside that ring`]);
        rows.push(["Outfall", info?.waterfront ? "On the promenade — visitors will leave" : "Inland of the cove"]);
        const idle = plantWhyIdle(tile);
        if (idle) rows.push(["Serving", idle]);
      }
      if (spec.jobs) {
        rows.push(["Jobs", `${tile.jobs.toFixed(1)} / ${spec.jobs}`]);
        if (info) rows.push(["Labor nearby", `${Math.round(info.nearbyPop || 0)}`]);
      }
      rows.push(["Upkeep", `${money(spec.upkeep)} / tick`]);
      rows.push(["Refund", money(tile.starter ? 0 : refundFor(tile.kind))]);
    }
    if (info) {
      rows.push(["Road", info.access ? "Connected" : "No access"]);
      if (info.util) {
        const label = (on, src, off) => {
          if (!on) return off;
          if (src === "mains") return "Mains";
          if (src === "lamp") return "Kerosene";
          if (src === "well") return "Well";
          if (src === "privy") return "Privy";
          return "Yes";
        };
        const u = city.utilities || {};
        const i = idx(tile.x, tile.z);
        const powerOff =
          u.reachPower && u.reachPower.has(i) ? "No slots — the plant is full" : "Dark";
        const waterOff =
          u.reachWater && u.reachWater.has(i) ? "No slots — the tower is full" : "Dry";
        const sewerOff =
          u.reachSewer && u.reachSewer.has(i) ? "No slots — the works are full" : "None";
        rows.push(["Power", label(info.util.powered, info.util.powerSrc, powerOff)]);
        rows.push(["Water", label(info.util.watered, info.util.waterSrc, waterOff)]);
        rows.push(["Sewer", label(info.util.sewered, info.util.sewerSrc, sewerOff)]);
        const net = () => {
          if (info.util.wired && info.util.internetSrc === "line") return "Line";
          let onCopper = false;
          let onLive = false;
          const live = city.utilities?.liveCable;
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const n = tileAt(city, tile.x + dx, tile.z + dz);
            if (!n || !n.cable || (n.kind !== "road" && n.kind !== "cobble")) continue;
            onCopper = true;
            if (live && live.has && live.has(idx(n.x, n.z))) onLive = true;
          }
          if (onLive) return "No ports — the Exchange is full";
          if (onCopper) return "Dead copper — the line does not reach an Exchange";
          return "None";
        };
        rows.push(["Internet", net()]);
      }
      if (info.waterfront) rows.push(["Waterfront", "Yes"]);
      if (spec?.pop) {
        rows.push(["Park", `${Math.round(info.park * 100)}%`]);
        rows.push(["School", `${Math.round(info.edu * 100)}%`]);
        rows.push(["Clinic", `${Math.round(info.health * 100)}%`]);
      }
      if (info.pollution >= 0.05) rows.push(["Pollution", info.pollution.toFixed(2)]);
    }
    const actions =
      (spec && !isBuilt(tile) ? `<button type="button" id="rush-lot">Rush · ${money(rushCost(tile))}</button>` : "") +
      (spec && spec.category !== "infra" && tile.kind !== "bulldoze" ? `<button type="button" id="copy-lot">Build more ${spec.label.toLowerCase()}s</button>` : "") +
      (spec?.upgrade && !tile.abandoned && isBuilt(tile) ? `<button type="button" id="up-lot">Upgrade to ${DEFS[spec.upgrade].label} · $${spec.upgradeCost.toLocaleString("en-US")}</button>` : "") +
      (tile.abandoned && tile.kind ? '<button type="button" id="reopen-lot">Reopen $180</button>' : "") +
      (tile.kind ? '<button type="button" id="demo-lot">Demolish</button>' : `<p class="mute">Choose a tool, then ${DEVICE.touch ? "tap" : "click"} a lot.</p>`);
    panel.innerHTML = `<div class="inspect-head"><h3>${title}</h3><button type="button" id="inspect-close">Close</button></div>
      <p>${tile.x}, ${tile.z}</p>
      <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <div class="inspect-actions">${actions}</div>`;
    panel.dataset.sig = sig;
    panel.dataset.at = `${tile.x},${tile.z}`;
    panel.classList.add("show");
    state.selected = tile;
    if (spec && (tile.kind === "power" || tile.kind === "cistern" || tile.kind === "sewer") && spec.radius) {
      const tint = tile.kind === "cistern" ? 0x4aa6ff : tile.kind === "sewer" ? 0x8ab87a : 0xffd27a;
      setRangeHalo(tile.x, tile.z, spec.radius, tint);
    } else setRangeHalo(null);
    if (tile.kind === "exchange" || (tile.cable && isPaved(tile.kind))) {
      setOverlayMode("mains");
      refreshOverlay(city);
    } else restoreWash();
    setChrome();
    const dl = panel.querySelector("dl");
    if (dl) dl.scrollTop = scroll;
    let closeFromPtr = 0;
    function dismissInspect(e) {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      inspectTouchUntil = 0;
      closeInspect();
      holdCanvas(1100);
      swallowLeftover(1100);
    }
    panel.querySelector("#inspect-close")?.addEventListener("pointerup", (e) => {
      closeFromPtr = performance.now();
      dismissInspect(e);
    });
    panel.querySelector("#inspect-close")?.addEventListener("click", (e) => {
      if (performance.now() - closeFromPtr < 450) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      dismissInspect(e);
    });
    panel.querySelector("#rush-lot")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const lot = tileAt(city, tile.x, tile.z);
      if (isBuilt(lot)) {
        inspect(lot, true);
        toast("It's up.");
        return;
      }
      const fee = rushBuild(city, tile.x, tile.z);
      if (fee) {
        rebuildCityMeshes(city);
        tick(city);
        refresh();
        inspect(tileAt(city, tile.x, tile.z), true);
        const k = lot?.kind;
        const teach =
          k === "power" || k === "cistern" || k === "sewer" || k === "exchange" || k === "market";
        toast(teach ? finishLine({ opened: 1, kinds: [k] }) : `Rushed for ${money(fee)}.`);
      } else if ((lot && city.treasury < rushCost(lot)) || city.treasury < 80) {
        toast("Not enough cash.");
      } else toast("Cannot rush that site.");
    });
    panel.querySelector("#copy-lot")?.addEventListener("click", (e) => {
      e.stopPropagation();
      state.tool = tile.kind;
      setTool(state.tool);
      toast(`${spec.label} tool.`);
    });
    panel.querySelector("#up-lot")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (upgradeLot(city, tile.x, tile.z)) {
        rebuildCityMeshes(city);
        refresh();
        inspect(tileAt(city, tile.x, tile.z), true);
        toast("Upgrade started.");
      } else toast(city.treasury < (spec.upgradeCost || 0) ? "Not enough cash." : "Cannot upgrade that lot.");
    });
    panel.querySelector("#reopen-lot")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (reopenLot(city, tile.x, tile.z)) {
        rebuildCityMeshes(city);
        refresh();
        inspect(tileAt(city, tile.x, tile.z), true);
        toast("Reopened.");
      } else toast(city.treasury < 180 ? "Not enough cash." : "Needs a road on the main network.");
    });
    panel.querySelector("#demo-lot")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const kind = tile.kind;
      if (demolish(city, tile.x, tile.z)) {
        state.selected = null;
        inspect(null);
        if (isInfra(kind)) buildTerrain(city);
        rebuildCityMeshes(city);
        tick(city);
        refresh();
      }
    });
  }

  function whyChip(text, x, y) {
    const el = document.getElementById("ghost-why");
    if (!el) return;
    if (text && document.body.classList.contains("recap-hold")) {
      text = "";
    }
    if (!text) {
      el.textContent = "";
      el.classList.add("hidden");
      return;
    }
    el.textContent = text;
    el.classList.remove("hidden");
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const w = el.offsetWidth || 180;
      const h = el.offsetHeight || 28;
      const above = DEVICE.touch ? y - h - 18 : y + 16;
      el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x + 14))}px`;
      el.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, above))}px`;
    }
  }
  function whyAtCell(text, cell, fallbackX, fallbackY) {
    if (!text || !cell) {
      whyChip(null);
      return;
    }
    const s = cellToScreen(cell.x, cell.z);
    if (s && s.visible) whyChip(text, s.x, s.y);
    else whyChip(text, fallbackX, fallbackY);
  }

  function idleLotStatus(lot) {
    if (!lot?.kind || !DEFS[lot.kind]) return "";
    if (lot.cable && isPaved(lot.kind)) {
      const liveCopper = !!(city.utilities?.liveCable && city.utilities.liveCable.has(idx(lot.x, lot.z)));
      return liveCopper ? "Line" : "Dead copper";
    }
    if (lot.kind === "power" || lot.kind === "cistern" || lot.kind === "sewer" || lot.kind === "exchange") {
      return plantWhyIdle(lot) ? "Idle" : "";
    }
    if (isPaved(lot.kind)) {
      const jam = lot.traffic || 0;
      if (jam > 3.2) return "Jammed";
      if (jam > 1.6) return "Busy";
      return "";
    }
    if (lot.kind === "pier" || lot.kind === "park") return "";
    if (lot.abandoned) return "Abandoned";
    if (!isBuilt(lot)) return "";
    const load = LOAD[lot.kind];
    if (!load) return "";
    const u = city.utilities || {};
    if (load.power && !lot.powered) {
      return u.reachPower && u.reachPower.has(idx(lot.x, lot.z)) ? "No slots" : "Dark";
    }
    if (load.water && !lot.watered) {
      return u.reachWater && u.reachWater.has(idx(lot.x, lot.z)) ? "No slots" : "Dry";
    }
    if (load.internet) {
      if (lot.wired && lot.internetSrc === "line") return "Line";
      let onCopper = false;
      let onLive = false;
      const live = city.utilities?.liveCable;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = tileAt(city, lot.x + dx, lot.z + dz);
        if (!n?.cable || !isPaved(n.kind)) continue;
        onCopper = true;
        if (live && live.has(idx(n.x, n.z))) onLive = true;
      }
      if (onLive) return "No ports";
      if (onCopper) return "Dead copper";
    }
    return "";
  }

  function hint(cell, valid, extra, kind = state.tool) {
    const el = document.getElementById("hint");
    if (!el) return;
    let live = false;
    let tail = "";
    if (extra) {
      el.textContent = extra;
      live = true;
    } else if (!cell || !kind || !DEFS[kind]) {
      const touch = window.__pointerKind === "touch" || (DEVICE.touch && window.__pointerKind !== "mouse");
      const lot = cell ? tileAt(city, cell.x, cell.z) : null;
      if (state.tool && DEFS[state.tool]) {
        el.textContent =
          state.tool === "cable"
            ? "Placing: Cable · click a street or drag along it"
            : state.tool === "road" || state.tool === "cobble" || state.tool === "park" || state.tool === "pier"
              ? `Placing: ${DEFS[state.tool].label} · click or drag`
              : `Placing: ${DEFS[state.tool].label} · tap an empty lot`;
      } else if (lot?.kind && DEFS[lot.kind]) {
        const status = idleLotStatus(lot);
        let line = `${DEFS[lot.kind].label} · ${cell.x},${cell.z}`;
        if (status) line += ` · ${status}`;
        el.textContent = line;
        live = true;
        if (status && status !== "Line") tail = status;
      } else if (overlay === "mains" && lot && lot.terrain !== "water" && !lot.kind) {
        const i = idx(lot.x, lot.z);
        const u = city.utilities || {};
        const bits = [];
        if (u.reachWater && u.reachWater.has(i)) bits.push("water");
        if (u.reachPower && u.reachPower.has(i)) bits.push("power");
        if (u.reachSewer && u.reachSewer.has(i)) bits.push("works");
        el.textContent = bits.length ? `Vacant · ${bits.join(" · ")}` : "Vacant · no mains";
        live = true;
        if (!bits.length) tail = "no mains";
      } else if (overlay === "access" && lot && lot.terrain !== "water" && !lot.kind) {
        const road = hasRoadAccess(city, lot.x, lot.z);
        el.textContent = road ? "Vacant · road" : "Vacant · no road";
        live = true;
        if (!road) tail = "no road";
      } else if (overlay && MAP_DOCK[overlay]) {
        el.textContent = MAP_DOCK[overlay];
        live = true;
      } else if (!city.seen?.coach && (city.tickCount || 0) < 40) {
        el.textContent = touch
          ? "The empty lot by the pier is yours · tap to place · drag to pan"
          : "The empty lot by the pier is yours · LMB build · RMB look";
      } else {
        el.textContent = touch
          ? "Tap to place · drag to pan · two-finger looks"
          : "LMB build · RMB drag look · MMB or WASD pan · wheel zoom";
      }
    } else {
      const why = !valid ? placeBlockReason(city, cell.x, cell.z, kind) : "";
      const idle = valid ? ghostUtilHint(city, cell.x, cell.z, kind) : "";
      tail = why || idle || "";
      el.textContent = `${DEFS[kind].label} · ${cell.x},${cell.z}` + (tail ? ` · ${tail}` : "");
      live = true;
    }
    el.classList.toggle("live", live);
    el.classList.toggle("warn", !!tail);
    document.body.classList.toggle("hint-live", live && (innerWidth <= 820 || DEVICE.phone));
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    const ms = Math.max(3200, 1800 * (city.speed || 1));
    toast._t = setTimeout(() => el.classList.remove("show"), ms);
  }

  document.getElementById("placing")?.addEventListener("pointerup", (e) => {
    e.preventDefault();
    e.stopPropagation();
    holdCanvas(400);
    if (!state.tool || city.digest) return;
    const lot = findPlaceable(state.tool);
    if (!lot) {
      toast("No empty lot for that.");
      return;
    }
    if (focusCell(lot.x, lot.z)) holdCanvas(520);
    state.hover = lot;
    state.aim = { x: lot.x, z: lot.z };
    const valid = canPlace(city, lot.x, lot.z, state.tool) && city.treasury >= (DEFS[state.tool]?.cost || 0);
    setGhost(state.tool, lot.x, lot.z, valid, state.facing || 0, !!(valid && ghostUtilHint(city, lot.x, lot.z, state.tool)));
    hint(lot, valid);
    if (!valid) {
      whyAtCell(placeBlockReason(city, lot.x, lot.z, state.tool), lot);
      toast("Nearest lot still needs a road.");
    } else {
      const idle = ghostUtilHint(city, lot.x, lot.z, state.tool);
      if (idle) {
        whyAtCell(idle, lot);
        toast(idle);
      } else {
        whyChip(null);
        toast("Here — a legal lot.");
      }
    }
  });
  let recapChipPtr = 0;
  document.getElementById("recap-wait")?.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    recapChipPtr = performance.now();
    holdCanvas(800);
    swallowLeftover(1000, true);
    whyChip(null);
  });
  document.getElementById("recap-wait")?.addEventListener("pointerup", (e) => {
    e.preventDefault();
    e.stopPropagation();
    recapChipPtr = performance.now();
    openRecapLog();
  });
  document.getElementById("recap-wait")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() - recapChipPtr < 450) return;
    openRecapLog();
  });

  return { refresh, inspect, hint, whyChip, whyAtCell, toast, setTool, syncTransport, setMap, toggleLaws, toggleBooks, setMenu, fileRecap, recapWaiting, openHeldRecap, findPlaceable, fileWaitChip };
}
