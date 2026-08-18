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
await page.evaluateOnNewDocument(() => localStorage.removeItem("harborline-save-v2"));
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

await page.screenshot({ path: path.join(outDir, "shot_city.png") });
const treeInfo = await page.evaluate(async () => {
  const h = window.__harbor;
  if (!h) return { trees: -1 };
  const shots = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  h.lookCell(16, 18, 26, 48);
  await wait(400);
  shots.push({ name: "park", trees: h.trees() });
  h.lookCell(40, 42, 34, 70);
  await wait(400);
  shots.push({ name: "forest", trees: h.trees() });
  h.lookCell(22, 12, 22, 42);
  await wait(400);
  shots.push({ name: "street", trees: h.trees() });
  return { trees: h.trees(), shots };
});
await page.screenshot({ path: path.join(outDir, "shot_street.png") });
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
  sample,
  treeInfo,
  moneyMoved: money1 !== money2,
  clockMoved: clock1 !== clock2,
  errors,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (boot || !tools) process.exit(1);

