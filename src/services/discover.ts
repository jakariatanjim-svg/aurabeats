/**
 * Discover feed — a YouTube-style home recommendation engine.
 *
 * YouTube builds its home feed in three steps, and so does this:
 *
 *  1. Candidate generation from the user's signals.
 *     YouTube: subscriptions + watch history + "related videos".
 *     Here:    FAVOURITES play the role of subscriptions (strongest signal),
 *              recently played is the watch history. Candidates come from
 *                • YouTube's own related videos of each favourite (the same
 *                  graph that powers "Up next"),
 *                • more songs from each favourited artist / channel
 *                  ("new from your subscriptions"),
 *                • a slice of popular / trending music for exploration, so the
 *                  feed never becomes an echo chamber.
 *  2. Ranking: favourites weigh more than history, recent signals more than
 *     old ones, and popular uploads get a small boost.
 *  3. Diversity: no artist twice in a row (YouTube does the same), songs
 *     already favourited or already shown are filtered out.
 *
 * The feed is paged: every page runs the next few candidate jobs, so the list
 * keeps growing as the user scrolls.
 */
import * as youtube from "@/services/youtube";
import { searchYTMusic } from "@/services/catalog";
import type { Track } from "@/types";

export interface FeedJob {
  key: string;
  /** relative priority used when ranking the items this job produced */
  weight: number;
  run: () => Promise<Track[]>;
}


const NOT_MUSIC = /\b(podcast|interview|reaction|trailer|teaser|episode|vlog|full movie|news|gameplay|unboxing|review|tutorial|lesson|shorts?)\b/i;

function videoIdOf(t: Track): string | null {
  if (t.source !== "youtube") return null;
  if (t.id.startsWith("yt:")) return t.id.slice(3);
  if (t.streamUrl.startsWith("yt-resolve:")) return t.streamUrl.slice("yt-resolve:".length);
  return null;
}

function norm(v: string) {
  return v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function trackKey(t: Track) {
  return `${norm(t.title)}|${norm(t.artist)}`;
}

/** Plausibly a song (not a podcast, a 1-hour mix or a 20-second clip). */
export function looksLikeMusic(t: Track) {
  if (t.isLive) return false;
  if (t.duration && (t.duration < 60 || t.duration > 15 * 60)) return false;
  return !NOT_MUSIC.test(t.title);
}

/**
 * Builds the ordered list of candidate jobs — from HEARTED songs only.
 * Listening history and generic "explore" queries are deliberately not used:
 * the feed should be exactly "more like what I liked". Favourites are
 * newest-first, so a fresh heart shapes the top of the feed.
 */
export function buildFeedJobs(favorites: Track[], _history: Track[] = []): FeedJob[] {
  // --- artists you hearted, like channel subscriptions ---
  const artistScore = new Map<string, { name: string; score: number }>();
  favorites.forEach((t, i) => {
    const key = norm(t.artist);
    if (!key || key === "unknown artist") return;
    const cur = artistScore.get(key);
    artistScore.set(key, { name: cur?.name ?? t.artist, score: (cur?.score ?? 0) + 3 * Math.pow(0.93, i) });
  });
  const artists = [...artistScore.values()].sort((a, b) => b.score - a.score).slice(0, 12);

  // --- YouTube's related-songs graph of each hearted song ---
  const seen = new Set<string>();
  const related: FeedJob[] = [];
  favorites.forEach((t, i) => {
    const id = videoIdOf(t);
    if (id && !seen.has(id) && related.length < 20) {
      seen.add(id);
      related.push({ key: `rel:${id}`, weight: 2 + 3 * Math.pow(0.93, i), run: () => youtube.fetchRelated(id, 20, t.title, t.artist) });
    } else if (!id && related.length < 20) {
      // Hearted from another source: songs like it, found on YouTube Music.
      const q = `${t.title} ${t.artist}`.trim();
      if (q && !seen.has(q)) {
        seen.add(q);
        related.push({ key: `like:${norm(q)}`, weight: 2 + 3 * Math.pow(0.93, i), run: () => searchYTMusic(q, 20) });
      }
    }
  });
  const channel: FeedJob[] = artists.map((a) => ({
    key: `artist:${norm(a.name)}`,
    weight: 2 + a.score,
    run: () => searchYTMusic(a.name, 20),
  }));

  const jobs: FeedJob[] = [];
  for (let i = 0; i < Math.max(related.length, channel.length); i++) {
    if (related[i]) jobs.push(related[i]);
    if (channel[i]) jobs.push(channel[i]);
  }
  return jobs;
}

/**
 * Ranks one page of candidates and spreads artists out so the same one never
 * appears twice in a row (and rarely within a few cards).
 */
export function rankPage(groups: { weight: number; tracks: Track[] }[], recentArtists: string[]): Track[] {
  const scored: { t: Track; s: number }[] = [];
  for (const g of groups) {
    g.tracks.forEach((t, i) => {
      const pop = t.playCount ? Math.log10(t.playCount + 10) / 10 : 0; // 0 … ~1
      const position = 1 - Math.min(i, 20) / 25; // earlier = more relevant
      scored.push({ t, s: g.weight * position + pop });
    });
  }
  scored.sort((a, b) => b.s - a.s);

  const out: Track[] = [];
  const recent = recentArtists.slice(-3).map(norm);
  const pool = [...scored];
  while (pool.length) {
    let pick = pool.findIndex((c) => !recent.includes(norm(c.t.artist)));
    if (pick === -1) pick = 0;
    const [{ t }] = pool.splice(pick, 1);
    out.push(t);
    recent.push(norm(t.artist));
    if (recent.length > 3) recent.shift();
  }
  return out;
}
