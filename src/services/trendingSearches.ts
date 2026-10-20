/**
 * "Trending searches" for the top-bar search panel, built from what is
 * trending right now: Music = Trending in Bangladesh songs (the Home feed's
 * cache when it exists), Video = YouTube trending videos. YouTube only.
 */
import { storage } from "@/utils/storage";
import type { Track } from "@/types";
import type { SearchMode } from "@/utils/searchHistory";

const memo = new Map<SearchMode, { at: number; list: string[] }>();
const inflight = new Map<SearchMode, Promise<string[]>>();
const TTL = 30 * 60 * 1000;

/** A long upload title → a short search phrase. */
export function toQuery(title: string): string {
  let s = title
    .replace(/\s*[([{【].*?[)\]}】]\s*/g, " ")
    .split(/\s*[|•]\s*/)[0]
    .replace(/#\S+/g, " ")
    .replace(/\b(official|music|lyric(al)?|video|audio|full|song|hd|4k|mv|new)\b/gi, " ")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = s.split(" ");
  if (words.length > 6) s = words.slice(0, 6).join(" ");
  return s.replace(/[\s,:;\-–—]+$/, "");
}

function uniq(list: string[], max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const q = toQuery(raw);
    const k = q.toLowerCase();
    if (q.length < 2 || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

async function build(mode: SearchMode): Promise<string[]> {
  if (mode === "music") {
    let tracks = storage.get<{ value?: Track[] } | null>("feed:cat:trending-v3", null)?.value ?? [];
    if (!tracks.length) {
      const { fetchTrendingMusic } = await import("@/services/youtube");
      tracks = await fetchTrendingMusic(30);
    }
    return uniq(tracks.map((t) => (t.title.split(" ").length < 2 && t.artist ? `${t.title} ${t.artist}` : t.title)));
  }
  const { getTrending } = await import("@/services/video/api");
  return uniq((await getTrending()).map((v) => v.title));
}

/** Cached for 30 min; never throws (empty list = section hidden). */
export function trendingSearches(mode: SearchMode): Promise<string[]> {
  const hit = memo.get(mode);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.list);
  let p = inflight.get(mode);
  if (!p) {
    p = build(mode)
      .then((list) => {
        if (list.length) memo.set(mode, { at: Date.now(), list });
        return list;
      })
      .catch(() => [] as string[])
      .finally(() => inflight.delete(mode));
    inflight.set(mode, p);
  }
  return p;
}

export function cachedTrendingSearches(mode: SearchMode): string[] {
  return memo.get(mode)?.list ?? [];
}
