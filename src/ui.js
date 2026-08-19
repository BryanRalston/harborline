import { DEFS, TOOLS, refundFor } from "./buildings.js";
import { demolish, placeBlockReason, reopenLot, takeLoan, tileAt, undoLast, upgradeLot } from "./city.js";
import { buildLabel, isBuilt, rushBuild, rushCost } from "./construction.js";
import { contractProgress, inspectLocal, skipContract, LAWS, toggleLaw } from "./economy.js";
import { clearSave, loadCity, saveCity } from "./save.js";
import { buildTerrain, DEVICE, rebuildCityMeshes, refreshOverlay, setDayNight, setOverlayMode } from "./render.js";

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
  clinic: '<svg viewBox="0 0 24 24"><path d="M5 21V8h14v13M12 11v6M9 14h6"/></svg>',
  school: '<svg viewBox="0 0 24 24"><path d="M3 10 12 5l9 5-9 5-9-5zM6 12v5c3 2 9 2 12 0v-5"/></svg>',
  civic: '<svg viewBox="0 0 24 24"><path d="M4 20h16M6 20V10h12v10M12 4l9 6H3z"/></svg>',
  fire: '<svg viewBox="0 0 24 24"><path d="M12 3c2 4-1 5 1 8 2 2 4 3 4 6a5 5 0 0 1-10 0c0-3 3-5 3-8 0-2 1-4 2-6z"/></svg>',
  pier: '<svg viewBox="0 0 24 24"><path d="M3 11h18M6 11v8M12 11v8M18 11v8M3 19h18"/></svg>',
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
  let overlay = null;
  function setMap(mode) {
    overlay = overlay === mode ? null : mode;
    setOverlayMode(overlay);
    refreshOverlay(city);
    document.getElementById("map-access").classList.toggle("on", overlay === "access");
    document.getElementById("map-pollution").classList.toggle("on", overlay === "pollution");
    document.getElementById("map-value").classList.toggle("on", overlay === "value");
    document.getElementById("map-cover")?.classList.toggle("on", overlay === "cover");
    document.getElementById("map-traffic")?.classList.toggle("on", overlay === "traffic");
  }
  document.getElementById("map-access").addEventListener("click", () => setMap("access"));
  document.getElementById("map-pollution").addEventListener("click", () => setMap("pollution"));
  document.getElementById("map-value").addEventListener("click", () => setMap("value"));
  document.getElementById("map-cover")?.addEventListener("click", () => setMap("cover"));
  document.getElementById("map-traffic")?.addEventListener("click", () => setMap("traffic"));
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
    const panel = document.getElementById("laws");
    const on = !panel.classList.contains("show");
    panel.classList.toggle("show", on);
    document.getElementById("btn-laws")?.classList.toggle("on", on);
    if (on) {
      document.getElementById("books")?.classList.remove("show");
      document.getElementById("log")?.classList.remove("show");
      document.getElementById("btn-log")?.classList.remove("on");
      renderLaws();
    }
  }
  document.getElementById("btn-laws")?.addEventListener("click", () => toggleLaws());
  document.getElementById("btn-log").addEventListener("click", () => {
    const panel = document.getElementById("log");
    const on = !panel.classList.contains("show");
    panel.classList.toggle("show", on);
    document.getElementById("btn-log").classList.toggle("on", on);
    if (on) {
      const rows = (city.log || []).map((e) => `<li><span>W${e.week}</span>${e.msg}</li>`).join("") || "<li>No events yet.</li>";
      panel.innerHTML = `<h3>Harbor log</h3><ul class="log-list">${rows}</ul>`;
    }
  });
  document.getElementById("btn-loan").addEventListener("click", () => {
    if ((city.loanTicks || 0) > 0) {
      toast(`${city.loanTicks} payments left on the bond.`);
      return;
    }
    if (!takeLoan(city)) {
      toast("A bond is already open.");
      return;
    }
    refresh();
    toast("Bond issued: $8,000.");
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
      buildTerrain(city);
      rebuildCityMeshes(city);
      setDayNight(city.time);
      refresh();
      syncTransport();
      toast("City loaded.");
    } else toast("No save yet.");
  });
  document.getElementById("stat-money")?.parentElement?.addEventListener("click", () => {
    const panel = document.getElementById("books");
    const on = !panel.classList.contains("show");
    panel.classList.toggle("show", on);
    if (on) {
      const s = city.stats || {};
      const rows = [
        ["Wages", money(s.wageTax || 0)],
        ["Property", money(s.property || 0)],
        ["Shops", money(s.commerce || 0)],
        ["Harbor", money((s.pierBonus || 0) + (s.shipping || 0) + (s.tourism || 0))],
        ["Upkeep", money(s.upkeep || 0)],
        ["Bond left", s.loanTicks ? `${s.loanTicks} ticks` : "None"],
        ["Commute", s.commute ? `${s.commute} min` : "—"],
        ["Jammed streets", String(s.congested || 0)],
        ["Smoke levy", money(s.levy || 0)],
      ];
      panel.innerHTML = `<h3>Books</h3><dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
    }
  });
  document.getElementById("contract")?.addEventListener("click", () => {
    if (!city.contract) return;
    if (!window.confirm(`Pass on “${city.contract.label}” for $250?`)) return;
    skipContract(city);
    refresh();
    toast("Passed. New job posted.");
  });
  document.getElementById("digest-ok")?.addEventListener("click", () => {
    city.digest = null;
    document.getElementById("digest").classList.add("hidden");
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
    const weekEl = document.getElementById("stat-week");
    if (weekEl) weekEl.textContent = String(s.week || 0);
    document.getElementById("warn").classList.toggle("hidden", !city.bankruptWarn);
    const demand = s.demand || {};
    for (const key of ["home", "work", "shop", "port", "edu", "health"]) {
      const el = document.querySelector(`#demand [data-d="${key}"] i`);
      if (el) el.style.setProperty("--p", `${Math.round((demand[key] || 0) * 100)}%`);
    }
    const adv = document.getElementById("advisor");
    if (adv) adv.textContent = s.advisor || "";
    const con = document.getElementById("contract");
    if (con) {
      const c = s.contract;
      if (!c) con.textContent = "";
      else {
        const prog = contractProgress(c, s);
        con.textContent = `${c.label}${prog ? ` · ${prog}` : ""} · ${c.weeks} wk · $${c.reward.toLocaleString("en-US")} · tap to pass`;
      }
    }
    const bud = document.getElementById("budget");
    if (bud && s) {
      const loan = s.loanTicks ? ` · bond ${s.loanTicks}` : "";
      bud.textContent = `In ${money(s.income || 0)} · out ${money(s.upkeep || 0)}${loan}`;
    }
    const loanBtn = document.getElementById("btn-loan");
    if (loanBtn) loanBtn.classList.toggle("on", (city.loanTicks || 0) > 0);
    const d = s.demand || {};
    for (const el of rail.querySelectorAll("button[data-tool]")) {
      const id = el.dataset.tool;
      const spec = DEFS[id];
      el.classList.toggle("poor", !!(spec && spec.cost > 0 && city.treasury < spec.cost));
      const need =
        (d.home > 0.62 && (id === "house" || id === "apartment" || id === "tower")) ||
        (d.work > 0.62 && (id === "office" || id === "warehouse" || id === "factory")) ||
        (d.shop > 0.62 && id === "shop") ||
        (d.port > 0.62 && id === "pier") ||
        (d.edu > 0.18 && id === "school") ||
        (d.health > 0.18 && (id === "hospital" || id === "clinic")) ||
        ((city.stats?.fires || 0) < 1 && (city.stats?.demand?.work || 0) > 0.4 && id === "fire");
      el.classList.toggle("need", need);
    }
    if (city.events && city.events.length) {
      const msg = city.events.shift();
      if (msg) toast(msg);
    }
    if (city.digest) {
      const box = document.getElementById("digest");
      if (box && box.classList.contains("hidden")) {
        document.getElementById("digest-title").textContent = `Week ${city.digest.week}`;
        document.getElementById("digest-body").textContent =
          `${city.digest.people}. ${city.digest.cash}. Mood ${city.digest.mood}%.` +
          (city.digest.commute ? ` Commute ${city.digest.commute} min.` : "") +
          (city.digest.extra ? ` ${city.digest.extra}` : "");
        box.classList.remove("hidden");
      }
    }
    if (city.dayAuto) document.getElementById("day").value = String(city.time);
    if (overlay) refreshOverlay(city);
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
    if (!spec) {
      if (info?.suit && tile.terrain !== "water") {
        const suit = info.suit;
        const ranked = [
          ["Homes", suit.home],
          ["Shops", suit.shop],
          ["Jobs", suit.work],
          ["Harbor", suit.port],
        ].sort((a, b) => b[1] - a[1]);
        rows.push(["Best here", `${ranked[0][0]} ${Math.round(ranked[0][1] * 100)}%`]);
        rows.push(["Also", ranked.slice(1).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(" · ")]);
      }
      if (city.stats?.advisor) rows.push(["Advice", city.stats.advisor]);
      if (city.contract) rows.push(["Contract", city.contract.label]);
    }
    if (spec && !isBuilt(tile)) {
      rows.push(["Status", buildLabel(tile.kind, tile.build || 0)]);
      rows.push(["Progress", `${Math.round((tile.build || 0) * 100)}%`]);
      rows.push(["Rush", money(rushCost(tile))]);
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
      if (info?.abandoned) rows.push(["Status", "Abandoned — reconnect the road or reopen"]);
      if (info && Number.isFinite(info.value)) rows.push(["Land value", `${Math.round(info.value * 100)}%`]);
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
      if (spec.jobs) {
        rows.push(["Jobs", `${tile.jobs.toFixed(1)} / ${spec.jobs}`]);
        if (info) rows.push(["Labor nearby", `${Math.round(info.nearbyPop || 0)}`]);
      }
      rows.push(["Upkeep", `${money(spec.upkeep)} / tick`]);
      rows.push(["Refund", money(tile.starter ? 0 : refundFor(tile.kind))]);
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
      ${spec && !isBuilt(tile) ? `<button type="button" id="rush-lot">Rush · ${money(rushCost(tile))}</button>` : ""}
      ${spec && spec.category !== "infra" && tile.kind !== "bulldoze" ? `<button type="button" id="copy-lot">Build more ${spec.label.toLowerCase()}s</button>` : ""}
      ${spec?.upgrade && !tile.abandoned && isBuilt(tile) ? `<button type="button" id="up-lot">Upgrade to ${DEFS[spec.upgrade].label} · $${spec.upgradeCost.toLocaleString("en-US")}</button>` : ""}
      ${tile.abandoned && tile.kind ? '<button type="button" id="reopen-lot">Reopen $180</button>' : ""}
      ${tile.kind ? '<button type="button" id="demo-lot">Demolish</button>' : '<p class="mute">Choose a tool, then tap a lot.</p>'}`;
    panel.classList.add("show");
    state.selected = tile;
    panel.querySelector("#rush-lot")?.addEventListener("click", () => {
      const fee = rushBuild(city, tile.x, tile.z);
      if (fee) {
        rebuildCityMeshes(city);
        refresh();
        inspect(tileAt(city, tile.x, tile.z));
        toast(`Rushed for ${money(fee)}.`);
      } else toast("Cannot rush that site.");
    });
    panel.querySelector("#copy-lot")?.addEventListener("click", () => {
      state.tool = tile.kind;
      setTool(state.tool);
      toast(`${spec.label} tool.`);
    });
    panel.querySelector("#up-lot")?.addEventListener("click", () => {
      if (upgradeLot(city, tile.x, tile.z)) {
        rebuildCityMeshes(city);
        refresh();
        inspect(tileAt(city, tile.x, tile.z));
        toast("Upgrade started.");
      } else toast(city.treasury < (spec.upgradeCost || 0) ? "Not enough cash." : "Cannot upgrade that lot.");
    });
    panel.querySelector("#reopen-lot")?.addEventListener("click", () => {
      if (reopenLot(city, tile.x, tile.z)) {
        rebuildCityMeshes(city);
        refresh();
        inspect(tileAt(city, tile.x, tile.z));
        toast("Reopened.");
      } else toast(city.treasury < 180 ? "Not enough cash." : "Needs a road on the main network.");
    });
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

  function hint(cell, valid, extra) {
    const el = document.getElementById("hint");
    if (extra) {
      el.textContent = extra;
      return;
    }
    if (!cell || !state.tool) {
      el.textContent = DEVICE.touch
        ? "Tap to place · hold to demolish · pinch to zoom"
        : "LMB drag roads · RMB drag demolish · R rotate";
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

  return { refresh, inspect, hint, toast, setTool, syncTransport, setMap, toggleLaws };
}
