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
import { PNG } from "pngjs";
function rows(buf) {
  const png = PNG.sync.read(buf);
  const { width: W, height: H, data } = png;
  const lum = (x, y) => { const i = (y * W + x) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  const d = [];
  for (let y = 1; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += Math.abs(lum(x, y) - lum(x, y - 1)); d.push([y, s / W]); }
  const sorted = d.map((e) => e[1]).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  // a seam = a row that differs from BOTH neighbours (thin line)
  const thin = [];
  for (let y = 1; y < H - 1; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) { const c = lum(x, y); s += Math.min(Math.abs(c - lum(x, y - 1)), Math.abs(c - lum(x, y + 1))); }
    thin.push([y, +(s / W).toFixed(2)]);
  }
  thin.sort((a, b) => b[1] - a[1]);
  return `H=${H} med=${med.toFixed(2)} thinTop=${thin.slice(0, 4).map((t) => t.join(":")).join(" ")}`;
}
function midScore(buf) {
  const png = PNG.sync.read(buf);
  const { width: W, height: H, data } = png;
  const lum = (x, y) => { const i = (y * W + x) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  const thin = (y) => { let s = 0; for (let x = 0; x < W; x++) { const c = lum(x, y); s += Math.min(Math.abs(c - lum(x, y - 1)), Math.abs(c - lum(x, y + 1))); } return s / W; };
  const all = []; for (let y = 2; y < H - 2; y++) all.push(thin(y));
  const med = [...all].sort((a, b) => a - b)[Math.floor(all.length / 2)];
  const m = Math.floor(H / 2);
  const mid = Math.max(thin(m - 2), thin(m - 1), thin(m), thin(m + 1), thin(m + 2));
  const top = all.map((v, i) => [i + 2, v]).sort((a, b) => b[1] - a[1])[0];
  return `mid=${mid.toFixed(2)} med=${med.toFixed(2)} max=${top[0]}:${top[1].toFixed(2)}`;
}
// h = host div (holds the iframe), w = 16:9 wrap (fw x fh)
const variants = {
  base: null,
  noscale: (h) => { const w = h.parentElement; const fw = w.offsetWidth, fh = w.offsetHeight; Object.assign(h.style, { transform: "none", width: fw + "px", height: 2 * fh + "px", top: -Math.round(fh / 2) + "px" }); },
  half: (h) => { const w = h.parentElement; const fw = w.offsetWidth, fh = w.offsetHeight; const L = 2 * fw; Object.assign(h.style, { transform: "scale(0.5)", width: L + "px", height: 4 * fh + "px", top: -Math.round(fh / 2) + "px" }); },
  zoom: (h) => { const w = h.parentElement; const fw = w.offsetWidth, fh = w.offsetHeight; const L = 1280, k = fw / L; Object.assign(h.style, { transform: "none", zoom: String(k), width: L + "px", height: (2 * fh) / k + "px", top: -(fh / 2) / k + "px" }); },
  gpu: (h) => { const w = h.parentElement; const fw = w.offsetWidth, fh = w.offsetHeight; const L = 1280, k = fw / L; Object.assign(h.style, { zoom: "", width: L + "px", height: (2 * fh) / k + "px", top: -Math.round(fh / 2) + "px", transform: `scale(${k}) translateZ(0)`, willChange: "transform" }); },
};
async function ytInfo(page) {
  const f = page.frames().find((fr) => fr.url().includes("youtube-nocookie.com/embed/"));
  if (!f) return "noframe";
  return f.evaluate(() => { const p = document.querySelector("#movie_player"); return `q=${p?.getPlaybackQuality?.()} inner=${innerWidth}x${innerHeight} dpr=${devicePixelRatio} st=${p?.getPlayerState?.()}`; }).catch((e) => "err " + e.message.slice(0, 60));
}
for (const [name, ctxOpts] of Object.entries({
  desktop: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
})) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.goto("http://localhost:4173/watch/dQw4w9WgXcQ");
  await page.waitForTimeout(12000);
  const rects = await page.evaluate(() => { const ifr = document.querySelector(".fixed iframe"); const h = ifr.parentElement, w = h.parentElement, box = w.parentElement; const r = (e) => { const b = e.getBoundingClientRect(); return `${b.left.toFixed(2)},${b.top.toFixed(2)} ${b.width.toFixed(2)}x${b.height.toFixed(2)}`; }; return `box=${r(box)} wrap=${r(w)} iframe=${r(ifr)}`; });
  log(`${name}: ${rects} ${await ytInfo(page)}`);
  if (name === "desktop") {
    const box = await page.evaluate(() => { const b = document.querySelector(".fixed").getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2);
    await page.click('.fixed button[aria-label="Settings"]');
    await page.locator(".fixed button", { hasText: /^Quality/ }).first().click({ timeout: 5000 });
    await page.locator(".ab-menu-list button", { hasText: "1080p" }).first().click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    log(`  picked 1080p -> ${await ytInfo(page)}`);
  }
  await ctx.close();
}
if (false) {
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
