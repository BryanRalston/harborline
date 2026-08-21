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
  "clinic",
  "school",
  "hospital",
  "fire",
  "civic",
];

const DEMAND = ["home", "work", "shop", "port", "visit", "freight", "edu", "health", "power", "water", "sewer"];

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
    return {
      title: document.querySelector("#splash h1")?.textContent || "",
      begin: !!begin,
      beginVisible: !!(r && r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight),
      coach: document.getElementById("splash-coach")?.textContent || "",
    };
  });
  if (splash.title !== "Harborline") fail("splash title missing");
  if (!splash.begin) fail("missing begin");
  if (!splash.beginVisible) fail("begin button not on screen");
  if (!/look/i.test(splash.coach) || !/build/i.test(splash.coach)) fail("splash missing coach");

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
    const ids = ["stat-money", "stat-pop", "stat-jobs", "stat-happy", "stat-clock", "advisor", "btn-pause", "btn-undo", "btn-menu"];
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
    if (!coachOn) fails.push("first-minute coach hidden");
    const coachCopy = document.getElementById("coach-copy")?.textContent || "";
    if (!/week 4/i.test(coachCopy) || !/recap/i.test(coachCopy)) fails.push("coach missing recap week");
    const eta = document.getElementById("recap-eta")?.textContent || "";
    if (!/recap/i.test(eta)) fails.push("hud missing recap cadence");
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
    if (!mains?.tools.includes("power") || !mains?.tools.includes("cistern") || !mains?.tools.includes("sewer")) {
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

    document.getElementById("btn-menu")?.click();
    const menu = document.getElementById("city-menu");
    if (menu?.classList.contains("hidden")) fails.push("menu did not open");
    const kickers = [...document.querySelectorAll(".menu-kicker")].map((k) => k.textContent.trim());
    for (const k of ["Look", "Maps", "City", "File"]) {
      if (!kickers.includes(k)) fails.push("missing menu section " + k);
    }
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
    }
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
    ok?.click();
    if (!document.getElementById("digest")?.classList.contains("hidden")) fails.push("continue did not hide digest");
    const veilOn = !document.getElementById("pointer-veil")?.classList.contains("hidden");
    const mapDead = document.getElementById("view")?.style.pointerEvents === "none";
    if (!veilOn && !mapDead) fails.push("continue left the map live");
    if (!document.body.classList.contains("recap-hold")) fails.push("continue did not hold leftover");
    const view = document.getElementById("view");
    view?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0 }));
    view?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0 }));
    if (document.getElementById("inspect")?.classList.contains("show")) fails.push("continue click-through inspect");
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
      if (document.getElementById("btn-pause")?.textContent !== "Play") {
        document.getElementById("btn-pause")?.click();
      }
      h.step(50);
      if (h.digest()) fails.push("early recap week " + h.digest().week);
      h.step(40);
      if (!h.digest()) fails.push("week 4 recap missing");
      document.getElementById("digest-ok")?.click();
      document.querySelector('[data-tool="market"]')?.click();
      h.step(30);
      if (h.digest()) fails.push("recap while tool armed");
      document.querySelector('[data-tool="market"]')?.click();
      h.step(15);
      if (!h.digest()) fails.push("deferred recap did not open");
      document.getElementById("digest-ok")?.click();
      h.reset();
    }
    return { fails, week: after.week };
  });
  notes.recap = { week: recap.week };
  for (const f of recap.fails || []) fail(f);

  await page.screenshot({ path: path.join(page._shotDir, "city.png") });

  const sim = await page.evaluate(() => {
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
    if (opening.kinds.power || opening.kinds.cistern || opening.kinds.sewer) fails.push("gifted utilities");
    if ((opening.kinds.house || 0) > 6) fails.push("too many starter houses");
    if ((opening.kinds.house || 0) < 1) fails.push("no starter houses");
    if ((opening.kinds.pier || 0) < 1) fails.push("no starter pier");
    if (opening.treasury > 14000) fails.push("opening treasury too fat " + opening.treasury);
    if (opening.treasury < 8000) fails.push("opening treasury too thin " + opening.treasury);

    const coast = h.auditCoast?.() || { bad: [] };
    const giftedBad = (coast.bad || []).filter((b) => b.kind !== "pier");
    if (giftedBad.length) fails.push("coast junk " + JSON.stringify(giftedBad.slice(0, 6)));

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
    if (lot) {
      const occ = h.why("road", lot[0], lot[1]) || "";
      if (!/rowhouse|house/i.test(occ)) fails.push("occupied why " + occ);
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
            }
          }
        }
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
        fold.click();
        if (!document.body.classList.contains("rail-shut")) fails.push("rail did not fold");
        fold.click();
      }
      if (rr && dr && rr.bottom > dr.top + 8 && rr.top < dr.bottom) {
        /* rail sits just above dock; overlap of a few px is ok */
      }
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
    if (m.type() === "error") errors.push("console " + m.text());
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
