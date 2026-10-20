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
const t0s = Date.now();
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  let t = Date.now();
  await page.goto("http://localhost:4173/home");
  const n = await page.waitForFunction(() => document.querySelectorAll("article[role=button]").length >= 3, null, { timeout: 30000 }).then(() => true).catch(() => false);
  log(`music home: trending cards ${n ? "ok" : "MISSING"} in ${Date.now() - t}ms; first="${await page.evaluate(() => document.querySelector("article[role=button]")?.getAttribute("aria-label"))}" count=${await page.evaluate(() => document.querySelectorAll("article[role=button]").length)}`);
  const imgs = await page.evaluate(() => [...document.querySelectorAll("article img")].slice(0, 3).map((i) => `${i.currentSrc.split("/").slice(-2).join("/")} ${i.complete ? "loaded" : "pending"}`).join(", "));
  log(`  imgs: ${imgs}`);
  t = Date.now();
  await page.goto("http://localhost:4173/search");
  const inp = await page.$("input[type=search], input");
  await inp.fill("arijit singh");
  await inp.press("Enter");
  const ok = await page.waitForFunction(() => document.body.innerText.includes("Arijit") && document.querySelectorAll("img").length > 5, null, { timeout: 30000 }).then(() => true).catch(() => false);
  log(`music search: ${ok ? "results" : "NONE"} in ${Date.now() - t}ms`);
  await ctx.close();
}
for (const [name, ctxOpts] of Object.entries({
  desktop: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
})) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const t = Date.now();
  await page.goto("http://localhost:4173/watch/dQw4w9WgXcQ");
  const rel = await page.waitForFunction(() => [...document.querySelectorAll("a[href^='/watch/']")].filter((a) => !a.href.includes("dQw4w9WgXcQ")).length >= 3, null, { timeout: 30000 }).then(() => true).catch(() => false);
  log(`${name} watch: up next ${rel ? "ok" : "EMPTY"} in ${Date.now() - t}ms (${await page.evaluate(() => new Set([...document.querySelectorAll("a[href^='/watch/']")].map((a) => a.href)).size)} links)`);
  await page.waitForTimeout(8000);
  const box = await page.evaluate(() => { const b = document.querySelector(".fixed iframe").parentElement.parentElement.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
  const res = [];
  for (let f = 0; f < 3; f++) { res.push(midScore(await page.screenshot({ clip: box }))); await page.waitForTimeout(600); }
  log(`  ${await ytInfo(page)} host="${await page.evaluate(() => document.querySelector(".fixed iframe").parentElement.getAttribute("style"))}"\n   ${res.join(" | ")}`);
  if (name === "desktop") {
    for (const q of ["1080p", "360p", "2160p", "Auto"]) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2);
      await page.click('.fixed button[aria-label="Settings"]').catch((e) => log("no settings " + e.message.slice(0, 50)));
      await page.waitForTimeout(300);
      await page.locator(".fixed button", { hasText: /^Quality/ }).first().click({ timeout: 5000 }).catch((e) => log("no quality row " + e.message.slice(0, 50)));
      await page.waitForTimeout(300);
      const items = await page.evaluate(() => [...document.querySelectorAll(".ab-menu-list button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()).join(" / "));
      await page.locator(".ab-menu-list button", { hasText: q }).first().click({ timeout: 5000 }).catch((e) => log("no item " + q));
      const t1 = Date.now();
      let got = "";
      for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); got = await ytInfo(page); if ((q === "1080p" && got.includes("hd1080")) || (q === "360p" && got.includes("q=medium")) || (q === "2160p" && got.includes("hd2160"))) break; }
      log(`  pick ${q}: menu=[${items}] -> ${got} after ${Date.now() - t1}ms`);
    }
    const res2 = [];
    for (let f = 0; f < 3; f++) { res2.push(midScore(await page.screenshot({ clip: box }))); await page.waitForTimeout(600); }
    log(`  after picks: ${res2.join(" | ")}`);
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
