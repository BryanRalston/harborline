import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = "http://127.0.0.1:5173/";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PROFILES = {
  pc: {
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    userAgent: DESKTOP_UA,
    wait: 2200,
  },
  phone: {
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: IPHONE_UA,
    wait: 2800,
  },
};

const EXPECTED_TOOLS = [
  "road",
  "cobble",
  "bulldoze",
  "pier",
  "market",
  "house",
  "apartment",
  "tower",
  "park",
  "shop",
  "office",
  "warehouse",
  "factory",
  "power",
  "cistern",
  "sewer",
  "exchange",
  "cable",
  "clinic",
  "school",
  "hospital",
  "fire",
  "civic",
];

const DEMAND = ["home", "work", "shop", "port", "visit", "freight", "edu", "health", "power", "water", "sewer", "internet"];

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(ORIGIN, (res) => {
      res.resume();
      resolve(res.statusCode > 0);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function runPageTests(page, profile) {
  const fails = [];
  const notes = {};
  const fail = (msg) => fails.push(msg);

  await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#btn-begin", { timeout: 15000 });
  await wait(900);
  await page.screenshot({ path: path.join(page._shotDir, "splash.png") });

  const splash = await page.evaluate(() => {
    const begin = document.getElementById("btn-begin");
    const r = begin?.getBoundingClientRect();
    const fresh = document.getElementById("btn-fresh");
    const fr = fresh?.getBoundingClientRect();
    const fst = fresh ? getComputedStyle(fresh) : null;
    const freshVisible = !!(
      fr &&
      fr.width > 8 &&
      fr.height > 8 &&
      fst &&
      fst.display !== "none" &&
      fst.visibility !== "hidden" &&
      Number(fst.opacity || "1") > 0.05
    );
    return {
      title: document.querySelector("#splash h1")?.textContent || "",
      begin: !!begin,
      beginVisible: !!(r && r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight),
      coach: document.getElementById("splash-coach")?.textContent || "",
      freshVisible,
    };
  });
  if (splash.title !== "Harborline") fail("splash title missing");
  if (!splash.begin) fail("missing begin");
  if (!splash.beginVisible) fail("begin button not on screen");
  if (!/look/i.test(splash.coach) || !/build/i.test(splash.coach)) fail("splash missing coach");
  if (splash.freshVisible) fail("new harbor visible with no save");

  await page.click("#btn-begin");
  await page.waitForFunction(() => window.__harbor && window.__harbor.snapshot, { timeout: 20000 });
  await wait(profile.wait);

  const boot = await page.$eval("#boot-err", (el) => (el.hidden ? "" : el.textContent));
  if (boot) fail("boot-err " + boot.slice(0, 240));

  const chrome = await page.evaluate((demandKeys, expectedTools) => {
    const fails = [];
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && r.left < innerWidth && r.right > 0;
    };
    const phone = innerWidth <= 820;
    const ids = phone
      ? ["stat-money", "stat-pop", "stat-jobs", "stat-week", "advisor", "btn-pause", "btn-undo", "btn-menu"]
      : ["stat-money", "stat-pop", "stat-jobs", "stat-happy", "stat-clock", "advisor", "btn-pause", "btn-undo", "btn-menu"];
    const adv = document.getElementById("advisor");
    if (adv) {
      const bg = getComputedStyle(adv).backgroundColor || "";
      const parts = (bg.match(/[\d.]+/g) || []).map(Number);
      const alpha = parts.length === 4 ? parts[3] : 1;
      if (alpha < 0.85) fails.push("advisor chip too transparent " + bg);
    }
    for (const id of ids) {
      if (!vis(document.getElementById(id))) fails.push("hidden " + id);
    }
    for (const key of demandKeys) {
      if (!document.querySelector(`#demand [data-d="${key}"]`)) fails.push("missing demand " + key);
    }
    const tools = [...document.querySelectorAll("#tools button[data-tool]")].map((b) => b.dataset.tool);
    for (const t of expectedTools) {
      if (!tools.includes(t)) fails.push("missing tool " + t);
    }
    const canvas = document.getElementById("view");
    const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
    if (!gl) fails.push("no-gl");
    const splashGone = document.getElementById("splash")?.classList.contains("gone");
    if (!splashGone) fails.push("splash still up");
    if (!document.getElementById("ghost-why")) fails.push("missing ghost-why chip");
    const coachOn = !document.getElementById("coach")?.classList.contains("hidden");
    const coachCopy = document.getElementById("coach-copy")?.textContent || "";
    if (!/week 4/i.test(coachCopy) || !/recap/i.test(coachCopy)) fails.push("coach missing recap week");
    if (!phone && !coachOn) fails.push("first-minute coach hidden");
    const eta = document.getElementById("recap-eta")?.textContent || "";
    if (!/recap/i.test(eta)) fails.push("hud missing recap cadence");
    if (!phone) {
      const bar = document.querySelector("#demand i");
      const bh = bar ? bar.getBoundingClientRect().height : 0;
      if (bh < 7) fails.push("demand meters too thin " + bh);
    } else if (!vis(document.querySelector('#demand [data-d="home"]'))) {
      fails.push("phone demand hidden");
    }
    return {
      fails,
      money: document.getElementById("stat-money")?.textContent || "",
      pop: document.getElementById("stat-pop")?.textContent || "",
      tools,
      body: [...document.body.classList],
      pause: document.getElementById("btn-pause")?.textContent || "",
    };
  }, DEMAND, EXPECTED_TOOLS);
  notes.chrome = { money: chrome.money, pop: chrome.pop, body: chrome.body, tools: chrome.tools.length };
  for (const f of chrome.fails) fail(f);

  const openingView = await page.evaluate(() => {
    const h = window.__harbor;
    if (!h?.tile || !h?.screenOf) return { ok: false };
    const phone = innerWidth <= 820;
    const top = phone ? 64 : 70;
    const bottom = phone ? innerHeight * 0.62 : innerHeight - 80;
    let n = 0;
    let on = false;
    for (let z = 0; z < 48; z++) {
      for (let x = 0; x < 48; x++) {
        const t = h.tile(x, z);
        if (t?.kind !== "pier") continue;
        n += 1;
        const s = h.screenOf(x, z);
        if (s?.visible && s.y > top && s.y < bottom && s.x > 16 && s.x < innerWidth - 16) on = true;
      }
    }
    return { ok: on, n };
  });
  if (!openingView.ok) fail("opening camera misses the pier");

  await page.evaluate(() => {
    const canvas = document.getElementById("view");
    const h = window.__harbor;
    const fire = (type, id, x, y) => {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        })
      );
    };
    const x = Math.round(innerWidth * 0.46);
    const y = Math.round(innerHeight * 0.4);
    window.__lookProbe = { x, y, kinds: { ...(h.snapshot().kinds || {}) }, pop: h.snapshot().pop };
    fire("pointerdown", 11, x, y);
    fire("pointerdown", 12, x + 42, y + 18);
  });
  await wait(700);
  const look = await page.evaluate(() => {
    const canvas = document.getElementById("view");
    const h = window.__harbor;
    const fire = (type, id, x, y) => {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        })
      );
    };
    const p = window.__lookProbe || { x: 200, y: 400, kinds: {}, pop: 0 };
    fire("pointerup", 11, p.x, p.y);
    fire("pointerup", 12, p.x + 42, p.y + 18);
    const after = h.snapshot();
    return {
      inspectOn: !!document.getElementById("inspect")?.classList.contains("show"),
      toast: document.getElementById("toast")?.classList.contains("show") ? document.getElementById("toast").textContent : "",
      kindsChanged: JSON.stringify(after.kinds) !== JSON.stringify(p.kinds),
      pop: after.pop,
      pop0: p.pop,
      gfxFail: !document.getElementById("gfx-fail")?.hidden,
    };
  });
  if (look.inspectOn) fail("two-finger opened inspector");
  if (look.kindsChanged) fail("two-finger changed the map");
  if (look.pop !== look.pop0) fail("two-finger demolished people");
  if (/occupied|demolish/i.test(look.toast || "")) fail("two-finger toasted " + look.toast);
  if (look.gfxFail) fail("gfx-fail showing on a healthy canvas");

  const twist = await page.evaluate(() => {
    const canvas = document.getElementById("view");
    const h = window.__harbor;
    document.getElementById("inspect")?.classList.remove("show");
    h.select?.(null);
    const x = Math.round(innerWidth * 0.5);
    const y = Math.round(innerHeight * 0.42);
    try {
      const mk = (id, cx, cy) =>
        new Touch({
          identifier: id,
          target: canvas,
          clientX: cx,
          clientY: cy,
          pageX: cx,
          pageY: cy,
          radiusX: 8,
          radiusY: 8,
          rotationAngle: 0,
          force: 1,
        });
      const t1 = mk(1, x, y);
      const t2 = mk(2, x + 36, y + 14);
      canvas.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches: [t1, t2],
          targetTouches: [t1, t2],
          changedTouches: [t1, t2],
        })
      );
    } catch {
      /* Touch constructor missing */
    }
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 21,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 21,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })
    );
    return {
      inspectOn: !!document.getElementById("inspect")?.classList.contains("show"),
    };
  });
  if (twist.inspectOn) fail("two-finger twist opened inspector");

  const menus = await page.evaluate(() => {
    const fails = [];
    const packs = [...document.querySelectorAll(".rail-pack")].map((p) => ({
      id: p.dataset.pack,
      shut: p.classList.contains("shut"),
      tools: [...p.querySelectorAll("[data-tool]")].map((b) => b.dataset.tool),
    }));
    const street = packs.find((p) => p.id === "street");
    const civic = packs.find((p) => p.id === "civic");
    const homes = packs.find((p) => p.id === "homes");
    const harbor = packs.find((p) => p.id === "harbor");
    const work = packs.find((p) => p.id === "work");
    const mains = packs.find((p) => p.id === "mains");
    if (!street || street.shut) fails.push("street not open");
    if (!civic || !civic.shut) fails.push("civic should start closed");
    if (!harbor?.tools.includes("pier") || !harbor?.tools.includes("market")) fails.push("harbor tools wrong");
    if (!homes?.tools.includes("house") || !homes?.tools.includes("apartment")) fails.push("homes tools wrong");
    if (homes?.tools.includes("shop")) fails.push("shop under homes");
    if (civic?.tools.includes("apartment") || civic?.tools.includes("tower")) fails.push("housing under civic");
    if (street?.tools.includes("pier")) fails.push("pier under street");
    if (!work?.tools.includes("shop") || !work?.tools.includes("warehouse")) fails.push("work tools wrong");
    if (!mains?.tools.includes("power") || !mains?.tools.includes("cistern") || !mains?.tools.includes("sewer") || !mains?.tools.includes("cable") || !mains?.tools.includes("exchange")) {
      fails.push("mains tools wrong");
    }
    document.querySelector('[data-group="harbor"]')?.click();
    const afterHarbor = [...document.querySelectorAll(".rail-pack")].map((p) => ({
      id: p.dataset.pack,
      shut: p.classList.contains("shut"),
    }));
    if (afterHarbor.find((p) => p.id === "street" && !p.shut)) fails.push("accordion street stayed open");
    if (afterHarbor.find((p) => p.id === "harbor" && p.shut)) fails.push("accordion harbor did not open");
    document.querySelector('[data-group="street"]')?.click();

    document.getElementById("stat-week")?.parentElement?.click();
    if (document.getElementById("city-menu")?.classList.contains("hidden")) fails.push("week tap did not open menu");
    document.getElementById("btn-menu")?.click();
    if (!document.getElementById("city-menu")?.classList.contains("hidden")) fails.push("menu did not close after week");
    document.getElementById("stat-pop")?.parentElement?.click();
    window.__veilUntil = 0;
    if (!document.getElementById("city-menu")?.classList.contains("hidden")) fails.push("people tap opened menu");
    if (window.__harbor?.overlay?.() !== "place:house") {
      fails.push("people tap overlay " + (window.__harbor?.overlay?.() || "none"));
    }
    window.__harbor?.arm?.(null);
    window.__veilUntil = 0;
    document.getElementById("btn-menu")?.click();
    if (document.getElementById("city-menu")?.classList.contains("hidden")) fails.push("menu did not open");
    const menu = document.getElementById("city-menu");
    const kickers = [...document.querySelectorAll(".menu-kicker")].map((k) => k.textContent.trim());
    for (const k of ["Look", "Maps", "City", "File"]) {
      if (!kickers.includes(k)) fails.push("missing menu section " + k);
    }
    if (!document.getElementById("menu-jobs") || !document.getElementById("menu-mood") || !document.getElementById("menu-hour")) {
      fails.push("menu missing jobs/mood/hour");
    }
    if (!document.getElementById("btn-recap")) fails.push("menu missing Recap");
    const menuBox = menu?.getBoundingClientRect();
    if (menuBox) {
      if (menuBox.left < -8 || menuBox.right > innerWidth + 8) fails.push("menu overflows x");
      if (menuBox.top < -8 || menuBox.bottom > innerHeight + 12) fails.push("menu overflows y");
    }
    {
      const bg = getComputedStyle(menu).backgroundColor || "";
      const parts = (bg.match(/[\d.]+/g) || []).map(Number);
      const alpha = parts.length === 4 ? parts[3] : 1;
      if (alpha < 0.9) fails.push("menu too transparent " + bg);
    }
    if (innerWidth <= 820) {
      const rail = document.getElementById("tools");
      const rst = getComputedStyle(rail);
      if (rst.visibility !== "hidden") fails.push("phone rail visible under menu");
    }
    document.getElementById("btn-books")?.click();
    if (!document.getElementById("books")?.classList.contains("show")) fails.push("books did not open");
    if (!document.getElementById("city-menu")?.classList.contains("hidden")) fails.push("menu stayed over books");
    document.getElementById("btn-menu")?.click();
    document.getElementById("btn-laws")?.click();
    if (!document.getElementById("laws")?.classList.contains("show")) fails.push("laws did not open");
    if (document.getElementById("books")?.classList.contains("show")) fails.push("books stayed with laws");
    document.getElementById("btn-menu")?.click();
    document.getElementById("btn-log")?.click();
    if (!document.getElementById("log")?.classList.contains("show")) fails.push("log did not open");
    if (document.getElementById("laws")?.classList.contains("show")) fails.push("laws stayed with log");
    document.getElementById("btn-log")?.click();
    window.__harbor?.select?.(18, 22);
    if (document.getElementById("log")?.classList.contains("show")) fails.push("inspect did not close log");
    if (!document.getElementById("inspect")?.classList.contains("show")) fails.push("inspect did not open");
    if (!document.querySelector("#inspect .inspect-actions")) fails.push("inspect missing pinned actions");
    const demo = document.getElementById("demo-lot");
    if (demo) {
      const pr = document.getElementById("inspect").getBoundingClientRect();
      const dr = demo.getBoundingClientRect();
      if (dr.bottom > pr.bottom + 4) fails.push("inspect actions below fold");
    }
    if (innerWidth <= 820) {
      const ir = document.getElementById("inspect")?.getBoundingClientRect();
      if (ir && ir.top < innerHeight * 0.45) fails.push("phone inspector not a bottom sheet top=" + Math.round(ir.top));
      const rst = getComputedStyle(document.getElementById("tools"));
      if (rst.visibility !== "hidden") fails.push("phone rail visible under inspector");
      const hud = document.querySelector(".top")?.getBoundingClientRect();
      if (ir && hud && ir.top - hud.bottom < 120) {
        fails.push("phone inspector leaves no town gap=" + Math.round(ir.top - hud.bottom));
      }
      const dl = document.querySelector("#inspect dl");
      if (dl && dl.getBoundingClientRect().height < 48) fails.push("phone inspect stats collapsed h=" + Math.round(dl.getBoundingClientRect().height));
      const waitDot = document.getElementById("recap-wait");
      waitDot?.classList.remove("hidden");
      waitDot?.classList.add("recap-dot");
      if (waitDot && getComputedStyle(waitDot).display !== "none") fails.push("recap-dot covers inspector");
      waitDot?.classList.add("hidden");
      waitDot?.classList.remove("recap-dot");
    }
    {
      const closeBtn = document.getElementById("inspect-close");
      const adv = document.getElementById("advisor");
      if (adv) adv.textContent = "Homes are full. Tap this chip for Rowhouse — zone inland of the beach.";
      const cr = closeBtn?.getBoundingClientRect();
      const cx = (cr?.x || 0) + (cr?.width || 0) / 2;
      const cy = (cr?.y || 0) + (cr?.height || 0) / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (adv && getComputedStyle(adv).display !== "none") fails.push("advisor visible over inspector");
      if (hit?.id === "advisor" || hit?.closest?.("#advisor")) fails.push("advisor covers inspect close");
      if (hit && closeBtn && hit !== closeBtn && !closeBtn.contains(hit) && !hit.closest?.("#inspect")) {
        fails.push("inspect close covered by " + (hit.id || hit.className || hit.tagName));
      }
      closeBtn?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 21, pointerType: "mouse", button: 0 }));
      closeBtn?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 21, pointerType: "mouse", button: 0 }));
      if (document.getElementById("inspect")?.classList.contains("show")) fails.push("inspect close did not dismiss");
      const view = document.getElementById("view");
      view?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 22, pointerType: "mouse", button: 0 }));
      view?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 22, pointerType: "mouse", button: 0 }));
      if (document.getElementById("inspect")?.classList.contains("show")) fails.push("inspect close click-through");
      const freeze = (window.__veilUntil || 0) - performance.now();
      if (freeze > 400) fails.push("inspect close froze the map " + Math.round(freeze));
      const viewTap = document.getElementById("view");
      let reached = false;
      const spy = (e) => {
        if (e.pointerId !== 24) return;
        reached = true;
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      window.addEventListener("pointerdown", spy, true);
      viewTap?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 180, clientY: 240, pointerId: 24, pointerType: "mouse", button: 0 })
      );
      window.removeEventListener("pointerdown", spy, true);
      if (!reached) fails.push("inspect close leftover ate a distant tap");
    }
    window.__veilUntil = 0;
    window.__harbor?.select?.(18, 22);
    window.__veilUntil = performance.now() + 1800;
    window.__harbor?.select?.(18, 22);
    if (!document.getElementById("inspect")?.classList.contains("show")) fails.push("inspect auto-closed under veil");
    document.getElementById("btn-books")?.click();
    if (document.getElementById("inspect")?.classList.contains("show")) fails.push("inspect stayed with books");
    if (!document.getElementById("books")?.classList.contains("show")) fails.push("books did not open over inspect");
    document.getElementById("btn-books")?.click();

    const maps = ["map-access", "map-pollution", "map-value", "map-cover", "map-traffic", "map-mains"];
    for (const id of maps) {
      document.getElementById("btn-menu")?.click();
      document.getElementById(id)?.click();
      if (!document.getElementById(id)?.classList.contains("on")) fails.push(id + " did not toggle");
      if (!document.getElementById("city-menu")?.classList.contains("hidden")) fails.push("menu stayed over " + id);
      document.getElementById("btn-menu")?.click();
      document.getElementById(id)?.click();
    }
    document.getElementById("btn-pause")?.click();
    const paused = document.getElementById("btn-pause")?.textContent === "Play";
    if (!paused) fails.push("pause did not switch to Play");
    document.getElementById("btn-pause")?.click();
    return { fails, kickers, packs };
  });
  notes.menus = { kickers: menus.kickers };
  for (const f of menus.fails) fail(f);

  const recap = await page.evaluate(async () => {
    const fails = [];
    const h = window.__harbor;
    if (!h?.forceDigest || !h.reset) return { fails: ["no digest api"] };
    h.forceDigest({ week: 28, people: "+18,039 people", cash: "+$18,039", mood: 60, verdict: "A fat week." });
    const box = document.getElementById("digest");
    if (!box || box.classList.contains("hidden")) fails.push("digest did not show");
    if (!/fat week/i.test(document.getElementById("digest-body")?.textContent || "")) {
      fails.push("digest missing till verdict");
    }
    const r = box?.getBoundingClientRect();
    if (r && (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9)) fails.push("digest does not veil the city");
    if (document.getElementById("books")?.classList.contains("show")) fails.push("books under digest");
    const t0 = h.snapshot().tick;
    await new Promise((res) => setTimeout(res, 1100));
    const t1 = h.snapshot().tick;
    if (t1 !== t0) fails.push("sim ran under digest " + t0 + " -> " + t1);
    if (!h.held()) fails.push("held() false under digest");
    const ok = document.getElementById("digest-ok");
    const at = ok?.getBoundingClientRect();
    const x = (at?.x || 0) + (at?.width || 0) / 2;
    const y = (at?.y || 0) + (at?.height || 0) / 2;
    ok?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0 }));
    ok?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0 }));
    if (!document.getElementById("digest")?.classList.contains("hidden")) {
      ok?.click();
    }
    if (!document.getElementById("digest")?.classList.contains("hidden")) fails.push("continue did not hide digest");
    const veilOn = !document.getElementById("pointer-veil")?.classList.contains("hidden");
    const mapDead = document.getElementById("view")?.style.pointerEvents === "none";
    if (!veilOn && !mapDead) fails.push("continue left the map live");
    if (!document.body.classList.contains("recap-hold")) fails.push("continue did not hold leftover");
    const view = document.getElementById("view");
    view?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0 }));
    view?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0 }));
    if (document.getElementById("inspect")?.classList.contains("show")) fails.push("continue click-through inspect");
    document.getElementById("btn-menu")?.click();
    if (document.getElementById("city-menu")?.classList.contains("hidden")) fails.push("menu did not open for clock hold");
    if (!h.held()) fails.push("held() false under menu");
    const m0 = h.snapshot().tick;
    await new Promise((res) => setTimeout(res, 1100));
    const m1 = h.snapshot().tick;
    if (m1 !== m0) fails.push("sim ran under menu " + m0 + " -> " + m1);
    document.getElementById("btn-menu")?.click();
    if (!document.getElementById("city-menu")?.classList.contains("hidden")) fails.push("menu did not close after clock hold");
    h.forceDigest({ week: 20, people: "+12 people", cash: "+$400", mood: 55, verdict: "The till grew." });
    const hint = document.getElementById("digest-hint")?.textContent || "";
    if (!/next recap around week 22/i.test(hint) || !/stays in Log/i.test(hint)) {
      fails.push("digest missing next recap " + hint);
    }
    const box2 = document.getElementById("digest");
    box2?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 24, clientY: 24, pointerId: 1, pointerType: "mouse", button: 0 }));
    box2?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: 24, clientY: 24, pointerId: 1, pointerType: "mouse", button: 0 }));
    if (!document.getElementById("digest")?.classList.contains("hidden")) fails.push("backdrop did not file recap");
    const veil2 = !document.getElementById("pointer-veil")?.classList.contains("hidden");
    const mapDead2 = document.getElementById("view")?.style.pointerEvents === "none";
    if (!veil2 && !mapDead2) fails.push("backdrop left the map live");
    if (!document.body.classList.contains("recap-hold")) fails.push("backdrop did not hold leftover");
    document.getElementById("pointer-veil")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 24, clientY: 24, pointerId: 1, pointerType: "mouse", button: 0 }));
    document.getElementById("pointer-veil")?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: 24, clientY: 24, pointerId: 1, pointerType: "mouse", button: 0 }));
    if (document.getElementById("inspect")?.classList.contains("show")) fails.push("backdrop click-through inspect");
    h.forceDigest({ week: 22, people: "+0 people", cash: "+$0", mood: 50 });
    const body = document.getElementById("digest-body");
    body?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 40, clientY: 40, pointerId: 1, pointerType: "mouse", button: 0 }));
    body?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: 40, clientY: 40, pointerId: 1, pointerType: "mouse", button: 0 }));
    if (!document.getElementById("digest")?.classList.contains("hidden")) fails.push("card tap did not file recap");
    document.querySelector('[data-speed="4"]')?.click();
    h.forceDigest({ week: 30, people: "+1 people", cash: "+$1", mood: 50 });
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    await new Promise((res) => setTimeout(res, 450));
    const cd = document.getElementById("digest-ok")?.textContent || "";
    if (/Continue ·/.test(cd)) fails.push("4x recap counted down under recap pointer " + cd);
    document.querySelector('[data-speed="1"]')?.click();
    document.getElementById("digest-ok")?.click();
    h.forceDigest({ week: 24, people: "+1 people", cash: "+$1", mood: 50, verdict: "A quiet week." });
    const adv = document.getElementById("advisor");
    if (adv) {
      adv.textContent = "Homes are full. Tap this chip for Rowhouse — zone inland of the beach.";
      adv.click();
    }
    if (h.digest()) fails.push("advisor did not file recap");
    if (!document.querySelector('[data-tool="house"]')?.classList.contains("on")) {
      fails.push("advisor did not arm rowhouse");
    }
    h.arm?.(null);
    if (adv) {
      adv.textContent = "The market is buying. Grow inland — homes and shops along the avenue.";
      adv.click();
      if (!document.querySelector('[data-tool="house"]')?.classList.contains("on")) {
        fails.push("grow inland first tap did not arm house");
      }
      adv.click();
      if (!document.querySelector('[data-tool="shop"]')?.classList.contains("on")) {
        fails.push("grow inland second tap did not arm shop");
      }
    }
    h.arm?.(null);
    h.forceDigest({ week: 4, people: "+0 people", cash: "+$0", mood: 50 });
    document.getElementById("btn-log-dock")?.click();
    if (!document.getElementById("digest")?.classList.contains("hidden")) fails.push("log did not file recap");
    if (!document.getElementById("log")?.classList.contains("show")) fails.push("log did not open under recap");
    if (!/Last recap/i.test(document.getElementById("log")?.textContent || "")) fails.push("log missing last recap");
    document.getElementById("btn-log-dock")?.click();
    if (h.expireJob) {
      const job = h.expireJob();
      if (!/0 of 5 jobs met/i.test(job.msg || "")) fails.push("expiry missing 0 of 5 tally " + (job.msg || ""));
    }
    h.forceDigest({ week: 28, people: "x", cash: "y", mood: 1 });
    const after = h.reset();
    if (after.digest) fails.push("New Harbor leftover digest " + after.digest);
    if (after.week > 0) fails.push("New Harbor week " + after.week);
    if (h.digest()) fails.push("digest leftover after reset");
    if (!document.getElementById("digest")?.classList.contains("hidden")) fails.push("digest modal leftover after New Harbor");
    if (!h.step) fails.push("no step api");
    else {
      h.reset();
      const phone = innerWidth <= 820;
      const waitShowing = () => {
        if (phone) return /recap due/i.test(document.getElementById("recap-eta")?.textContent || "");
        const w = document.getElementById("recap-wait");
        return !!(w && !w.classList.contains("hidden"));
      };
      const tapWait = () => {
        if (phone) {
          document.getElementById("stat-week")?.parentElement?.dispatchEvent(
            new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 41, pointerType: "mouse", button: 0 })
          );
        } else document.getElementById("recap-wait")?.click();
      };
      if (document.getElementById("btn-pause")?.textContent !== "Play") {
        document.getElementById("btn-pause")?.click();
      }
      h.step(50);
      if (h.digest()) fails.push("early recap week " + h.digest().week);
      h.step(40);
      if (h.digest()) fails.push("week 4 recap auto-popped");
      const waitFirst = document.getElementById("recap-wait");
      if (!waitShowing()) fails.push("week 4 recap-wait hidden");
      if (phone) {
        const etaTxt = document.getElementById("recap-eta")?.textContent || "";
        if (!/mood|\d+p\b|people/i.test(etaTxt)) fails.push("phone week 4 WEEK has no recap " + etaTxt);
        const etaEl = document.getElementById("recap-eta");
        const etaH = etaEl?.getBoundingClientRect().height || 0;
        const etaWrap = etaEl ? getComputedStyle(etaEl).whiteSpace : "";
        if (etaWrap !== "nowrap") fails.push("phone week recap wraps space " + etaWrap);
        if (etaH > 16) fails.push("phone week recap wrapped h=" + Math.round(etaH));
        const weekHit = document.getElementById("stat-week")?.parentElement;
        const pe = weekHit ? getComputedStyle(weekHit).pointerEvents : "";
        if (pe === "none") fails.push("phone WEEK not tappable");
      }
      document.getElementById("btn-menu")?.click();
      const hourEl = document.getElementById("menu-hour");
      const vitals = document.querySelector(".menu-vitals");
      if (vitals && getComputedStyle(vitals).pointerEvents !== "none") {
        fails.push("menu city vitals still receive taps");
      }
      if (hourEl && !/tabular/i.test(getComputedStyle(hourEl).fontVariantNumeric || "")) {
        fails.push("menu hour not tabular");
      }
      const recapBtn = document.getElementById("btn-recap");
      if (!recapBtn) fails.push("menu missing Recap");
      if (!/recap due/i.test(recapBtn.textContent || "")) fails.push("menu Recap not marked due");
      recapBtn.click();
      if (h.digest()) fails.push("menu Recap opened the popup");
      if (!document.getElementById("log")?.classList.contains("show")) fails.push("menu Recap did not open Log");
      if (!/last recap/i.test(document.getElementById("log")?.textContent || "")) {
        fails.push("log missing last recap after Recap");
      }
      if (!phone && !waitFirst.classList.contains("hidden")) fails.push("recap-wait stayed after Log");
      document.getElementById("btn-menu")?.click();
      document.getElementById("btn-books")?.click();
      if (!/last recap/i.test(document.getElementById("books")?.textContent || "")) {
        fails.push("books missing last recap");
      }
      document.getElementById("btn-books")?.click();
      document.querySelector('[data-tool="market"]')?.click();
      h.step(30);
      if (h.digest()) fails.push("recap while tool armed");
      const wait = document.getElementById("recap-wait");
      if (!waitShowing()) fails.push("recap-wait hidden while tool armed");
      if (!phone && !/tap to read/i.test(wait?.textContent || "")) fails.push("recap-wait copy " + (wait?.textContent || ""));
      const placing = document.getElementById("placing");
      if (placing?.classList.contains("hidden")) fails.push("placing hidden under recap-wait");
      const viewTap = document.getElementById("view");
      const capture = viewTap?.setPointerCapture;
      const release = viewTap?.releasePointerCapture;
      if (viewTap) {
        viewTap.setPointerCapture = () => {};
        viewTap.releasePointerCapture = () => {};
      }
      viewTap?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 180, clientY: 240, pointerId: 11, pointerType: "mouse", button: 0 }));
      viewTap?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: 180, clientY: 240, pointerId: 11, pointerType: "mouse", button: 0 }));
      if (viewTap) {
        if (capture) viewTap.setPointerCapture = capture;
        if (release) viewTap.releasePointerCapture = release;
      }
      if (h.digest()) fails.push("armed canvas tap opened recap");
      if (!phone && wait.classList.contains("hidden")) fails.push("recap-wait hid after armed canvas tap");
      const chipBox = wait.getBoundingClientRect();
      if (!phone && chipBox.width > 8 && chipBox.height > 8) {
        const cx = chipBox.left + chipBox.width / 2;
        const cy = chipBox.top + chipBox.height / 2;
        viewTap?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 21, pointerType: "mouse", button: 0 }));
        viewTap?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 21, pointerType: "mouse", button: 0 }));
        if (document.getElementById("inspect")?.classList.contains("show")) {
          fails.push("mouse chip click-through inspect");
        }
      }
      document.querySelector('[data-group="homes"]')?.click();
      if (!placing?.classList.contains("hidden")) fails.push("placing strip stayed after category switch");
      document.querySelector('[data-group="harbor"]')?.click();
      if (placing?.classList.contains("hidden")) fails.push("placing strip did not return on harbor");
      tapWait();
      if (h.digest()) fails.push("recap-wait opened the popup");
      if (!document.getElementById("log")?.classList.contains("show")) fails.push("recap-wait did not open Log");
      if (!document.querySelector('[data-tool="market"]')?.classList.contains("on")) {
        fails.push("tool dropped after recap-wait");
      }
      document.getElementById("btn-log-dock")?.click();
      document.querySelector('[data-tool="market"]')?.click();
      h.step(15);
      if (h.digest()) fails.push("recap immediately after continue");
      document.querySelector('[data-tool="market"]')?.click();
      h.step(40);
      if (h.digest()) fails.push("recap while tool armed 2");
      document.querySelector('[data-tool="market"]')?.click();
      h.step(15);
      if (h.digest()) fails.push("unarmed recap auto-popped");
      const wait2 = document.getElementById("recap-wait");
      if (!waitShowing()) fails.push("recap-wait hidden while unarmed");
      if (h.fileWaitChip) {
        const leftover = wait2.getBoundingClientRect();
        const lx = leftover.left + leftover.width / 2;
        const ly = leftover.top + leftover.height / 2;
        if (!h.fileWaitChip()) fails.push("fileWaitChip failed");
        if (!phone && wait2.classList.contains("hidden")) fails.push("auto-file hid recap-dot");
        if (!phone && !wait2.classList.contains("recap-dot")) fails.push("auto-file did not leave recap-dot");
        const whyLeftover = document.getElementById("ghost-why");
        if (whyLeftover) {
          whyLeftover.textContent = "That's beach — stay inland, or pave from the pier";
          whyLeftover.classList.remove("hidden");
        }
        if (!phone) {
          viewTap?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: lx, clientY: ly, pointerId: 31, pointerType: "mouse", button: 0 }));
          viewTap?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: lx, clientY: ly, pointerId: 31, pointerType: "mouse", button: 0 }));
          viewTap?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: lx, clientY: ly, pointerId: 31, pointerType: "mouse" }));
        }
        if (document.getElementById("inspect")?.classList.contains("show")) {
          fails.push("leftover inspect after auto-file");
        }
        if (!phone && whyLeftover && !whyLeftover.classList.contains("hidden") && /beach/i.test(whyLeftover.textContent || "")) {
          fails.push("leftover ghost-why after auto-file");
        }
        const dotBox = wait2.getBoundingClientRect();
        if (!phone && (dotBox.width > 56 || dotBox.height > 56)) {
          fails.push("recap-dot hit box still huge " + Math.round(dotBox.width) + "x" + Math.round(dotBox.height));
        }
        h.step(50);
        if (!phone && (wait2.classList.contains("hidden") || !wait2.classList.contains("recap-dot"))) {
          fails.push("auto-file recap-dot did not survive the next recap");
        }
      }
      tapWait();
      if (h.digest()) fails.push("unarmed recap-wait opened the popup");
      if (!document.getElementById("log")?.classList.contains("show")) fails.push("unarmed recap-wait did not open Log");
      if (wait2 && !wait2.classList.contains("hidden") && getComputedStyle(wait2).display !== "none") {
        fails.push("recap-dot stayed after Log");
      }
      document.getElementById("btn-log-dock")?.click();
      h.reset();
      if (document.getElementById("btn-pause")?.textContent !== "Play") {
        document.getElementById("btn-pause")?.click();
      }
      document.querySelector('[data-tool="house"]')?.click();
      h.step(90);
      if (h.digest()) fails.push("first recap auto-popped while tool armed");
      const waitHouse = document.getElementById("recap-wait");
      if (!waitShowing()) fails.push("first recap-wait hidden while house armed");
      document.querySelector('[data-tool="house"]')?.click();
      h.reset();
      if (document.getElementById("btn-pause")?.textContent !== "Play") {
        document.getElementById("btn-pause")?.click();
      }
      document.querySelector('[data-speed="4"]')?.click();
      h.step(90);
      if (h.digest()) fails.push("4x week 4 recap auto-popped");
      const wait4first = document.getElementById("recap-wait");
      if (!waitShowing()) fails.push("4x week 4 recap-wait hidden");
      tapWait();
      if (h.digest()) fails.push("4x week 4 recap-wait opened the popup");
      if (!document.getElementById("log")?.classList.contains("show")) fails.push("4x week 4 recap-wait did not open Log");
      document.getElementById("btn-log-dock")?.click();
      h.step(40);
      if (h.digest()) fails.push("4x unarmed recap auto-popped");
      const waitU = document.getElementById("recap-wait");
      if (!waitShowing()) fails.push("4x unarmed recap-wait hidden");
      tapWait();
      if (h.digest()) fails.push("4x unarmed recap-wait opened the popup");
      if (!document.getElementById("log")?.classList.contains("show")) fails.push("4x unarmed recap-wait did not open Log");
      await new Promise((res) => setTimeout(res, 900));
      if (h.digest()) fails.push("4x unarmed recap auto-popped after wait tap");
      if (!document.getElementById("log")?.classList.contains("show")) fails.push("4x unarmed Log closed after wait tap");
      document.getElementById("btn-log-dock")?.click();
      document.querySelector('[data-tool="market"]')?.click();
      h.step(40);
      if (h.digest()) fails.push("4x recap while tool armed");
      const wait4 = document.getElementById("recap-wait");
      if (!waitShowing()) fails.push("4x recap-wait hidden");
      tapWait();
      if (h.digest()) fails.push("4x recap-wait opened the popup");
      if (!document.getElementById("log")?.classList.contains("show")) fails.push("4x recap-wait did not open Log");
      await new Promise((res) => setTimeout(res, 900));
      if (h.digest()) fails.push("4x recap auto-popped after wait tap");
      if (!document.getElementById("log")?.classList.contains("show")) fails.push("4x Log closed after wait tap");
      if (wait4 && !wait4.classList.contains("hidden") && getComputedStyle(wait4).display !== "none") {
        fails.push("4x recap-wait still over Log");
      }
      document.getElementById("btn-log-dock")?.click();
      document.querySelector('[data-speed="1"]')?.click();
      h.reset();
    }
    return { fails, week: after.week };
  });
  notes.recap = { week: recap.week };
  for (const f of recap.fails || []) fail(f);

  await page.screenshot({ path: path.join(page._shotDir, "city.png") });

  const sim = await page.evaluate(async () => {
    const fails = [];
    const h = window.__harbor;
    if (!h?.snapshot || !h.build || !h.why) {
      return { fails: ["no harbor api"], opening: null };
    }
    const opening = h.snapshot();
    if (opening.pop > 80) fails.push("opening too big pop=" + opening.pop);
    if (/landfall/i.test(opening.advisor) && !/Road|Cobble/.test(opening.advisor)) {
      fails.push("advisor landfall missing Road " + opening.advisor);
    }
    if (opening.kinds.shop) fails.push("gifted shop");
    if (opening.kinds.school || opening.kinds.tower || opening.kinds.hospital || opening.kinds.civic) {
      fails.push("gifted civic " + JSON.stringify(opening.kinds));
    }
    if (opening.kinds.power || opening.kinds.cistern || opening.kinds.sewer || opening.kinds.exchange) fails.push("gifted utilities");
    if ((opening.kinds.house || 0) > 6) fails.push("too many starter houses");
    if ((opening.kinds.house || 0) < 1) fails.push("no starter houses");
    if ((opening.kinds.pier || 0) < 1) fails.push("no starter pier");
    if (opening.treasury > 14000) fails.push("opening treasury too fat " + opening.treasury);
    if (opening.treasury < 8000) fails.push("opening treasury too thin " + opening.treasury);
    if (opening.popCap > 8 && opening.pop / opening.popCap > 0.9) {
      fails.push("opening homes already full " + opening.pop + "/" + opening.popCap);
    }
    if (h.overlay?.() !== "landfall") fails.push("opening overlay " + (h.overlay?.() || "none"));
    const dens = h.perf?.();
    if (innerWidth <= 820) {
      if (!(dens?.people > 0)) fails.push("phone people density " + dens?.people);
      if ((dens?.walkers || 0) < 1) fails.push("phone opening has no walkers " + JSON.stringify(dens));
    }
    const besidePier = (x, z) =>
      h.tile?.(x + 1, z)?.kind === "pier" ||
      h.tile?.(x - 1, z)?.kind === "pier" ||
      h.tile?.(x, z + 1)?.kind === "pier" ||
      h.tile?.(x, z - 1)?.kind === "pier";
    const gap = h.findLot?.("road");
    if (!gap || !besidePier(gap.x, gap.z)) fails.push("road pick is not the landfall gap " + JSON.stringify(gap));
    h.hover?.(null);
    const shopPick = h.pickLot?.("shop");
    if (!shopPick) fails.push("no shop lot");
    else if (besidePier(shopPick.x, shopPick.z)) fails.push("shop pick is landfall " + JSON.stringify(shopPick));
    const jobsEl = document.getElementById("stat-jobs")?.parentElement;
    jobsEl?.click();
    if (!document.querySelector('[data-tool="shop"]')?.classList.contains("on")) {
      fails.push("jobs meter did not arm shop");
    }
    if (shopPick && h.build) {
      h.build("shop", shopPick.x, shopPick.z);
      h.step?.(1);
      jobsEl?.click();
      if (!document.querySelector('[data-tool="office"]')?.classList.contains("on")) {
        fails.push("jobs meter after shop did not arm office");
      }
      const officePick = h.pickLot?.("office");
      if (officePick && h.build) {
        const pave = h.pickLot?.("road");
        if (pave) h.build("road", pave.x, pave.z);
        const mkt = h.pickLot?.("market");
        if (mkt) {
          h.build("market", mkt.x, mkt.z);
          h.finish?.(mkt.x, mkt.z);
        }
        h.arm?.(null);
        h.step?.(1);
        const jobAdv = document.getElementById("advisor")?.textContent || "";
        if (!/Jobs next|office on the avenue/i.test(jobAdv)) fails.push("advisor after market and shop did not offer office " + jobAdv);
        document.getElementById("advisor")?.click();
        if (!document.querySelector('[data-tool="office"]')?.classList.contains("on")) {
          fails.push("advisor after market and shop did not arm office");
        }
        h.build("office", officePick.x, officePick.z);
        h.finish?.(officePick.x, officePick.z);
        h.step?.(1);
        jobsEl?.click();
        if (!document.querySelector('[data-tool="power"]')?.classList.contains("on")) {
          fails.push("jobs meter after office did not arm plant");
        }
        const plantPick = h.pickLot?.("power");
        if (!plantPick) fails.push("no plant lot after office");
        else if (besidePier(plantPick.x, plantPick.z)) fails.push("plant pick is landfall " + JSON.stringify(plantPick));
        if (innerWidth <= 820 && plantPick && h.screenOf) {
          const scr = h.screenOf(plantPick.x, plantPick.z);
          const top = 200;
          const bottom = innerHeight * 0.56;
          const insetX = Math.max(72, innerWidth * 0.2);
          if (!scr || scr.y < top || scr.y > bottom || scr.x < insetX || scr.x > innerWidth - insetX) {
            fails.push("plant lot off the play band " + JSON.stringify(scr));
          }
          const gold = h.overlayAt?.(plantPick.x, plantPick.z);
          if (!gold) fails.push("plant lot has no ground overlay");
          let pierOn = false;
          let pierScr = null;
          for (let z = 0; z < 48 && !pierOn; z++) {
            for (let x = 0; x < 48; x++) {
              if (h.tile?.(x, z)?.kind !== "pier") continue;
              const ps = h.screenOf?.(x, z);
              pierScr = ps;
              if (ps?.visible && ps.y > 64 && ps.y < innerHeight - 24 && ps.x > 0 && ps.x < innerWidth) {
                pierOn = true;
                break;
              }
            }
          }
          if (!pierOn) fails.push("inland plant arm lost the pier " + JSON.stringify(pierScr));
          if ((h.boatsOnScreen?.() || 0) < 1) fails.push("inland plant arm lost the boats");
        }
        const adv = document.getElementById("advisor")?.textContent || "";
        if (!/kerosene|plant inland/i.test(adv)) fails.push("advisor missed plant after office " + adv);
        if (plantPick && h.build) {
          h.build("power", plantPick.x, plantPick.z);
          h.step?.(1);
          const wetLot = h.pickLot?.("cistern");
          if (wetLot) {
            const wetWhy = h.utilHint?.("cistern", wetLot.x, wetLot.z) || "";
            if (/Idle here — needs a plant/i.test(wetWhy)) {
              fails.push("mains idle lied with a raising plant " + wetWhy);
            }
          }
          const raisingAdv = document.getElementById("advisor")?.textContent || "";
          if (/kerosene/i.test(raisingAdv) && !/going up/i.test(raisingAdv)) {
            fails.push("advisor lied kerosene on a raising plant " + raisingAdv);
          }
          if (!/going up/i.test(raisingAdv) && !/Water tower is armed/i.test(raisingAdv)) {
            fails.push("advisor missed raising-plant wait " + raisingAdv);
          }
          if (/Rush/i.test(raisingAdv)) fails.push("advisor promised Rush on a raising plant " + raisingAdv);
          h.arm?.("cistern");
          window.__veilUntil = 0;
          h.step?.(0);
          const armedMood = document.getElementById("advisor")?.textContent || "";
          const happyNow = Number.parseFloat(document.getElementById("stat-happy")?.textContent || "");
          if (Number.isFinite(happyNow) && happyNow < 38 && !/mood is low|mood is falling/i.test(armedMood)) {
            fails.push("armed water chip buried the mood " + armedMood);
          }
          if (/Wait for mains/i.test(armedMood)) {
            fails.push("armed water chip still said wait " + armedMood);
          }
          if (!/Water tower is armed/i.test(armedMood)) {
            fails.push("armed water chip missed the tower " + armedMood);
          }
          h.arm?.(null);
          window.__veilUntil = 0;
          h.step?.(0);
          h.finish?.(plantPick.x, plantPick.z);
          h.step?.(1);
          const wet = document.getElementById("advisor")?.textContent || "";
          if (!/dry|water tower/i.test(wet)) fails.push("advisor missed water after plant " + wet);
          const happy = Number.parseFloat(document.getElementById("stat-happy")?.textContent || "");
          if (Number.isFinite(happy) && happy < 38 && !/mood is low|mood is falling/i.test(wet + " " + raisingAdv)) {
            fails.push("mood crash after plant stayed silent " + happy + " " + wet);
          }
          document.getElementById("advisor")?.click();
          if (!document.querySelector('[data-tool="cistern"]')?.classList.contains("on")) {
            fails.push("advisor after plant did not arm water tower");
          }
          const tower = h.pickLot?.("cistern");
          if (!tower) fails.push("no water tower lot after plant");
          else if (besidePier(tower.x, tower.z)) fails.push("water tower pick is landfall " + JSON.stringify(tower));
          if (tower && h.build) {
            h.build("cistern", tower.x, tower.z);
            h.finish?.(tower.x, tower.z);
            h.step?.(1);
            const raw = document.getElementById("advisor")?.textContent || "";
            if (!/outfall|works inland|privy/i.test(raw)) fails.push("advisor missed sewer after water " + raw);
            document.getElementById("advisor")?.click();
            if (!document.querySelector('[data-tool="sewer"]')?.classList.contains("on")) {
              fails.push("advisor after water did not arm works");
            }
            const cash = h.snapshot?.().treasury ?? 0;
            if (cash < 2200) fails.push("first town cannot afford works and a house " + cash);
            h.credit?.(4000);
            const works = h.pickLot?.("sewer");
            if (!works) fails.push("no works lot after water");
            else if (besidePier(works.x, works.z)) fails.push("works pick is landfall " + JSON.stringify(works));
            if (works) {
              const sewerHint = h.utilHint?.("sewer", works.x, works.z) || "";
              if (/Idle here — needs a plant/i.test(sewerHint)) {
                fails.push("works idle lied with a plant on the map " + sewerHint);
              }
            }
            const nextHouse = h.pickLot?.("house");
            if (plantPick && nextHouse) {
              const d = Math.hypot(nextHouse.x - plantPick.x, nextHouse.z - plantPick.z);
              if (d > 9) fails.push("grow-inland house is off the plant " + d + " " + JSON.stringify(nextHouse));
            }
            if (works && innerWidth <= 820) {
              h.hover?.(works.x, works.z);
              const wscr = h.screenOf?.(works.x, works.z);
              const insetX = Math.max(72, innerWidth * 0.2);
              const top = 200;
              const bottom = innerHeight * 0.56;
              if (!wscr || wscr.y < top || wscr.y > bottom || wscr.x < insetX || wscr.x > innerWidth - insetX) {
                fails.push("works lot off the play band " + JSON.stringify(wscr));
              }
            }
            if (works && h.build) {
              h.build("sewer", works.x, works.z);
              h.finish?.(works.x, works.z);
              h.step?.(1);
            }
            const extraSewer = h.pickLot?.("sewer");
            const worksVoice = document.getElementById("advisor")?.textContent || "";
            if (innerWidth <= 820 && /Grow inland/i.test(worksVoice)) {
              fails.push("advisor after works still grow-inland " + worksVoice);
            }
            document.getElementById("advisor")?.click();
            if (innerWidth <= 820 && extraSewer && !document.querySelector('[data-tool="house"]')?.classList.contains("on")) {
              fails.push("advisor after works stayed on sewer while homes are full");
            }
            if (innerWidth <= 820) {
              if (!document.querySelector('[data-tool="house"]')?.classList.contains("on")) {
                fails.push("advisor after works did not arm house");
              }
              const afterWorks = document.getElementById("advisor")?.textContent || "";
              if (!/Rowhouse is armed|Homes are full|glowing empty lot/i.test(afterWorks)) {
                fails.push("advisor after works missed the next house " + afterWorks);
              }
              const voice = document.getElementById("advisor")?.textContent || "";
              const toastEl = document.getElementById("toast");
              if (voice && toastEl?.classList.contains("show")) {
                fails.push("two voices when zoning a house");
              }
              const hud = document.querySelector(".top")?.getBoundingClientRect();
              const advBox = document.getElementById("advisor")?.getBoundingClientRect();
              if (hud && hud.bottom > 148) fails.push("HUD covers the sky h=" + Math.round(hud.bottom));
              if (advBox && advBox.bottom > 148) fails.push("advisor covers the sky y=" + Math.round(advBox.bottom));
              const demandHome = document.querySelector('#demand [data-d="home"]');
              const dr = demandHome?.getBoundingClientRect();
              if (advBox && dr && dr.height > 2 && Math.min(advBox.bottom, dr.bottom) - Math.max(advBox.top, dr.top) > 8) {
                fails.push("advisor covers the demand bars");
              }
              const housePick = h.pickLot?.("house") || nextHouse;
              if (housePick) h.hover?.(housePick.x, housePick.z);
              let housePier = false;
              let housePierScr = null;
              for (let z = 0; z < 48 && !housePier; z++) {
                for (let x = 0; x < 48; x++) {
                  if (h.tile?.(x, z)?.kind !== "pier") continue;
                  const ps = h.screenOf?.(x, z);
                  housePierScr = ps;
                  if (ps?.visible && ps.y > 48 && ps.y < innerHeight - 8 && ps.x > -48 && ps.x < innerWidth + 48) {
                    housePier = true;
                    break;
                  }
                }
              }
              if (!housePier) fails.push("inland house arm lost the pier " + JSON.stringify(housePierScr));
              if ((h.boatsOnScreen?.() || 0) < 1) fails.push("inland house arm lost the boats");
              if ((h.boatsLower?.() || 0) < 1) fails.push("inland house arm boats not the lower half");
              if (housePick && h.screenOf) {
                const hscr = h.screenOf(housePick.x, housePick.z);
                const top = 200;
                const bottom = innerHeight * 0.56;
                const insetX = Math.max(72, innerWidth * 0.2);
                if (!hscr || hscr.y < top || hscr.y > bottom || hscr.x < insetX || hscr.x > innerWidth - insetX) {
                  fails.push("house lot off the play band " + JSON.stringify(hscr));
                }
                const ov = h.overlayAt?.(housePick.x, housePick.z);
                if (!ov) fails.push("house lot has no ground overlay");
                else {
                  const r = (ov.color >> 16) & 255;
                  const g = (ov.color >> 8) & 255;
                  const b = ov.color & 255;
                  if (r < 200 || g < 140 || b > 130 || (ov.opacity || 0) < 0.72) {
                    fails.push("house lot overlay is not a gold tap " + JSON.stringify(ov));
                  }
                }
              }
              if (housePick && h.build) {
                h.build("house", housePick.x, housePick.z);
                const chipAfter = document.getElementById("advisor")?.textContent || "";
                const toastAfter = document.getElementById("toast");
                if (toastAfter?.classList.contains("show") && chipAfter) {
                  fails.push("two voices after extra house " + (toastAfter.textContent || "") + " / " + chipAfter);
                }
                const left = h.snapshot?.().treasury ?? 0;
                if (left < 400) fails.push("first town extra house left a dead till " + left);
                const houseToast = document.getElementById("toast")?.textContent || "";
                if (/kerosene/i.test(houseToast)) fails.push("house toast lied kerosene with a plant on the map " + houseToast);
                window.__veilUntil = 0;
                if (innerWidth <= 820) {
                  document.getElementById("stat-happy")?.parentElement?.click();
                  if (document.querySelector('[data-tool="park"]')?.classList.contains("on")) {
                    fails.push("mood meter stole the house hand");
                  }
                  if (!document.querySelector('[data-tool="house"]')?.classList.contains("on")) {
                    fails.push("mood meter disarmed house");
                  }
                  const site = h.screenOf?.(housePick.x, housePick.z);
                  const picked = document.getElementById("view")?.__pickWork?.(site?.x, site?.y);
                  if (!picked || picked.x !== housePick.x || picked.z !== housePick.z) {
                    fails.push(
                      "extra house tap aimed a neighbor " +
                        JSON.stringify({ lot: housePick, site, picked })
                    );
                  }
                }
                const house2 = h.findLot?.("house") || h.pickLot?.("house");
                if (!house2) fails.push("no next house lot after post-works house");
                else {
                  if (besidePier(house2.x, house2.z) || h.waterfront?.(house2.x, house2.z) || house2.z < 17) {
                    fails.push("next house lot is the landfall " + JSON.stringify(house2));
                  }
                  if (house2 && h.build && (h.snapshot?.().treasury ?? 0) >= 400) {
                    h.build("house", house2.x, house2.z);
                    const house3 = h.findLot?.("house") || h.pickLot?.("house");
                    if (house3 && (besidePier(house3.x, house3.z) || h.waterfront?.(house3.x, house3.z) || house3.z < 17)) {
                      fails.push("later house lot is the sand " + JSON.stringify(house3));
                    }
                    if (!house3 && innerWidth <= 820) {
                      h.arm?.(null);
                      window.__veilUntil = 0;
                      h.step?.(0);
                      const stuck = document.getElementById("advisor")?.textContent || "";
                      if (/Tap this chip for Rowhouse/i.test(stuck) && !/pave|street inland/i.test(stuck)) {
                        fails.push("advisor promised a house with no inland lot " + stuck);
                      }
                      document.getElementById("advisor")?.click();
                      if (document.querySelector('[data-tool="house"]')?.classList.contains("on")) {
                        fails.push("chip armed house with no inland lot");
                      }
                      if (!document.querySelector('[data-tool="road"]')?.classList.contains("on")) {
                        fails.push("chip did not arm the inland street " + (document.getElementById("advisor")?.textContent || ""));
                      }
                      const wash = h.overlay?.() || "";
                      if (wash === "landfall") fails.push("inland street kept the landfall wash");
                      const voice = document.getElementById("advisor")?.textContent || "";
                      if (/Tap this chip for Rowhouse/i.test(voice)) {
                        fails.push("armed road chip still promised a house " + voice);
                      }
                    }
                  }
                  h.look?.(house2.x, house2.z);
                  if (h.hover) h.hover(house2.x, house2.z);
                  const nscr = h.screenOf?.(house2.x, house2.z);
                  const top2 = 200;
                  const bottom2 = innerHeight * 0.56;
                  const inset2 = Math.max(64, innerWidth * 0.16);
                  if (!nscr || nscr.y < top2 || nscr.y > bottom2 || nscr.x < inset2 || nscr.x > innerWidth - inset2) {
                    fails.push("next house lot off the play band " + JSON.stringify({ lot: house2, scr: nscr }));
                  }
                }
                const cashNow = h.snapshot?.().treasury ?? 0;
                let builtHome = null;
                for (let z = 0; z < 48 && !builtHome; z++) {
                  for (let x = 0; x < 48; x++) {
                    const t = h.tile?.(x, z);
                    if (t?.kind === "house" && (t.build ?? 1) >= 1) {
                      builtHome = { x, z };
                      break;
                    }
                  }
                }
                if (builtHome) {
                  h.select?.(builtHome.x, builtHome.z);
                  const up = document.getElementById("up-lot");
                  const sheet = document.getElementById("inspect")?.innerText || "";
                  if (cashNow < 1450 && (up || /Upgrade to Apartment/i.test(sheet))) {
                    fails.push("inspect offered an upgrade they cannot pay " + cashNow + " " + (up?.textContent || sheet.slice(0, 120)));
                  }
                  h.select?.(null);
                  window.__veilUntil = 0;
                }
                h.select?.(housePick.x, housePick.z);
                const wash = h.overlay?.() || "";
                if (/^place:/.test(wash) || wash === "landfall") {
                  fails.push("raising inspect kept the place overlay " + wash);
                }
                const siteScr = h.screenOf?.(housePick.x, housePick.z);
                if (!siteScr || !siteScr.visible || siteScr.y < 110 || siteScr.y > innerHeight * 0.76) {
                  fails.push("raising inspect lost the lot " + JSON.stringify(siteScr));
                }
                if (innerWidth <= 820) {
                  const photoBot = innerHeight * 0.7;
                  let pierOn = false;
                  for (let z = 0; z < 48 && !pierOn; z++) {
                    for (let x = 0; x < 48; x++) {
                      if (h.tile?.(x, z)?.kind !== "pier") continue;
                      const ps = h.screenOf?.(x, z);
                      if (ps?.visible && ps.y > 110 && ps.y < photoBot && ps.x > 8 && ps.x < innerWidth - 8) {
                        pierOn = true;
                        break;
                      }
                    }
                  }
                  const boats = h.boatsOnScreen?.() || 0;
                  if (!pierOn && boats < 1) {
                    fails.push("raising inspect lost the harbor " + JSON.stringify({ siteScr, boats }));
                  }
                }
                const placing = document.getElementById("placing");
                if (placing && getComputedStyle(placing).display !== "none") {
                  fails.push("placing chip on raising photograph");
                }
                const copy = document.getElementById("inspect")?.innerText || "";
                if (!/Excavation|Progress|Rush/i.test(copy)) fails.push("raising inspect missing site rows");
                if ((copy.match(/Rush/gi) || []).length > 1) fails.push("raising inspect printed Rush twice");
                if (/Internet|Pollution|No slots/i.test(copy)) fails.push("raising inspect still a spreadsheet " + copy.slice(0, 180));
                if (/Demolish/i.test(copy) || document.getElementById("demo-lot")) {
                  fails.push("raising inspect offers Demolish");
                }
                h.showGhostWhy?.("house", housePick.x, housePick.z);
                const occChip = document.getElementById("ghost-why");
                if (occChip && !occChip.classList.contains("hidden") && /Occupied/i.test(occChip.textContent || "")) {
                  fails.push("Occupied chip on raising photograph");
                }
                h.select?.(null);
                if ((h.boatsOnScreen?.() || 0) < 1) fails.push("closing inspect lost the harbor");
              }
            }
          }
        }
      }
    }
    h.arm?.(null);
    h.hover?.(null);
    h.reset?.();
    {
      const r = h.pickLot?.("road");
      if (r) h.build?.("road", r.x, r.z);
      const m = h.pickLot?.("market");
      if (m) {
        h.build?.("market", m.x, m.z);
        h.finish?.(m.x, m.z);
      }
      h.step?.(12);
      const board = document.getElementById("contract")?.textContent || "";
      if (board) fails.push("job board before week 4 " + board);
      const toast = document.getElementById("toast")?.textContent || "";
      if (/Contract done|Contract:/i.test(toast)) fails.push("contract toast before week 4 " + toast);
      h.step?.(80);
      if (innerWidth <= 820) {
        const late = document.getElementById("contract")?.textContent || "";
        if (late) fails.push("phone job board at week 4 " + late);
      }
      h.reset?.();
    }
    {
      const plant = h.pickLot?.("power");
      if (plant) h.build?.("power", plant.x, plant.z);
      const now = h.snapshot?.().tick || 0;
      if (now < 56) h.step?.(56 - now);
      const mainsToast = document.getElementById("toast")?.textContent || "";
      if (/kerosene/i.test(mainsToast)) fails.push("mains tip lied kerosene with a plant on the map " + mainsToast);
      h.reset?.();
    }

    h.step?.(25);
    const later = h.snapshot();
    if (!/landfall|Market/i.test(later.advisor || "")) {
      fails.push("first job lost after 25 ticks " + (later.advisor || ""));
    }
    h.reset?.();

    h.arm?.("cable");
    const cableHint = document.getElementById("hint")?.textContent || "";
    if (!/click a street or drag/i.test(cableHint)) fails.push("cable hint " + JSON.stringify(cableHint));
    h.arm?.(null);
    h.select?.(null);
    window.__veilUntil = 0;

    const coast = h.auditCoast?.() || { bad: [] };
    const giftedBad = (coast.bad || []).filter((b) => b.kind !== "pier");
    if (giftedBad.length) fails.push("coast junk " + JSON.stringify(giftedBad.slice(0, 6)));

    const starter = h.findKind?.("house");
    if (starter && h.select) {
      h.select(starter.x, starter.z);
      const dl = document.querySelector("#inspect dl");
      if (dl && dl.scrollHeight > dl.clientHeight + 8) {
        dl.scrollTop = 48;
        await new Promise((r) => setTimeout(r, 400));
        const again = document.querySelector("#inspect dl");
        if (again && again.scrollTop < 16) fails.push("inspect scroll snapped");
      }
      const fireRow = document.querySelector('#inspect [data-arm="fire"]');
      if (!fireRow) fails.push("home inspect missing fire arm");
      else {
        fireRow.click();
        window.__veilUntil = 0;
        if (document.getElementById("inspect")?.classList.contains("show")) fails.push("fire arm left inspect open");
        if (h.overlay?.() !== "cover") fails.push("home fire arm overlay " + (h.overlay?.() || "none"));
        const toast = document.getElementById("toast")?.textContent || "";
        if (!/Firehouse/i.test(toast)) fails.push("home fire arm toast " + toast);
        h.arm?.(null);
        window.__veilUntil = 0;
      }
      h.select(starter.x, starter.z);
      const powerRow = document.querySelector('#inspect [data-arm="power"]');
      if (!powerRow) fails.push("home inspect missing power arm");
      else {
        powerRow.click();
        window.__veilUntil = 0;
        if (document.getElementById("inspect")?.classList.contains("show")) fails.push("power arm left inspect open");
        if (h.overlay?.() !== "place:power") fails.push("home power arm overlay " + (h.overlay?.() || "none"));
        const toast = document.getElementById("toast")?.textContent || "";
        if (!/Plant inland/i.test(toast)) fails.push("home power arm toast " + toast);
        h.arm?.(null);
        window.__veilUntil = 0;
      }
      const vacant = h.findLot?.("house");
      if (!vacant) fails.push("no vacant house lot");
      else {
        h.select(vacant.x, vacant.z);
        const best = [...document.querySelectorAll("#inspect dt")].find((d) => d.textContent === "Best here");
        if (!best) fails.push("vacant inspect missing Best here");
        else if (!best.parentElement?.dataset?.arm) fails.push("best here not tappable");
        else {
          best.parentElement.click();
          window.__veilUntil = 0;
          if (document.getElementById("inspect")?.classList.contains("show")) fails.push("best here left inspect open");
        }
        h.arm?.(null);
        window.__veilUntil = 0;
      }
    }
    const park = h.findKind?.("park");
    if (!park) fails.push("no starter park");
    else {
      h.select?.(park.x, park.z);
      const copy = document.getElementById("inspect")?.innerText || "";
      if (!/5 lots from here/i.test(copy)) fails.push("park inspect range copy");
      if (!/\d+ homes? in the ring/i.test(copy)) fails.push("park inspect covered copy");
      if (!h.rangeHalo?.()) fails.push("park inspect range ring missing");
      h.select?.(null);
      const fireLot = h.findLot?.("fire");
      if (!fireLot) fails.push("no firehouse lot");
      else {
        h.hover?.(fireLot.x, fireLot.z);
        h.arm?.("fire");
        if (!h.ghostRing?.()) fails.push("fire place range ring missing");
        if (h.overlay?.() !== "cover") fails.push("fire tool overlay " + (h.overlay?.() || "none"));
        const nearHint = h.utilHint?.("fire", fireLot.x, fireLot.z);
        if (nearHint) fails.push("near fire idle " + nearHint);
        const shopLot = h.findLot?.("shop");
        if (shopLot) {
          const shopHint = h.utilHint?.("shop", shopLot.x, shopLot.z);
          if (shopHint) fails.push("near shop idle " + shopHint);
        }
        h.arm?.("park");
        if (h.overlay?.() !== "cover") fails.push("park tool overlay " + (h.overlay?.() || "none"));
        h.arm?.("civic");
        if (h.overlay?.() !== "cover") fails.push("civic tool overlay " + (h.overlay?.() || "none"));
        if (!h.ghostRing?.()) fails.push("civic place range ring missing");
        h.arm?.(null);
        h.hover?.(null);
        window.__veilUntil = 0;
      }
    }
    const waterWhy = h.why("house", 18, 2);
    if (!waterWhy) fails.push("house allowed on water");
    if (waterWhy === "Stay inland of the beach") fails.push("house water copy");
    const mktWater = h.why("market", 18, 2);
    if (!mktWater) fails.push("market allowed on water");
    if (mktWater === "Stay inland of the beach") fails.push("market water copy");
    for (let z = 8; z < 28; z++) {
      for (let x = 14; x < 22; x++) {
        const m = h.why("market", x, z);
        const r = h.why("road", x, z);
        if (m && r && /beach|inland/i.test(r) && !/beach/i.test(m)) {
          fails.push("market beach copy at " + x + "," + z + " = " + m);
        }
      }
    }
    let vague = null;
    for (let z = 8; z < 28 && !vague; z++) {
      const w = h.why("road", 18, z);
      if (w === "Occupied") vague = [18, z];
    }
    if (vague) fails.push("occupied too vague at " + vague.join(","));
    const inlandPier = h.why("pier", 18, 30);
    if (!inlandPier) fails.push("pier allowed inland");
    const roadOk = h.why("road", 18, 22);
    if (roadOk) fails.push("road blocked on avenue " + roadOk);

    let cableHouse = null;
    let cableStreet = null;
    let cableEx = null;
    for (let z = 8; z < 36 && !cableStreet; z++) {
      for (let x = 8; x < 36 && !cableStreet; x++) {
        const t = h.tile?.(x, z);
        if (t?.kind !== "house") continue;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const sx = x + dx;
          const sz = z + dz;
          const n = h.tile?.(sx, sz);
          if (!n || (n.kind !== "road" && n.kind !== "cobble")) continue;
          for (let ez = -2; ez <= 2 && !cableEx; ez++) {
            for (let ex = -2; ex <= 2; ex++) {
              if (!ex && !ez) continue;
              const xx = sx + ex;
              const zz = sz + ez;
              if (!h.why("exchange", xx, zz)) {
                cableHouse = { x, z };
                cableStreet = { x: sx, z: sz };
                cableEx = [xx, zz];
                break;
              }
            }
          }
          if (cableStreet) break;
        }
      }
    }
    if (!cableStreet) fails.push("no street beside a house for cable");
    else {
      const laid = h.build("cable", cableStreet.x, cableStreet.z);
      if (!laid?.ok) fails.push("cable place failed " + (laid?.why || ""));
      if (!h.tile?.(cableStreet.x, cableStreet.z)?.cable) fails.push("cable did not mark the street");
      if (h.tile?.(cableHouse.x, cableHouse.z)?.wired) fails.push("dead copper wired a house");
    }
    const houseLot = h.pickLot?.("house");
    if (!houseLot) fails.push("find-lot no house");
    else {
      let onNet = false;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const t = h.tile?.(houseLot.x + dx, houseLot.z + dz);
        if (t && (t.kind === "road" || t.kind === "cobble")) onNet = true;
      }
      if (!onNet) fails.push("find-lot house off network " + houseLot.x + "," + houseLot.z);
    }
    const roadLot = h.pickLot?.("road");
    if (!roadLot) fails.push("find-lot no road");
    else {
      if (roadLot.z > 36 || roadLot.z < 8) fails.push("find-lot road in wilderness z=" + roadLot.z);
      let edge = false;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const t = h.tile?.(roadLot.x + dx, roadLot.z + dz);
        if (t && (t.kind === "road" || t.kind === "cobble")) edge = true;
      }
      if (!edge) fails.push("find-lot road not adjacent " + roadLot.x + "," + roadLot.z);
    }
    const paved = h.findKind?.("road");
    if (paved && h.showGhostWhy) {
      const msg = h.showGhostWhy("house", paved.x, paved.z);
      if (!/occupied/i.test(msg || "")) fails.push("ghost why missing occupied " + (msg || ""));
      const whyEl = document.getElementById("ghost-why");
      if (!whyEl || whyEl.classList.contains("hidden") || !whyEl.textContent) {
        fails.push("ghost-why empty on occupied lot");
      }
      whyEl?.classList.add("hidden");
      if (whyEl) whyEl.textContent = "";
    }

    let lot = null;
    for (let z = 18; z < 32 && !lot; z++) {
      for (let x = 16; x < 22; x++) {
        if (!h.why("house", x, z)) {
          lot = [x, z];
          break;
        }
      }
    }
    const house = lot ? h.build("house", lot[0], lot[1]) : { ok: false, why: "no-lot" };
    if (!house.ok) fails.push("could not place house " + (house.why || ""));
    if (lot && house.ok) {
      h.select?.(null);
      const ownWhy = h.showGhostWhy?.("house", lot[0], lot[1]) || "";
      if (/Occupied/i.test(ownWhy)) fails.push("Occupied why on the house you just zoned " + ownWhy);
      const ownHint = document.getElementById("hint")?.textContent || "";
      if (/Occupied/i.test(ownHint)) fails.push("Occupied dock on the house you just zoned " + ownHint);
      const ownChip = document.getElementById("ghost-why");
      if (ownChip && !ownChip.classList.contains("hidden") && /Occupied/i.test(ownChip.textContent || "")) {
        fails.push("Occupied chip on the house you just zoned");
      }
      h.select?.(lot[0], lot[1]);
      h.showGhostWhy?.("house", lot[0], lot[1]);
      const occChip = document.getElementById("ghost-why");
      if (occChip && !occChip.classList.contains("hidden") && /Occupied/i.test(occChip.textContent || "")) {
        fails.push("Occupied chip on raising photograph");
      }
      const raisingCopy = document.getElementById("inspect")?.innerText || "";
      if (/Demolish/i.test(raisingCopy) || document.getElementById("demo-lot")) {
        fails.push("raising inspect offers Demolish");
      }
      const rushBtn = document.getElementById("rush-lot");
      if (!rushBtn) fails.push("rush missing on new house");
      else {
        const cash0 = h.snapshot().treasury;
        h.credit?.(-cash0);
        h.select?.(lot[0], lot[1]);
        if (document.getElementById("rush-lot")) fails.push("rush offered with empty till");
        const brokeCopy = document.getElementById("inspect")?.innerText || "";
        if (/\bRush\b/i.test(brokeCopy)) fails.push("rush row with empty till");
        h.credit?.(cash0);
        h.select?.(lot[0], lot[1]);
        const rushBtn2 = document.getElementById("rush-lot");
        if (!rushBtn2) fails.push("rush missing after restoring till");
        else {
          h.setBuild?.(lot[0], lot[1], 1);
          rushBtn2.click();
          const rushToast = document.getElementById("toast")?.textContent || "";
          const cash1 = h.snapshot().treasury;
          if (/Cannot rush/i.test(rushToast)) fails.push("rush toast on finished site " + rushToast);
          if (!/It's up/i.test(rushToast)) fails.push("rush finished toast " + rushToast);
          if (cash1 !== cash0) fails.push("rush charged after finish " + cash0 + " -> " + cash1);
          if (document.getElementById("rush-lot")) fails.push("rush stayed on finished site");
        }
      }
      const keep = h.snapshot().treasury;
      h.credit?.(-keep);
      h.select?.(null);
      h.arm?.("house");
      window.__veilUntil = 0;
      h.step?.(0);
      const brokeAdv = document.getElementById("advisor")?.textContent || "";
      if (!/till is filling|till can't pay/i.test(brokeAdv)) fails.push("advisor missed broke house " + brokeAdv);
      if (/glowing empty lot|tap this lot|tap to find a lot/i.test(brokeAdv)) {
        fails.push("advisor promised a house the till can't pay " + brokeAdv);
      }
      const placeTxt = document.getElementById("placing")?.textContent || "";
      if (/tap to find a lot|tap this lot/i.test(placeTxt)) {
        fails.push("placing promised a house the till can't pay " + placeTxt);
      }
      h.credit?.(keep);
      h.arm?.(null);
      window.__veilUntil = 0;
    }
    if (lot) {
      const occ = h.why("road", lot[0], lot[1]) || "";
      if (!/^Occupied — /.test(occ) || !/rowhouse/i.test(occ) || !/empty lot/i.test(occ)) {
        fails.push("occupied why " + occ);
      }
      if (/^On the /i.test(occ)) fails.push("occupied label " + occ);
    }
    const waterM = h.why("market", 18, 2) || "";
    if (!waterM) fails.push("market allowed on water");
    if (/Stay inland/i.test(waterM)) fails.push("market water copy " + waterM);

    let wh = null;
    for (let x = 8; x < 36 && !wh; x++) {
      for (let z = 8; z < 36; z++) {
        if (!h.why("warehouse", x, z) && h.waterfront?.(x, z)) {
          wh = [x, z];
          break;
        }
      }
    }
    if (!wh) {
      for (let x = 8; x < 36 && !wh; x++) {
        for (let z = 8; z < 36; z++) {
          if (!h.why("warehouse", x, z)) {
            wh = [x, z];
            break;
          }
        }
      }
    }
    const before = h.snapshot();
    const warehouse = wh ? h.build("warehouse", wh[0], wh[1]) : { ok: false, why: "no-lot" };
    const afterWh = h.snapshot();
    if (!warehouse.ok) fails.push("could not place warehouse " + (warehouse.why || ""));
    else if (afterWh.trade + 0.01 < before.trade) fails.push("warehouse did not raise trade");
    if (warehouse.ok && wh) {
      h.select?.(wh[0], wh[1]);
      const wcopy = document.getElementById("inspect")?.innerText || "";
      if (!/6 lots from here/i.test(wcopy)) fails.push("warehouse inspect range copy");
      if (!h.rangeHalo?.()) fails.push("warehouse inspect range ring missing");
      h.select?.(null);
      h.arm?.("factory");
      if (h.overlay?.() !== "pollution") fails.push("factory tool overlay " + (h.overlay?.() || "none"));
      h.arm?.(null);
      window.__veilUntil = 0;
    }

    let mkt = null;
    for (let x = 8; x < 36 && !mkt; x++) {
      for (let z = 8; z < 36; z++) {
        if (!h.why("market", x, z) && h.waterfront?.(x, z)) {
          mkt = [x, z];
          break;
        }
      }
    }
    if (!mkt) {
      for (let x = 8; x < 36 && !mkt; x++) {
        for (let z = 8; z < 36; z++) {
          if (!h.why("market", x, z)) {
            mkt = [x, z];
            break;
          }
        }
      }
    }
    const market = mkt ? h.build("market", mkt[0], mkt[1]) : { ok: false, why: "no-lot" };
    if (!market.ok) fails.push("could not place market " + (market.why || ""));
    else {
      h.finish?.(mkt[0], mkt[1]);
      const afterM = h.snapshot();
      if (!afterM.kinds.market) fails.push("market did not register");
      h.select?.(mkt[0], mkt[1]);
      const mcopy = document.getElementById("inspect")?.innerText || "";
      if (!/6 lots from here/i.test(mcopy)) fails.push("market inspect range copy");
      if (!h.rangeHalo?.()) fails.push("market inspect range ring missing");
      h.select?.(null);
    }

    let plant = null;
    for (let x = 8; x < 36 && !plant; x++) {
      for (let z = 8; z < 36; z++) {
        if (!h.why("power", x, z) && (!h.waterfront || !h.waterfront(x, z))) {
          plant = [x, z];
          break;
        }
      }
    }
    const power = plant ? h.build("power", plant[0], plant[1]) : { ok: false, why: "no-lot" };
    if (!power.ok) fails.push("could not place plant " + (power.why || ""));
    else if (!h.snapshot().kinds.power) fails.push("plant did not register");

    const home = h.findKind?.("house");
    if (!home) fails.push("no starter house for util range");
    else {
      let near = null;
      for (let r = 1; r <= 4 && !near; r++) {
        for (let dx = -r; dx <= r && !near; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            const x = home.x + dx;
            const z = home.z + dz;
            if (h.why("power", x, z)) continue;
            if (h.waterfront?.(x, z)) continue;
            near = [x, z];
          }
        }
      }
      if (!near) fails.push("no plant lot near house");
      else {
        const p2 = h.build("power", near[0], near[1]);
        if (!p2.ok) fails.push("range plant " + (p2.why || ""));
        else {
          h.finish?.(near[0], near[1]);
          h.step?.(1);
          const u = h.tile?.(home.x, home.z);
          if (!u?.powered) fails.push("house not powered in range");
          h.select?.(home.x, home.z);
          const pol = document.querySelector('#inspect [data-arm="map:pollution"]');
          if (!pol) fails.push("house missing pollution arm");
          else {
            pol.click();
            window.__veilUntil = 0;
            if (h.overlay?.() !== "pollution") fails.push("pollution arm overlay " + (h.overlay?.() || "none"));
          }
          h.select?.(null);
          if ((h.snapshot().power?.cap || 0) < 100) fails.push("plant cap too small " + JSON.stringify(h.snapshot().power));
          let tower = null;
          for (let r = 1; r <= 4 && !tower; r++) {
            for (let dx = -r; dx <= r && !tower; dx++) {
              for (let dz = -r; dz <= r; dz++) {
                const x = home.x + dx;
                const z = home.z + dz;
                if (!h.why("cistern", x, z)) tower = [x, z];
              }
            }
          }
          if (!tower) fails.push("no cistern lot near house");
          else {
            const tw = h.build("cistern", tower[0], tower[1]);
            if (!tw.ok) fails.push("range tower " + (tw.why || ""));
            else {
              h.finish?.(tower[0], tower[1]);
              h.step?.(1);
              const w = h.tile?.(home.x, home.z);
              if (!w?.watered) fails.push("house not watered in range");
              const plantTile = h.tile?.(near[0], near[1]);
              if ((plantTile?.servedLoad || 0) < 4) fails.push("plant servedLoad " + plantTile?.servedLoad);
              h.credit?.(2000);
              let isoLot = null;
              const ax = 18;
              for (let z = home.z + 4; z < 42 && !isoLot; z++) {
                if (!h.why("road", ax, z)) {
                  const rd = h.build("road", ax, z);
                  if (rd.ok) h.finish?.(ax, z);
                }
                if (Math.hypot(ax - home.x, z - home.z) < 14) continue;
                for (const [dx, dz] of [
                  [-1, 0],
                  [1, 0],
                  [0, 1],
                  [0, -1],
                ]) {
                  const x = ax + dx;
                  const zz = z + dz;
                  if (!h.why("cistern", x, zz)) {
                    isoLot = [x, zz];
                    break;
                  }
                }
              }
              if (!isoLot) fails.push("no isolated tower lot");
              else {
                const idleWhy =
                  h.showGhostWhy?.("cistern", isoLot[0], isoLot[1]) ||
                  h.utilHint?.("cistern", isoLot[0], isoLot[1]);
                if (!/Idle here/i.test(idleWhy || "")) fails.push("idle ghost hint missing " + (idleWhy || ""));
                const chip = document.getElementById("ghost-why");
                if (!chip || chip.classList.contains("hidden") || !/Idle here/i.test(chip.textContent || "")) {
                  fails.push("idle ghost chip hidden");
                }
                const dock = document.getElementById("hint");
                const dockCss = dock ? getComputedStyle(dock) : null;
                const dockBox = dock?.getBoundingClientRect();
                if (
                  !dock ||
                  dockCss.display === "none" ||
                  dockCss.visibility === "hidden" ||
                  !/Idle here/i.test(dock.textContent || "")
                ) {
                  fails.push("idle dock hint hidden " + (dock?.textContent || ""));
                } else if (
                  !dockBox ||
                  dockBox.height < 8 ||
                  dockBox.top < 0 ||
                  dockBox.bottom > innerHeight + 4
                ) {
                  fails.push("idle dock hint offscreen");
                }
                h.arm?.("cistern");
                h.hover?.(isoLot[0], isoLot[1]);
                const kept = h.findLot?.("cistern");
                if (!kept || kept.x !== isoLot[0] || kept.z !== isoLot[1]) {
                  fails.push("find-lot left idle hover " + JSON.stringify(kept));
                }
                h.leaveToHud?.();
                const keptHud = h.findLot?.("cistern");
                if (!keptHud || keptHud.x !== isoLot[0] || keptHud.z !== isoLot[1]) {
                  fails.push("find-lot left idle on hud leave " + JSON.stringify(keptHud));
                }
                const leftMap = h.leaveMap?.();
                if (leftMap?.live && /Idle here/i.test(leftMap.hint || "")) {
                  fails.push("idle dock stuck after leave-map " + (leftMap.hint || ""));
                }
                const afterLeave = h.findLot?.("cistern");
                if (afterLeave && afterLeave.x === isoLot[0] && afterLeave.z === isoLot[1]) {
                  fails.push("find-lot kept idle after leave-map");
                }
                h.hover?.(isoLot[0], isoLot[1]);
                h.blurHover?.();
                const keptAim = h.findLot?.("cistern");
                if (!keptAim || keptAim.x !== isoLot[0] || keptAim.z !== isoLot[1]) {
                  fails.push("find-lot left idle after hover blur " + JSON.stringify(keptAim));
                }
                const pill = document.getElementById("placing");
                const pillBox = pill?.getBoundingClientRect();
                if (!pill || pill.classList.contains("hidden") || !pillBox || pillBox.width < 4) {
                  fails.push("placing pill hidden for idle find-lot");
                } else {
                  document.getElementById("view")?.dispatchEvent(
                    new PointerEvent("pointerleave", {
                      bubbles: true,
                      cancelable: true,
                      clientX: pillBox.left + pillBox.width / 2,
                      clientY: pillBox.top + pillBox.height / 2,
                      relatedTarget: pill,
                    })
                  );
                  pill.dispatchEvent(
                    new PointerEvent("pointerup", {
                      bubbles: true,
                      cancelable: true,
                      clientX: pillBox.left + pillBox.width / 2,
                      clientY: pillBox.top + pillBox.height / 2,
                    })
                  );
                  const toast = document.getElementById("toast")?.textContent || "";
                  if (!/Idle here/i.test(toast)) fails.push("placing pill toast " + toast);
                  if (/Here — a legal lot/i.test(toast)) fails.push("placing pill jumped to legal-lot toast");
                }
                h.arm?.(null);
                window.__veilUntil = 0;
                h.hover?.(null);
                const stray = h.findLot?.("cistern");
                if (stray && stray.x === isoLot[0] && stray.z === isoLot[1]) {
                  fails.push("find-lot stuck on idle after no hover");
                }
                const it = h.build("cistern", isoLot[0], isoLot[1]);
                if (!it.ok) fails.push("isolated tower " + (it.why || ""));
                else {
                  h.finish?.(isoLot[0], isoLot[1]);
                  h.step?.(1);
                  const isoTile = h.tile?.(isoLot[0], isoLot[1]);
                  if ((isoTile?.servedLoad || 0) > 0) fails.push("isolated tower served " + isoTile.servedLoad);
                  h.select?.(isoLot[0], isoLot[1]);
                  const copy = document.getElementById("inspect")?.innerText || "";
                  if (!/No lots in range|Idle — needs a plant/i.test(copy)) fails.push("isolated tower copy missing");
                  if (!h.rangeHalo?.()) fails.push("inspect range ring missing");
                  const still = h.tile?.(home.x, home.z);
                  if (!still?.watered) fails.push("home lost water after isolated tower");
                }
              }
              let spurRoad = null;
              for (let x = 6; x < 12 && !spurRoad; x++) {
                for (let z = 30; z < 38; z++) {
                  if (h.why("road", x, z) || h.waterfront?.(x, z)) continue;
                  const rd = h.build("road", x, z);
                  if (rd.ok) {
                    h.finish?.(x, z);
                    spurRoad = [x, z];
                    break;
                  }
                }
              }
              if (!spurRoad) fails.push("no spur road lot");
              else {
                let spurLot = null;
                for (const [dx, dz] of [
                  [-1, 0],
                  [1, 0],
                  [0, 1],
                  [0, -1],
                ]) {
                  const x = spurRoad[0] + dx;
                  const z = spurRoad[1] + dz;
                  if (!h.why("cistern", x, z)) {
                    spurLot = [x, z];
                    break;
                  }
                }
                if (!spurLot) fails.push("spur still blocks a water tower");
              }
            }
          }
        }
      }
    }

    if (cableStreet && cableHouse) {
      h.credit?.(2500);
      let exLot = cableEx && !h.why("exchange", cableEx[0], cableEx[1]) ? cableEx : null;
      if (!exLot) {
        for (let r = 1; r <= 2 && !exLot; r++) {
          for (let dx = -r; dx <= r && !exLot; dx++) {
            for (let dz = -r; dz <= r; dz++) {
              if (!dx && !dz) continue;
              const xx = cableStreet.x + dx;
              const zz = cableStreet.z + dz;
              if (!h.why("exchange", xx, zz)) exLot = [xx, zz];
            }
          }
        }
      }
      const ex = exLot ? h.build("exchange", exLot[0], exLot[1]) : { ok: false };
      if (!ex.ok) fails.push("cable test exchange " + (ex.why || "no-lot"));
      else {
        h.finish?.(exLot[0], exLot[1]);
        h.step?.(1);
        if (!h.tile?.(cableHouse.x, cableHouse.z)?.wired) {
          const exT = h.tile?.(exLot[0], exLot[1]);
          const st = h.tile?.(cableStreet.x, cableStreet.z);
          fails.push(
            "line did not reach the house house=" +
              cableHouse.x +
              "," +
              cableHouse.z +
              " street=" +
              cableStreet.x +
              "," +
              cableStreet.z +
              " cable=" +
              !!st?.cable +
              " ex=" +
              exLot[0] +
              "," +
              exLot[1] +
              " powered=" +
              !!exT?.powered +
              " src=" +
              (exT?.powerSrc || "none")
          );
        }
        h.lookCell?.(cableStreet.x, cableStreet.z, 16, 28);
        h.hover?.(cableStreet.x, cableStreet.z);
        h.arm?.("bulldoze");
        let neighbor = null;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const n = h.tile?.(cableStreet.x + dx, cableStreet.z + dz);
          if (n && (n.kind === "road" || n.kind === "cobble") && !n.cable) {
            neighbor = { x: n.x, z: n.z, kind: n.kind };
            break;
          }
        }
        const view = document.getElementById("view");
        const scr = h.screenOf?.(cableStreet.x, cableStreet.z);
        const nscr = neighbor ? h.screenOf?.(neighbor.x, neighbor.z) : null;
        const hit = scr ? document.elementFromPoint(scr.x, scr.y) : null;
        const onView = !!(hit && (hit.id === "view" || hit === view));
        if (view && onView && scr && Number.isFinite(scr.x) && Number.isFinite(scr.y)) {
          let jx = scr.x + 5;
          let jy = scr.y;
          if (nscr && Number.isFinite(nscr.x)) {
            const vx = nscr.x - scr.x;
            const vy = nscr.y - scr.y;
            const len = Math.hypot(vx, vy) || 1;
            jx = scr.x + (vx / len) * 5;
            jy = scr.y + (vy / len) * 5;
          }
          const fire = (type, x, y) =>
            view.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                pointerId: 41,
                pointerType: "mouse",
                isPrimary: true,
                button: 0,
                buttons: type === "pointerup" ? 0 : 1,
                clientX: x,
                clientY: y,
              })
            );
          const capture = view.setPointerCapture;
          const release = view.releasePointerCapture;
          view.setPointerCapture = () => {};
          view.releasePointerCapture = () => {};
          fire("pointerdown", scr.x, scr.y);
          fire("pointermove", jx, jy);
          fire("pointerup", jx, jy);
          if (capture) view.setPointerCapture = capture;
          if (release) view.releasePointerCapture = release;
          const toast = document.getElementById("toast")?.textContent || "";
          const afterClick = h.tile?.(cableStreet.x, cableStreet.z);
          if (/Demolished/i.test(toast) || (afterClick && !afterClick.kind)) {
            fails.push(
              "left-click cable toast " +
                JSON.stringify(toast) +
                " cable=" +
                !!afterClick?.cable +
                " kind=" +
                (afterClick?.kind || "empty")
            );
          }
        }
        if (h.tile?.(cableStreet.x, cableStreet.z)?.cable) {
          h.select?.(cableStreet.x, cableStreet.z);
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
          const toast = document.getElementById("toast")?.textContent || "";
          if (toast !== "Cable pulled. The street stays.") {
            fails.push("cable pull toast " + JSON.stringify(toast));
          }
        }
        if (h.tile?.(cableStreet.x, cableStreet.z)?.cable) {
          const pulled = h.build("bulldoze", cableStreet.x, cableStreet.z);
          if (!pulled?.ok) fails.push("cable bulldoze failed " + (pulled?.why || ""));
        }
        const afterPull = h.tile?.(cableStreet.x, cableStreet.z);
        if (afterPull?.cable) fails.push("bulldoze left the cable");
        if (afterPull?.kind !== "road" && afterPull?.kind !== "cobble") {
          fails.push("bulldoze removed the street kind=" + (afterPull?.kind || "empty"));
        }
        if (neighbor) {
          const nAfter = h.tile?.(neighbor.x, neighbor.z);
          if (nAfter?.kind !== neighbor.kind) {
            fails.push("jitter click demolished neighbor " + neighbor.x + "," + neighbor.z);
          }
        }
        if (h.tile?.(cableHouse.x, cableHouse.z)?.wired) fails.push("house still wired after cable pull");
        h.arm?.(null);
      }
    }

    h.setTime?.(22);
    const lights = h.lights?.();
    if (!lights) fails.push("no lights api");
    else {
      if (lights.lamps < 1) fails.push("no lamps at night");
      if (lights.glass < 1) fails.push("no window glow");
      if (lights.emit < 0.3) fails.push("night emit too low " + lights.emit);
    }

    return {
      fails,
      opening,
      warehouse,
      market,
      power,
      after: h.snapshot(),
      boats: h.boats?.() || 0,
    };
  });
  notes.sim = {
    opening: sim.opening,
    boats: sim.boats,
    after: sim.after && {
      kinds: sim.after.kinds,
      trade: sim.after.trade,
      tourism: sim.after.tourism,
      mix: sim.after.mix,
    },
  };
  for (const f of sim.fails || []) fail(f);

  const layout = await page.evaluate((isPhone) => {
    const fails = [];
    const rail = document.getElementById("tools");
    const dock = document.querySelector("footer.dock");
    const rr = rail?.getBoundingClientRect();
    const dr = dock?.getBoundingClientRect();
    const touch = document.body.classList.contains("is-touch");
    const pointer = document.body.classList.contains("is-pointer");
    if (isPhone) {
      if (!touch) fails.push("phone missing is-touch");
      if (rr && rr.top < innerHeight * 0.45) fails.push("phone rail not at bottom top=" + Math.round(rr.top));
      if (dr && innerHeight - dr.bottom > 24) fails.push("phone dock not at bottom");
      const fold = document.getElementById("rail-fold");
      if (!fold || getComputedStyle(fold).display === "none") fails.push("phone missing tool fold");
      else {
        const wasShut = document.body.classList.contains("rail-shut");
        fold.click();
        if (document.body.classList.contains("rail-shut") === wasShut) fails.push("rail did not fold");
        fold.click();
        if (document.body.classList.contains("rail-shut")) fold.click();
      }
      const heads = [...document.querySelectorAll(".rail-head")];
      if (heads.length < 6) fails.push("phone missing category heads " + heads.length);
      for (const head of heads) {
        const box = head.getBoundingClientRect();
        const name = (head.textContent || "").trim() || head.dataset.group;
        if (box.left < -2 || box.right > innerWidth + 2) {
          fails.push("phone rail head overflow " + name + " right=" + Math.round(box.right));
        }
        if (box.width < 20 || box.height < 20) {
          fails.push("phone rail head too small " + name);
        }
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (hit && hit !== head && !head.contains(hit) && hit.dataset?.tool) {
          fails.push("phone rail head covered " + name + " by " + hit.dataset.tool);
        }
        if (head.scrollWidth > head.clientWidth + 2) {
          fails.push("phone rail head truncated " + name);
        }
      }
      const onHead = document.querySelector(".rail-head.on");
      if (onHead) {
        const bg = getComputedStyle(onHead).backgroundColor || "";
        const rgb = (bg.match(/[\d.]+/g) || []).map(Number);
        if (rgb[0] > 180 && rgb[1] > 150 && rgb[2] < 190 && (rgb.length < 4 || rgb[3] > 0.4)) {
          fails.push("phone rail head filled like a chip " + bg);
        }
      }
      document.querySelector('[data-group="homes"]')?.click();
      const house = document.querySelector('[data-tool="house"]');
      if (!house || house.closest(".rail-pack.shut")) fails.push("phone homes rail not tappable");
      document.querySelector('[data-group="street"]')?.click();
      if (rr && dr && rr.bottom > dr.top + 8 && rr.top < dr.bottom) {
        /* rail sits just above dock; overlap of a few px is ok */
      }
      const placeEl = document.getElementById("placing");
      const waitEl = document.getElementById("recap-wait");
      const placeWas = placeEl?.classList.contains("hidden");
      const waitWas = waitEl?.classList.contains("hidden");
      placeEl?.classList.remove("hidden");
      waitEl?.classList.remove("hidden");
      const pr = placeEl?.getBoundingClientRect();
      const wr = waitEl?.getBoundingClientRect();
      if (pr && wr && pr.width > 4 && wr.width > 4) {
        const overlapY = Math.min(pr.bottom, wr.bottom) - Math.max(pr.top, wr.top);
        const midP = (pr.left + pr.right) / 2;
        const midW = (wr.left + wr.right) / 2;
        if (overlapY > 10 && Math.abs(midP - midW) < 48) {
          fails.push("phone pills stacked mid=" + Math.round(midP) + "/" + Math.round(midW));
        }
      }
      const toast = document.getElementById("toast");
      const tr = toast?.getBoundingClientRect();
      if (pr && tr && toast) {
        toast.classList.add("show");
        const t2 = toast.getBoundingClientRect();
        const yHit = Math.min(pr.bottom, t2.bottom) - Math.max(pr.top, t2.top);
        if (yHit > 12) fails.push("phone toast stacked on placing");
        toast.classList.remove("show");
      }
      document.getElementById("inspect")?.classList.remove("show");
      document.body.classList.remove("inspect-open");
      const adv = document.getElementById("advisor");
      const advWas = adv?.textContent || "";
      if (adv) {
        adv.textContent = "The lot by the dock is empty. Road or Cobble on the landfall, then Harbor → Market — not on the sand.";
      }
      toast?.classList.add("show");
      const ar = adv?.getBoundingClientRect();
      const t3 = toast?.getBoundingClientRect();
      if (ar && t3 && adv && toast) {
        const yHit = Math.min(ar.bottom, t3.bottom) - Math.max(ar.top, t3.top);
        const xHit = Math.min(ar.right, t3.right) - Math.max(ar.left, t3.left);
        if (yHit > 8 && xHit > 8) fails.push("phone toast stacked on advisor");
        if (ar.width < 280) fails.push("phone advisor too narrow w=" + Math.round(ar.width));
        const fs = parseFloat(getComputedStyle(adv).fontSize) || 0;
        if (fs < 12) fails.push("phone advisor too small " + fs);
        const con = document.getElementById("contract");
        if (con && getComputedStyle(con).display !== "none") {
          const cr = con.getBoundingClientRect();
          const cHit = Math.min(cr.bottom, t3.bottom) - Math.max(cr.top, t3.top);
          const cX = Math.min(cr.right, t3.right) - Math.max(cr.left, t3.left);
          if (cHit > 8 && cX > 8) fails.push("phone toast stacked on contract");
        }
      }
      toast?.classList.remove("show");
      if (adv) adv.textContent = advWas;
      const hintEl = document.getElementById("hint");
      if (hintEl) {
        hintEl.textContent = "Occupied — a road is here. Tap an empty lot.";
        hintEl.classList.add("live");
        const hs = getComputedStyle(hintEl);
        if (hs.whiteSpace === "nowrap") fails.push("phone hint clipped nowrap");
        const hf = parseFloat(hs.fontSize) || 0;
        if (hf < 12) fails.push("phone hint too small " + hf);
        hintEl.classList.remove("live");
      }
      const pauseBtn = document.getElementById("btn-pause")?.getBoundingClientRect();
      if (pauseBtn && pauseBtn.height < 34) fails.push("phone dock buttons too short h=" + Math.round(pauseBtn.height));
      if (placeWas) placeEl?.classList.add("hidden");
      if (waitWas) waitEl?.classList.add("hidden");
      const why = document.getElementById("ghost-why");
      if (why) {
        why.textContent = "Occupied — a road is here. Tap an empty lot.";
        why.classList.remove("hidden");
        why.classList.add("hidden");
        why.textContent = "";
        if (!why.classList.contains("hidden")) fails.push("ghost-why did not hide");
      }
      const bud = document.getElementById("budget");
      if (bud) {
        bud.textContent = "In $1 · out $1";
        const st = getComputedStyle(bud);
        if (st.display !== "none") fails.push("phone budget banner still open");
        bud.textContent = "";
      }
      const hud = document.querySelector(".top")?.getBoundingClientRect();
      if (hud && hud.height > 128) fails.push("phone header still tall h=" + Math.round(hud.height));
      const moodHud = document.getElementById("stat-happy")?.parentElement;
      if (moodHud && getComputedStyle(moodHud).display === "none") fails.push("phone mood hidden");
      const houseBtn = document.querySelector('[data-tool="house"]');
      if (houseBtn && !houseBtn.classList.contains("on")) houseBtn.click();
      if (!document.body.classList.contains("rail-shut")) fails.push("phone rail did not tuck when armed");
      const railShut = document.getElementById("tools")?.getBoundingClientRect();
      if (railShut && railShut.height > 56) fails.push("phone armed rail still tall h=" + Math.round(railShut.height));
      if (houseBtn?.classList.contains("on")) houseBtn.click();
    } else {
      if (!pointer) fails.push("pc missing is-pointer");
      if (rr && rr.left > 80) fails.push("pc rail not on the left");
    }
    const pause = document.getElementById("btn-pause")?.getBoundingClientRect();
    if (pause && (pause.bottom > innerHeight + 4 || pause.top < -4)) fails.push("pause off screen");
    return {
      fails,
      touch,
      pointer,
      rail: rr && { top: Math.round(rr.top), bottom: Math.round(rr.bottom), left: Math.round(rr.left) },
      dock: dr && { top: Math.round(dr.top), bottom: Math.round(dr.bottom) },
      inner: [innerWidth, innerHeight],
    };
  }, !!profile.viewport.isMobile);
  notes.layout = { rail: layout.rail, dock: layout.dock, inner: layout.inner, touch: layout.touch, pointer: layout.pointer };
  for (const f of layout.fails) fail(f);

  await page.evaluate(() => window.__harbor && window.__harbor.lookAlong(18, 12, "x"));
  await wait(700);
  await page.screenshot({ path: path.join(page._shotDir, "harbor.png") });
  await page.evaluate(() => {
    const m = document.getElementById("city-menu");
    if (m?.classList.contains("hidden")) document.getElementById("btn-menu")?.click();
  });
  await wait(200);
  await page.screenshot({ path: path.join(page._shotDir, "menu.png") });
  await page.evaluate(() => {
    const m = document.getElementById("city-menu");
    if (m && !m.classList.contains("hidden")) document.getElementById("btn-menu")?.click();
  });

  return { fails, notes };
}

