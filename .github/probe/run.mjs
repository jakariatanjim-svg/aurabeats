import { Innertube } from "youtubei.js";
const ORIGIN = "https://aurabeats.pages.dev";
const hdrs = (r) => [...r.headers].filter(([k]) => k.startsWith("access-control")).map(([k, v]) => `${k}=${v}`).join(" ; ") || "(no CORS headers)";
async function pre(url) {
  try {
    const r = await fetch(url, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" } });
    console.log("PREFLIGHT", r.status, url, "->", hdrs(r));
  } catch (e) { console.log("PREFLIGHT ERR", url, String(e)); }
}
for (const u of [
  "https://oauth2.googleapis.com/device/code",
  "https://oauth2.googleapis.com/token",
  "https://www.youtube.com/o/oauth2/device/code",
  "https://www.youtube.com/o/oauth2/token",
  "https://youtubei.googleapis.com/youtubei/v1/browse",
  "https://www.youtube.com/youtubei/v1/browse",
  "https://www.googleapis.com/youtubei/v1/browse",
]) await pre(u);

const yt = await Innertube.create({ retrieve_player: false });
const oauth = yt.session.oauth;
const cid = await oauth.getClientID();
console.log("CLIENT_ID ok:", Boolean(cid?.client_id), "secret ok:", Boolean(cid?.client_secret), "id prefix:", String(cid?.client_id).slice(0, 12));
const scope = "http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content";
for (const u of ["https://oauth2.googleapis.com/device/code", "https://www.youtube.com/o/oauth2/device/code"]) {
  const body = new URLSearchParams({ client_id: cid.client_id, scope, device_id: crypto.randomUUID(), device_model: "ytlr::" });
  const r = await fetch(u, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, body });
  const t = await r.text();
  console.log("DEVICE(form)", r.status, u, hdrs(r), t.replace(/"device_code":\s*"[^"]+"/, '"device_code":"…"').slice(0, 300));
}
// token endpoint (expect authorization_pending / invalid) — just CORS headers on a simple POST
for (const u of ["https://oauth2.googleapis.com/token", "https://www.youtube.com/o/oauth2/token"]) {
  const body = new URLSearchParams({ client_id: cid.client_id, client_secret: cid.client_secret, refresh_token: "x", grant_type: "refresh_token" });
  const r = await fetch(u, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, body });
  console.log("TOKEN(form)", r.status, u, hdrs(r), (await r.text()).slice(0, 160));
}
// TV browse as a "simple" request (text/plain, no auth header) — CORS headers?
const ctx = { client: { clientName: "TVHTML5", clientVersion: "7.20260707.07.00", hl: "en", gl: "US" } };
for (const u of ["https://youtubei.googleapis.com/youtubei/v1/browse", "https://www.youtube.com/youtubei/v1/browse", "https://youtubei.googleapis.com/youtubei/v1/browse?access_token=abc", "https://www.youtube.com/youtubei/v1/browse?access_token=abc", "https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&access_token=abc"]) {
  try {
    const r = await fetch(u, { method: u.includes("/v3/") ? "GET" : "POST", headers: { Origin: ORIGIN, ...(u.includes("/v3/") ? {} : { "Content-Type": "text/plain;charset=UTF-8" }) }, body: u.includes("/v3/") ? undefined : JSON.stringify({ context: ctx, browseId: "FEtopics" }) });
    const t = await r.text();
    console.log("BROWSE(text)", r.status, u, hdrs(r), t.slice(0, 200).replace(/\s+/g, " "));
  } catch (e) { console.log("BROWSE ERR", u, String(e)); }
}
