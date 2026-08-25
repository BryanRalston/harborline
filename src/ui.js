import { DEFS, TOOLS, isResidential, refundFor } from "./buildings.js";
import { LOAD, capacityHomes, ghostUtilHint, plantWhyIdle } from "./utilities.js";
import { bondOffer, canPlace, creditScore, demolish, forEachInRadius, hasRoadAccess, idx, inlandCells, isInfra, isPaved, isWaterfront, nextToPier, pickLegalLot, placeBlockReason, refreshRoadNet, reopenLot, takeLoan, tileAt, undoLast, upgradeLot } from "./city.js";
import { buildLabel, finishLine, isBuilt, rushBuild, rushCost } from "./construction.js";
import { contractProgress, inspectLocal, skipContract, LAWS, toggleLaw, tick } from "./economy.js";
import { clearSave, hasSave, loadCity, saveCity } from "./save.js";
import { applyQuality, buildTerrain, cellToScreen, DEVICE, focusCell, focusSite, holdView, playBandBonus, rebuildCityMeshes, refreshOverlay, releaseView, setDayNight, setGhost, setGhostDamping, setOrbitLock, setOverlayMode, setRangeHalo } from "./render.js";
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
  let foldUntil = 0;
  function toggleFold() {
    document.body.classList.toggle("rail-shut");
    if (!document.body.classList.contains("rail-shut")) foldUntil = performance.now() + 8000;
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
  if (DEVICE.phone || innerWidth <= 820) {
    document.body.classList.add("rail-shut");
    syncFold();
  }
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
  let streetWash = false;
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
    releaseView();
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
    if ((DEVICE.phone || innerWidth <= 820) && !state.tool && performance.now() > foldUntil) {
      document.body.classList.add("rail-shut");
      syncFold();
    }
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
      copy.textContent = "Recaps live in Menu and Log after week 4.";
    }
    if (DEVICE.phone || innerWidth <= 820) {
      el.classList.add("hidden");
      sessionStorage.setItem("harborline-coach", "1");
      return;
    }
    el.classList.remove("hidden");
  }
  document.getElementById("coach-ok")?.addEventListener("click", () => {
    document.getElementById("coach")?.classList.add("hidden");
    sessionStorage.setItem("harborline-coach", "1");
  });
  function toolOverlay(id) {
    if (!id) return (city.stats?.markets || 0) < 1 ? "landfall" : null;
    if (id === "exchange" || id === "cable") return "mains";
    if (id === "power" || id === "cistern" || id === "sewer") return "place:" + id;
    if (id === "road" || id === "cobble") return streetWash ? "place:" + id : "landfall";
    if (id === "clinic" || id === "school" || id === "hospital" || id === "fire" || id === "park" || id === "civic") return "cover";
    if (id === "factory") return "pollution";
    if (id === "bulldoze") return null;
    return "place:" + id;
  }
  const MAP_LEGEND = {
    mains: "Mains. Gold street is live copper. Brown is dead. Red lots still need plants.",
    access: "Access. Green has a road. Red is cut off.",
    pollution: "Smoke. Darker lots are fouled.",
    value: "Value. Blue is worth more.",
    cover: "Care. School, clinic, fire, and park range.",
    traffic: "Jam. Green flows. Red is packed.",
  };
  const MAP_DOCK = {
    mains: "Mains · gold live copper · brown dead · red still dark",
    access: "Access · green has a road · red is cut off",
    pollution: "Smoke · darker is fouled",
    value: "Value · blue is worth more",
    cover: "Care · school, clinic, fire, park",
    traffic: "Jam · green flows · red is packed",
  };
  function setMap(mode, force) {
    overlay = !force && overlay === mode ? null : mode;
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
    document.getElementById("btn-loan")?.classList.remove("need");
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
  bindHudTap(document.getElementById("stat-week")?.parentElement, () => {
    if (recapWaiting() || recapUnread) {
      openRecapLog();
      return;
    }
    setMenu(true);
  });
  document.getElementById("stat-week")?.parentElement?.setAttribute("title", "Recap, or Menu");
  bindHudTap(document.getElementById("stat-pop")?.parentElement, () => {
    state.tool = "house";
    setTool("house");
    toast("Rowhouse. Zone inland of the beach.");
  });
  document.getElementById("stat-pop")?.parentElement?.setAttribute("title", "Zone more homes");
  function workJob() {
    let shops = 0;
    let offices = 0;
    let plants = 0;
    for (const t of city.tiles) {
      if (t.kind === "shop") shops += 1;
      if (t.kind === "office") offices += 1;
      if (t.kind === "power") plants += 1;
    }
    if (offices >= 1 && plants < 1) return ["power", "Plant inland. The office is on kerosene."];
    if (shops >= 1) return ["office", "Office. Jobs on the avenue."];
    return ["shop", "Shop — or Harbor for jobs."];
  }
  bindHudTap(document.getElementById("stat-jobs")?.parentElement, () => {
    const [id, note] = workJob();
    armTool(id, note);
  });
  document.getElementById("stat-jobs")?.parentElement?.setAttribute("title", "Add jobs");
  bindHudTap(document.getElementById("stat-happy")?.parentElement, () => {
    if (state.tool === "house" && findPlaceable("house") && city.treasury >= (DEFS.house.cost || 0)) {
      return;
    }
    if ((city.stats?.plants || 0) >= 1 && (city.stats?.cisterns || 0) < 1) {
      armTool("cistern", "Water tower on the avenue. Dry lots sour the town.");
      return;
    }
    if ((city.stats?.cisterns || 0) >= 1 && (city.stats?.works || 0) < 1) {
      armTool("sewer", "Works inland. Privies sour the town.");
      return;
    }
    armTool("park", "Park — lift mood, or cut the smoke.");
  });
  document.getElementById("stat-happy")?.parentElement?.setAttribute("title", "Lift mood");
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
  let swallowAt = null;
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
    if (swallowAt && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      if (Math.hypot(e.clientX - swallowAt.x, e.clientY - swallowAt.y) > 64) return;
    }
    whyChip(null);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
  function swallowLeftover(ms = 1100, recap = false, at) {
    swallowUntil = Math.max(swallowUntil, performance.now() + ms);
    if (arguments.length >= 3) {
      swallowAt =
        at && Number.isFinite(at.x) && Number.isFinite(at.y) ? { x: at.x, y: at.y } : { x: -1, y: -1 };
    } else if (ms > 0) {
      swallowAt = null;
      window.__veilUntil = Math.max(window.__veilUntil || 0, swallowUntil);
    }
    if (recap) {
      swallowAt = null;
      window.__veilUntil = Math.max(window.__veilUntil || 0, swallowUntil);
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
      swallowAt = null;
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
      const phone = DEVICE.phone || innerWidth <= 820;
      const gripped = !!(state.aim || state.hover);
      const next = findPlaceable(state.tool);
      const cost = DEFS[state.tool]?.cost || 0;
      el.textContent =
        state.tool === "cable"
          ? phone
            ? `Placing: ${name} · tap a street`
            : `Placing: ${name} · click a street or drag`
          : !next && cost > city.treasury
            ? `Need ${money(cost)} for a ${name.toLowerCase()}`
            : !next
              ? `No empty lot for a ${name.toLowerCase()}`
          : gripped
            ? phone
              ? `Placing: ${name} · tap this lot`
              : `Placing: ${name} · click this lot`
            : phone
              ? `Placing: ${name} · tap to find a lot`
              : `Placing: ${name} · click an empty lot`;
    }
  }
  function findPlaceable(kind) {
    const grip = state.hover || state.aim;
    const home = kind === "house" || kind === "apartment" || kind === "tower";
    const lot = grip ? tileAt(city, grip.x, grip.z) : null;
    const beach =
      grip &&
      home &&
      (nextToPier(city, grip.x, grip.z) ||
        isWaterfront(city, grip.x, grip.z) ||
        inlandCells(grip.x, grip.z) < 3 ||
        lot?.terrain === "sand" ||
        !!lot?.shoreline);
    if (
      grip &&
      !beach &&
      canPlace(city, grip.x, grip.z, kind) &&
      city.treasury >= (DEFS[kind]?.cost || 0)
    ) {
      return { x: grip.x, z: grip.z };
    }
    if (
      (kind === "road" || kind === "cobble") &&
      (city.stats?.markets || 0) >= 1 &&
      !pickLegalLot(city, "house", city.treasury, playBandBonus)
    ) {
      const street = findInlandStreet();
      if (street) return street;
    }
    return pickLegalLot(city, kind, city.treasury, playBandBonus);
  }
  function onMainStreet(x, z) {
    if (!city.roadMain || city.roadMain.size === 0) refreshRoadNet(city);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nb = tileAt(city, x + dx, z + dz);
      if (nb && isPaved(nb.kind) && city.roadMain.has(idx(nb.x, nb.z))) return true;
    }
    return false;
  }
  function wouldUnlockHouse(rx, rz) {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = rx + dx;
      const z = rz + dz;
      const t = tileAt(city, x, z);
      if (!t || t.kind) continue;
      if (
        nextToPier(city, x, z) ||
        isWaterfront(city, x, z) ||
        inlandCells(x, z) < 3 ||
        t.terrain === "sand" ||
        t.shoreline
      ) {
        continue;
      }
      const why = placeBlockReason(city, x, z, "house");
      if (why && /Needs a road/i.test(why)) return true;
    }
    return false;
  }
  function findInlandStreet() {
    if (city.treasury < (DEFS.road?.cost || 0)) return null;
    refreshRoadNet(city);
    let houseX = 0;
    let houseZ = 0;
    let hn = 0;
    for (const t of city.tiles) {
      if (t.kind !== "house") continue;
      houseX += t.x;
      houseZ += t.z;
      hn += 1;
    }
    if (hn) {
      houseX = houseX / hn;
      houseZ = houseZ / hn;
    }
    const lot = pickLegalLot(city, "road", city.treasury, (x, z) => {
      let n = playBandBonus(x, z);
      const inland = inlandCells(x, z);
      if (nextToPier(city, x, z) || isWaterfront(city, x, z) || inland < 4) n -= 1e6;
      n += Math.min(200, Math.round(Math.max(0, inland - 2) * 45));
      if (!onMainStreet(x, z)) n -= 1e6;
      if (!wouldUnlockHouse(x, z)) n -= 1e6;
      const d = Math.abs(x - houseX) + Math.abs(z - houseZ);
      if (d > 8) n -= 4000;
      n += 200 - d * 45;
      return n;
    });
    if (!lot) return null;
    if (!onMainStreet(lot.x, lot.z) || !wouldUnlockHouse(lot.x, lot.z)) return null;
    if (nextToPier(city, lot.x, lot.z) || isWaterfront(city, lot.x, lot.z) || inlandCells(lot.x, lot.z) < 4) {
      return null;
    }
    return lot;
  }
  function continueInland() {
    if ((city.stats?.markets || 0) < 1) return false;
    const nextHouse = findPlaceable("house");
    if (nextHouse && city.treasury >= (DEFS.house.cost || 0) && streetWash) {
      streetWash = false;
      armTool("house", "Rowhouse. Zone inland of the beach.");
      return true;
    }
    if (!nextHouse) {
      if ((city.stats?.happiness || 50) < 38 && city.treasury >= (DEFS.park.cost || 0)) {
        armTool("park", "Park — lift mood, or cut the smoke.");
        return true;
      }
      const street = findInlandStreet();
      if (street) {
        armTool("road", "Road — pave inland, then zone the lot.", street);
        return true;
      }
    }
    return false;
  }
  function armTool(id, note, lot) {
    if (!id || !DEFS[id]) return;
    const next = lot || findPlaceable(id);
    const same = state.tool === id;
    if (next) {
      state.hover = next;
      state.aim = next;
    }
    state.tool = id;
    const inlandRoad = !!(lot && (id === "road" || id === "cobble"));
    if (inlandRoad) {
      overlay = "place:" + id;
      streetWash = true;
    } else {
      if (id !== "road" && id !== "cobble") streetWash = false;
      overlay = null;
    }
    setTool(id, { keepMap: true });
    if (inlandRoad) {
      setOverlayMode("place:" + id);
      refreshOverlay(city, true);
    }
    if (!same) toast(note || `${DEFS[id].label} tool.`);
    else {
      const el = document.getElementById("toast");
      if (el && !el.classList.contains("show")) el.textContent = "";
    }
    if (next) focusCell(next.x, next.z);
  }
  function setTool(id, opts) {
    if (!id && state.tool && !city.digest && recapWaiting()) resumeTool = state.tool;
    for (const el of rail.querySelectorAll("button[data-tool]")) {
      el.classList.toggle("on", el.dataset.tool === id);
    }
    document.body.classList.toggle("tool-armed", !!id);
    if (DEVICE.phone || innerWidth <= 820) {
      document.body.classList.add("rail-shut");
      if (id && !opts?.keepMap) {
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
    if (overlay && String(overlay).startsWith("place:")) {
      const nextWash = toolOverlay(id);
      if (overlay !== nextWash) overlay = null;
    }
    if (id !== "road" && id !== "cobble") streetWash = false;
    if (!overlay) {
      setOverlayMode(toolOverlay(id));
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
    if (!overlay) refreshOverlay(city, true);
    syncFold();
  }
  document.getElementById("advisor")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (city.digest) fileRecap();
    const msg = document.getElementById("advisor")?.textContent || "";
    if (/Raise an Exchange|needs an Exchange|dead copper/i.test(msg)) {
      armTool("exchange", "Exchange — then click Cable along the street. No wireless.");
      return;
    }
    if (/cable on the avenue|paint Cable|click Cable|Run Cable|no cable/i.test(msg)) {
      armTool("cable", "Cable — click a street or drag along it from the Exchange.");
      return;
    }
    if (/Homes are full|zone more houses|pave the next street inland|gold lot inland of the beach/i.test(msg)) {
      city.seen = city.seen || {};
      city.seen.homesFullAck = true;
      if (findPlaceable("house")) {
        armTool("house", "Rowhouse. Zone inland of the beach.");
        return;
      }
      if ((city.stats?.happiness || 50) < 38 && city.treasury >= (DEFS.park.cost || 0)) {
        armTool("park", "Park — lift mood, or cut the smoke.");
        return;
      }
      const street = findInlandStreet();
      if (street) {
        armTool("road", "Road — pave inland, then zone the lot.", street);
        return;
      }
      return;
    }
    if (/plant is full/i.test(msg)) {
      armTool("power", "Plant — another inland. The last one is full.");
      return;
    }
    if (/tower is full/i.test(msg)) {
      armTool("cistern", "Water tower — another on the avenue. The last one is full.");
      return;
    }
    if (/works are full/i.test(msg)) {
      armTool("sewer", "Works — another inland. The last one is full.");
      return;
    }
    if (/Avenues are jammed|add streets|add roads to spread/i.test(msg)) {
      armTool("road", "Road — spread the load off the jammed avenue.");
      return;
    }
    if (/homes are abandoned|reconnect the road or reopen/i.test(msg)) {
      armTool("road", "Road — reconnect the abandoned lots, then reopen.");
      return;
    }
    if (/mood is low/i.test(msg)) {
      if (state.tool === "cistern") return;
      const hasCistern = city.tiles.some((t) => t.kind === "cistern");
      const hasWorks = city.tiles.some((t) => t.kind === "sewer");
      const hasPlant = city.tiles.some((t) => t.kind === "power");
      if (hasPlant && !hasCistern) {
        armTool("cistern", "Water tower on the avenue. Dry lots sour the town.");
        return;
      }
      if (hasCistern && (city.stats?.works || 0) < 1 && !hasWorks) {
        armTool("sewer", "Works inland. Privies sour the town.");
        return;
      }
      armTool("park", "Park — lift mood, or cut the smoke.");
      return;
    }
    if (/diesel plant is on the water/i.test(msg)) {
      armTool("bulldoze", "Bulldoze the plant on the water. Rebuild inland.");
      return;
    }
    if (/office is on kerosene|hamlet is on kerosene|plant inland|lights are failing/i.test(msg)) {
      armTool("power", "Plant inland of the cove.");
      return;
    }
    if (/office is dry|wells are dry|water tower on the avenue|tower is dry/i.test(msg)) {
      armTool("cistern", "Water tower on the avenue.");
      return;
    }
    if (/office has no outfall|privies will not hold|works inland/i.test(msg)) {
      armTool("sewer", "Works inland of the cove.");
      return;
    }
    if (/Too few jobs|job is work|Job demand is high|offices, or the harbor/i.test(msg)) {
      const [id, note] = workJob();
      armTool(id, note);
      return;
    }
    if (/this dock is freight|visitors will not walk it/i.test(msg)) {
      armTool("shop", "Shop on the water — visitors will not walk a freight dock.");
      return;
    }
    if (/sewer outfall sits on the tourist water|move the works off the cove/i.test(msg)) {
      armTool("bulldoze", "Bulldoze the works on the water. Rebuild inland.");
      return;
    }
    if (/float a bond|treasury is empty|bond is covering a hole/i.test(msg)) {
      setMenu(true);
      const loan = document.getElementById("btn-loan");
      loan?.classList.add("need");
      loan?.scrollIntoView({ block: "nearest", inline: "nearest" });
      toast("Bond is in Menu if you need the cash.");
      return;
    }
    if (/families want rowhouses/i.test(msg)) {
      state.tool = "house";
      setTool("house");
      toast("Rowhouse. Zone inland of the beach.");
      return;
    }
    if (/extend the road, then add homes/i.test(msg)) {
      state.tool = "road";
      setTool("road");
      toast("Road — then homes and shops.");
      return;
    }
    if (/Jobs next|office on the avenue/i.test(msg)) {
      armTool("office", "Office. Jobs on the avenue.");
      return;
    }
    if (/Grow inland|homes and shops along the avenue|chip again for a shop/i.test(msg)) {
      if ((city.stats?.shops || 0) >= 1 && (city.stats?.offices || 0) < 1) {
        armTool("office", "Office. Jobs on the avenue.");
        return;
      }
      if (state.tool === "house") {
        state.hover = null;
        state.aim = null;
        armTool("shop", "Shop along the avenue.");
        return;
      }
      armTool("house", "Rowhouse. Zone inland of the beach.");
      return;
    }
    if (/Pave the landfall|Road or Cobble/i.test(msg)) {
      if (state.tool === "road" || state.tool === "cobble") {
        armTool("market", "Harbor → Market. After the gold lots are paved.");
        return;
      }
      armTool(
        "road",
        DEVICE.phone || innerWidth <= 820
          ? "Road — tap the gold lot by the pier."
          : "Road — gold lots are the landfall. Tap again for Market."
      );
      return;
    }
    if (/Harbor → Market|fish market|boats need a market/i.test(msg)) {
      if (state.tool === "market" && !findPlaceable("market")) {
        armTool("road", "Road first if the landfall is still dirt.");
        return;
      }
      armTool("market", "Market — tap the lot by the pier.");
      return;
    }
    const arm = [
      [/shop/i, "shop", "Shop along the avenue."],
      [/pier|berth/i, "pier", "Pier — push into the harbor."],
      [/workplace|Add workplaces/i, "shop", "Shop — or Harbor for jobs."],
      [/warehouse|cargo dock/i, "warehouse", "Warehouse on the landfall."],
      [/plant inland|kerosene|lights are failing|range of a plant/i, "power", "Plant inland of the cove."],
      [/water tower|wells are dry|tower is dry/i, "cistern", "Water tower on the avenue."],
      [/works inland|privy|outfall/i, "sewer", "Works inland of the cove."],
      [/school/i, "school", "School near the houses."],
      [/clinic|hospital/i, "clinic", "Clinic."],
      [/firehouse|no firehouse/i, "fire", "Firehouse near the plant."],
      [/park or a school|lift mood/i, "park", "Park."],
    ];
    for (const [re, id, note] of arm) {
      if (re.test(msg) && DEFS[id]) {
        armTool(id, note);
        return;
      }
    }
  });
  const DEMAND_ARM = {
    home: ["house", "Rowhouse. Zone inland of the beach."],
    work: ["shop", "Shop — or Harbor for jobs."],
    shop: ["shop", "Shop along the avenue."],
    port: ["pier", "Pier — push into the harbor."],
    visit: ["shop", "Shop on the water."],
    freight: ["warehouse", "Warehouse on the landfall."],
    edu: ["school", "School near the houses."],
    health: ["clinic", "Clinic."],
    power: ["power", "Plant inland of the cove."],
    water: ["cistern", "Water tower on the avenue."],
    sewer: ["sewer", "Works inland of the cove."],
    internet: ["exchange", "Exchange — then click Cable along the street. No wireless."],
  };
  document.querySelectorAll("#demand [data-d]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (city.digest) return;
      const key = el.dataset.d;
      let pair = DEMAND_ARM[key];
      if (!pair) return;
      let [id, note] = pair;
      if (key === "internet" && (city.utilities?.exchanges || 0) >= 1) {
        id = "cable";
        note = "Cable — click a street or drag along it from the Exchange.";
      }
      if (key === "work") {
        [id, note] = workJob();
      }
      if (!DEFS[id]) return;
      armTool(id, note);
    });
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
    const happyEl = document.getElementById("stat-happy");
    happyEl.textContent = `${Math.round(s.happiness)}%`;
    happyEl.classList.toggle("bad", (s.happiness || 50) < 38);
    document.getElementById("stat-clock").textContent = clockLabel(city.time);
    const jobsMenu = document.getElementById("menu-jobs");
    const moodMenu = document.getElementById("menu-mood");
    const hourMenu = document.getElementById("menu-hour");
    if (jobsMenu) jobsMenu.textContent = `${Math.round(s.jobs)} / ${Math.round(s.jobCap)}`;
    if (moodMenu) moodMenu.textContent = `${Math.round(s.happiness)}%`;
    if (hourMenu) hourMenu.textContent = clockLabel(city.time);
    const weekEl = document.getElementById("stat-week");
    if (weekEl) weekEl.textContent = String(s.week || 0);
    document.getElementById("warn").classList.toggle("hidden", !city.bankruptWarn);
    const demand = s.demand || {};
    for (const key of ["home", "work", "shop", "port", "visit", "freight", "edu", "health", "power", "water", "sewer", "internet"]) {
      const el = document.querySelector(`#demand [data-d="${key}"] i`);
      if (el) el.style.setProperty("--p", `${Math.round((demand[key] || 0) * 100)}%`);
    }
    const adv = document.getElementById("advisor");
    if (adv) {
      let copy = s.advisor || "";
      if (
        !state.tool &&
        /Homes are full|Tap this chip for Rowhouse/i.test(copy) &&
        city.treasury >= (DEFS.house.cost || 0) &&
        !findPlaceable("house")
      ) {
        copy =
          (s.happiness || 50) < 38 && city.treasury >= (DEFS.park.cost || 0)
            ? "Mood is low. Homes are full — tap this chip for a park."
            : findInlandStreet()
              ? "Homes are full. Tap this chip — pave the next street inland."
              : "Homes are full. No empty lot inland of the beach.";
      }
      if (state.tool === "house") {
        const nextHouse = findPlaceable("house");
        if (!nextHouse) {
          copy =
            (s.happiness || 50) < 38 && city.treasury >= (DEFS.park.cost || 0)
              ? "Mood is low. Homes are full — tap this chip for a park."
              : city.treasury < (DEFS.house.cost || 0)
                ? "Homes are full. Wait — the till is filling."
                : findInlandStreet()
                  ? "Homes are full. Tap this chip — pave the next street inland."
                  : "Homes are full. No empty lot inland of the beach.";
        } else if (/Homes are full|Tap this chip for Rowhouse|plant is (still )?going up|wait for mains|mood is falling/i.test(copy)) {
          copy = "Rowhouse is armed. Tap a glowing empty lot inland of the beach.";
        } else if (/Grow inland|homes and shops along the avenue/i.test(copy)) {
          copy = "Rowhouse is armed. Tap the lot, then this chip again for a shop.";
        }
      }
      if (
        state.tool === "road" &&
        /pave the next street inland|pave inland|Homes are full/i.test(copy) &&
        !findPlaceable("house")
      ) {
        copy = "Road is armed. Tap the gold lot inland of the beach.";
      }
      if (state.tool === "shop" && /Grow inland|homes and shops along the avenue|People need shops/i.test(copy)) {
        copy = "Shop is armed. Tap the lot on the avenue.";
      }
      if (state.tool === "office" && /Too few jobs|job is work|Job demand|offices, or the harbor|Jobs next|office on the avenue/i.test(copy)) {
        copy = "Office is armed. Tap the lot on the avenue.";
      }
      if (state.tool === "power" && /kerosene|plant inland|lights are failing/i.test(copy)) {
        copy = "Plant is armed. Tap the lot inland of the cove.";
      }
      if (state.tool === "cistern" && !city.tiles.some((t) => t.kind === "cistern")) {
        copy =
          (s.happiness || 50) < 38
            ? "Mood is low. Water tower is armed — dry lots sour the town. Tap the lot."
            : (s.plants || 0) < 1
              ? "Water tower is armed. The plant is still going up."
              : "Water tower is armed. Tap the lot on the avenue.";
      }
      if (state.tool === "sewer" && /tower is going up|plant is going up/i.test(copy)) {
        copy = "Works are armed. The last plant is still going up.";
      } else if (state.tool === "sewer" && /outfall|privies will not hold|works inland/i.test(copy)) {
        copy = "Works are armed. Tap the lot inland of the cove.";
      }
      if (state.tool === "park" && /mood is low|lift mood|till can't pay a house/i.test(copy)) {
        copy = "Park is armed. Mood is low — tap a lot near the houses.";
      }
      adv.textContent = copy;
    }
    const con = document.getElementById("contract");
    if (con) {
      const c = s.contract;
      const dockDone = city.tiles.some((t) => t.kind === "market" && isBuilt(t));
      const week = Math.floor((city.tickCount || 0) / 20);
      const phone = DEVICE.phone || innerWidth <= 820;
      const menuCon = document.getElementById("menu-contract");
      const menuKick = document.getElementById("menu-job-kicker");
      const boardCopy = c && dockDone && week >= 4
        ? `${c.label}${contractProgress(c, s) ? ` · ${contractProgress(c, s)}` : ""} · ${c.weeks} wk`
        : "";
      if (menuCon) menuCon.textContent = boardCopy;
      if (menuKick) menuKick.style.display = boardCopy ? "" : "none";
      if (!c || !dockDone || week < 4 || phone) con.textContent = "";
      else {
        const prog = contractProgress(c, s);
        const lastLabel = c.weeks <= 1 ? "Last week · " : c.weeks <= 2 ? "2 wk left · " : "";
        con.textContent = `${lastLabel}${c.label}${prog ? ` · ${prog}` : ""} · ${c.weeks} wk · win $${c.reward.toLocaleString("en-US")} · pass job −$250`;
      }
      con.classList.toggle("urgent", !!(dockDone && c && c.weeks <= 2 && !phone));
    }
    const bud = document.getElementById("budget");
    if (bud && s) {
      const week = Math.floor((city.tickCount || 0) / 20);
      if (week < 1) bud.textContent = "";
      else {
        const loan = s.loanTicks ? ` · bond ${s.loanTicks}` : "";
        bud.textContent = `In ${money(s.income || 0)} · out ${money(s.upkeep || 0)}${loan}`;
      }
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
        ((city.stats?.fires || 0) < 1 && ((city.stats?.factories || 0) > 0 || (city.stats?.plants || 0) > 0) && id === "fire") ||
        ((s.happiness || 50) < 38 && id === "park");
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
    const phoneHud = DEVICE.phone || innerWidth <= 820;
    waitEl?.classList.toggle("hidden", !showWait || phoneHud);
    waitEl?.classList.toggle("recap-dot", !waiting && recapUnread && !phoneHud);
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
    const eta = document.getElementById("recap-eta");
    if (eta) {
      const week = Math.floor((city.tickCount || 0) / 20);
      const due = Number.isFinite(city.nextRecapTick) ? city.nextRecapTick : 80;
      const dueWeek = Math.max(4, Math.floor(due / 20));
      const recap = city.lastDigest;
      const dueNow = !!(city.digest || waiting || recapUnread);
      if (week < 4) eta.textContent = "first recap · 4";
      else if (city.digest) eta.textContent = "recap now";
      else if (dueNow && recap) {
        const bits = ["recap due"];
        if (recap.people) bits.push(String(recap.people).replace(/\s+people/i, "p"));
        if (Number.isFinite(recap.mood)) bits.push(`${recap.mood}%`);
        eta.textContent = bits.join(" · ");
      } else if (dueNow || city.tickCount >= due) eta.textContent = "recap due";
      else eta.textContent = `recap ${dueWeek}`;
      eta.classList.toggle("due", dueNow);
    }
    weekEl?.parentElement?.classList.toggle("need", !!(waiting || recapUnread || city.digest));
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
    if (!overlay && !document.getElementById("inspect")?.classList.contains("show")) {
      setOverlayMode(toolOverlay(state.tool));
    }
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
    holdCanvas(180);
  });

  function inspectSig(tile) {
    if (!tile) return "";
    const fee = tile.kind && !isBuilt(tile) ? rushCost(tile) : 0;
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
      fee && city.treasury >= fee ? 1 : 0,
      tile.kind && DEFS[tile.kind]?.upgrade && city.treasury >= (DEFS[tile.kind].upgradeCost || 0) ? 1 : 0,
    ].join(":");
  }

  function inspect(tile, force) {
    const panel = document.getElementById("inspect");
    if (!tile || city.digest) {
      panel.classList.remove("show");
      document.body.classList.remove("inspect-build");
      if (!tile) state.selected = null;
      setRangeHalo(null);
      releaseView();
      restoreWash();
      setChrome();
      return;
    }
    if (!force && performance.now() < (window.__veilUntil || 0) && !panel.classList.contains("show")) {
      state.selected = null;
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
        return;
      }
      if (panel.dataset.sig === sig) return;
    }
    const scroll = panel.querySelector("dl")?.scrollTop || 0;
    setMenu(false);
    closeSheets();
    document.getElementById("coach")?.classList.add("hidden");
    const info = inspectLocal(city, tile.x, tile.z);
    const spec = tile.kind ? DEFS[tile.kind] : null;
    const title = spec ? spec.label : tile.terrain === "water" ? "Harbor" : "Vacant lot";
    const rows = [];
    let zonePick = null;
    if (!spec) {
      if (tile.terrain === "sand" || tile.shoreline) {
        rows.push(["Beach", "Piers only. Build on the landfall.", "pier", "Pier — on the shoreline.", true]);
        zonePick = ["pier", "Harbor", "Pier — on the shoreline."];
      } else if (info?.waterfront && tile.terrain !== "water") {
        rows.push(
          (city.stats?.markets || 0) < 1
            ? ["Waterfront", "A shop or market here pulls catch and tourists", "market", "Market — on the landfall, not the sand.", true]
            : ["Waterfront", "A shop or market here pulls catch and tourists", "shop", "Shop on the water.", true]
        );
      }
      if (info?.suit && tile.terrain !== "water" && tile.terrain !== "sand" && !tile.shoreline) {
        const ranked = [
          ["house", "Homes", "Rowhouse. Zone inland of the beach.", info.suit.home],
          ["shop", "Shops", "Shop along the avenue.", info.suit.shop],
          ["office", "Jobs", "Office — or a shop if you want street jobs.", info.suit.work],
          ["pier", "Harbor", "Pier — push into the harbor.", info.suit.port],
        ].sort((a, b) => b[3] - a[3]);
        let top = ranked[0];
        if (top[0] === "pier" && tile.terrain !== "water" && !tile.shoreline) {
          top = ranked.find((r) => r[0] !== "pier") || top;
        }
        if (info.waterfront && (city.stats?.markets || 0) < 1) {
          top = ["market", "Market", "Market — on the landfall, not the sand.", 1];
        }
        rows.push(["Best here", `${top[1]} ${Math.round(top[3] * 100)}%`, top[0], top[2], true]);
        zonePick = top;
      } else if (tile.terrain === "water") {
        zonePick = ["pier", "Harbor", "Pier — push into the harbor."];
      }
    }
    const fee = spec && !isBuilt(tile) ? rushCost(tile) : 0;
    const canRush = !!(fee && city.treasury >= fee);
    const canUp = !!(spec?.upgrade && DEFS[spec.upgrade] && !tile.abandoned && isBuilt(tile) && city.treasury >= (spec.upgradeCost || 0));
    if (spec && !isBuilt(tile)) {
      rows.push(["Status", buildLabel(tile.kind, tile.build || 0)]);
      rows.push(["Progress", `${Math.round((tile.build || 0) * 100)}%`]);
      if (spec.radius) rows.push(["Range", `${spec.radius} lots from here`]);
    }
    if (spec && isBuilt(tile)) {
      if (tile.kind === "road" || tile.kind === "cobble") {
        const live = !!(city.utilities?.liveCable && city.utilities.liveCable.has && city.utilities.liveCable.has(idx(tile.x, tile.z)));
        if (tile.cable && live) {
          rows.push(["Cable", "Live — carries a line from the Exchange"]);
        } else if (tile.cable) {
          rows.push(["Cable", "Dead copper — no Exchange on this line", "exchange", "Exchange — then click Cable along the street. No wireless.", true]);
        } else {
          rows.push(["Cable", "None — click Cable along this street from an Exchange", "cable", "Cable — click a street from the Exchange.", true]);
        }
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
        if (grow === "No road") rows.push(["Households", grow, "road", "Road — connect this lot.", true]);
        else if (grow === "Full") rows.push(["Households", grow, "house", "Rowhouse. Zone inland of the beach.", true]);
        else if (grow === "Broke") rows.push(["Households", grow, "menu:loan", "Bond is in Menu if you need the cash.", true]);
        else if (grow === "No water") rows.push(["Households", grow, "cistern", "Water tower on the avenue.", true]);
        else if (grow === "No power") rows.push(["Households", grow, "power", "Plant inland of the cove.", true]);
        else if (grow === "Pollution") rows.push(["Households", grow, "map:pollution", MAP_LEGEND.pollution, true]);
        else rows.push(["Households", grow]);
      }
      if (info?.abandoned) {
        rows.push(["Status", "Abandoned — reconnect the road or reopen", "road", "Road — reconnect the abandoned lots, then reopen.", true]);
      }
      if (info && Number.isFinite(info.value) && info.value > 0) rows.push(["Land value", `${Math.round(info.value * 100)}%`]);
      if (canUp) {
        rows.push(["Upgrade", `${DEFS[spec.upgrade].label} · $${spec.upgradeCost.toLocaleString("en-US")}`]);
      }
      if (info && info.congestion > 0) {
        const jam = info.congestion;
        const tLabel = jam > 3.2 ? `Jammed ${jam.toFixed(1)}` : jam > 1.6 ? `Busy ${jam.toFixed(1)}` : jam.toFixed(1);
        rows.push(
          jam > 1.6
            ? ["Traffic", tLabel, "road", "Road — spread the load off the jammed avenue."]
            : ["Traffic", tLabel]
        );
      }
      if (info?.commute && spec.pop) {
        const cLabel = `${info.commute} min`;
        rows.push(
          info.commute > 22
            ? ["Commute", cLabel, "road", "Road — spread the load off the jammed avenue."]
            : ["Commute", cLabel]
        );
      }
      if (tile.kind === "school") {
        const kids = Math.round(city.stats.kids || 0);
        const seats = city.stats.seats || 0;
        const label = `${kids} kids / ${seats}`;
        rows.push(
          kids > seats
            ? ["Seats", label, "school", "School near the houses.", true]
            : ["Seats", label]
        );
      }
      if (tile.kind === "hospital" || tile.kind === "clinic") {
        const needBeds = Math.round((city.stats.pop || 0) * 0.08);
        const beds = city.stats.beds || 0;
        const label = `${needBeds} need / ${beds}`;
        rows.push(
          needBeds > beds
            ? ["Beds", label, tile.kind, `${DEFS[tile.kind].label} near the houses.`, true]
            : ["Beds", label]
        );
      }
      if (tile.kind === "fire") {
        rows.push(["Companies", String(city.stats.fires || 1)]);
      }
      if (tile.kind === "park" || tile.kind === "fire" || tile.kind === "school" || tile.kind === "clinic" || tile.kind === "hospital" || tile.kind === "civic") {
        rows.push(["Range", `${spec.radius} lots from here`]);
        let homes = 0;
        forEachInRadius(city, tile.x, tile.z, spec.radius, (lot) => {
          if (lot.kind && isResidential(lot.kind)) homes += 1;
        });
        rows.push(["Covered", homes ? `${homes} home${homes === 1 ? "" : "s"} in the ring` : "No homes in the ring"]);
      }
      if (tile.kind === "shop" || tile.kind === "warehouse" || tile.kind === "factory") {
        rows.push(["Range", `${spec.radius} lots from here`]);
      }
      if (tile.kind === "market") {
        rows.push(["Range", `${spec.radius} lots from here`]);
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
        if (mix > 0.55) {
          rows.push(["Dock", "Freight", "shop", "Shop on the water — visitors will not walk a freight dock.", true]);
        } else if (mix >= 0.35) {
          rows.push(["Dock", "Split — cargo and guests fight", "pier", "Lay a second slip and keep cargo off the promenade.", true]);
        } else {
          rows.push(["Dock", "Visitors"]);
        }
      }
      function servingRow(idle, fallback) {
        if (!idle) {
          if (fallback) rows.push(["Serving", fallback]);
          return;
        }
        if (/Click Cable|No line/i.test(idle)) {
          rows.push(["Serving", idle, "cable", "Cable — click a street from the Exchange.", true]);
        } else if (/pave toward homes|No lots in range/i.test(idle)) {
          rows.push(["Serving", idle, "road", "Road — then the plant can reach homes.", true]);
        } else if (/needs a plant/i.test(idle)) {
          rows.push(["Serving", idle, "power", "Plant inland of the cove.", true]);
        } else {
          rows.push(["Serving", idle]);
        }
      }
      if (tile.kind === "power") {
        rows.push(["This plant", `${Math.round(tile.servedLoad || 0)} / ${spec.capacity} · ~${capacityHomes("power")} homes`]);
        rows.push(["Town grid", `${Math.round(city.stats?.powerUsed || 0)} / ${Math.round(city.stats?.powerCap || 0)}`]);
        rows.push(["Range", `${spec.radius} lots, then 3 lots off streets inside that ring`]);
        servingRow(plantWhyIdle(tile), "Lots in the ring, then a little along those streets");
        rows.push(
          info?.waterfront
            ? ["Note", "Smoke on the cove kills the catch.", "bulldoze", "Bulldoze the plant on the water. Rebuild inland.", true]
            : ["Note", "Smoke on the cove kills the catch."]
        );
      }
      if (tile.kind === "cistern") {
        rows.push(["This tower", `${Math.round(tile.servedLoad || 0)} / ${spec.capacity} · ~${capacityHomes("cistern")} homes`]);
        rows.push(["Town mains", `${Math.round(city.stats?.waterUsed || 0)} / ${Math.round(city.stats?.waterCap || 0)}`]);
        rows.push(["Range", `${spec.radius} lots, then 3 lots off streets inside that ring`]);
        rows.push(
          tile.powered && tile.powerSrc === "mains"
            ? ["Pumps", "Powered"]
            : ["Pumps", "Dark — needs a plant in range", "power", "Plant inland of the cove.", true]
        );
        servingRow(plantWhyIdle(tile));
      }
      if (tile.kind === "exchange") {
        rows.push(["This exchange", `${Math.round(tile.servedLoad || 0)} / ${spec.capacity} · ~${capacityHomes("exchange")} homes`]);
        rows.push(["Town line", `${Math.round(city.stats?.internetUsed || 0)} / ${Math.round(city.stats?.internetCap || 0)}`]);
        rows.push(["Feed", "Along Cable only — not a radius"]);
        rows.push(
          tile.powered && tile.powerSrc === "mains"
            ? ["Pumps", "Powered"]
            : ["Pumps", "Dark — needs a plant in range", "power", "Plant inland of the cove.", true]
        );
        servingRow(plantWhyIdle(tile));
      }
      if (tile.kind === "sewer") {
        rows.push(["This works", `${Math.round(tile.servedLoad || 0)} / ${spec.capacity} · ~${capacityHomes("sewer")} homes`]);
        rows.push(["Town load", `${Math.round(city.stats?.sewerUsed || 0)} / ${Math.round(city.stats?.sewerCap || 0)}`]);
        rows.push(["Range", `${spec.radius} lots, then 3 lots off streets inside that ring`]);
        rows.push(
          info?.waterfront
            ? ["Outfall", "On the promenade — visitors will leave", "bulldoze", "Bulldoze the works on the water. Rebuild inland.", true]
            : ["Outfall", "Inland of the cove"]
        );
        servingRow(plantWhyIdle(tile));
      }
      if (spec.jobs) {
        rows.push(["Jobs", `${tile.jobs.toFixed(1)} / ${spec.jobs}`]);
        if (info) {
          const labor = Math.round(info.nearbyPop || 0);
          rows.push(
            labor < 8
              ? ["Labor nearby", String(labor), "house", "Rowhouse. Zone inland of the beach.", true]
              : ["Labor nearby", String(labor)]
          );
        }
      }
      rows.push(["Upkeep", `${money(spec.upkeep)} / tick`]);
      rows.push(["Refund", money(tile.starter ? 0 : refundFor(tile.kind))]);
    }
    if (info && isBuilt(tile)) {
      rows.push(
        info.access
          ? ["Road", "Connected"]
          : ["Road", "No access", "road", "Road — connect this lot."]
      );
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
        const pLabel = label(info.util.powered, info.util.powerSrc, powerOff);
        const wLabel = label(info.util.watered, info.util.waterSrc, waterOff);
        const sLabel = label(info.util.sewered, info.util.sewerSrc, sewerOff);
        rows.push(
          info.util.powered && info.util.powerSrc === "mains"
            ? ["Power", pLabel]
            : ["Power", pLabel, "power", "Plant inland of the cove."]
        );
        rows.push(
          info.util.watered && info.util.waterSrc === "mains"
            ? ["Water", wLabel]
            : ["Water", wLabel, "cistern", "Water tower on the avenue."]
        );
        rows.push(
          info.util.sewered && info.util.sewerSrc === "mains"
            ? ["Sewer", sLabel]
            : ["Sewer", sLabel, "sewer", "Works inland of the cove."]
        );
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
        const netLabel = net();
        if (netLabel === "Line") rows.push(["Internet", netLabel]);
        else if (netLabel.startsWith("No ports")) {
          rows.push(["Internet", netLabel, "exchange", "Exchange is full. Raise another."]);
        } else if ((u.exchanges || 0) >= 1) {
          rows.push(["Internet", netLabel, "cable", "Cable — click a street from the Exchange."]);
        } else {
          rows.push(["Internet", netLabel, "exchange", "Exchange — then click Cable along the street. No wireless."]);
        }
      }
      if (info.waterfront && spec) {
        rows.push(
          (city.stats?.markets || 0) < 1
            ? ["Waterfront", "Yes", "market", "Market — on the landfall, not the sand.", true]
            : ["Waterfront", "Yes", "shop", "Shop on the water.", true]
        );
      }
      if (spec?.pop) {
        rows.push(["Park", `${Math.round(info.park * 100)}%`, "park", "Park near the houses."]);
        rows.push(["School", `${Math.round(info.edu * 100)}%`, "school", "School near the houses."]);
        rows.push(["Clinic", `${Math.round(info.health * 100)}%`, "clinic", "Clinic near the houses."]);
        rows.push(["Fire", `${Math.round((info.fire || 0) * 100)}%`, "fire", "Firehouse near the houses."]);
      }
      if (info.pollution >= 0.05) {
        rows.push(["Pollution", info.pollution.toFixed(2), "map:pollution", MAP_LEGEND.pollution]);
      }
    }
    const actions =
      (canRush ? `<button type="button" id="rush-lot">Rush · ${money(fee)}</button>` : "") +
      (spec && spec.category !== "infra" && tile.kind !== "bulldoze" && isBuilt(tile) ? `<button type="button" id="copy-lot">Build more ${spec.label.toLowerCase()}s</button>` : "") +
      (canUp ? `<button type="button" id="up-lot">Upgrade to ${DEFS[spec.upgrade].label} · $${spec.upgradeCost.toLocaleString("en-US")}</button>` : "") +
      (tile.abandoned && tile.kind ? '<button type="button" id="reopen-lot">Reopen $180</button>' : "") +
      (tile.kind && (isBuilt(tile) || state.tool === "bulldoze")
        ? '<button type="button" id="demo-lot">Demolish</button>'
        : !tile.kind
          ? zonePick
            ? `<button type="button" id="zone-lot" data-tool="${zonePick[0]}">Zone ${zonePick[1]}</button>`
            : `<p class="mute">Choose a tool, then ${DEVICE.touch ? "tap" : "click"} a lot.</p>`
          : "");
    panel.innerHTML = `<div class="inspect-head"><h3>${title}</h3><button type="button" id="inspect-close">Close</button></div>
      <dl>${rows
        .map(([k, v, arm, note, hot]) => {
          if (!arm) return `<div><dt>${k}</dt><dd>${v}</dd></div>`;
          const need =
            hot === true ||
            v === "0%" ||
            v === "0" ||
            /^Dark/.test(String(v)) ||
            v === "Dry" ||
            v === "None" ||
            /^None/.test(String(v)) ||
            v === "Kerosene" ||
            v === "Well" ||
            v === "Privy" ||
            v === "No access" ||
            v === "Full" ||
            v === "Pollution" ||
            v === "Broke" ||
            /^Abandoned/.test(String(v)) ||
            /^Jammed/.test(String(v)) ||
            /^Busy/.test(String(v)) ||
            /^No /.test(String(v)) ||
            /^Dead copper/.test(String(v)) ||
            (arm === "map:pollution" && Number(v) >= 0.55);
          return `<div class="arm${need ? " need" : ""}" data-arm="${arm}" data-note="${note}"><dt>${k}</dt><dd>${v}</dd></div>`;
        })
        .join("")}</dl>
      <div class="inspect-actions">${actions}</div>`;
    panel.dataset.sig = sig;
    panel.dataset.at = `${tile.x},${tile.z}`;
    panel.classList.add("show");
    state.selected = tile;
    whyChip(null);
    document.body.classList.toggle("inspect-build", !!(tile.kind && !isBuilt(tile)));
    if (DEVICE.phone || innerWidth <= 820) {
      holdView();
      if (tile.kind && !isBuilt(tile)) focusSite(tile.x, tile.z);
      else if (tile.kind) focusCell(tile.x, tile.z);
    }
    if (spec?.radius && (tile.kind === "power" || tile.kind === "cistern" || tile.kind === "sewer" || tile.kind === "fire" || tile.kind === "school" || tile.kind === "clinic" || tile.kind === "hospital" || tile.kind === "park" || tile.kind === "civic" || tile.kind === "market" || tile.kind === "shop" || tile.kind === "warehouse" || tile.kind === "factory")) {
      const tint =
        tile.kind === "cistern" ? 0x4aa6ff
        : tile.kind === "sewer" ? 0x8ab87a
        : tile.kind === "fire" ? 0xd45a28
        : tile.kind === "school" ? 0x4a88d4
        : tile.kind === "clinic" || tile.kind === "hospital" ? 0xd45a6a
        : tile.kind === "park" ? 0x2fdd8a
        : tile.kind === "civic" ? 0xe0c48a
        : tile.kind === "market" || tile.kind === "shop" ? 0xc4a428
        : tile.kind === "warehouse" ? 0xc4a46a
        : tile.kind === "factory" ? 0xc44a18
        : 0xffd27a;
      setRangeHalo(tile.x, tile.z, spec.radius, tint);
    } else setRangeHalo(null);
    if (tile.kind === "exchange" || (tile.cable && isPaved(tile.kind))) {
      setOverlayMode("mains");
      refreshOverlay(city);
    } else {
      const keepMap = overlay && !String(overlay).startsWith("place:") && overlay !== "landfall";
      setOverlayMode(keepMap ? overlay : null);
      refreshOverlay(city);
    }
    setGhost(null);
    setChrome();
    const dl = panel.querySelector("dl");
    if (dl) dl.scrollTop = scroll;
    let closeFromPtr = 0;
    function dismissInspect(e) {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      inspectTouchUntil = 0;
      const at =
        e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)
          ? { x: e.clientX, y: e.clientY }
          : { x: -1, y: -1 };
      closeInspect();
      swallowLeftover(280, false, at);
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
      const next = findPlaceable(tile.kind);
      if (next) {
        state.hover = next;
        state.aim = next;
      }
      setTool(state.tool);
      toast(next ? `Build more ${spec.label.toLowerCase()}s · tap the glowing lot` : `${spec.label} tool.`);
      closeInspect();
      if (next && focusCell(next.x, next.z)) holdCanvas(520);
      else holdCanvas(700);
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
    panel.querySelectorAll("[data-arm]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.dataset.arm;
        if (id && id.startsWith("map:")) {
          setMap(id.slice(4), true);
          closeInspect();
          holdCanvas(700);
          return;
        }
        if (id === "menu:loan") {
          closeInspect();
          setMenu(true);
          document.getElementById("btn-loan")?.classList.add("need");
          document.getElementById("btn-loan")?.scrollIntoView({ block: "nearest", inline: "nearest" });
          toast(el.dataset.note || "Bond is in Menu if you need the cash.");
          holdCanvas(700);
          return;
        }
        if (!id || !DEFS[id]) return;
        const next = findPlaceable(id);
        if (next) {
          state.hover = next;
          state.aim = next;
        }
        state.tool = id;
        setTool(id);
        if (id === "road" && /jammed avenue/i.test(el.dataset.note || "")) setMap("traffic", true);
        closeInspect();
        toast(el.dataset.note || `${DEFS[id].label} tool.`);
        if (next && focusCell(next.x, next.z)) holdCanvas(520);
        else holdCanvas(700);
      });
    });
    panel.querySelector("#zone-lot")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = e.currentTarget?.dataset?.tool;
      if (!id || !DEFS[id]) return;
      state.hover = { x: tile.x, z: tile.z };
      state.aim = { x: tile.x, z: tile.z };
      state.tool = id;
      setTool(id);
      toast(zonePick?.[2] || `${DEFS[id].label} tool.`);
      closeInspect();
      if (focusCell(tile.x, tile.z)) holdCanvas(520);
      else holdCanvas(700);
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
    if (document.getElementById("inspect")?.classList.contains("show")) text = "";
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
    const info = inspectLocal(city, lot.x, lot.z);
    if (info && info.pollution > 0.55) return "Smoke";
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
              : state.aim
                ? `Placing: ${DEFS[state.tool].label} · tap this lot`
                : `Placing: ${DEFS[state.tool].label} · tap an empty lot`;
      } else if (lot?.kind && DEFS[lot.kind]) {
        const status = idleLotStatus(lot);
        let line = DEFS[lot.kind].label;
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
      } else if (overlay === "pollution" && lot && lot.terrain !== "water" && !lot.kind) {
        const p = inspectLocal(city, lot.x, lot.z)?.pollution || 0;
        if (p > 0.55) {
          el.textContent = "Vacant · heavy smoke";
          tail = "heavy smoke";
        } else if (p > 0.07) {
          el.textContent = "Vacant · haze";
        } else {
          el.textContent = "Vacant · clear";
        }
        live = true;
      } else if (overlay === "cover" && lot && lot.terrain !== "water" && !lot.kind) {
        const info = inspectLocal(city, lot.x, lot.z);
        const bits = [];
        if ((info?.edu || 0) > 0.15) bits.push("school");
        if ((info?.health || 0) > 0.15) bits.push("clinic");
        if ((info?.park || 0) > 0.15) bits.push("park");
        if ((info?.fire || 0) > 0.15) bits.push("fire");
        el.textContent = bits.length ? `Vacant · ${bits.join(" · ")}` : "Vacant · no care";
        live = true;
        if (!bits.length) tail = "no care";
      } else if (overlay === "value" && lot && lot.terrain !== "water" && !lot.kind) {
        const suit = inspectLocal(city, lot.x, lot.z)?.suit;
        if (suit) {
          const ranked = [
            ["homes", suit.home],
            ["shops", suit.shop],
            ["jobs", suit.work],
            ["harbor", suit.port],
          ].sort((a, b) => b[1] - a[1]);
          el.textContent = `Vacant · ${ranked[0][0]} ${Math.round(ranked[0][1] * 100)}%`;
        } else {
          el.textContent = MAP_DOCK.value;
        }
        live = true;
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
      const lot = tileAt(city, cell.x, cell.z);
      const ownLot = !!(lot?.kind === kind && !isPaved(lot.kind));
      if (ownLot) {
        const stage = !isBuilt(lot) ? buildLabel(lot.kind, lot.build || 0) : idleLotStatus(lot);
        el.textContent = stage ? `${DEFS[kind].label} · ${stage}` : `${DEFS[kind].label} · ${cell.x},${cell.z}`;
        live = true;
        tail = "";
      } else {
        const why = !valid ? placeBlockReason(city, cell.x, cell.z, kind) : "";
        const idle = valid ? ghostUtilHint(city, cell.x, cell.z, kind) : "";
        tail = why || idle || "";
        el.textContent = `${DEFS[kind].label} · ${cell.x},${cell.z}` + (tail ? ` · ${tail}` : "");
        live = true;
      }
    }
    el.classList.toggle("live", live);
    el.classList.toggle("warn", !!tail);
    document.body.classList.toggle("hint-live", live && (innerWidth <= 820 || DEVICE.phone));
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    const phone = DEVICE.phone || innerWidth <= 820;
    const adv = document.getElementById("advisor");
    let advisorUp = false;
    if (phone && adv && adv.textContent) {
      const cs = getComputedStyle(adv);
      advisorUp = cs.display !== "none" && cs.visibility !== "hidden";
    }
    clearTimeout(toast._t);
    if (advisorUp) {
      el.classList.remove("show");
      return;
    }
    el.classList.add("show");
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

  setOverlayMode(toolOverlay(null));
  refreshOverlay(city);

  return { refresh, inspect, hint, whyChip, whyAtCell, toast, setTool, armTool, syncTransport, setMap, toggleLaws, toggleBooks, setMenu, fileRecap, recapWaiting, openHeldRecap, findPlaceable, findInlandStreet, continueInland, fileWaitChip };
}
