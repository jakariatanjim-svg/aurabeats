// What does YouTube's player do when sound is switched on? Logs, every 250 ms,
// what the page receives from the IFrame API (postMessage infoDelivery) next
// to the player's own internal state (ad-showing etc.) and our UI.
import { chromium } from "playwright";
const ids = (process.env.IDS || "kJQP7kiw5Fk").split(",");
const browser = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required"] });
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    window.__yt = {};
    window.addEventListener("message", (e) => {
      if (!String(e.origin).includes("youtube")) return;
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.event === "infoDelivery" && d.info) Object.assign(window.__yt, d.info);
        if (d?.event === "onStateChange") window.__yt.playerState = d.info;
        if (d?.event) (window.__ev = window.__ev || []).push(d.event + (d.event === "onStateChange" ? ":" + d.info : ""));
      } catch {}
    });
  });
  const t0 = Date.now();
  await page.goto(`http://localhost:4173/watch/${id}`);
  const lines = [];
  let last = "";
  let clicked = false;
  for (let i = 0; i < 200; i++) {
    const el = ((Date.now() - t0) / 1000).toFixed(1);
    if (!clicked && Date.now() - t0 > 9000) {
      clicked = true;
      const tap = page.locator('button:has-text("Tap anywhere for sound")');
      const how = (await tap.count()) ? "tap-button" : "mute-ctrl";
      try {
        if (how === "tap-button") await tap.first().click({ timeout: 2000 });
        else {
          await page.mouse.move(640, 300);
          await page.locator('button[aria-label^="Unmute"], button[aria-label^="Mute"]').first().click({ timeout: 2000, force: true });
        }
      } catch (e) {
        lines.push(`${el}s CLICK FAILED ${e}`);
      }
      lines.push(`${el}s >>> CLICKED SOUND (${how})`);
    }
    const api = await page.evaluate(() => {
      const y = window.__yt || {};
      const ev = (window.__ev || []).splice(0).filter((x) => x !== "infoDelivery").join("+");
      const ui = {
        adBadge: document.body.innerText.includes("YouTube ad"),
        tap: document.body.innerText.includes("Tap anywhere for sound"),
      };
      return `API st=${y.playerState} t=${(+y.currentTime || 0).toFixed(1)} muted=${y.muted} vid=${y.videoData?.video_id ?? "?"} ${ev ? "ev=" + ev : ""} UI ad=${ui.adBadge} tap=${ui.tap}`;
    });
    let inner = "no-frame";
    const fr = page.frames().find((f) => f.url().includes("/embed/"));
    if (fr) {
      inner = await fr
        .evaluate(() => {
          const mp = document.getElementById("movie_player");
          const v = document.querySelector("video");
          if (!mp) return "no-mp";
          const c = mp.classList;
          let as = "?";
          try { as = mp.getAdState?.(); } catch {}
          return `IN st=${mp.getPlayerState?.()} t=${(+mp.getCurrentTime?.() || 0).toFixed(1)} adShowing=${c.contains("ad-showing")} adInterrupting=${c.contains("ad-interrupting")} adState=${as} video.paused=${v?.paused} video.t=${(+v?.currentTime || 0).toFixed(1)} video.muted=${v?.muted} unstarted=${c.contains("unstarted-mode")} paused-mode=${c.contains("paused-mode")}`;
        })
        .catch((e) => "frame-err " + String(e).slice(0, 60));
    }
    // timestamps only when something other than the clocks changed
    const sig = (api + " " + inner).replace(/t=[\d.]+/g, "");
    if (sig !== last) {
      lines.push(`${el}s ${api} | ${inner}`);
      last = sig;
    }
    await page.waitForTimeout(250);
    if (Date.now() - t0 > 55000) break;
  }
  console.log(`::warning title=${id}::` + lines.join(" ¦ ").replace(/\n/g, " "));
  await page.close();
}
await browser.close();
