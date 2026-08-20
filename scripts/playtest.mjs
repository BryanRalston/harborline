import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import puppeteer from "puppeteer-core";

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outDir = path.join(os.tmpdir(), "harborline-shots");
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1600,900", "--use-gl=angle", "--enable-webgl"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  localStorage.removeItem("harborline-save-v2");
  localStorage.removeItem("harborline-save-v3");
  localStorage.removeItem("harborline-save-v4");
});
const errors = [];
page.on("pageerror", (e) => errors.push("page " + e.message + "\n" + (e.stack || "")));
page.on("requestfailed", (req) => {
  const url = req.url();
  if (url.includes("fonts.g") || url.includes("favicon")) return;
  errors.push("fail " + url + " " + req.failure()?.errorText);
});
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error") errors.push("console " + t);
  if (t.includes("[harborline]")) errors.push("log " + t);
});
await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#btn-begin", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1800));
await page.screenshot({ path: path.join(outDir, "shot_splash.png") });
const begin = await page.$("#btn-begin");
if (!begin) errors.push("missing begin button");
else {
  await begin.click();
  await new Promise((r) => setTimeout(r, 5000));
}

const money1 = await page.$eval("#stat-money", (el) => el.textContent);
const advisor = await page.$eval("#advisor", (el) => el.textContent).catch(() => "");
const demandW = await page.$eval('#demand [data-d="work"] i', (el) => el.style.getPropertyValue("--p")).catch(() => "");
const pop1 = await page.$eval("#stat-pop", (el) => el.textContent);
const clock1 = await page.$eval("#stat-clock", (el) => el.textContent);
const boot = await page.$eval("#boot-err", (el) => (el.hidden ? "" : el.textContent));
const tools = await page.$$eval("#tools button", (els) => els.length);
if (boot) errors.push("boot-err " + boot);

await page.evaluate(() => window.__harbor && window.__harbor.lookCell(18, 16, 14, 26));
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: path.join(outDir, "shot_city.png") });
const opening = await page.evaluate(() => (window.__harbor && window.__harbor.snapshot && window.__harbor.snapshot()) || null);
if (opening && opening.pop > 80) errors.push("opening city too big pop=" + opening.pop);
if (opening && opening.kinds && (opening.kinds.school || opening.kinds.tower || opening.kinds.hospital)) {
  errors.push("opening city has late-game buildings " + JSON.stringify(opening.kinds));
}
if (opening && opening.kinds && (opening.kinds.power || opening.kinds.cistern || opening.kinds.sewer)) {
  errors.push("opening gifted utilities " + JSON.stringify(opening.kinds));
}
const grew = await page.evaluate(() => {
  const h = window.__harbor;
  if (!h?.build) return { err: "no-build" };
  const built = [];
  for (let z = 20; z <= 30; z++) {
    const r = h.build("road", 18, z);
    if (r.ok) built.push(["road", 18, z]);
  }
  for (let z = 24; z <= 28; z++) {
    const a = h.build("house", 17, z);
    const b = h.build("house", 19, z);
    if (a.ok) built.push(["house", 17, z]);
    if (b.ok) built.push(["house", 19, z]);
  }
  const shop = h.build("shop", 17, 27);
  return { built: built.length, shop, after: h.snapshot() };
});
await page.click('button[data-speed="4"]').catch(() => {});
await new Promise((r) => setTimeout(r, 12000));
await page.evaluate(() => window.__harbor && window.__harbor.lookCell(18, 24, 16, 32));
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, "shot_grew.png") });
const afterGrow = await page.evaluate(() => (window.__harbor && window.__harbor.snapshot && window.__harbor.snapshot()) || null);
const mixTest = await page.evaluate(() => {
  const h = window.__harbor;
  if (!h?.build || !h.why) return { err: "no-build" };
  const before = h.snapshot();
  let wh = null;
  let plant = null;
  for (let x = 8; x < 36; x++) {
    for (let z = 8; z < 36; z++) {
      if (!wh && !h.why("warehouse", x, z) && (!h.waterfront || h.waterfront(x, z))) wh = [x, z];
      if (!plant && !h.why("power", x, z) && (!h.waterfront || !h.waterfront(x, z))) plant = [x, z];
    }
  }
  if (!wh) {
    for (let x = 8; x < 36; x++) {
      for (let z = 8; z < 36; z++) {
        if (!h.why("warehouse", x, z)) {
          wh = [x, z];
          break;
        }
      }
      if (wh) break;
    }
  }
  if (!plant) {
    for (let x = 8; x < 36; x++) {
      for (let z = 8; z < 36; z++) {
        if (!h.why("power", x, z)) {
          plant = [x, z];
          break;
        }
      }
      if (plant) break;
    }
  }
  const w = wh ? h.build("warehouse", wh[0], wh[1]) : { ok: false, why: "no-lot" };
  const afterWh = h.snapshot();
  const p = plant ? h.build("power", plant[0], plant[1]) : { ok: false, why: "no-lot" };
  const afterP = h.snapshot();
  return { before, wh, plant, w, afterWh, p, afterP };
});
if (mixTest?.afterWh && mixTest?.before && mixTest.w?.ok) {
  if (mixTest.afterWh.trade + 0.01 < mixTest.before.trade) errors.push("warehouse did not raise trade");
}
if (mixTest?.p?.ok && !(mixTest.afterP?.kinds?.power)) errors.push("power plant did not register");
const mainsTools = await page.$$eval("#tools button[data-tool]", (els) => els.map((e) => e.dataset.tool));
if (!mainsTools.includes("power") || !mainsTools.includes("cistern") || !mainsTools.includes("sewer")) {
  errors.push("missing mains tools " + mainsTools.join(","));
}
const treeInfo = await page.evaluate(async () => {
  const h = window.__harbor;
  if (!h) return { trees: -1 };
  const shots = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  h.lookCell(18, 22, 18, 34);
  await wait(400);
  shots.push({ name: "hamlet", trees: h.trees() });
  h.lookCell(40, 42, 34, 70);
  await wait(400);
  shots.push({ name: "forest", trees: h.trees() });
  h.lookCell(18, 12, 16, 28);
  await wait(400);
  shots.push({ name: "street", trees: h.trees() });
  return { trees: h.trees(), shots };
});
await page.screenshot({ path: path.join(outDir, "shot_street.png") });
await page.evaluate(() => window.__harbor && window.__harbor.lookAlong(18, 12, "x"));
await new Promise((r) => setTimeout(r, 1400));
await page.screenshot({ path: path.join(outDir, "shot_harbor.png") });
await page.evaluate(() => window.__harbor && window.__harbor.lookAlong(18, 30, "z"));
await new Promise((r) => setTimeout(r, 2200));
await page.screenshot({ path: path.join(outDir, "shot_traffic.png") });
const traffic = await page.evaluate(() => (window.__harbor && window.__harbor.traffic()) || null);
await page.evaluate(() => window.__harbor && window.__harbor.lookAlong(30, 28, "x"));
await new Promise((r) => setTimeout(r, 1600));
await page.screenshot({ path: path.join(outDir, "shot_traffic_ew.png") });
await page.evaluate(() => window.__harbor && window.__harbor.lookCell(16, 18, 26, 48));
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, "shot_park.png") });
await page.evaluate(() => window.__harbor && window.__harbor.lookCell(40, 42, 34, 70));
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, "shot_forest.png") });
await new Promise((r) => setTimeout(r, 2800));
const money2 = await page.$eval("#stat-money", (el) => el.textContent);
const clock2 = await page.$eval("#stat-clock", (el) => el.textContent);

