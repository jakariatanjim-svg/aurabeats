import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
const server = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end(fs.readFileSync("probe.html")); });
await new Promise((r) => server.listen(4173, r));
const URL = "http://aurabeats.test:4173/watch/x";
const HOST = "--host-resolver-rules=MAP aurabeats.test 127.0.0.1";
const log = (...a) => console.log(...a);
async function run(name, launch, wait = 0) {
  log(`\n##### ${name}`);
  let ctx;
  try {
    ctx = await launch();
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(URL);
    const out = await page.evaluate(() => window.runProbe());
    log(`brave=${out.brave} ua=${out.ua}`);
    for (const [k, v] of Object.entries(out.rows)) log(`  ${k.padEnd(60)} ${v}`);
    log("  adsbygoogle:", out.adsbygoogle);
    log("  googletag:", out.googletag, "| google_ad_status:", out.google_ad_status);
    log("  newGlobals:", out.newGlobals);
    log("  bait:", out.bait);
  } catch (e) {
    log("  FAILED", String(e).slice(0, 300));
  } finally {
    await ctx?.close().catch(() => {});
  }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
const UBOL = path.resolve("ubol");
await run("chromium (no extension)", () => chromium.launchPersistentContext(tmp(), { headless: false, args: [HOST] }));
await run("chromium + uBlock Origin Lite", () => chromium.launchPersistentContext(tmp(), { headless: false, args: [HOST, `--disable-extensions-except=${UBOL}`, `--load-extension=${UBOL}`] }), 8000);
const braveDir = tmp();
// first start lets Brave download its ad-block components, second run measures
await run("brave warm-up (fresh profile)", () => chromium.launchPersistentContext(braveDir, { headless: false, executablePath: "/usr/bin/brave-browser", args: [HOST] }), 45000);
await run("brave default Shields", () => chromium.launchPersistentContext(braveDir, { headless: false, executablePath: "/usr/bin/brave-browser", args: [HOST] }), 15000);
server.close();
