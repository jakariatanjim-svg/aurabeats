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
  laptop2x: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
})) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.goto("http://localhost:4173/watch/dQw4w9WgXcQ");
  await page.waitForTimeout(14000);
  const f = page.frames().find((fr) => fr.url().includes("youtube-nocookie.com/embed/"));
  for (const at of [43, 70, 100]) {
    await f.evaluate((at) => { const p = document.querySelector("#movie_player"); p.pauseVideo(); p.seekTo(at, true); }, at);
    await page.waitForTimeout(2500);
    const box = await page.evaluate(() => { const b = document.querySelector(".fixed iframe").parentElement.parentElement.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
    // hide our own overlay (controls) so only the picture is measured
    await page.addStyleTag({ content: ".fixed > .touch-none { opacity: 0 !important }" });
    const zoom = midScore(await page.screenshot({ clip: box }));
    const old = await page.evaluate(() => { const h = document.querySelector(".fixed iframe").parentElement; const st = h.getAttribute("style"); const k = parseFloat(h.style.zoom); const fh = h.parentElement.offsetHeight; h.style.zoom = ""; h.style.top = -fh / 2 + "px"; h.style.height = (2 * fh) / k + "px"; h.style.transform = `scale(${k})`; h.style.transformOrigin = "0 0"; return st; });
    await page.waitForTimeout(1500);
    const scale = midScore(await page.screenshot({ clip: box }));
    await page.evaluate((st) => { const h = document.querySelector(".fixed iframe").parentElement; h.setAttribute("style", st); }, old);
    await page.waitForTimeout(800);
    log(`${name} t=${at}: NEW zoom ${zoom}  ||  OLD scale ${scale}`);
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