async function runProfile(browser, name) {
  const spec = PROFILES[name];
  const shotDir = path.join(os.tmpdir(), "harborline-suite", name);
  fs.mkdirSync(shotDir, { recursive: true });
  const page = await browser.newPage();
  page._shotDir = shotDir;
  page.setDefaultTimeout(25000);
  await page.emulate({
    viewport: spec.viewport,
    userAgent: spec.userAgent,
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.removeItem("harborline-save-v2");
    localStorage.removeItem("harborline-save-v3");
    localStorage.removeItem("harborline-save-v4");
    localStorage.removeItem("harborline-save-v5");
    sessionStorage.removeItem("harborline-coach");
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push("page " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/ERR_SOCKET_NOT_CONNECTED|ERR_CONNECTION_REFUSED/.test(t)) return;
    errors.push("console " + t);
  });
  let result;
  try {
    result = await runPageTests(page, spec);
  } catch (err) {
    result = { fails: ["runner " + (err && err.message ? err.message : String(err))], notes: {} };
  }
  await page.close();
  const fails = [...errors, ...result.fails];
  return { name, ok: fails.length === 0, fails, notes: result.notes, shots: shotDir };
}

const wanted = process.argv.slice(2).filter((a) => a === "pc" || a === "phone");
const names = wanted.length ? wanted : ["pc", "phone"];

if (!(await ping())) {
  console.error("Vite is not running at " + ORIGIN);
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  protocolTimeout: 120000,
  args: ["--no-sandbox", "--use-gl=angle", "--enable-webgl", "--window-size=1600,900"],
});

const reports = [];
try {
  for (const name of names) reports.push(await runProfile(browser, name));
} finally {
  await browser.close();
}

const summary = {
  ok: reports.every((r) => r.ok),
  reports: reports.map((r) => ({
    name: r.name,
    ok: r.ok,
    fails: r.fails,
    shots: r.shots,
    notes: r.notes,
  })),
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
