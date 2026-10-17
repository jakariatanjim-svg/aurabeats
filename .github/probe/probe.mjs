// Temporary diagnostics for Video mode (removed after use).
import { chromium } from "playwright";
const VID = process.env.VID || "dQw4w9WgXcQ";
const log = (...a) => console.log(...a);

// ---------- 1+2: browser-side innertube from a foreign origin ----------
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage();
await p.goto("https://example.com");
const out = await p.evaluate(async (VID) => {
  const R = {};
  const clients = {
    VISIONOS: { clientName: "VISIONOS", clientVersion: "1.02", deviceMake: "Apple", deviceModel: "RealityDevice17,1", osName: "visionOS", osVersion: "26.5.23O471", hl: "en", gl: "US" },
  };
  const hosts = ["youtubei.googleapis.com", "www.youtube.com", "m.youtube.com"];
  const ctypes = ["application/json", "text/plain;charset=UTF-8"];
  let urls = null;
  for (const host of hosts) for (const ct of ctypes) for (const [cn, c] of Object.entries(clients)) {
    const k = `${host} ${ct.split(";")[0]} ${cn}`;
    try {
      const r = await fetch(`https://${host}/youtubei/v1/player?prettyPrint=false`, {
        method: "POST", headers: { "Content-Type": ct },
        body: JSON.stringify({ context: { client: c }, videoId: VID, contentCheckOk: true, racyCheckOk: true }),
      });
      const j = await r.json().catch(() => null);
      const sd = j?.streamingData;
      R[k] = { status: r.status, play: j?.playabilityStatus?.status, reason: j?.playabilityStatus?.reason, muxed: sd?.formats?.length ?? 0, adaptive: (sd?.adaptiveFormats || []).filter((f) => f.url).length };
      if (!urls && sd) urls = { muxed: sd.formats?.find((f) => f.url)?.url, video: sd.adaptiveFormats?.find((f) => f.url && /avc1/.test(f.mimeType) && f.height >= 720)?.url, audio: sd.adaptiveFormats?.find((f) => f.url && f.mimeType.startsWith("audio/mp4"))?.url };
    } catch (e) { R[k] = { error: String(e) }; }
  }
  // metadata endpoints with WEB client
  const web = { clientName: "WEB", clientVersion: "2.20261007.01.00", hl: "en", gl: "US" };
  for (const [ep, extra] of [["search", { query: "rick astley" }], ["browse", { browseId: "UCuAXFkgsw1L7xaCfnd5JJOw", params: "EgZ2aWRlb3PyBgQKAjoA" }], ["next", { videoId: VID }]]) {
    for (const host of ["youtubei.googleapis.com", "www.youtube.com"]) {
      try {
        const r = await fetch(`https://${host}/youtubei/v1/${ep}?prettyPrint=false`, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ context: { client: web }, ...extra }) });
        const t = await r.text();
        R[`meta ${ep} ${host}`] = { status: r.status, bytes: t.length, videoIds: (t.match(/"videoId":"/g) || []).length };
      } catch (e) { R[`meta ${ep} ${host}`] = { error: String(e) }; }
    }
  }
  // can the stream URLs play in <video>/<audio>?
  const tryMedia = (tag, src) => new Promise((res) => {
    if (!src) return res("no url");
    const el = document.createElement(tag); el.muted = true; el.preload = "auto"; el.src = src;
    const t = setTimeout(() => res(`timeout rs=${el.readyState}`), 15000);
    el.onloadedmetadata = () => { clearTimeout(t); res(`OK metadata dur=${Math.round(el.duration)} ${el.videoWidth || ""}x${el.videoHeight || ""}`); };
    el.onerror = () => { clearTimeout(t); res(`ERROR code=${el.error?.code}`); };
  });
  if (urls) {
    R.play_muxed = await tryMedia("video", urls.muxed);
    R.play_video720 = await tryMedia("video", urls.video);
    R.play_audio = await tryMedia("audio", urls.audio);
  }
  return R;
}, VID);
log("=== BROWSER (origin https://example.com) ===");
for (const [k, v] of Object.entries(out)) log(k.padEnd(48), JSON.stringify(v));

