/**
 * The signed-in account's YouTube library and actions (WEB InnerTube):
 * recommendations, liked videos, playlists, Watch later, history,
 * subscriptions; like, save to playlists, subscribe, watch history.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { VideoItem } from "@/services/video/types";
import { findAll, readPage, text, type YtChannel, type YtPage, type YtPlaylist } from "./parse";
import { call, ping, ytPrefs, ytSession } from "./session";
import { WEB_CLIENT } from "./transport";

export type { YtChannel, YtPage, YtPlaylist };
export type YtVideo = YtPage["videos"][number];

/* ---------------------------------- lists --------------------------------- */

async function browse(browseId: string, cursor?: string): Promise<YtPage> {
  const r = await call("browse", cursor ? { continuation: cursor } : { browseId });
  return readPage(r);
}

export const ytHome = (cursor?: string) => browse("FEwhat_to_watch", cursor);
export const ytSubsFeed = (cursor?: string) => browse("FEsubscriptions", cursor);
export const ytHistory = (cursor?: string) => browse("FEhistory", cursor);
export const ytLiked = (cursor?: string) => browse("VLLL", cursor);
export const ytWatchLater = (cursor?: string) => browse("VLWL", cursor);
export const ytPlaylistVideos = (id: string, cursor?: string) => browse(id.startsWith("VL") ? id : `VL${id}`, cursor);

/** All your playlists (without Liked / Watch later, which have their own tabs). */
export async function ytPlaylists(): Promise<YtPlaylist[]> {
  let page = await browse("FEplaylist_aggregation");
  const all = [...page.playlists];
  for (let i = 0; page.next && i < 10; i++) {
    page = await browse("", page.next);
    all.push(...page.playlists);
  }
  if (!all.length) all.push(...(await browse("FElibrary")).playlists);
  const seen = new Set<string>();
  return all.filter((p) => !["LL", "WL", "VLLL", "VLWL"].includes(p.id) && !seen.has(p.id) && seen.add(p.id));
}

/* ------------------------------ subscriptions ----------------------------- */

interface SubsState {
  key: string | null;
  list: YtChannel[] | null;
  loading: boolean;
  error: string | null;
}
let subs: SubsState = { key: null, list: null, loading: false, error: null };
const subsL = new Set<() => void>();
const setSubs = (p: Partial<SubsState>) => {
  subs = { ...subs, ...p };
  subsL.forEach((f) => f());
};

export async function loadSubscriptions(force = false): Promise<void> {
  const s = ytSession();
  if (!s) return;
  if (!force && subs.key === s.key && (subs.list || subs.loading)) return;
  setSubs({ key: s.key, loading: true, error: null, ...(subs.key === s.key ? {} : { list: null }) });
  try {
    let page = await browse("FEchannels");
    const all = [...page.channels];
    for (let i = 0; page.next && i < 30; i++) {
      page = await browse("", page.next);
      all.push(...page.channels);
    }
    if (ytSession()?.key === s.key) setSubs({ list: all, loading: false });
  } catch (e) {
    if (ytSession()?.key === s.key) setSubs({ loading: false, error: (e as Error)?.message || "Couldn't load" });
  }
}

/** Your subscriptions (loads once per session). */
export function useYtSubscriptions(enabled = true): SubsState {
  const st = useSyncExternalStore(
    (f) => {
      subsL.add(f);
      return () => subsL.delete(f);
    },
    () => subs,
    () => subs,
  );
  const key = ytSession()?.key ?? null;
  useEffect(() => {
    if (enabled && key) void loadSubscriptions();
  }, [enabled, key]);
  return st.key === key ? st : { key, list: null, loading: !!key, error: null };
}

export function isSubscribed(channelId?: string): boolean {
  return !!channelId && subs.key === ytSession()?.key && !!subs.list?.some((c) => c.id === channelId);
}

/* --------------------------------- actions -------------------------------- */

const SUBSCRIBE_PARAMS = "EgIIAhgA";
const UNSUBSCRIBE_PARAMS = "CgIIAhgA";

export async function setSubscribed(ch: YtChannel, on: boolean): Promise<void> {
  await call(on ? "subscription/subscribe" : "subscription/unsubscribe", {
    channelIds: [ch.id],
    params: on ? SUBSCRIBE_PARAMS : UNSUBSCRIBE_PARAMS,
  });
  const key = ytSession()?.key ?? null;
  if (subs.key === key && subs.list) {
    const rest = subs.list.filter((c) => c.id !== ch.id);
    setSubs({ list: on ? [ch, ...rest] : rest });
  }
}

