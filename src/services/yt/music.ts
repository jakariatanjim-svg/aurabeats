/**
 * YouTube Music for a signed-in account (music.youtube.com, WEB_REMIX):
 * liked songs, your playlists with their songs, and Like / remove like.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { Track } from "@/types";
import { bestImage, findAll, isObj, parseDuration, text, type Obj } from "./parse";
import { storage } from "@/utils/storage";
import { musicCall, ytSession } from "./session";

export interface YtmPlaylist {
  id: string;
  title: string;
  thumbnail?: string;
  subtitle?: string;
}

export interface YtmPage<T> {
  items: T[];
  next?: string;
}

/* --------------------------------- reading -------------------------------- */

function songFrom(r: Obj): Track | null {
  const play = findAll(r.overlay, "watchEndpoint")[0];
  const data = isObj(r.playlistItemData) ? r.playlistItemData : {};
  const videoId = String(data.videoId ?? play?.videoId ?? "");
  if (!videoId) return null;
  const cols = findAll(r.flexColumns, "musicResponsiveListItemFlexColumnRenderer");
  const title = text(cols[0]?.text);
  const runsOf = (c?: Obj) => (isObj(c?.text) && Array.isArray(c.text.runs) ? c.text.runs : []) as Obj[];
  const runs = [...runsOf(cols[1])];
  // playlists put the album in a third column
  for (const run of runsOf(cols[2])) {
    const id = findAll(run, "browseEndpoint")[0]?.browseId;
    if (typeof id === "string" && id.startsWith("MPRE")) runs.push(run);
  }
  const artists: string[] = [];
  let album: string | undefined;
  let artistId: string | undefined;
  for (const run of runs) {
    const id = findAll(run, "browseEndpoint")[0]?.browseId;
    const s = text(run.text ?? run);
    if (typeof id === "string" && id.startsWith("MPRE")) album = s;
    else if (typeof id === "string" && id.startsWith("UC")) {
      artists.push(s);
      artistId ??= id;
    }
  }
  if (!artists.length && runs.length) artists.push(text(runs[0].text ?? runs[0]));
  const fixed = findAll(r.fixedColumns, "musicResponsiveListItemFixedColumnRenderer")[0];
  const art = bestImage(findAll(r.thumbnail, "musicThumbnailRenderer")[0]);
  return {
    id: `yt:${videoId}`,
    title: title.trim(),
    artist: artists.join(", ").replace(/ - Topic$/i, "").trim(),
    artistHandle: artistId,
    album,
    artwork: art ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    artworkLarge: art ? art.replace(/=w\d+-h\d+/, "=w544-h544") : `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    artworkFallback: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: parseDuration(text(fixed?.text)),
    source: "youtube",
    streamUrl: `yt-resolve:${videoId}`,
    fallbackUrls: [],
    homepage: `https://music.youtube.com/watch?v=${videoId}`,
    isLive: false,
  };
}

function playlistFrom(r: Obj): YtmPlaylist | null {
  const b = findAll(r.navigationEndpoint ?? r, "browseEndpoint")[0];
  const id = typeof b?.browseId === "string" ? b.browseId.replace(/^VL/, "") : "";
  if (!id || id.startsWith("UC") || id.startsWith("MPRE") || id === "LM" || id === "SE") return null;
  return { id, title: text(r.title), thumbnail: bestImage(findAll(r.thumbnailRenderer ?? r.thumbnail, "musicThumbnailRenderer")[0]), subtitle: text(r.subtitle) || undefined };
}

/** Next-page token; "q:" = old URL-style, "b:" = body-style. */
function nextOf(r: unknown): string | undefined {
  const items = findAll(r, "continuationItemRenderer");
  const tok = items.length ? findAll(items[items.length - 1], "continuationCommand")[0]?.token : undefined;
  if (typeof tok === "string") return `b:${tok}`;
  const old = findAll(r, "nextContinuationData")[0]?.continuation;
  return typeof old === "string" ? `q:${old}` : undefined;
}

async function browse(browseId: string, cursor?: string): Promise<unknown> {
  if (!cursor) return musicCall("browse", { browseId });
  const tok = cursor.slice(2);
  if (cursor.startsWith("b:")) return musicCall("browse", { continuation: tok });
  const q = encodeURIComponent(tok);
  return musicCall("browse", {}, `&ctoken=${q}&continuation=${q}&type=next`);
}

export async function ytmPlaylistSongs(id: string, cursor?: string): Promise<YtmPage<Track>> {
  const r = await browse(id.startsWith("VL") ? id : `VL${id}`, cursor);
  const seen = new Set<string>();
  const items = findAll(r, "musicResponsiveListItemRenderer")
    .map(songFrom)
    .filter((t): t is Track => !!t && !!t.title && !seen.has(t.id) && !!seen.add(t.id));
  return { items, next: items.length ? nextOf(r) : undefined };
}

