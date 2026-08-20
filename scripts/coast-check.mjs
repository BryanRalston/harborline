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
page.on("pageerror", (e) => errors.push("page " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console " + m.text());
});
await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#btn-begin", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1600));
await page.click("#btn-begin");
await new Promise((r) => setTimeout(r, 4500));

const boot = await page.$eval("#boot-err", (el) => (el.hidden ? "" : el.textContent));
if (boot) errors.push("boot-err " + boot);

const opening = await page.evaluate(() => {
  const h = window.__harbor;
  const snap = h?.snapshot?.() || null;
  const audit = h?.auditCoast?.() || null;
  const tools = [...document.querySelectorAll("#tools button")].map((b) => b.dataset.tool);
  const blocked = [];
  for (let z = 8; z <= 22; z++) {
    blocked.push({
      z,
      road: h.why("road", 21, z),
      cobble: h.why("cobble", 22, z),
      house: h.why("house", 23, z),
      pier: h.why("pier", 18, z),
    });
  }
  return { snap, audit, tools, blocked, pop: document.querySelector("#stat-pop")?.textContent };
});

const landZ = (opening.audit?.lots || []).filter((l) => l.kind === "road").reduce((m, l) => Math.min(m, l.z), 99);
await page.evaluate((z) => {
  const h = window.__harbor;
  h.lookAlong(18, z, "z");
}, landZ);
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: path.join(outDir, "shot_t.png") });

await page.evaluate((z) => window.__harbor.lookAlong(16, z, "x"), landZ);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, "shot_deadend.png") });

await page.evaluate((z) => window.__harbor.lookCell(18, z - 1, 14, 34), landZ);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, "shot_coast.png") });

await page.evaluate((z) => window.__harbor.lookCell(18, z - 4, 10, 22), landZ);
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: path.join(outDir, "shot_pier.png") });

const pierGrow = await page.evaluate(() => {
  const h = window.__harbor;
  const far = h.why("pier", 8, 8);
  const placed = [];
  for (let z = 20; z >= 4; z--) {
    if (h.why("pier", 18, z)) continue;
    const r = h.build("pier", 18, z);
    placed.push({ z, r });
    if (placed.filter((p) => p.r.ok).length >= 2) break;
  }
  return { far, placed, after: h.snapshot() };
});
await new Promise((r) => setTimeout(r, 800));
await page.evaluate((z) => window.__harbor.lookCell(18, z - 5, 10, 24), landZ);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, "shot_pier_grown.png") });

await page.evaluate((z) => window.__harbor.lookCell(18, z + 2, 22, 42), landZ);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, "shot_town.png") });

const cobbleTry = await page.evaluate((z) => {
  const h = window.__harbor;
  const a = h.build("cobble", 21, z);
  const b = h.build("cobble", 22, z);
  const c = h.build("cobble", 22, z + 1);
  document.querySelector('button[data-speed="4"]')?.click();
  h.lookAlong(21, z, "x");
  return { a, b, c, why21: h.why("cobble", 21, z) };
}, landZ);
await new Promise((r) => setTimeout(r, 3500));
await page.screenshot({ path: path.join(outDir, "shot_cobble.png") });

console.log(JSON.stringify({ errors, landZ, opening, pierGrow, cobbleTry, outDir }, null, 2));
await browser.close();
