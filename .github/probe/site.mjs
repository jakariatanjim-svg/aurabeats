// Temporary end-to-end check of the BUILT website in real Chrome.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DIST = path.resolve("../../dist");
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
  const file = p.startsWith(DIST) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : path.join(DIST, "index.html");
  const ext = path.extname(file);
  res.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" }[ext] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(4173, r));
const BASE = "http://localhost:4173";

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
  console.log("browser: Google Chrome", browser.version());
} catch {
  browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  console.log("browser: bundled chromium", browser.version());
}

async function newPage(settings) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript((s) => {
    if (s) localStorage.setItem("aurabeats:v1:videoSettings", JSON.stringify(s));
    window.__yt = { states: [], maxT: 0 };
    addEventListener("message", (e) => {
      if (!String(e.origin).includes("youtube")) return;
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        const i = d && d.info;
        if (!i) return;
        if (typeof i.playerState === "number") window.__yt.states.push(i.playerState);
        if (typeof i.currentTime === "number") window.__yt.maxT = Math.max(window.__yt.maxT, i.currentTime);
      } catch {}
    });
  }, settings || null);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   pageerror:", String(e).slice(0, 160)));
  return page;
}

const snap = (page) =>
  page.evaluate(() => {
    const vids = [...document.querySelectorAll("video")].map((v) => ({ t: +v.currentTime.toFixed(1), paused: v.paused, rs: v.readyState, err: v.error?.code, w: v.videoWidth, h: v.videoHeight, src: (v.currentSrc || "").replace(/\?.*/, "").slice(0, 60) }));
    const badge = [...document.querySelectorAll("span")].map((s) => s.textContent || "").find((t) => /^\s*(Ad-free ·|YouTube player ·)/.test(t)) || "";
    const embed = !!document.querySelector('iframe[src*="youtube-nocookie.com/embed"]');
    const loading = /Finding the best ad-free stream/.test(document.body.innerText);
    const err = document.body.innerText.match(/(All ad-free servers[^\n]*|No servers left[^\n]*|Something went wrong[^\n]*)/)?.[0] || "";
    const title = document.querySelector("h1")?.textContent || "";
    return { vids, badge: badge.trim(), embed, loading, err, title: title.slice(0, 60), yt: window.__yt };
  });

async function watch(id, label, settings) {
  console.log(`\n=== WATCH ${label} (${id}) ===`);
  const page = await newPage(settings);
  const t0 = Date.now();
  await page.goto(`${BASE}/watch/${id}`);
  let last = "";
  let result = "TIMEOUT (nothing played in 90s)";
  while (Date.now() - t0 < 90000) {
    await page.waitForTimeout(2000);
    const s = await snap(page);
    const v = s.vids.find((x) => x.t > 1 && !x.paused);
    const line = JSON.stringify({ badge: s.badge, embed: s.embed, loading: s.loading, err: s.err, vids: s.vids.map((x) => `${x.t}s ${x.paused ? "paused" : "playing"} rs${x.rs} err${x.err ?? "-"} ${x.w}x${x.h} ${x.src}`) });
    if (line !== last) console.log(`  +${((Date.now() - t0) / 1000).toFixed(0)}s`, line);
    last = line;
    if (v) { result = `AD-FREE PLAYING ${v.w}x${v.h} via "${s.badge}" after ${((Date.now() - t0) / 1000).toFixed(0)}s`; break; }
    if (s.embed && s.yt.maxT > 1) { result = `EMBED PLAYING (t=${s.yt.maxT.toFixed(1)}) after ${((Date.now() - t0) / 1000).toFixed(0)}s`; break; }
    if (s.err && !s.loading) { result = "ERROR: " + s.err; break; }
  }
  console.log("  RESULT:", result, "| title:", (await snap(page)).title);
  return page;
}

async function embedCheck(id) {
  console.log(`\n=== YOUTUBE PLAYER BUTTON (${id}) ===`);
  const page = await newPage();
  await page.goto(`${BASE}/watch/${id}`);
  const btn = page.getByRole("button", { name: /YouTube player/ });
  try {
    await btn.waitFor({ timeout: 60000 });
    await btn.click();
  } catch {
    console.log("  button not found (maybe already in embed mode)");
  }
  let ads = 0, t = 0;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const f = page.frames().find((fr) => fr.url().includes("youtube-nocookie.com/embed"));
    if (f) {
      const st = await f.evaluate(() => {
        const p = document.querySelector(".html5-video-player");
        const v = document.querySelector("video");
        return { ad: !!p && p.classList.contains("ad-showing"), t: v ? v.currentTime : -1, err: document.querySelector(".ytp-error")?.textContent?.slice(0, 120) || "" };
      }).catch((e) => ({ ad: false, t: -1, err: "frame eval: " + e }));
      if (st.ad) ads++;
      t = Math.max(t, st.t);
      if (st.err) console.log("  player error:", st.err);
    }
  }
  const s = await snap(page);
  console.log(`  embed iframe=${s.embed} badge="${s.badge}" playedTo=${t.toFixed(1)}s api-states=${[...new Set(s.yt.states)].join(",")} api-maxT=${s.yt.maxT.toFixed(1)} adSamples=${ads}/15`);
  await page.context().close();
}

async function channel(id, label) {
  console.log(`\n=== CHANNEL ${label} (${id}) ===`);
  const page = await newPage();
  const t0 = Date.now();
  await page.goto(`${BASE}/channel/${id}`);
  let s;
  while (Date.now() - t0 < 60000) {
    await page.waitForTimeout(2000);
    s = await page.evaluate(() => ({
      name: document.querySelector("h1")?.textContent || "",
      subs: document.querySelector("h1")?.nextElementSibling?.textContent || "",
      banner: !!document.querySelector('img[class*="object-cover"][referrerpolicy="no-referrer"]'),
      cards: new Set([...document.querySelectorAll('a[href^="/watch/"]')].map((a) => a.getAttribute("href"))).size,
      empty: /Videos aren't available/.test(document.body.innerText),
      error: document.body.innerText.match(/(All ad-free servers[^\n]*|No servers left[^\n]*)/)?.[0] || "",
      more: [...document.querySelectorAll("button")].some((b) => b.textContent === "Load more"),
    }));
    if (s.cards > 0 || s.empty || s.error) break;
  }
  console.log(`  after ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(s));
  if (s?.more) {
    await page.getByRole("button", { name: "Load more" }).click();
    await page.waitForTimeout(8000);
    const n = await page.evaluate(() => new Set([...document.querySelectorAll('a[href^="/watch/"]')].map((a) => a.getAttribute("href"))).size);
    console.log("  after Load more: cards =", n);
  }
  await page.context().close();
}

const p1 = await watch("dQw4w9WgXcQ", "Rick Astley");
await p1.context().close();
const p2 = await watch("kJQP7kiw5Fk", "Despacito");
await p2.context().close();
const p3 = await watch("dQw4w9WgXcQ", "fallback OFF", { quality: "auto", autoplayNext: true, customServer: "", embedFallback: false });
await p3.context().close();
await embedCheck("kJQP7kiw5Fk");
await channel("UCuAXFkgsw1L7xaCfnd5JJOw", "Rick Astley");
await channel("UCX6OQ3DkcsbYNE6H8uQQuVA", "MrBeast");
await browser.close();
server.close();
