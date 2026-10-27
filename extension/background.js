/*
 * AuraBeats Connector — background worker.
 *
 * The AuraBeats website asks (through bridge.js) for YouTube requests; this
 * worker makes them with this browser's own youtube.com sign-in. Only
 * youtube.com / music.youtube.com addresses are allowed. The sign-in itself
 * (cookies) never leaves the browser: only the answers go back to the page.
 */
const HOSTS = new Set(["www.youtube.com", "music.youtube.com"]);

// Requests from this worker look like they come from youtube.com itself
// (session rule: only requests made by the extension, not by any tab).
async function setupHeaders() {
  const rules = [...HOSTS].map((host, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "origin", operation: "set", value: `https://${host}` },
        { header: "referer", operation: "set", value: `https://${host}/` },
      ],
    },
    condition: { urlFilter: `|https://${host}/`, tabIds: [-1], resourceTypes: ["xmlhttprequest", "other"] },
  }));
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id), addRules: rules });
}
let ready = setupHeaders().catch(() => undefined);
chrome.runtime.onStartup.addListener(() => (ready = setupHeaders().catch(() => undefined)));
chrome.runtime.onInstalled.addListener(() => (ready = setupHeaders().catch(() => undefined)));

async function sha1(s) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function cookie(name) {
  const c = await chrome.cookies.get({ url: "https://www.youtube.com", name });
  return c ? c.value : null;
}

/** SAPISIDHASH (plus 1P / 3P) for an origin; null when signed out. */
async function authHeader(origin) {
  const sapisid = (await cookie("SAPISID")) || (await cookie("__Secure-3PAPISID"));
  if (!sapisid) return null;
  const ts = Math.floor(Date.now() / 1000);
  const parts = [`SAPISIDHASH ${ts}_${await sha1(`${ts} ${sapisid} ${origin}`)}`];
  const p1 = await cookie("__Secure-1PAPISID");
  if (p1) parts.push(`SAPISID1PHASH ${ts}_${await sha1(`${ts} ${p1} ${origin}`)}`);
  const p3 = await cookie("__Secure-3PAPISID");
  if (p3) parts.push(`SAPISID3PHASH ${ts}_${await sha1(`${ts} ${p3} ${origin}`)}`);
  return parts.join(" ");
}

async function request({ url, method = "POST", body, headers = {}, pageId, authUser = "0" }) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !HOSTS.has(u.hostname)) return { status: 0, body: "", error: "bad url" };
  await ready;
  const origin = `https://${u.hostname}`;
  const h = { ...headers, "X-Origin": origin, "X-Goog-AuthUser": String(authUser) };
  const auth = await authHeader(origin);
  if (auth) h.Authorization = auth;
  if (pageId) h["X-Goog-PageId"] = pageId;
  if (body != null && method !== "GET" && !h["Content-Type"]) h["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers: h, body: method === "GET" ? undefined : body, credentials: "include" });
  return { status: res.status, body: await res.text(), signedIn: !!auth };
}

const SITES = [/^https:\/\/([a-z0-9-]+\.)?aurabeats\.pages\.dev\//, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//];

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || sender.id !== chrome.runtime.id) return false;
  if (msg.kind === "status") {
    authHeader("https://www.youtube.com").then((a) => reply({ signedIn: !!a }), () => reply({ signedIn: false }));
    return true;
  }
  if (msg.kind !== "yt-request" || !SITES.some((re) => re.test(sender.url || ""))) return false;
  request(msg.req || {}).then(reply, (e) => reply({ status: 0, body: "", error: String((e && e.message) || e) }));
  return true; // answer comes later
});
