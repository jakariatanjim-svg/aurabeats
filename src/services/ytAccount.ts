/**
 * YouTube account (Android app). Signs in the way smart TVs do: the app shows
 * a short code, you approve it at google.com/device with your Google account,
 * and the app receives a token from YouTube's TV client. No Google Cloud
 * project, no API quota, no server. It reads your subscriptions, liked
 * videos and playlists from YouTube (TV client, as only that accepts these
 * tokens).
 *
 * Everything stays on this device (localStorage). Sign out revokes the token
 * at Google and wipes it. Not signed in = guest mode: the local follows,
 * likes and history keep working as before.
 *
 * Website: browsers aren't allowed to call YouTube's API (no CORS), and the
 * official Data API would need our own Cloud project, so sign-in is app-only.
 */
import { useSyncExternalStore } from "react";
import { http, isNative } from "@/services/video/net";
import type { VideoItem } from "@/services/video/types";
import { storage } from "@/utils/storage";

export const accountSupported = isNative;

const YT = "https://www.youtube.com";
const TV_UA = "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version";
const TV_CLIENT = { clientName: "TVHTML5", clientVersion: "7.20260707.07.00", hl: "en", gl: "US" };
const SCOPE = "http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content";

/* ---------------------------------- types -------------------------------- */

export interface YtChannel {
  id: string;
  name: string;
  avatar?: string;
}
export interface YtPlaylist {
  id: string;
  title: string;
  thumbnail?: string;
  countText?: string;
}
export interface YtProfile {
  name: string;
  handle?: string;
  photo?: string;
}
interface Tokens {
  access_token: string;
  refresh_token: string;
  /** epoch ms */
  expiry: number;
  client_id: string;
  client_secret: string;
}
export interface AccountState {
  signedIn: boolean;
  profile?: YtProfile;
  subs: YtChannel[];
  subsFeed: VideoItem[];
  liked: VideoItem[];
  playlists: YtPlaylist[];
  syncing: boolean;
  syncedAt?: number;
  /** short notes on what failed during the last sync */
  errors: string[];
}

/* ---------------------------------- store -------------------------------- */

const K_TOKENS = "account:tokens";
const K_DATA = "account:data";

let tokens: Tokens | null = storage.get<Tokens | null>(K_TOKENS, null);
const saved = storage.get<Partial<AccountState>>(K_DATA, {});
let state: AccountState = {
  signedIn: Boolean(tokens),
  profile: saved.profile,
  subs: saved.subs ?? [],
  subsFeed: saved.subsFeed ?? [],
  liked: saved.liked ?? [],
  playlists: saved.playlists ?? [],
  syncedAt: saved.syncedAt,
  syncing: false,
  errors: [],
};
const listeners = new Set<() => void>();
function set(next: Partial<AccountState>) {
  state = { ...state, ...next };
  if (state.signedIn) {
    const { profile, subs, subsFeed, liked, playlists, syncedAt } = state;
    storage.set(K_DATA, { profile, subs, subsFeed, liked, playlists, syncedAt });
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export function useYtAccount(): AccountState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
export const ytAccount = { get: () => state };

/* ---------------------------------- OAuth -------------------------------- */

/** The TV app's public client id/secret, read from YouTube's TV page. */
async function tvClient(): Promise<{ client_id: string; client_secret: string }> {
  const html = await http<string>(`${YT}/tv`, { headers: { "User-Agent": TV_UA, Referer: `${YT}/tv`, "Accept-Language": "en-US" } }, "text");
  const src = /<script\s+id="base-js"\s+src="([^"]+)"[^>]*><\/script>/.exec(html)?.[1];
  if (!src) throw new Error("YouTube TV page changed (no script)");
  const js = await http<string>(new URL(src, YT).href, { headers: { "User-Agent": TV_UA }, timeout: 20000 }, "text");
  const m = /clientId:"(?<id>[^"]+)",[^"]*?:"(?<secret>[^"]+)"/.exec(js);
  if (!m?.groups) throw new Error("YouTube TV script changed (no client id)");
  return { client_id: m.groups.id, client_secret: m.groups.secret };
}

