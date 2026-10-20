/**
 * YouTube / YouTube Music catalogue for the music side.
 *
 * Shares the Video mode's server pool (public Piped / Invidious front-ends
 * with CORS, ordered by what answered last). Before, this file kept its own
 * list of Invidious hosts behind public CORS proxies — by Oct 2026 every one
 * of those hosts was gone and the proxies either demanded an API key (401) or
 * hung for 12 s, so each YouTube search waited many seconds for nothing.
 *
 * Song search uses YouTube Music's "Songs" filter, so results are the same
 * tracks the YouTube Music app shows.
 */
import type { Track } from "@/types";
import { http } from "@/services/video/net";
import { getTrending, relatedFor, searchVideosOnly } from "@/services/video/api";
import { race } from "@/services/video/providers";
import type { VideoItem } from "@/services/video/types";

/** Small, fast thumbnail (320x180) for lists; the large one for the player. */
export function ytThumb(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

export function videoToTrack(v: VideoItem): Track | null {
  if (!v.id || !v.title || v.live) return null;
  const dur = v.duration ?? 0;
  if (dur && (dur < 20 || dur > 45 * 60)) return null;
  return {
    id: `yt:${v.id}`,
    title: v.title.trim(),
    artist: (v.author || "").replace(/ - Topic$/i, "").replace(/VEVO$/i, "").trim(),
    artwork: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    artworkLarge: `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`,
    duration: dur,
    source: "youtube",
    streamUrl: `yt-resolve:${v.id}`,
    fallbackUrls: [],
    homepage: `https://music.youtube.com/watch?v=${v.id}`,
    isLive: false,
    playCount: v.views,
  };
}

const toTracks = (list: VideoItem[]) => list.map(videoToTrack).filter((t): t is Track => t !== null);

function dedupe(list: Track[]) {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/** YouTube Music songs first; plain videos fill up if the songs shelf is short. */
export async function searchTracks(query: string, limit = 60): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  const songs = toTracks(await searchVideosOnly(q, "music_songs").catch(() => [] as VideoItem[]));
  if (songs.length >= Math.min(limit, 12)) return songs.slice(0, limit);
  const videos = toTracks(await searchVideosOnly(q, "videos").catch(() => [] as VideoItem[]));
  return dedupe([...songs, ...videos]).slice(0, limit);
}

/**
 * YouTube's own "related videos" for a track — the graph behind Up next.
 * Falls back to "more like this title + more from this artist" when the
 * servers can't open the video itself.
 */
export async function fetchRelated(videoId: string, limit = 20, title?: string, artist?: string): Promise<Track[]> {
  if (!videoId) return [];
  return toTracks(await relatedFor(videoId, title, artist).catch(() => [] as VideoItem[])).slice(0, limit);
}

/** What is trending on YouTube (local region), music only, then YouTube Music's popular songs. */
export async function fetchTrendingMusic(limit = 30): Promise<Track[]> {
  const [trend, songs] = await Promise.all([
    getTrending("BD").catch(() => [] as VideoItem[]),
    searchVideosOnly("trending bangla songs", "music_songs").catch(() => [] as VideoItem[]),
  ]);
  // Trending mixes in news, dramas and shows: keep song-length uploads only.
  const music = trend.filter((v) => v.duration >= 90 && v.duration <= 9 * 60);
  return dedupe([...toTracks(music), ...toTracks(songs)]).slice(0, limit);
}

export async function fetchTrending(): Promise<Track[]> {
  return searchTracks("top songs 2026", 20);
}

/** Search suggestions from the same servers (fallback when YouTube's JSONP is blocked). */
export async function fetchSuggestions(query: string): Promise<string[]> {
  const { value } = await race(
    async (p) => {
      const url = p.kind === "piped" ? `${p.base}/suggestions?query=${encodeURIComponent(query)}` : `${p.base}/api/v1/suggestions?q=${encodeURIComponent(query)}`;
      const r = await http<unknown>(url, { timeout: 4000 });
      const list = (Array.isArray(r) ? r : (r as { suggestions?: unknown[] })?.suggestions ?? []).filter((x): x is string => typeof x === "string");
      if (!list.length) throw new Error("empty");
      return list.slice(0, 10);
    },
    { stagger: 400, max: 3 },
  );
  return value;
}