const sample = await page.evaluate(() => {
  const c = document.getElementById("view");
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  if (!gl) return { err: "no-gl" };
  const w = 80;
  const h = 45;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(c.width / 2 - w / 2, c.height / 2 - h / 2, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const hues = { brown: 0, green: 0, blue: 0, other: 0 };
  for (let i = 0; i < pixels.length; i += 4) {
    const pr = pixels[i];
    const pg = pixels[i + 1];
    const pb = pixels[i + 2];
    r += pr;
    g += pg;
    b += pb;
    n += 1;
    if (pg > pr + 8 && pg > pb) hues.green += 1;
    else if (pb > pr + 6 && pb > pg - 10) hues.blue += 1;
    else if (pr > 90 && pr > pg && pg > pb + 8) hues.brown += 1;
    else hues.other += 1;
  }
  return {
    avg: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
    hues,
    size: [c.width, c.height],
  };
});

if (tools > 0) {
  await page.click("#tools button[data-tool='house']");
  const box = await page.$eval("#view", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * 0.58, y: r.top + r.height * 0.46 };
  });
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(outDir, "shot_placed.png") });
}

const report = {
  outDir,
  money1,
  money2,
  advisor,
  demandW,
  pop1,
  clock1,
  clock2,
  tools,
  budget: await page.$eval("#budget", (el) => el.textContent).catch(() => ""),
  loanBtn: await page.$eval("#btn-loan", (el) => el.textContent).catch(() => ""),
  mapBtns: await page.$$eval(".maps button", (els) => els.map((e) => e.id)),
  lawsBtn: await page.$eval("#btn-laws", (el) => el.textContent).catch(() => ""),
  gfxBtn: await page.$eval("#btn-gfx", (el) => el.textContent).catch(() => ""),
  boats: await page.evaluate(() => (window.__harbor && window.__harbor.boats()) || 0),
  perf: await page.evaluate(() => (window.__harbor && window.__harbor.perf && window.__harbor.perf()) || null),
  sample,
  opening,
  grew,
  afterGrow,
  mixTest,
  mainsTools,
  treeInfo,
  traffic,
  moneyMoved: money1 !== money2,
  clockMoved: clock1 !== clock2,
  errors,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (boot || !tools || errors.length) process.exit(1);

