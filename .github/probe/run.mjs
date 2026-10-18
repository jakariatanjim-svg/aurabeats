import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, firefox } from "playwright";
const server = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end(fs.readFileSync("probe.html")); });
await new Promise((r) => server.listen(4173, r));
const URL = "http://aurabeats.test:4173/watch/x";
const HOST = "--host-resolver-rules=MAP aurabeats.test 127.0.0.1";
const log = (...a) => console.log(...a);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
async function run(name, launch, wait = 0, url = URL) {
  log(`\n##### ${name}`);
  let ctx;
  try {
    ctx = await launch();
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(url);
    const t0 = Date.now();
    const out = await page.evaluate(() => window.runProbe());
    log(`  brave=${out.brave} control=${out.control} -> ${out.verdict} (hits ${out.hits}, ${Date.now() - t0} ms)  ua=${out.ua}`);
    out.res.forEach((r) => log("   ", r));
  } catch (e) {
    log("  FAILED", String(e).slice(0, 300));
  } finally {
    await ctx?.close().catch(() => {});
  }
}
const UBOL = path.resolve("ubol");
await run("chromium (no extension)", () => chromium.launchPersistentContext(tmp(), { headless: false, args: [HOST] }));
await run("chromium + uBlock Origin Lite", () => chromium.launchPersistentContext(tmp(), { headless: false, args: [HOST, `--disable-extensions-except=${UBOL}`, `--load-extension=${UBOL}`] }), 8000);

const braveDir = tmp();
const braveOpts = { headless: false, executablePath: "/usr/bin/brave-browser", args: [HOST], ignoreDefaultArgs: ["--disable-component-update", "--disable-background-networking", "--disable-component-extensions-with-background-pages"] };
await run("brave warm-up (downloading Shields lists)", () => chromium.launchPersistentContext(braveDir, braveOpts), 90000);
await run("brave default Shields (http test host)", () => chromium.launchPersistentContext(braveDir, braveOpts), 10000);
log("  brave component dirs:", fs.readdirSync(braveDir).filter((d) => /^[a-z]{32}$/.test(d)).join(",") || "(none)");

// Firefox: plain, and with uBlock Origin installed into the profile
await run("firefox (no extension)", () => firefox.launchPersistentContext(tmp(), { headless: true }), 0, "http://localhost:4173/watch/x");
const ffDir = tmp();
fs.mkdirSync(path.join(ffDir, "extensions"), { recursive: true });
fs.copyFileSync("ubo.xpi", path.join(ffDir, "extensions", "uBlock0@raymondhill.net.xpi"));
await run("firefox + uBlock Origin", () => firefox.launchPersistentContext(ffDir, {
  headless: true,
  firefoxUserPrefs: { "extensions.autoDisableScopes": 0, "extensions.enabledScopes": 15, "xpinstall.signatures.required": false, "extensions.startupScanScopes": 15 },
}), 15000, "http://localhost:4173/watch/x");
server.close();
