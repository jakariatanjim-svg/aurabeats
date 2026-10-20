import http from "node:http";
import { chromium } from "playwright";
const server = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<p>x</p>"); });
await new Promise((r) => server.listen(4173, r));
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto("http://localhost:4173/");
const out = await page.evaluate(async () => {
  const hit = async (url) => {
    const t0 = performance.now();
    try {
      const c = new AbortController(); setTimeout(() => c.abort(), 12000);
      const r = await fetch(url, { signal: c.signal });
      const j = await r.text();
      let info = "";
      try { const d = JSON.parse(j); info = d.error ? `error=${String(d.error).slice(0, 40)} ${String(d.message || "").slice(0, 60)}` : `title=${!!d.title} desc=${(d.description || "").length} rel=${(d.relatedStreams || []).length} vs=${(d.videoStreams || []).length} heights=${[...new Set((d.videoStreams || []).map((s) => s.height))].join(",")}`; } catch { info = j.slice(0, 50); }
      return `${r.status} ${Math.round(performance.now() - t0)}ms ${info}`;
    } catch (e) { return `ERR ${e.message} ${Math.round(performance.now() - t0)}ms`; }
  };
  const ids = ["dQw4w9WgXcQ", "kJQP7kiw5Fk", "JGwWNGJdvx8", "hT_nvWreIhg", "RgKAFK5djSk", "9bZkp7q19f0", "jNQXAC9IVRw", "OPf0YbXqDm0"];
  const lines = [];
  await Promise.all(ids.flatMap((id) => [
    hit(`https://pipedapi.ducks.party/streams/${id}`).then((r) => lines.push(`ducks ${id}: ${r}`)),
    hit(`https://api.piped.private.coffee/streams/${id}`).then((r) => lines.push(`coffee ${id}: ${r}`)),
  ]));
  lines.push("oembed: " + (await hit("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))));
  lines.push("noembed: " + (await hit("https://noembed.com/embed?url=" + encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))));
  lines.push("piped trending: " + (await hit("https://pipedapi.ducks.party/trending?region=BD")).slice(0, 40));
  return lines.sort();
});
console.log(out.join("\n"));
await browser.close(); server.close();