/** What the account thinks of a video: liked? (cached per session) */
const likeCache = new Map<string, boolean>();
const likeL = new Set<() => void>();
const likeKey = (id: string) => `${ytSession()?.key}|${id}`;

export async function loadLike(id: string): Promise<boolean> {
  const k = likeKey(id);
  if (likeCache.has(k)) return likeCache.get(k)!;
  const r = await call("next", { videoId: id });
  const ent = findAll(r, "likeStatusEntity")[0] ?? findAll(r, "likeButtonRenderer")[0];
  const liked = ent?.likeStatus === "LIKE";
  likeCache.set(k, liked);
  likeL.forEach((f) => f());
  return liked;
}

export function likedNow(id: string): boolean | undefined {
  return likeCache.get(likeKey(id));
}

export function subscribeLikes(f: () => void) {
  likeL.add(f);
  return () => {
    likeL.delete(f);
  };
}

export async function setLiked(id: string, on: boolean): Promise<void> {
  const k = likeKey(id);
  const before = likeCache.get(k);
  likeCache.set(k, on);
  likeL.forEach((f) => f());
  try {
    await call(on ? "like/like" : "like/removelike", { target: { videoId: id } });
  } catch (e) {
    if (before === undefined) likeCache.delete(k);
    else likeCache.set(k, before);
    likeL.forEach((f) => f());
    throw e;
  }
}

export interface SaveTarget {
  id: string;
  title: string;
  saved: boolean;
  private?: boolean;
}

/** Watch later + your playlists, with whether the video is already in each. */
export async function saveTargets(videoId: string): Promise<SaveTarget[]> {
  const r = await call("playlist/get_add_to_playlist", { videoIds: [videoId], excludeWatchLater: false });
  const out = findAll(r, "playlistAddToOptionRenderer").map((o) => ({
    id: String(o.playlistId ?? ""),
    title: text(o.title),
    saved: o.containsSelectedVideos === "ALL",
    private: o.privacy === "PRIVATE",
  }));
  return out.filter((t) => t.id);
}

export async function setInPlaylist(playlistId: string, videoId: string, on: boolean): Promise<void> {
  const r = await call<{ status?: string }>("browse/edit_playlist", {
    playlistId,
    actions: [on ? { action: "ACTION_ADD_VIDEO", addedVideoId: videoId } : { action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: videoId }],
  });
  if (r?.status && r.status !== "STATUS_SUCCEEDED") throw new Error("YouTube didn't save that");
}

export async function createPlaylist(title: string, videoIds: string[] = [], privacyStatus: "PRIVATE" | "UNLISTED" | "PUBLIC" = "PRIVATE"): Promise<string> {
  const r = await call<{ playlistId?: string }>("playlist/create", { title, privacyStatus, videoIds });
  if (!r?.playlistId) throw new Error("YouTube didn't create the playlist");
  return r.playlistId;
}

/* ------------------------------ watch history ----------------------------- */

const recorded = new Map<string, number>();
const CPN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Adds a video to the account's YouTube history (once per 30 min per video). */
export async function recordPlay(v: Pick<VideoItem, "id">): Promise<void> {
  const s = ytSession();
  if (!s || !ytPrefs.get().recordHistory) return;
  const k = `${s.key}|${v.id}`;
  if (Date.now() - (recorded.get(k) ?? 0) < 30 * 60 * 1000) return;
  recorded.set(k, Date.now());
  try {
    const r = await call<{ playbackTracking?: { videostatsPlaybackUrl?: { baseUrl?: string } } }>("player", { videoId: v.id, racyCheckOk: true, contentCheckOk: true });
    const base = r?.playbackTracking?.videostatsPlaybackUrl?.baseUrl;
    if (!base) return;
    const url = new URL(base.replace("https://s.youtube.com", "https://www.youtube.com"));
    const cpn = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CPN_CHARS[b & 63]).join("");
    const q = { ver: "2", c: WEB_CLIENT.clientName, cver: WEB_CLIENT.clientVersion, cbrver: WEB_CLIENT.clientVersion, cpn, fmt: "251", rtn: "0", rt: "0" };
    for (const [key, val] of Object.entries(q)) url.searchParams.set(key, val);
    await ping(url.toString());
  } catch {
    recorded.delete(k); // try again next time
  }
}
