/**
 * YouTube Music search via Invidious public API.
 * Search works. Playback falls back to JioSaavn cross-match.
 */
import type { Track } from "@/types";

const INVIDIOUS_HOSTS = [
  "https://invidious.f5.si",
  "https://inv.nadeko.net",
  "https://invidious.tiekoetter.com",
];

const CORS = [
  (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

async function fetchJSON<T>(url: string, timeout = 8000): Promise<T> {
  // Try direct first
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(timeout, 3500));
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    if (res.ok) return res.json() as Promise<T>;
  } catch { /* try proxy */ }

  // Race CORS proxies
  const controllers = CORS.map(() => new AbortController());
  const masterTimer = setTimeout(() => controllers.forEach((c) => c.abort()), timeout);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let fails = 0;
    CORS.forEach((proxy, i) => {
      fetch(proxy(url), { signal: controllers[i].signal, headers: { Accept: "application/json" } })
        .then((res) => {
          if (!res.ok) throw new Error(`${res.status}`);
          return res.json() as Promise<T>;
        })
        .then((data) => {
          if (settled) return;
          settled = true;
          clearTimeout(masterTimer);
          controllers.forEach((c, j) => { if (j !== i) c.abort(); });
          resolve(data);
        })
        .catch(() => {
          fails++;
          if (fails >= CORS.length && !settled) {
            settled = true;
            clearTimeout(masterTimer);
            reject(new Error("All proxies failed"));
          }
        });
    });
  });
}

function thumb(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

interface InvItem {
  type: string;
  videoId: string;
  title: string;
  author: string;
  lengthSeconds: number;
  viewCount: number;
  liveNow?: boolean;
  isUpcoming?: boolean;
}

function toTrack(item: InvItem): Track | null {
  if (item.type !== "video") return null;
  if (!item.videoId || !item.title) return null;
  if (item.liveNow || item.isUpcoming) return null;
  const dur = item.lengthSeconds ?? 0;
  if (dur < 20 || dur > 45 * 60) return null;

  return {
    id: `yt:${item.videoId}`,
    title: item.title.trim(),
    artist: item.author.replace(/ - Topic$/i, "").replace(/ VEVO$/i, "").trim(),
    artwork: thumb(item.videoId),
    artworkLarge: `https://i.ytimg.com/vi/${item.videoId}/maxresdefault.jpg`,
    duration: dur,
    source: "youtube",
    streamUrl: `yt-resolve:${item.videoId}`,
    fallbackUrls: [],
    homepage: `https://music.youtube.com/watch?v=${item.videoId}`,
    isLive: false,
    playCount: item.viewCount,
  };
}

async function searchHost(host: string, query: string): Promise<Track[]> {
  // Fetch page 1 first — fast and reliable
  const url = `${host}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&page=1`;
  const data = await fetchJSON<InvItem[]>(url, 9000);
  const page1 = (Array.isArray(data) ? data : [])
    .map(toTrack)
    .filter((t): t is Track => t !== null);

  // Then fetch pages 2 and 3 in parallel (best-effort, won't block page 1)
  const extraPages = await Promise.allSettled([
    fetchJSON<InvItem[]>(`${host}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&page=2`, 9000),
    fetchJSON<InvItem[]>(`${host}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&page=3`, 9000),
  ]);

  const seen = new Set(page1.map((t) => t.id));
  const extra: Track[] = [];

  for (const result of extraPages) {
    if (result.status === "fulfilled") {
      const items = (Array.isArray(result.value) ? result.value : [])
        .map(toTrack)
        .filter((t): t is Track => t !== null && !seen.has(t.id));
      for (const t of items) {
        seen.add(t.id);
        extra.push(t);
      }
    }
  }

  return [...page1, ...extra];
}

export async function searchTracks(query: string, limit = 60): Promise<Track[]> {
  if (!query.trim()) return [];

  // Race the first working host (staggered)
  return new Promise<Track[]>((resolve) => {
    let settled = false;
    let fails = 0;

    INVIDIOUS_HOSTS.forEach((host, i) => {
      setTimeout(() => {
        if (settled) return;
        searchHost(host, query)
          .then((tracks) => {
            if (settled || tracks.length === 0) return;
            settled = true;
            resolve(tracks.slice(0, limit));
          })
          .catch(() => {
            fails++;
            if (fails >= INVIDIOUS_HOSTS.length && !settled) {
              settled = true;
              resolve([]);
            }
          });
      }, i * 400);
    });

    // Hard timeout
    setTimeout(() => {
      if (!settled) { settled = true; resolve([]); }
    }, 12000);
  });
}

/* ----------------------- recommendations (Discover) ----------------------- */

interface InvRelated {
  videoId: string;
  title: string;
  author: string;
  lengthSeconds: number;
  viewCount?: number;
  viewCountText?: string;
}

function parseViews(text?: string): number | undefined {
  if (!text) return undefined;
  const m = text.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * mult);
}

