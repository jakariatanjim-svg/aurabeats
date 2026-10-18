import http from "node:http";
import fs from "node:fs";
import { chromium } from "playwright";
const server = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end(fs.readFileSync("q.html")); });
await new Promise((r) => server.listen(4174, r));
const log = (...a) => console.log(...a);
for (const policy of ["no-user-gesture-required", "document-user-activation-required"]) {
  log(`\n##### autoplay-policy=${policy}`);
  const browser = await chromium.launch({ channel: "chrome", args: [`--autoplay-policy=${policy}`] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto("http://localhost:4174/");
  const frameInfo = async () => {
    const f = page.frames().find((fr) => fr.url().includes("/embed/"));
    if (!f) return "no frame";
    return f.evaluate(() => { const v = document.querySelector("video"); return v ? `video ${v.videoWidth}x${v.videoHeight} t=${v.currentTime.toFixed(1)} paused=${v.paused} muted=${v.muted}` : "no video"; }).catch((e) => "err " + e);
  };
  const api = (expr) => page.evaluate(expr).catch((e) => "ERR " + String(e).slice(0, 100));
  await page.waitForTimeout(8000);
  log("after 8s:", await frameInfo());
  log("levels:", await api(() => JSON.stringify(P.getAvailableQualityLevels())), "| current:", await api(() => P.getPlaybackQuality()), "| muted:", await api(() => P.isMuted()));
  if (policy === "no-user-gesture-required") {
    log("-- setPlaybackQuality('medium')");
    await api(() => P.setPlaybackQuality("medium"));
    await page.waitForTimeout(6000);
    log("   ", await frameInfo(), "q=", await api(() => P.getPlaybackQuality()));
    log("-- postMessage setPlaybackQualityRange('medium')");
    await api(() => {
      const ifr = P.getIframe();
      ifr.contentWindow.postMessage(JSON.stringify({ event: "command", func: "setPlaybackQualityRange", args: ["medium", "medium"], id: 1, channel: "widget" }), "*");
    });
    await page.waitForTimeout(6000);
    log("   ", await frameInfo(), "q=", await api(() => P.getPlaybackQuality()));
    log("-- loadVideoById suggestedQuality small");
    await api(() => P.loadVideoById({ videoId: "dQw4w9WgXcQ", startSeconds: P.getCurrentTime(), suggestedQuality: "small" }));
    await page.waitForTimeout(6000);
    log("   ", await frameInfo(), "q=", await api(() => P.getPlaybackQuality()));
    log("-- set hd1080 via setPlaybackQuality + range");
    await api(() => { P.setPlaybackQuality("hd1080"); P.getIframe().contentWindow.postMessage(JSON.stringify({ event: "command", func: "setPlaybackQualityRange", args: ["hd1080", "hd1080"], id: 1, channel: "widget" }), "*"); });
    await page.waitForTimeout(6000);
    log("   ", await frameInfo(), "q=", await api(() => P.getPlaybackQuality()));
    log("captions:", await api(() => { P.loadModule("captions"); return JSON.stringify(P.getOptions()) + " " + JSON.stringify(P.getOption("captions", "tracklist")); }));
    await page.waitForTimeout(2000);
    log("captions2:", await api(() => JSON.stringify(P.getOptions()) + " " + JSON.stringify(P.getOption("captions", "tracklist"))));
  } else {
    log("-- user click on page (outside iframe) then unMute + playVideo");
    await page.mouse.click(5, 5);
    await api(() => { P.unMute(); P.playVideo(); });
    await page.waitForTimeout(3000);
    log("   ", await frameInfo(), "muted:", await api(() => P.isMuted()));
  }
  log("events:", (await api(() => R.log.join(" | "))).slice(0, 1500));
  await browser.close();
}
server.close();