export interface DeviceCode {
  userCode: string;
  verifyUrl: string;
  /** epoch ms */
  expiresAt: number;
  interval: number;
  /** internal */
  deviceCode: string;
  client: { client_id: string; client_secret: string };
}

/** Step 1: get the code the user types at google.com/device. */
export async function startSignIn(): Promise<DeviceCode> {
  if (!accountSupported) throw new Error("Sign-in works in the Android app");
  const client = await tvClient();
  const r = await http<{ device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number }>(
    `${YT}/o/oauth2/device/code`,
    {
      method: "POST",
      body: { client_id: client.client_id, scope: SCOPE, device_id: crypto.randomUUID(), device_model: "ytlr::" },
    },
  );
  return {
    userCode: r.user_code,
    verifyUrl: r.verification_url || "https://www.google.com/device",
    expiresAt: Date.now() + (r.expires_in || 1800) * 1000,
    interval: Math.max(3, r.interval || 5),
    deviceCode: r.device_code,
    client,
  };
}

/**
 * Step 2: wait until the user approves. Resolves true when signed in, false
 * on cancel/expiry; throws on "access denied".
 */
export async function waitForApproval(dc: DeviceCode, signal: AbortSignal): Promise<boolean> {
  while (!signal.aborted && Date.now() < dc.expiresAt) {
    await new Promise((r) => setTimeout(r, dc.interval * 1000));
    if (signal.aborted) return false;
    let r: Record<string, unknown>;
    try {
      // The token endpoint answers 4xx while pending, so read the body ourselves.
      r = await tokenCall({ ...dc.client, code: dc.deviceCode, grant_type: "http://oauth.net/grant_type/device/1.0" });
    } catch {
      continue; // network hiccup: keep polling
    }
    if (typeof r.access_token === "string") {
      tokens = {
        access_token: r.access_token,
        refresh_token: String(r.refresh_token || ""),
        expiry: Date.now() + Number(r.expires_in || 3600) * 1000 - 60_000,
        ...dc.client,
      };
      storage.set(K_TOKENS, tokens);
      set({ signedIn: true, errors: [] });
      void syncAccount();
      return true;
    }
    const err = String(r.error || "");
    if (err === "access_denied") throw new Error("Access was denied");
    if (err === "expired_token") return false;
    if (err && err !== "authorization_pending" && err !== "slow_down") throw new Error(err);
  }
  return false;
}

async function tokenCall(body: Record<string, string>): Promise<Record<string, unknown>> {
  const { CapacitorHttp } = await import("@capacitor/core");
  const res = await CapacitorHttp.request({
    url: `${YT}/o/oauth2/token`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: body,
    responseType: "json",
    connectTimeout: 12000,
    readTimeout: 12000,
  });
  const d = typeof res.data === "string" ? JSON.parse(res.data || "{}") : res.data;
  return (d ?? {}) as Record<string, unknown>;
}

async function accessToken(): Promise<string> {
  if (!tokens) throw new Error("Not signed in");
  if (Date.now() < tokens.expiry) return tokens.access_token;
  const r = await tokenCall({
    client_id: tokens.client_id,
    client_secret: tokens.client_secret,
    refresh_token: tokens.refresh_token,
    grant_type: "refresh_token",
  });
  if (typeof r.access_token !== "string") {
    if (r.error === "invalid_grant") {
      // Access removed from the Google account: back to guest mode.
      clearLocal();
      throw new Error("Signed out: access was removed from your Google account");
    }
    throw new Error(`Couldn't refresh sign-in (${String(r.error || "unknown")})`);
  }
  tokens = { ...tokens, access_token: r.access_token, expiry: Date.now() + Number(r.expires_in || 3600) * 1000 - 60_000 };
  storage.set(K_TOKENS, tokens);
  return tokens.access_token;
}

function clearLocal() {
  tokens = null;
  storage.remove(K_TOKENS);
  storage.remove(K_DATA);
  set({ signedIn: false, profile: undefined, subs: [], subsFeed: [], liked: [], playlists: [], syncedAt: undefined, errors: [] });
}

