/*
 * AuraBeats Connector — background worker.
 *
 * The AuraBeats website asks (through bridge.js) for YouTube requests; this
 * worker makes them with this browser's own youtube.com sign-in. Only
 * youtube.com / music.youtube.com addresses are allowed. The sign-in itself
 * (cookies) never leaves the browser: only the answers go back to the page.
 */
const HOSTS = new Set(["www.youtube.com", "music.youtube.com"]);
const DEVICE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

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
  // Video streams (no sign-in): YouTube's player answer is asked for as the
  // same Apple Vision device the Android app uses, so the stream addresses
  // need no deciphering. They are tied to this computer's address, which is
  // why the request has to come from this browser.
  for (const [i, path] of ["youtubei/v1/player", "sw.js_data"].entries()) {
    rules.push({
      id: 10 + i,
      priority: 2,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "user-agent", operation: "set", value: DEVICE_UA }] },
      condition: { urlFilter: `|https://www.youtube.com/${path}`, tabIds: [-1], resourceTypes: ["xmlhttprequest", "other"] },
    });
  }
  const old = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old.map((r) => r.id), addRules: rules });
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

async function request({ url, method = "POST", body, headers = {}, pageId, authUser = "0", anon = false }) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !HOSTS.has(u.hostname)) return { status: 0, body: "", error: "bad url" };
  await ready;
  const origin = `https://${u.hostname}`;
  if (anon) {
    // no sign-in at all (video streams)
    const h = { ...headers };
    if (body != null && method !== "GET" && !h["Content-Type"]) h["Content-Type"] = "application/json";
    const res = await fetch(url, { method, headers: h, body: method === "GET" ? undefined : body, credentials: "omit" });
    return { status: res.status, body: await res.text(), signedIn: false };
  }
  const h = { ...headers, "X-Origin": origin, "X-Goog-AuthUser": String(authUser) };
  const auth = await authHeader(origin);
  if (auth) h.Authorization = auth;
  if (pageId) h["X-Goog-PageId"] = pageId;
  if (body != null && method !== "GET" && !h["Content-Type"]) h["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers: h, body: method === "GET" ? undefined : body, credentials: "include" });
  return { status: res.status, body: await res.text(), signedIn: !!auth };
}

/* ---------------- accounts (for the popup) ---------------- */

const WEB_CLIENT = { clientName: "WEB", clientVersion: "2.20261020.01.00", hl: "en", gl: "US" };

function findFirst(root, key) {
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) stack.push(...v);
    else if (v && typeof v === "object") {
      if (v[key] && typeof v[key] === "object") return v[key];
      stack.push(...Object.values(v));
    }
  }
  return null;
}
const textOf = (t) => (!t ? "" : typeof t === "string" ? t : t.simpleText || (t.runs || []).map((r) => r.text).join(""));
function photoOf(t) {
  const list = (t && t.thumbnails) || [];
  const url = list.length ? list[list.length - 1].url : "";
  return url && url.startsWith("//") ? `https:${url}` : url;
}

let cache = null; // { at, accounts }

/** Google accounts signed in to YouTube in this browser (name, email, picture). */
async function listAccounts() {
  if (cache && Date.now() - cache.at < 60000) return cache.accounts;
  const out = [];
  for (let i = 0; i < 6; i++) {
    const res = await request({
      url: "https://www.youtube.com/youtubei/v1/account/accounts_list?prettyPrint=false",
      body: JSON.stringify({ context: { client: WEB_CLIENT } }),
      headers: { "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": WEB_CLIENT.clientVersion },
      authUser: String(i),
    });
    if (res.status !== 200) break;
    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      break;
    }
    if (/"key":"logged_in","value":"0"/.test(JSON.stringify(data.responseContext || {}))) break;
    const header = findFirst(data, "googleAccountHeaderRenderer");
    const item = findFirst(data, "accountItem");
    if (!header && !item) break;
    const email = textOf(header && header.email);
    if (out.some((a) => a.email && a.email === email)) break; // past the last one
    out.push({ name: textOf(item && item.accountName) || textOf(header && header.name), email, photo: photoOf(item && item.accountPhoto) });
  }
  cache = { at: Date.now(), accounts: out };
  return out;
}

const SITES = [/^https:\/\/([a-z0-9-]+\.)?aurabeats\.pages\.dev\//, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//];

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || sender.id !== chrome.runtime.id) return false;
  if (msg.kind === "status") {
    authHeader("https://www.youtube.com").then((a) => reply({ signedIn: !!a }), () => reply({ signedIn: false }));
    return true;
  }
  // only the extension's own popup (not a website) may list the accounts
  if (msg.kind === "accounts" && !sender.tab) {
    listAccounts().then((accounts) => reply({ accounts }), () => reply({ accounts: [] }));
    return true;
  }
  if (msg.kind !== "yt-request" || !SITES.some((re) => re.test(sender.url || ""))) return false;
  request(msg.req || {}).then(reply, (e) => reply({ status: 0, body: "", error: String((e && e.message) || e) }));
  return true; // answer comes later
});
