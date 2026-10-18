import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const DIST = path.resolve("../../dist");
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
  const file = p.startsWith(DIST) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : path.join(DIST, "index.html");
  res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(4173, r));
const BASE = "http://localhost:4173";
const shots = [];
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=document-user-activation-required"] });

async function st(page) {
  const ui = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      badge: (txt.match(/Extension detected · ad-free|Ads not blocked|Checking ad blocker…/) || [""])[0],
      card: /No ad blocker found/.test(txt) ? "RED" : /Extension detected\. YouTube's ads/.test(txt) ? "BLUE" : "-",
      soundPill: /Tap anywhere for sound/.test(txt),
      adChip: /YouTube ad/.test(txt),
      err: (document.querySelector(".fixed.bg-black p.font-semibold")?.textContent || "").slice(0, 60),
      time: txt.match(/\d+:\d\d \/ (\d+:\d\d|--:--)/)?.[0] || "",
    };
  });
  const f = page.frames().find((fr) => fr.url().includes("/embed/"));
  let yt = "no-frame";
  if (f) yt = await f.evaluate(() => {
    const v = document.querySelector("video"); const p = document.querySelector("#movie_player");
    let q = "?"; try { q = p.getPlaybackQuality(); } catch {}
    return `t=${v ? v.currentTime.toFixed(1) : "-"} paused=${v?.paused} muted=${v?.muted} q=${q} ${v?.videoWidth}x${v?.videoHeight} ifr=${innerWidth}x${innerHeight}`;
  }).catch(() => "eval-failed");
  return JSON.stringify({ ...ui, yt });
}
const shot = async (page, name) => shots.push({ name, b64: (await page.screenshot({ type: "jpeg", quality: 50 })).toString("base64") });
const dockCenter = (page) => page.evaluate(() => {
  const b = [...document.querySelectorAll("div.fixed.bg-black")].find((d) => d.querySelector("iframe"))?.getBoundingClientRect();
  return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2, r: b.right, b: b.bottom } : null;
});

// ---------- A: desktop, no blocker, realistic autoplay policy ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("  pageerror:", String(e).slice(0, 200)));
  log("=== A1 direct load (no gesture yet)");
  await page.goto(`${BASE}/watch/dQw4w9WgXcQ`);
  for (const s of [2, 4, 7, 10]) { await page.waitForTimeout(s === 2 ? 2000 : (s - [2, 4, 7, 10][[2, 4, 7, 10].indexOf(s) - 1]) * 1000); log(`  +${s}s`, await st(page)); }
  await shot(page, "A1-direct");
  log("=== A2 click on the page title (not the player)");
  await page.locator("h1").first().click();
  await page.waitForTimeout(2500);
  log("  ", await st(page));
  log("=== A3 quality menu");
  const c = await dockCenter(page);
  await page.mouse.move(c.x, c.y); await page.mouse.move(c.x + 4, c.y + 4);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  await page.getByText("Quality", { exact: true }).click();
  await page.waitForTimeout(400);
  log("  quality list:", (await page.locator(".fixed .max-h-72").first().innerText()).replace(/\n/g, " | "));
  await shot(page, "A3-quality-menu");
  for (const q of ["1080p", "360p", "4K"]) {
    if (!(await page.locator(".fixed .max-h-72").count())) {
      await page.mouse.move(c.x, c.y); await page.mouse.move(c.x + 4, c.y + 4);
      await page.getByRole("button", { name: "Settings" }).click(); await page.waitForTimeout(300);
      await page.getByText("Quality", { exact: true }).click(); await page.waitForTimeout(300);
    }
    await page.locator(".fixed .max-h-72 button", { hasText: new RegExp(`^${q}`) }).first().click();
    await page.waitForTimeout(8000);
    log(`  picked ${q}:`, await st(page));
  }
  log("=== A4 subtitles row?");
  await page.mouse.move(c.x, c.y); await page.mouse.move(c.x + 4, c.y + 4);
  await page.getByRole("button", { name: "Settings" }).click(); await page.waitForTimeout(400);
  log("  menu:", (await page.locator(".fixed .w-64").first().innerText()).replace(/\n/g, " | "));
  await page.keyboard.press("Escape");
  log("=== A5 Up next click (gesture) → next video");
  await page.locator('aside a[href^="/watch/"]').first().click();
  await page.waitForTimeout(6000);
  log("  ", await st(page));
  await shot(page, "A5-next");
  await page.evaluate(() => scrollTo(0, 0));
  await ctx.close();
}

// ---------- B: desktop with ad servers blocked (simulated blocker) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  await ctx.route(/googlesyndication|doubleclick/, (r) => r.abort("blockedbyclient"));
  const page = await ctx.newPage();
  log("=== B simulated blocker");
  await page.goto(`${BASE}/watch/dQw4w9WgXcQ`);
  await page.waitForTimeout(5000);
  log("  ", await st(page));
  await shot(page, "B-blocker");
  await ctx.close();
}

// ---------- C: tablet (touch), quality on dpr 2 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("  pageerror:", String(e).slice(0, 200)));
  log("=== C1 tablet direct load");
  await page.goto(`${BASE}/watch/dQw4w9WgXcQ`);
  await page.waitForTimeout(8000);
  log("  +8s", await st(page));
  const c = await dockCenter(page);
  log("=== C2 tap on the player");
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(2500);
  log("  ", await st(page));
  await page.waitForTimeout(4000);
  log("  +4s", await st(page));
  await shot(page, "C-tablet");
  await ctx.close();
}
await browser.close();
server.close();
fs.writeFileSync("shots.json", JSON.stringify(shots));