// ---------- 3: public servers: info + real stream playability ----------
const tryMediaUrl = async (src) => {
  const pg = await b.newPage(); await pg.goto("https://example.com");
  const r = await pg.evaluate((src) => new Promise((res) => {
    const el = document.createElement("video"); el.muted = true; el.src = src;
    const t = setTimeout(() => res(`timeout`), 15000);
    el.onloadedmetadata = () => { clearTimeout(t); res(`OK ${el.videoWidth}x${el.videoHeight}`); };
    el.onerror = () => { clearTimeout(t); res(`ERROR ${el.error?.code}`); };
  }), src).catch((e) => "ERR " + e);
  await pg.close(); return r;
};
const j = async (u) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 12000); try { const r = await fetch(u, { signal: c.signal, headers: { Origin: "https://example.com" } }); const txt = await r.text(); let js = null; try { js = JSON.parse(txt); } catch {} return { status: r.status, cors: r.headers.get("access-control-allow-origin"), js, head: txt.slice(0, 80) }; } catch (e) { return { error: String(e).slice(0, 60) }; } finally { clearTimeout(t); } };

const inv = new Set(["https://invidious.f5.si", "https://inv.nadeko.net", "https://yewtu.be", "https://invidious.nerdvpn.de", "https://invidious.tiekoetter.com", "https://yt.chocolatemoo53.com", "https://inv.thepixora.com"]);
const ij = await j("https://api.invidious.io/instances.json?sort_by=health");
for (const [, i] of ij.js || []) if (i?.type === "https" && i.uri) inv.add(i.uri.replace(/\/$/, ""));
const piped = new Set(["https://pipedapi.kavin.rocks", "https://api.piped.private.coffee", "https://pipedapi.adminforge.de", "https://pipedapi.reallyaweso.me", "https://pipedapi.leptons.xyz", "https://pipedapi.nosebs.ru", "https://pipedapi-libre.kavin.rocks", "https://piped-api.privacy.com.de", "https://api.piped.yt", "https://pipedapi.drgns.space", "https://pipedapi.owo.si", "https://pipedapi.ducks.party", "https://piped-api.codespace.cz", "https://pipedapi.darkness.services", "https://pipedapi.orangenet.cc"]);
const pj = await j("https://piped-instances.kavin.rocks/");
for (const i of Array.isArray(pj.js) ? pj.js : []) if (i?.api_url) piped.add(i.api_url.replace(/\/$/, ""));
log("\npiped-instances.kavin.rocks:", pj.status ?? pj.error, " invidious list:", ij.status ?? ij.error);

log("\n=== INVIDIOUS ===");
for (const base of inv) {
  const r = await j(`${base}/api/v1/videos/${VID}?local=true`);
  const d = r.js; const a = d?.adaptiveFormats || [];
  const v = a.find((f) => /avc1/.test(f.type) && /720/.test(f.qualityLabel || "")) || a.find((f) => f.type?.startsWith("video/"));
  const m = (d?.formatStreams || [])[0];
  const abs = (u) => (u?.startsWith("/") ? base + u : u);
  const ch = await j(`${base}/api/v1/channels/UCuAXFkgsw1L7xaCfnd5JJOw/videos`);
  const tr = await j(`${base}/api/v1/trending?region=BD`);
  const se = await j(`${base}/api/v1/search?q=rick&type=all`);
  log(base.padEnd(40), `info=${r.status ?? r.error} cors=${r.cors} title=${!!d?.title} fmts=${a.length}/${(d?.formatStreams || []).length}`,
    `| chanVideos=${ch.js?.videos?.length ?? ch.status ?? ch.error} trending=${Array.isArray(tr.js) ? tr.js.length : tr.status ?? tr.error} search=${Array.isArray(se.js) ? se.js.length : se.status ?? se.error}`,
    d?.title ? `| play720=${await tryMediaUrl(abs(v?.url))} playMuxed=${m ? await tryMediaUrl(abs(m.url)) : "none"}` : `| ${r.head?.replace(/\s+/g, " ")}`);
}
log("\n=== PIPED ===");
for (const base of piped) {
  const r = await j(`${base}/streams/${VID}`);
  const d = r.js; const vs = (d?.videoStreams || []).filter((s) => !/LBRY/.test(s.quality || ""));
  const v = vs.find((s) => s.videoOnly && /720/.test(s.quality || "")) || vs.find((s) => s.videoOnly);
  const m = vs.find((s) => !s.videoOnly);
  const ch = await j(`${base}/channel/UCuAXFkgsw1L7xaCfnd5JJOw`);
  log(base.padEnd(40), `info=${r.status ?? r.error} cors=${r.cors} title=${!!d?.title} video=${vs.length} audio=${(d?.audioStreams || []).length} chanRelated=${ch.js?.relatedStreams?.length ?? ch.status ?? ch.error}`,
    d?.title ? `| play720=${v ? await tryMediaUrl(v.url) : "none"} playMuxed=${m ? await tryMediaUrl(m.url) : "none"}` : `| ${(r.head || "").replace(/\s+/g, " ")}`);
}
await b.close();
