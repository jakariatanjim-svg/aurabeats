import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const DIST = path.resolve("../../dist");
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/q")) { res.setHeader("Content-Type", "text/html"); return res.end(fs.readFileSync("q.html")); }
  let f = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
  const ext = path.extname(f);
  res.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" }[ext] || "application/octet-stream");
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(4173, r));
const log = (...a) => console.log(...a);
fs.mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const variants = {
  base: null,
  gpu: (h) => { h.style.willChange = "transform"; h.style.backfaceVisibility = "hidden"; },
  snap: (h) => { const w = h.parentElement; w.style.transform = "none"; const r = w.getBoundingClientRect(); w.style.left = Math.round(parseFloat(getComputedStyle(w).left) - r.width / 2) + "px"; w.style.top = Math.round(parseFloat(getComputedStyle(w).top) - r.height / 2) + "px"; h.style.top = Math.round(parseFloat(h.style.top)) + "px"; },
};
for (const [name, ctxOpts] of Object.entries({
  phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  laptop2x: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
})) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.goto("http://localhost:4173/watch/dQw4w9WgXcQ");
  await page.waitForTimeout(2500);
  if (ctxOpts.hasTouch) await page.touchscreen.tap(200, 140); else await page.mouse.click(600, 200);
  await page.waitForTimeout(12000);
  const info = await page.evaluate(() => {
    const ifr = document.querySelector(".fixed iframe");
    if (!ifr) return "no iframe";
    const h = ifr.parentElement, w = h.parentElement, box = w.parentElement;
    const r = (e) => { const b = e.getBoundingClientRect(); return `${b.left.toFixed(2)},${b.top.toFixed(2)} ${b.width.toFixed(2)}x${b.height.toFixed(2)}`; };
    return `box=${r(box)} wrap=${r(w)} host=${r(h)} hostStyle="${h.getAttribute("style")}"`;
  });
  log(`${name}: ${info}`);
  for (const [v, fn] of Object.entries(variants)) {
    if (fn) await page.evaluate(`(${fn.toString()})(document.querySelector(".fixed iframe").parentElement)`);
    await page.waitForTimeout(2500);
    const el = await page.$(".fixed iframe");
    const box = await page.evaluate(() => { const b = document.querySelector(".fixed iframe").parentElement.parentElement.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
    await page.screenshot({ path: `shots/${name}-${v}.png`, clip: box });
    log(`  shot ${name}-${v} ${JSON.stringify(box)} ${el ? "" : "noel"}`);
  }
  await ctx.close();
}
{
  log("\n##### quality levels (youtube.com host)");
  const page = await browser.newPage();
  await page.goto("http://localhost:4173/q");
  await page.waitForFunction(() => window.ready, null, { timeout: 30000 }).catch(() => {});
  for (const v of ["dQw4w9WgXcQ", "jNQXAC9IVRw", "kJQP7kiw5Fk", "JGwWNGJdvx8", "RgKAFK5djSk", "hTWKbfoikeg", "CevxZvSJLk8", "09R8_2nJtjg", "lp-EO5I60KA", "2Vv-BfVoq4g"]) {
    await page.evaluate((v) => { window.lastErr = null; P.loadVideoById(v); }, v);
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => ({ lv: P.getAvailableQualityLevels(), q: P.getPlaybackQuality(), err: window.lastErr, t: P.getCurrentTime().toFixed(1) }));
    log(`  ${v} err=${r.err} t=${r.t} q=${r.q} levels=${JSON.stringify(r.lv)}`);
  }
}
await browser.close();
server.close();
