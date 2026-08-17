import { DEFS, TOOLS, refundFor } from "./buildings.js";
import { demolish, placeBlockReason } from "./city.js";
import { buildLabel, isBuilt } from "./construction.js";
import { inspectLocal } from "./economy.js";
import { clearSave, loadCity, saveCity } from "./save.js";
import { buildTerrain, DEVICE, rebuildCityMeshes, setDayNight } from "./render.js";

const ICONS = {
  road: '<svg viewBox="0 0 24 24"><path d="M9 3v18M15 3v18M12 8v.01M12 12v.01M12 16v.01"/></svg>',
  park: '<svg viewBox="0 0 24 24"><path d="M12 20V11M7 20h10M12 11c-4-1-5-5-3-8 4 1 6 4 6 7 2-1 4 1 3 3-3 1-5-1-6-2z"/></svg>',
  house: '<svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5V20H4zM10 20v-6h4v6"/></svg>',
  apartment: '<svg viewBox="0 0 24 24"><path d="M6 21V5h12v16M9 8h.01M12 8h.01M15 8h.01M9 12h.01M12 12h.01M15 12h.01"/></svg>',
  tower: '<svg viewBox="0 0 24 24"><path d="M8 22V4h8v18M8 8h8M8 13h8M8 18h8"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M4 10h16v10H4zM4 10l1.2-5h13.6L20 10M8 14h8"/></svg>',
  office: '<svg viewBox="0 0 24 24"><path d="M5 21V4h9v17M14 9h5v12M8 8h.01M11 8h.01M8 12h.01M11 12h.01"/></svg>',
  warehouse: '<svg viewBox="0 0 24 24"><path d="M3 20V10l9-6 9 6v10H3zM9 20v-6h6v6"/></svg>',
  factory: '<svg viewBox="0 0 24 24"><path d="M3 21V10l6 4V10l6 4V8l6 3v10H3z"/></svg>',
  hospital: '<svg viewBox="0 0 24 24"><path d="M4 21V5h16v16M12 8v8M8 12h8"/></svg>',
  school: '<svg viewBox="0 0 24 24"><path d="M3 10 12 5l9 5-9 5-9-5zM6 12v5c3 2 9 2 12 0v-5"/></svg>',
  civic: '<svg viewBox="0 0 24 24"><path d="M4 20h16M6 20V10h12v10M12 4l9 6H3z"/></svg>',
  pier: '<svg viewBox="0 0 24 24"><path d="M3 11h18M6 11v8M12 11v8M18 11v8M3 19h18"/></svg>',
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
  for (const id of TOOLS) {
    const spec = DEFS[id];
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.tool = id;
    b.innerHTML = `${ICONS[id]}<span class="t-copy"><span class="t-name">${spec.label}</span><span class="t-cost">${money(spec.cost)}</span></span>`;
    b.addEventListener("click", () => {
      state.tool = state.tool === id ? null : id;
      setTool(state.tool);
    });
    rail.appendChild(b);
  }

  document.getElementById("btn-begin").addEventListener("click", () => {
    document.getElementById("splash").classList.add("gone");
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
  document.getElementById("btn-save").addEventListener("click", () => {
    saveCity(city);
    toast("City saved.");
  });
  document.getElementById("btn-load").addEventListener("click", () => {
    if (loadCity(city)) {
      buildTerrain(city);
      rebuildCityMeshes(city);
      setDayNight(city.time);
      refresh();
      syncTransport();
      toast("City loaded.");
    } else toast("No save yet.");
  });
  document.getElementById("btn-new").addEventListener("click", () => {
    if (!window.confirm("Abandon this harbor?")) return;
    clearSave();
    onReset();
    document.getElementById("splash").classList.remove("gone");
  });

  function setTool(id) {
    for (const el of rail.querySelectorAll("button")) {
      el.classList.toggle("on", el.dataset.tool === id);
    }
  }

  function syncTransport() {
    document.getElementById("btn-pause").textContent = city.paused ? "Play" : "Pause";
    document.getElementById("btn-pause").classList.toggle("on", city.paused);
    document.getElementById("btn-auto").classList.toggle("on", city.dayAuto);
    document.getElementById("day").value = String(city.time);
    const tax = Number.isFinite(city.taxRate) ? city.taxRate : 1;
    document.getElementById("tax").value = String(tax);
    document.getElementById("tax-lbl").textContent = `${Math.round(tax * 100)}%`;
    document.querySelectorAll(".speeds button").forEach((b) => {
      b.classList.toggle("on", Number(b.dataset.speed) === city.speed);
    });
  }

  function refresh() {
    const s = city.stats;
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
    document.getElementById("warn").classList.toggle("hidden", !city.bankruptWarn);
    const demand = s.demand || {};
    for (const key of ["home", "work", "shop", "port"]) {
      const el = document.querySelector(`#demand [data-d="${key}"] i`);
      if (el) el.style.setProperty("--p", `${Math.round((demand[key] || 0) * 100)}%`);
    }
    const adv = document.getElementById("advisor");
    if (adv) adv.textContent = s.advisor || "";
    for (const el of rail.querySelectorAll("button[data-tool]")) {
      const spec = DEFS[el.dataset.tool];
      el.classList.toggle("poor", !!(spec && city.treasury < spec.cost));
    }
    if (city.events && city.events.length) {
      const msg = city.events.shift();
      if (msg) toast(msg);
    }
    if (city.dayAuto) document.getElementById("day").value = String(city.time);
    if (state.selected) inspect(state.selected);
  }

  function inspect(tile) {
    const panel = document.getElementById("inspect");
    if (!tile) {
      panel.classList.remove("show");
      return;
    }
    const info = inspectLocal(city, tile.x, tile.z);
    const spec = tile.kind ? DEFS[tile.kind] : null;
    const title = spec ? spec.label : tile.terrain === "water" ? "Harbor" : "Vacant lot";
    const rows = [];
    rows.push(["Terrain", tile.terrain]);
    if (spec && !isBuilt(tile)) {
      rows.push(["Status", buildLabel(tile.kind, tile.build || 0)]);
      rows.push(["Progress", `${Math.round((tile.build || 0) * 100)}%`]);
    }
    if (spec) {
      if (spec.pop) {
        rows.push(["Residents", `${tile.pop.toFixed(1)} / ${spec.pop}`]);
        let grow = "Steady";
        if (info && !info.access) grow = "No road";
        else if (tile.pop >= spec.pop - 0.05) grow = "Full";
        else if (city.treasury < 0) grow = "Broke";
        else if (info && info.pollution > 0.6) grow = "Pollution";
        else if (tile.pop < spec.pop * 0.9) grow = "Growing";
        rows.push(["Households", grow]);
      }
      if (spec.jobs) rows.push(["Jobs", `${tile.jobs.toFixed(1)} / ${spec.jobs}`]);
      rows.push(["Upkeep", `${money(spec.upkeep)} / tick`]);
      rows.push(["Refund", money(tile.starter ? 0 : refundFor(tile.kind))]);
    }
    const st = city.stats;
    if (st) {
      rows.push(["Wages", money(st.wageTax || 0)]);
      rows.push(["Property", money(st.property || 0)]);
      rows.push(["Shops / harbor", money((st.commerce || 0) + (st.pierBonus || 0))]);
    }
    if (info) {
      rows.push(["Road", info.access ? "Connected" : "No access"]);
      if (info.waterfront) rows.push(["Waterfront", "Yes"]);
      rows.push(["Park", `${Math.round(info.park * 100)}%`]);
      rows.push(["School", `${Math.round(info.edu * 100)}%`]);
      rows.push(["Hospital", `${Math.round(info.health * 100)}%`]);
      rows.push(["Harbor link", `${Math.round((info.cargo || 0) * 100)}%`]);
      rows.push(["Pollution", info.pollution < 0.05 ? "None" : info.pollution.toFixed(2)]);
    }
    panel.innerHTML = `<h3>${title}</h3>
      <p>${tile.x}, ${tile.z}</p>
      <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      ${tile.kind ? '<button type="button" id="demo-lot">Demolish</button>' : '<p class="mute">Choose a tool, then tap a lot.</p>'}`;
    panel.classList.add("show");
    state.selected = tile;
    panel.querySelector("#demo-lot")?.addEventListener("click", () => {
      const kind = tile.kind;
      if (demolish(city, tile.x, tile.z)) {
        state.selected = null;
        inspect(null);
        if (kind === "road" || kind === "pier") buildTerrain(city);
        rebuildCityMeshes(city);
        refresh();
      }
    });
  }

  function hint(cell, valid) {
    const el = document.getElementById("hint");
    if (!cell || !state.tool) {
      el.textContent = DEVICE.touch
        ? "Tap to place · hold to demolish · pinch to zoom"
        : "LMB place / inspect · RMB or Delete demolish · R rotate";
      return;
    }
    const why = !valid ? placeBlockReason(city, cell.x, cell.z, state.tool) : "";
    el.textContent =
      `${DEFS[state.tool].label} · ${cell.x},${cell.z}` + (valid ? "" : ` · ${why || "blocked"}`);
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  return { refresh, inspect, hint, toast, setTool, syncTransport };
}
