import puppeteer from "puppeteer-core";

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1600,900"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("page " + e.message + "\n" + (e.stack || "")));
page.on("requestfailed", (req) => errors.push("fail " + req.url() + " " + req.failure()?.errorText));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console " + m.text());
});
await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle0", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: "scripts/shot_splash.png" });
const begin = await page.$("#btn-begin");
if (!begin) errors.push("missing begin button");
else {
  await begin.click();
  await new Promise((r) => setTimeout(r, 2000));
}
await page.screenshot({ path: "scripts/shot_city.png" });

const money = await page.$eval("#stat-money", (el) => el.textContent);
const tools = await page.$$eval("#tools button", (els) => els.length);
errors.push("money=" + money + " tools=" + tools);

if (tools > 0) {
  await page.click("#tools button[data-tool='house']");
  const box = await page.$eval("#view", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.48 };
  });
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: "scripts/shot_placed.png" });
}

console.log(errors.join("\n"));
await browser.close();