/** Sign out: revoke at Google (best effort) and wipe everything local. */
export async function signOut(): Promise<void> {
  const t = tokens;
  clearLocal();
  if (!t) return;
  try {
    await http(`${YT}/o/oauth2/revoke?token=${encodeURIComponent(t.refresh_token || t.access_token)}`, { method: "POST", body: {} });
  } catch {
    /* offline: the token still expires; access can be removed in the Google account */
  }
}

/* -------------------------------- InnerTube ------------------------------ */

async function tv(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const token = await accessToken();
  return http(`${YT}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: "POST",
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": TV_UA,
      "X-YouTube-Client-Name": "7",
      "X-YouTube-Client-Version": TV_CLIENT.clientVersion,
      Origin: YT,
    },
    body: { context: { client: TV_CLIENT }, ...body },
  });
}

/* ----------------------- tolerant raw-JSON parsing ----------------------- */
/* TV answers use tileRenderer / tabRenderer trees that change often, so we
 * walk the whole JSON instead of following fixed paths. */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

function text(t: unknown): string {
  if (!isObj(t)) return typeof t === "string" ? t : "";
  if (typeof t.simpleText === "string") return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => (isObj(r) && typeof r.text === "string" ? r.text : "")).join("");
  if (typeof t.content === "string") return t.content;
  return "";
}

/** Every value stored under `key`, anywhere in the tree. */
function findAll(root: unknown, key: string): Obj[] {
  const out: Obj[] = [];
  const stack: unknown[] = [root];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === key && isObj(x)) out.push(x);
        stack.push(x);
      }
    }
  }
  return out;
}

const bestThumb = (t: unknown): string | undefined => {
  const list = isObj(t) && Array.isArray(t.thumbnails) ? (t.thumbnails as Obj[]) : [];
  const last = list[list.length - 1];
  const url = last && typeof last.url === "string" ? last.url : undefined;
  return url?.startsWith("//") ? `https:${url}` : url;
};

function parseDuration(s: string): number {
  if (!/^\d+(:\d{1,2}){1,2}$/.test(s.trim())) return 0;
  return s
    .trim()
    .split(":")
    .reduce((a, p) => a * 60 + Number(p), 0);
}

function parseViews(s: string): number | undefined {
  const m = /([\d.,]+)\s*([KMB])?\s*views?/i.exec(s);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/,/g, ""));
  const mul = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase() as "K"] ?? 1;
  return Math.round(n * mul);
}

function tileLines(tile: Obj): string[][] {
  const md = isObj(tile.metadata) ? (tile.metadata.tileMetadataRenderer as Obj | undefined) : undefined;
  const lines = Array.isArray(md?.lines) ? (md!.lines as Obj[]) : [];
  return lines.map((l) =>
    findAll(l, "lineItemRenderer")
      .map((i) => text(i.text))
      .filter((x) => x && x.trim() !== "•"),
  );
}

function tileTitle(tile: Obj): string {
  const md = isObj(tile.metadata) ? (tile.metadata.tileMetadataRenderer as Obj | undefined) : undefined;
  return text(md?.title);
}

function videosFrom(root: unknown): VideoItem[] {
  const out: VideoItem[] = [];
  const seen = new Set<string>();
  for (const t of findAll(root, "tileRenderer")) {
    const cmd = t.onSelectCommand;
    const watch = findAll(cmd, "watchEndpoint")[0] ?? findAll(cmd, "reelWatchEndpoint")[0];
    const id = (watch && typeof watch.videoId === "string" && watch.videoId) || (t.contentType === "TILE_CONTENT_TYPE_VIDEO" && typeof t.contentId === "string" ? t.contentId : "");
    if (!id || seen.has(id)) continue;
    // a playlist tile also carries a watchEndpoint (its first video)
    if (t.contentType === "TILE_CONTENT_TYPE_PLAYLIST" || t.contentType === "TILE_CONTENT_TYPE_CHANNEL") continue;
    seen.add(id);
    const lines = tileLines(t);
    const flat = lines.flat();
    const overlay = findAll(t.header, "thumbnailOverlayTimeStatusRenderer")[0];
    const durText = overlay ? text(overlay.text) : "";
    const browse = findAll(t, "browseEndpoint").find((b) => typeof b.browseId === "string" && (b.browseId as string).startsWith("UC"));
    out.push({
      id,
      title: tileTitle(t) || "Video",
      author: lines[0]?.[0] || "",
      authorId: browse ? (browse.browseId as string) : undefined,
      duration: parseDuration(durText),
      live: /live/i.test(durText) || undefined,
      views: parseViews(flat.join(" ")),
      publishedText: flat.find((x) => /ago|streamed|premiere/i.test(x)),
      thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    });
  }
  // Older/other list renderers, just in case.
  for (const key of ["playlistVideoRenderer", "videoRenderer", "gridVideoRenderer"]) {
    for (const v of findAll(root, key)) {
      const id = typeof v.videoId === "string" ? v.videoId : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        title: text(v.title) || "Video",
        author: text(v.shortBylineText) || text(v.ownerText) || "",
        duration: parseDuration(text(v.lengthText)),
        thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      });
    }
  }
  return out;
}

function channelsFrom(root: unknown): YtChannel[] {
  const out = new Map<string, YtChannel>();
  for (const tab of findAll(root, "tabRenderer")) {
    const b = findAll(tab.endpoint, "browseEndpoint")[0];
    const id = b && typeof b.browseId === "string" ? b.browseId : "";
    if (!id.startsWith("UC") || out.has(id)) continue;
    out.set(id, { id, name: text(tab.title) || "Channel", avatar: bestThumb(tab.thumbnail) });
  }
  for (const t of findAll(root, "tileRenderer")) {
    if (t.contentType !== "TILE_CONTENT_TYPE_CHANNEL") continue;
    const b = findAll(t.onSelectCommand, "browseEndpoint")[0];
    const id = b && typeof b.browseId === "string" ? b.browseId : typeof t.contentId === "string" ? t.contentId : "";
    if (!id.startsWith("UC") || out.has(id)) continue;
    out.set(id, { id, name: tileTitle(t) || "Channel", avatar: bestThumb(isObj(t.header) ? (t.header.tileHeaderRenderer as Obj)?.thumbnail : undefined) });
  }
  return [...out.values()];
}

function playlistsFrom(root: unknown): YtPlaylist[] {
  const out = new Map<string, YtPlaylist>();
  for (const t of findAll(root, "tileRenderer")) {
    const b = findAll(t.onSelectCommand, "browseEndpoint")[0];
    const browseId = b && typeof b.browseId === "string" ? b.browseId : "";
    const isPl = t.contentType === "TILE_CONTENT_TYPE_PLAYLIST" || browseId.startsWith("VL");
    if (!isPl) continue;
    const id = browseId.startsWith("VL") ? browseId.slice(2) : typeof t.contentId === "string" ? t.contentId : "";
    if (!id || out.has(id) || id === "LL" || id === "WL") continue;
    const header = isObj(t.header) ? (t.header.tileHeaderRenderer as Obj | undefined) : undefined;
    const countOverlay = findAll(header, "thumbnailOverlayTimeStatusRenderer")[0];
    out.set(id, {
      id,
      title: tileTitle(t) || "Playlist",
      thumbnail: bestThumb(header?.thumbnail),
      countText: (countOverlay && text(countOverlay.text)) || tileLines(t).flat().find((x) => /video/i.test(x)),
    });
  }
  return [...out.values()];
}

function profileFrom(root: unknown): YtProfile | undefined {
  const acc = findAll(root, "accountItem")[0] ?? findAll(root, "accountItemRenderer")[0];
  const name = acc ? text(acc.accountName) : "";
  if (!name) return undefined;
  return { name, handle: text(acc!.channelHandle) || undefined, photo: bestThumb(acc!.accountPhoto) };
}

/** Continuation tokens anywhere in an answer. */
function continuations(root: unknown): string[] {
  const out: string[] = [];
  for (const k of ["nextContinuationData", "reloadContinuationData"]) {
    for (const c of findAll(root, k)) if (typeof c.continuation === "string") out.push(c.continuation);
  }
  for (const c of findAll(root, "continuationCommand")) if (typeof c.token === "string") out.push(c.token);
  return [...new Set(out)];
}

/** Browse + follow continuations while they keep adding items. */
async function browseAll<T>(browse: Record<string, unknown>, pick: (r: unknown) => T[], key: (x: T) => string, maxPages = 6): Promise<T[]> {
  const first = await tv("browse", browse);
  const items = new Map<string, T>();
  for (const x of pick(first)) items.set(key(x), x);
  let tokensLeft = continuations(first);
  const used = new Set<string>();
  for (let page = 0; page < maxPages && tokensLeft.length; page++) {
    const tok = tokensLeft.find((t) => !used.has(t));
    if (!tok) break;
    used.add(tok);
    let r: unknown;
    try {
      r = await tv("browse", { continuation: tok });
    } catch {
      break;
    }
    const before = items.size;
    for (const x of pick(r)) items.set(key(x), x);
    tokensLeft = continuations(r);
    if (items.size === before && page > 0) break;
  }
  return [...items.values()];
}

/* ---------------------------------- sync --------------------------------- */

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 90);

async function fetchSubs(): Promise<{ subs: YtChannel[]; feed: VideoItem[] }> {
  const root = await tv("browse", { browseId: "FEsubscriptions" });
  const subs = channelsFrom(root);
  let feed = videosFrom(root);
  if (!feed.length) {
    // The "All" tab is loaded separately on TVs.
    const tab = findAll(root, "tabRenderer").find((t) => {
      const b = findAll(t.endpoint, "browseEndpoint")[0];
      return b && typeof b.browseId === "string" && !(b.browseId as string).startsWith("UC");
    });
    const b = tab ? findAll(tab.endpoint, "browseEndpoint")[0] : undefined;
    if (b) feed = await browseAll({ browseId: b.browseId, ...(b.params ? { params: b.params } : {}) }, videosFrom, (v) => v.id, 2);
  }
  if (!feed.length && continuations(root).length) {
    feed = await browseAll({ browseId: "FEsubscriptions" }, videosFrom, (v) => v.id, 2);
  }
  return { subs, feed };
}

let syncing: Promise<void> | null = null;
/** Fetch profile, subscriptions, liked videos and playlists. */
export function syncAccount(): Promise<void> {
  if (!tokens) return Promise.resolve();
  if (syncing) return syncing;
  set({ syncing: true });
  syncing = (async () => {
    const errors: string[] = [];
    const [profile, subs, liked, playlists] = await Promise.allSettled([
      tv("account/accounts_list", {}).then(profileFrom),
      fetchSubs(),
      browseAll({ browseId: "VLLL" }, videosFrom, (v) => v.id),
      browseAll({ browseId: "FEplaylist_aggregation" }, playlistsFrom, (p) => p.id).then(async (list) =>
        list.length ? list : playlistsFrom(await tv("browse", { browseId: "FElibrary" })),
      ),
    ]);
    if (!tokens) return; // signed out meanwhile
    const next: Partial<AccountState> = {};
    if (profile.status === "fulfilled") next.profile = profile.value ?? state.profile;
    else errors.push(`profile: ${msg(profile.reason)}`);
    if (subs.status === "fulfilled") {
      next.subs = subs.value.subs;
      next.subsFeed = subs.value.feed;
    } else errors.push(`subscriptions: ${msg(subs.reason)}`);
    if (liked.status === "fulfilled") next.liked = liked.value;
    else errors.push(`liked: ${msg(liked.reason)}`);
    if (playlists.status === "fulfilled") next.playlists = playlists.value;
    else errors.push(`playlists: ${msg(playlists.reason)}`);
    set({ ...next, errors, syncedAt: Date.now() });
  })().finally(() => {
    syncing = null;
    set({ syncing: false });
  });
  return syncing;
}

/** Videos of one of your playlists. */
export async function playlistVideos(id: string): Promise<VideoItem[]> {
  return browseAll({ browseId: `VL${id}` }, videosFrom, (v) => v.id, 8);
}

/** Refresh on start when the last sync is old. */
export function autoSync() {
  if (tokens && (!state.syncedAt || Date.now() - state.syncedAt > 30 * 60 * 1000)) void syncAccount();
}
