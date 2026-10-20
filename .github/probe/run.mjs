import http from "node:http";
import fs from "node:fs";
import { chromium } from "playwright";
const server = http.createServer((req, res) => {
  const f = req.url.startsWith("/q") ? "q.html" : "cors.html";
  res.setHeader("Content-Type", "text/html"); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(4173, r));
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ channel: "chrome", args: ["--host-resolver-rules=MAP aurabeats.test 127.0.0.1", "--autoplay-policy=no-user-gesture-required"] });
{
  const page = await browser.newPage();
  await page.goto("http://aurabeats.test:4173/");
  const out = await page.evaluate(() => window.runNet());
  for (const v of out) log(v);
}
if (false) {
  log("\n##### quality levels per video (embed, getAvailableQualityLevels after playing)");
  const page = await browser.newPage();
  await page.goto("http://localhost:4173/q");
  await page.waitForFunction(() => window.ready, null, { timeout: 30000 }).catch(() => {});
  const vids = ["dQw4w9WgXcQ", "jNQXAC9IVRw", "9bZkp7q19f0", "kffacxfA7G4", "fJ9rUzIMcZQ", "YQHsXMglC9A", "hT_nvWreIhg", "L_jWHffIx5E", "OPf0YbXqDm0", "60ItHLz5WEA"];
  for (const v of vids) {
    await page.evaluate((v) => { window.lastErr = null; P.loadVideoById(v); }, v);
    const lv = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(1000);
      lv.push(await page.evaluate(() => `${P.getPlayerState()}:${(P.getAvailableQualityLevels() || []).length}`));
    }
    const r = await page.evaluate(() => ({ lv: P.getAvailableQualityLevels(), q: P.getPlaybackQuality(), err: window.lastErr, t: P.getCurrentTime().toFixed(1) }));
    const f = page.frames().find((fr) => fr.url().includes("/embed/"));
    const inner = f ? await f.evaluate(() => { try { const p = document.querySelector("#movie_player"); const d = p.getAvailableQualityData ? p.getAvailableQualityData() : null; return JSON.stringify((d || []).map((x) => x.qualityLabel || x.quality)); } catch (e) { return "x " + e; } }).catch(() => "-") : "-";
    log(`  ${v} err=${r.err} t=${r.t} q=${r.q} levels=${JSON.stringify(r.lv)} | inner=${inner} | timeline=${lv.join(" ")}`);
  }
}
await browser.close();
server.close();