/** First host that answers wins (same staggered race as search). */
function raceHosts<T>(path: string, parse: (data: unknown) => T[], timeout = 10000): Promise<T[]> {
  return new Promise<T[]>((resolve) => {
    let settled = false;
    let fails = 0;
    INVIDIOUS_HOSTS.forEach((host, i) => {
      setTimeout(() => {
        if (settled) return;
        fetchJSON<unknown>(`${host}${path}`, 9000)
          .then((data) => {
            const items = parse(data);
            if (settled || items.length === 0) throw new Error("empty");
            settled = true;
            resolve(items);
          })
          .catch(() => {
            fails++;
            if (fails >= INVIDIOUS_HOSTS.length && !settled) {
              settled = true;
              resolve([]);
            }
          });
      }, i * 400);
    });
    setTimeout(() => {
      if (!settled) { settled = true; resolve([]); }
    }, timeout);
  });
}

/**
 * YouTube's own "related videos" for a video — the same recommendation graph
 * YouTube uses for its Up next / home suggestions.
 */
export async function fetchRelated(videoId: string, limit = 20): Promise<Track[]> {
  if (!videoId) return [];
  const tracks = await raceHosts<Track>(
    `/api/v1/videos/${encodeURIComponent(videoId)}?fields=recommendedVideos`,
    (data) => {
      const list = (data as { recommendedVideos?: InvRelated[] })?.recommendedVideos ?? [];
      return list
        .map((v) => toTrack({
          type: "video",
          videoId: v.videoId,
          title: v.title,
          author: v.author ?? "",
          lengthSeconds: v.lengthSeconds,
          viewCount: v.viewCount ?? parseViews(v.viewCountText) ?? 0,
        }))
        .filter((t): t is Track => t !== null);
    },
  );
  return tracks.slice(0, limit);
}

/** YouTube's music trending chart. */
export async function fetchTrendingMusic(limit = 30): Promise<Track[]> {
  const tracks = await raceHosts<Track>(`/api/v1/trending?type=music`, (data) =>
    (Array.isArray(data) ? (data as InvItem[]) : [])
      .map((v) => toTrack({ ...v, type: "video" }))
      .filter((t): t is Track => t !== null),
  );
  return tracks.slice(0, limit);
}

export async function fetchTrending(): Promise<Track[]> {
  return searchTracks("top songs 2026", 20);
}

export async function fetchSuggestions(query: string): Promise<string[]> {
  try {
    const url = `${INVIDIOUS_HOSTS[0]}/api/v1/suggestions?q=${encodeURIComponent(query)}`;
    const data = await fetchJSON<{ suggestions: string[] }>(url);
    return data.suggestions?.slice(0, 8) ?? [];
  } catch {
    return [];
  }
}

// Playback is now handled natively via the hidden YouTube IFrame player 
// in the AudioEngine. We just return the yt-resolve marker.
export async function resolveYTTrack(
  videoId: string,
  _title: string,
  _artist: string,
): Promise<{ urls: string[] }> {
  return { urls: [`yt-resolve:${videoId}`] };
}

export function resetHostHealth() { /* noop */ }
