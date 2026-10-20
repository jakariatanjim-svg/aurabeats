import http from "node:http";
import fs from "node:fs";
import { chromium } from "playwright";
const html = fs.readFileSync("../../dist/index.html");
const server = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end(html); });
await new Promise((r) => server.listen(4173, r));
const browser = await chromium.launch({ channel: "chrome" });
const log = (...a) => console.log(...a);
const OTHER = /jiosaavn|saavn|soundcloud|audius|jamendo|archive\.org/i;
const t0 = Date.now();
const T = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

async function step(name, fn) {
  try { await fn(); } catch (e) { log(`!! ${name}: ${String(e.message).split("\n")[0]}`); }
}

// ---------- phone ----------
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const other = [];
page.on("request", (r) => { if (OTHER.test(r.url())) other.push(r.url().slice(0, 80)); });
page.on("pageerror", (e) => log("pageerror", e.message));

await step("home", async () => {
  await page.goto("http://localhost:4173/home");
  await page.waitForTimeout(6000);
  const nav = await page.$$eval("nav.ab-navbar button", (b) => b.map((x) => x.textContent.trim()));
  log("mobile nav:", nav.join(" | "));
  log("other-source requests on home:", other.length, other.slice(0, 3).join(" "));
});

await step("sheet", async () => {
  await page.click('header button[aria-label="Search"]:visible');
  await page.waitForSelector('[role=dialog][aria-label=Search] input');
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  await page.waitForTimeout(3000);
  const rows = await page.$$eval('[role=dialog] [role=option]', (r) => r.map((x) => x.textContent.trim()));
  const hdr = await page.$$eval('[role=dialog] p', (r) => r.map((x) => x.textContent.trim()));
  log("sheet focused:", focused, "rows:", rows.length, "headers:", hdr.join(","), "first:", rows.slice(0, 4).join(" / "));
  await page.fill('[role=dialog] input', "arijit");
  await page.waitForTimeout(2000);
  const sug = await page.$$eval('[role=dialog] [role=option]', (r) => r.map((x) => x.textContent.trim()));
  log("suggestions:", sug.length, sug.slice(0, 4).join(" / "));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  log("url after enter:", page.url().replace("http://localhost:4173", ""), "sheet open:", !!(await page.$('[role=dialog][aria-label=Search]')));
  await page.waitForSelector("text=/found/", { timeout: 15000 });
  log(T(), "music results:", await page.textContent("text=/found/"));
  const topbar = await page.$eval("header", (h) => h.innerText.replace(/\s+/g, " ").slice(0, 60));
  log("topbar on results:", topbar);
  log("other-source requests after yt search:", other.length);
  await page.click("text=Other Sources");
  await page.waitForTimeout(6000);
  log("other-source requests after tab:", other.length);
  await page.goBack();
  await page.waitForTimeout(800);
  log("url after back:", page.url().replace("http://localhost:4173", ""));
});

await step("history in sheet", async () => {
  await page.click('header button[aria-label="Search"]:visible');
  await page.waitForTimeout(800);
  const rows = await page.$$eval('[role=dialog] [role=option]', (r) => r.map((x) => x.textContent.trim()));
  log("sheet rows now:", rows.slice(0, 3).join(" / "));
  await page.goBack(); // android back closes sheet
  await page.waitForTimeout(500);
  log("after back: sheet", !!(await page.$('[role=dialog][aria-label=Search]')), "url", page.url().replace("http://localhost:4173", ""));
});

await step("video search + watch", async () => {
  await page.goto("http://localhost:4173/video");
  await page.waitForTimeout(1500);
  await page.click('header button[aria-label="Search"]:visible');
  await page.fill('[role=dialog] input', "coke studio bangla");
  await page.keyboard.press("Enter");
  await page.waitForSelector('main a[href^="/watch/"]', { timeout: 20000 });
  log(T(), "video url:", page.url().replace("http://localhost:4173", ""));
  const hrefs = await page.$$eval('main a[href^="/watch/"]', (a) => [...new Set(a.map((x) => x.getAttribute("href")))]);
  log("video results:", hrefs.length);
  for (const h of hrefs.slice(0, 3)) {
    await page.goto("http://localhost:4173/video/search?q=coke%20studio%20bangla");
    await page.waitForSelector(`main a[href="${h}"]`, { timeout: 20000 });
    const s = Date.now();
    await page.click(`main a[href="${h}"] >> nth=1`);
    await page.waitForSelector("main h1", { timeout: 15000 });
    const tTitle = Date.now() - s;
    let desc = 0, tDesc = -1, rel = 0, tRel = -1, views = "";
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      const st = await page.evaluate(() => ({
        d: document.querySelector("main .line-clamp-3, main p.whitespace-pre-wrap")?.textContent?.length ?? 0,
        r: document.querySelectorAll("main aside a[href^='/watch/']").length,
        v: document.querySelector("main h1 + p")?.textContent ?? "",
      }));
      if (st.d && tDesc < 0) { tDesc = Date.now() - s; desc = st.d; }
      if (st.r && tRel < 0) { tRel = Date.now() - s; rel = st.r; }
      views = st.v;
      if (tDesc >= 0 && tRel >= 0 && i > 16) break;
    }
    const d2 = await page.evaluate(() => document.querySelector("main p.whitespace-pre-wrap")?.textContent?.length ?? 0);
    const ch = await page.evaluate(() => [...document.querySelectorAll("main button")].some((b) => /^Follow/.test(b.textContent)));
    log(`watch ${h}: title ${tTitle}ms, desc ${desc}ch @${tDesc}ms (final ${d2}), upnext ${rel} @${tRel}ms, meta "${views.slice(0, 40)}", follow=${ch}`);
  }
  // direct open (no card hint)
  const s = Date.now();
  await page.goto("http://localhost:4173/watch/kJQP7kiw5Fk");
  await page.waitForSelector("main h1", { timeout: 15000 });
  const tt = Date.now() - s;
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => ({
    h: document.querySelector("main h1")?.textContent,
    d: document.querySelector("main p.whitespace-pre-wrap")?.textContent?.length ?? 0,
    r: document.querySelectorAll("main aside a[href^='/watch/']").length,
    v: document.querySelector("main h1 + p")?.textContent ?? "",
  }));
  log(`direct watch: title ${tt}ms "${st.h}", desc ${st.d}, upnext ${st.r}, meta "${st.v.slice(0, 40)}"`);
});

await browser.close(); server.close();