/** Your YouTube Music playlists (Liked music has its own place: Saved). */
export async function ytmPlaylists(): Promise<YtmPlaylist[]> {
  const out: YtmPlaylist[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const r = await browse("FEmusic_liked_playlists", cursor);
    for (const k of ["musicTwoRowItemRenderer", "musicResponsiveListItemRenderer"]) {
      for (const it of findAll(r, k)) {
        const p = playlistFrom(it);
        if (p && !out.some((x) => x.id === p.id)) out.push(p);
      }
    }
    cursor = nextOf(r);
    if (!cursor) break;
  }
  return out;
}

/* ------------------------------- liked songs ------------------------------ */

interface LikedState {
  key: string | null;
  list: Track[] | null;
  /** liked / unliked here before the list arrived (or beyond it) */
  over: Map<string, boolean>;
  loading: boolean;
  error: string | null;
}
let liked: LikedState = { key: null, list: null, over: new Map(), loading: false, error: null };
const likedL = new Set<() => void>();
const setLikedState = (p: Partial<LikedState>) => {
  liked = { ...liked, ...p };
  likedL.forEach((f) => f());
};
const subscribeLiked = (f: () => void) => {
  likedL.add(f);
  return () => {
    likedL.delete(f);
  };
};

export async function loadLikedSongs(force = false): Promise<void> {
  const s = ytSession();
  if (!s) return;
  if (!force && liked.key === s.key && (liked.list || liked.loading)) return;
  setLikedState({ key: s.key, loading: true, error: null, ...(liked.key === s.key ? {} : { list: null, over: new Map() }) });
  try {
    const all: Track[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 40; i++) {
      const page = await ytmPlaylistSongs("LM", cursor);
      all.push(...page.items.filter((t) => !all.some((x) => x.id === t.id)));
      cursor = page.next;
      if (!cursor) break;
    }
    if (ytSession()?.key === s.key) setLikedState({ list: all, over: new Map(), loading: false });
  } catch (e) {
    if (ytSession()?.key === s.key) setLikedState({ loading: false, error: (e as Error)?.message || "Couldn't reach YouTube Music" });
  }
}

/** Liked songs of the signed-in account (loads once per session). */
export function useLikedSongs(enabled = true): LikedState {
  const st = useSyncExternalStore(subscribeLiked, () => liked, () => liked);
  const key = ytSession()?.key ?? null;
  useEffect(() => {
    if (enabled && key) void loadLikedSongs();
  }, [enabled, key]);
  return st;
}

export function isSongLiked(trackId: string): boolean {
  if (liked.key !== ytSession()?.key) return false;
  const o = liked.over.get(trackId);
  if (o !== undefined) return o;
  return !!liked.list?.some((t) => t.id === trackId);
}

/** The liked-songs list as shown (changes made here included). */
export function likedSongsNow(): Track[] {
  if (liked.key !== ytSession()?.key || !liked.list) return [];
  return [...liked.list.filter((t) => liked.over.get(t.id) !== false)];
}

/** A YouTube song in signed-in mode gets Like instead of the local heart. */
export function likeApplies(track: Pick<Track, "id" | "source">): boolean {
  return !!ytSession() && track.source === "youtube" && track.id.startsWith("yt:");
}

export async function setSongLiked(track: Track, on: boolean): Promise<void> {
  const s = ytSession();
  if (!s) throw new Error("Not signed in");
  const videoId = track.id.slice(3);
  const prev = liked.over.get(track.id);
  const over = new Map(liked.over).set(track.id, on);
  // newly liked songs go to the top of the list
  const list = on && liked.list && !liked.list.some((t) => t.id === track.id) ? [{ ...track, addedAt: Date.now() }, ...liked.list] : liked.list;
  setLikedState({ over, list });
  try {
    await musicCall(on ? "like/like" : "like/removelike", { target: { videoId } });
  } catch (e) {
    const back = new Map(liked.over);
    if (prev === undefined) back.delete(track.id);
    else back.set(track.id, prev);
    setLikedState({ over: back });
    throw e;
  }
}

export { subscribeLiked };

/* -------------------- hearted songs → YouTube Music likes ------------------- */

const syncedKey = (sessionKey: string) => `ytacct:heartsLiked:${sessionKey}`;
let syncing = false;

/**
 * Songs hearted on this device (guest) are liked on the signed-in account,
 * once each (a later unlike on YouTube is respected). Already-liked songs are
 * just marked done. Returns how many were newly liked.
 */
export async function likeHeartedSongs(hearted: Track[]): Promise<number> {
  const s = ytSession();
  if (!s || syncing || liked.key !== s.key || !liked.list) return 0;
  const done = new Set(storage.get<string[]>(syncedKey(s.key), []));
  // oldest first, so the newest heart ends up on top of Liked songs
  const todo = hearted.filter((t) => t.source === "youtube" && t.id.startsWith("yt:") && !done.has(t.id)).reverse();
  if (!todo.length) return 0;
  syncing = true;
  let n = 0;
  try {
    for (const t of todo) {
      if (ytSession()?.key !== s.key) break;
      if (!isSongLiked(t.id)) {
        try {
          await setSongLiked(t, true);
          n++;
          await new Promise((r) => setTimeout(r, 350));
        } catch {
          continue; // not marked: tried again next time
        }
      }
      done.add(t.id);
      storage.set(syncedKey(s.key), [...done]);
    }
  } finally {
    syncing = false;
  }
  return n;
}
