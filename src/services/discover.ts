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
import { fetchPopular, searchYTMusic } from "@/services/catalog";
import type { Track } from "@/types";

export interface FeedJob {
  key: string;
  /** relative priority used when ranking the items this job produced */
  weight: number;
  run: () => Promise<Track[]>;
}

const EXPLORE_QUERIES = [
  "top hits 2026",
  "new music this week",
  "viral songs 2026",
  "best hindi songs 2026",
  "bangla new song 2026",
  "chill hits",
  "party songs 2026",
  "romantic songs",
  "acoustic covers",
  "top english songs",
  "lofi songs",
  "workout music",
];

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
 * Builds the ordered list of candidate jobs from favourites + history.
 * Favourites are newest-first; history is most-recent-first.
 */
export function buildFeedJobs(favorites: Track[], history: Track[]): FeedJob[] {
  // --- interest profile: artists ("channels") weighted like subscriptions ---
  const artistScore = new Map<string, { name: string; score: number }>();
  const bump = (name: string, score: number) => {
    const key = norm(name);
    if (!key || key === "unknown artist") return;
    const cur = artistScore.get(key);
    artistScore.set(key, { name: cur?.name ?? name, score: (cur?.score ?? 0) + score });
  };
  favorites.forEach((t, i) => bump(t.artist, 3 * Math.pow(0.93, i))); // recent favourites count more
  history.slice(0, 40).forEach((t, i) => bump(t.artist, 1 * Math.pow(0.9, i)));
  const artists = [...artistScore.values()].sort((a, b) => b.score - a.score).slice(0, 10);

  // --- seeds for YouTube's related-videos graph ---
  const seen = new Set<string>();
  const relatedSeeds: { id: string; weight: number }[] = [];
  favorites.forEach((t, i) => {
    const id = videoIdOf(t);
    if (id && !seen.has(id)) { seen.add(id); relatedSeeds.push({ id, weight: 3 * Math.pow(0.93, i) }); }
  });
  history.slice(0, 15).forEach((t, i) => {
    const id = videoIdOf(t);
    if (id && !seen.has(id)) { seen.add(id); relatedSeeds.push({ id, weight: 1.2 * Math.pow(0.9, i) }); }
  });
  // keep the best 14, favourites first
  relatedSeeds.sort((a, b) => b.weight - a.weight).splice(14);

  const related: FeedJob[] = relatedSeeds.map((s) => ({
    key: `rel:${s.id}`,
    weight: 2 + s.weight,
    run: () => youtube.fetchRelated(s.id, 20),
  }));
  const channel: FeedJob[] = artists.map((a) => ({
    key: `artist:${norm(a.name)}`,
    weight: 2 + a.score,
    run: () => searchYTMusic(a.name, 20),
  }));
  const explore: FeedJob[] = [
    { key: "explore:trending", weight: 1.5, run: () => youtube.fetchTrendingMusic(30) },
    { key: "explore:popular", weight: 1.2, run: () => fetchPopular({ limit: 30 }) },
    ...EXPLORE_QUERIES.map((q) => ({ key: `explore:${q}`, weight: 1, run: () => searchYTMusic(q, 20) })),
  ];

  // Interleave like a YouTube home feed: mostly personal, regularly mixed with
  // exploration. Without any signals it is simply the explore feed.
  const personal: FeedJob[] = [];
  for (let i = 0; i < Math.max(related.length, channel.length); i++) {
    if (related[i]) personal.push(related[i]);
    if (channel[i]) personal.push(channel[i]);
  }
  if (personal.length === 0) return explore;

  const jobs: FeedJob[] = [];
  let e = 0;
  personal.forEach((job, i) => {
    jobs.push(job);
    if (i % 3 === 2 && explore[e]) jobs.push(explore[e++]); // ~1 explore job per 3 personal
  });
  while (e < explore.length) jobs.push(explore[e++]);
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
