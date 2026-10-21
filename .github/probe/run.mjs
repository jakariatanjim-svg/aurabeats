import { Innertube } from "youtubei.js";
import { execSync } from "node:child_process";
const yt = await Innertube.create({ retrieve_player: false });
const cid = await yt.session.oauth.getClientID();
const scope = "http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content";
const dc = await (await fetch("https://www.youtube.com/o/oauth2/device/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: cid.client_id, scope, device_id: crypto.randomUUID(), device_model: "ytlr::" }) })).json();
console.log("USER_CODE", dc.user_code, dc.verification_url, "expires", dc.expires_in);
execSync(`gh api repos/${process.env.GITHUB_REPOSITORY}/issues/5/comments -f body=${JSON.stringify(`Test sign-in code: **${dc.user_code}** at ${dc.verification_url} (temporary probe, token is revoked right after)`)}`, { stdio: "inherit" });
let tok;
const end = Date.now() + 14 * 60e3;
while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, (dc.interval || 5) * 1000));
  const r = await (await fetch("https://www.youtube.com/o/oauth2/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: cid.client_id, client_secret: cid.client_secret, code: dc.device_code, grant_type: "http://oauth.net/grant_type/device/1.0" }) })).json();
  if (r.access_token) { tok = r; break; }
  if (r.error && r.error !== "authorization_pending" && r.error !== "slow_down") { console.log("TOKEN_ERR", r.error); break; }
}
if (!tok) { console.log("NO_TOKEN"); process.exit(0); }
console.log("GOT_TOKEN scope=", tok.scope, "refresh:", Boolean(tok.refresh_token), "expires", tok.expires_in);
const api = async (label, url, extra = {}) => {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok.access_token}`, ...extra } });
  const j = await r.json().catch(() => ({}));
  console.log("API", label, r.status, j.error ? `${j.error.status} ${j.error.message?.slice(0, 160)} ${JSON.stringify(j.error.details?.[0]?.reason || j.error.errors?.[0]?.reason || "")}` : `items=${j.items?.length ?? "-"} total=${j.pageInfo?.totalResults ?? "-"}`);
};
const V3 = "https://www.googleapis.com/youtube/v3";
await api("channels", `${V3}/channels?part=snippet,contentDetails&mine=true`);
await api("subs", `${V3}/subscriptions?part=snippet&mine=true&maxResults=5`);
await api("playlists", `${V3}/playlists?part=snippet&mine=true&maxResults=5`);
await api("liked", `${V3}/playlistItems?part=snippet&playlistId=LL&maxResults=5`);
await api("liked-rating", `${V3}/videos?part=id&myRating=like&maxResults=5`);
await api("userinfo", "https://www.googleapis.com/oauth2/v3/userinfo");
await api("tokeninfo", `https://oauth2.googleapis.com/tokeninfo?access_token=${tok.access_token}`);
// InnerTube TV browse with the token (runner IP may be bot-blocked)
const ctx = { client: { clientName: "TVHTML5", clientVersion: "7.20260707.07.00", hl: "en", gl: "US" } };
for (const id of ["FEsubscriptions", "FElibrary", "VLLL"]) {
  const r = await fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", { method: "POST", headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version" }, body: JSON.stringify({ context: ctx, browseId: id }) });
  const t = await r.text();
  console.log("TVBROWSE", id, r.status, t.length, (t.match(/"(tileRenderer|tvBrowseRenderer|gridRenderer|shelfRenderer)"/g) || []).slice(0, 4).join(","), t.slice(0, 80).replace(/\s+/g, " "));
}
await fetch(`https://oauth2.googleapis.com/revoke?token=${tok.refresh_token || tok.access_token}`, { method: "POST" });
console.log("REVOKED");
