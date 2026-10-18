// Temporary: real-Chrome check of the website's YouTube player UI.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DIST = path.resolve("../../dist");
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
  const file = p.startsWith(DIST) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : path.join(DIST, "index.html");
  res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(4173, r));
const BASE = "http://localhost:4173";
const shots = [];
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ channel: "chrome" });
log("Chrome", browser.version());

async function state(page) {
  const ui = await page.evaluate(() => {
    const txt = document.body.innerText;
    const box = [...document.querySelectorAll("div.fixed.bg-black")].find((d) => d.querySelector("iframe"));
    const r = box?.getBoundingClientRect();
    return {
      dock: box ? `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} z=${getComputedStyle(box).zIndex}` : "none",
      time: txt.match(/\d+:\d\d \/ (\d+:\d\d|--:--)/)?.[0] || "",
      unmute: /Tap to unmute/.test(txt),
      native: /AuraBeats controls|\bDone\b/.test(txt) && !!document.querySelector("button.z-30"),
      x2: !!document.querySelector(".fixed .rounded-full") && /\b2x\b/.test(txt),
      ripple: /\d+ seconds/.test(txt),
      fsEl: !!document.fullscreenElement,
      route: location.pathname,
    };
  });
  const f = page.frames().find((fr) => fr.url().includes("youtube-nocookie.com/embed"));
  let yt = "no-frame";
  if (f) {
    yt = await f
      .evaluate(() => {
        const v = document.querySelector("video");
        const p = document.querySelector(".html5-video-player");
        return `t=${v ? v.currentTime.toFixed(1) : "-"} paused=${v ? v.paused : "-"} muted=${v ? v.muted : "-"} ad=${p?.classList.contains("ad-showing")} err="${(document.querySelector(".ytp-error")?.textContent || "").slice(0, 70)}"`;
      })
      .catch((e) => "eval-failed " + String(e).slice(0, 60));
  }
  return { ...ui, yt };
}

async function shot(page, name) {
  const buf = await page.screenshot({ type: "jpeg", quality: 45 });
  shots.push({ name, b64: buf.toString("base64") });
}

async function watchFor(page, label, secs) {
  let last = "";
  for (let i = 0; i < secs; i++) {
    await page.waitForTimeout(1000);
    const s = JSON.stringify(await state(page));
    if (s !== last) log(`  [${label} +${i + 1}s]`, s);
    last = s;
  }
}

// ---------- desktop ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("  pageerror:", String(e).slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && log("  console.error:", m.text().slice(0, 160)));

  log("\n=== 1. direct load /watch/dQw4w9WgXcQ (no user gesture) ===");
  await page.goto(`${BASE}/watch/dQw4w9WgXcQ`);
  await watchFor(page, "direct", 12);
  await shot(page, "1-desktop-inline");

  log("\n=== 3. hover → controls, hold → 2x ===");
  const box = await page.evaluate(() => {
    const b = [...document.querySelectorAll("div.fixed.bg-black")].find((d) => d.querySelector("iframe"))?.getBoundingClientRect();
    return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
  });
  if (box) {
    await page.mouse.move(box.x, box.y);
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.waitForTimeout(300);
    await shot(page, "3-desktop-controls");
    await page.mouse.down();
    await page.waitForTimeout(900);
    log("  holding:", JSON.stringify(await state(page)));
    await page.mouse.up();
    await page.waitForTimeout(300);
    log("  released:", JSON.stringify(await state(page)));
  }

  log("\n=== 2. click an Up next video (user gesture) ===");
  const link = page.locator('aside a[href^="/watch/"]').first();
  if (await link.count()) {
    const href = await link.getAttribute("href");
    await link.click();
    log("  clicked", href);
    await watchFor(page, "clicked", 10);
  } else log("  no Up next links");

  log("\n=== 4. theater (t) ===");
  await page.keyboard.press("t");
  await page.waitForTimeout(800);
  log("  ", JSON.stringify(await state(page)));
  await shot(page, "4-theater");
  await page.keyboard.press("t");

  log("\n=== 5. fullscreen (f) ===");
  await page.keyboard.press("f");
  await page.waitForTimeout(1000);
  log("  ", JSON.stringify(await state(page)));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  log("\n=== 6. miniplayer (i), then browse to search ===");
  await page.keyboard.press("i");
  await page.waitForTimeout(1200);
  log("  after i:", JSON.stringify(await state(page)));
  await page.evaluate(() => {
    history.pushState({}, "", "/video/search");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForTimeout(1500);
  log("  on search:", JSON.stringify(await state(page)));
  await shot(page, "6-mini-on-search");
  const exp = page.getByRole("button", { name: "Expand" }).first();
  if (await exp.count()) {
    await exp.click({ force: true });
    await page.waitForTimeout(1500);
    log("  after expand:", JSON.stringify(await state(page)));
  }
  await ctx.close();
}

// ---------- mobile ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("  pageerror:", String(e).slice(0, 200)));
  log("\n=== 7. mobile /watch/kJQP7kiw5Fk ===");
  await page.goto(`${BASE}/watch/kJQP7kiw5Fk`);
  await watchFor(page, "mobile", 10);
  await shot(page, "7-mobile");
  const b = await page.evaluate(() => {
    const r = [...document.querySelectorAll("div.fixed.bg-black")].find((d) => d.querySelector("iframe"))?.getBoundingClientRect();
    return r ? { l: r.left, t: r.top, w: r.width, h: r.height } : null;
  });
  if (b) {
    const cdp = await ctx.newCDPSession(page);
    const tap = async (x, y) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await tap(b.l + b.w * 0.85, b.t + b.h / 2);
    await page.waitForTimeout(120);
    await tap(b.l + b.w * 0.85, b.t + b.h / 2);
    await page.waitForTimeout(200);
    log("  double-tap right:", JSON.stringify(await state(page)));
    await page.waitForTimeout(900);
    // swipe down → miniplayer
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.l + b.w / 2, y: b.t + 40 }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: b.l + b.w / 2, y: b.t + 40 + i * 25 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(1500);
    log("  swipe down:", JSON.stringify(await state(page)));
    await shot(page, "8-mobile-mini");
  }
  await ctx.close();
}

await browser.close();
server.close();
fs.writeFileSync("shots.json", JSON.stringify(shots));
