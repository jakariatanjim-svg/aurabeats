/** Real Google Search trends, not popular video titles presented as searches.
 * Public regional RSS; no API key, account or paid service. These are not
 * YouTube-specific or music-only rankings. Unavailable feeds stay hidden.
 */
import type { SearchMode } from "@/utils/searchHistory";
import { guessRegion } from "@/services/video/settings";
import { http } from "@/services/video/net";

const memo = new Map<string, { at: number; list: string[] }>();
const inflight = new Map<string, Promise<string[]>>();
const TTL = 15 * 60 * 1000;

async function build(region: string): Promise<string[]> {
  // Browser CORS fallback transports only public RSS metadata, never history.
  const xml = await http<string>(
    `https://trends.google.com/trending/rss?geo=${encodeURIComponent(region)}`,
    { timeout: 5000 }, "text", "fallback",
  );
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror") || !doc.querySelector("rss > channel")) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of Array.from(doc.querySelectorAll("channel > item"))) {
    const published = Date.parse(item.querySelector("pubDate")?.textContent || "");
    // Never recycle stale feeds or invent replacements from video titles.
    if (!Number.isFinite(published) || Date.now() - published > 48 * 60 * 60 * 1000) continue;
    const q = item.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim() || "";
    const key = q.normalize("NFKC").toLocaleLowerCase();
    if (q.length < 2 || seen.has(key)) continue;
    seen.add(key);
    list.push(q);
    if (list.length === 8) break;
  }
  return list;
}

// Both search modes share the same actual regional search trends.
export function trendingSearches(_mode: SearchMode): Promise<string[]> {
  const region = guessRegion();
  const hit = memo.get(region);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.list);
  let p = inflight.get(region);
  if (!p) {
    p = build(region)
      .then((list) => {
        memo.set(region, { at: Date.now(), list });
        return list;
      })
      .catch(() => [] as string[])
      .finally(() => inflight.delete(region));
    inflight.set(region, p);
  }
  return p;
}

export function cachedTrendingSearches(_mode: SearchMode): string[] {
  const hit = memo.get(guessRegion());
  return hit && Date.now() - hit.at < TTL ? hit.list : [];
}
