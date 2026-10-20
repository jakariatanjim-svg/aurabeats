/**
 * Unified catalogue — all sources combined.
 */
import * as archive from "@/services/archive";
import * as audius from "@/services/audius";
import * as jiosaavn from "@/services/jiosaavn";
import * as jamendo from "@/services/jamendo";
import * as youtube from "@/services/youtube";
import * as soundcloud from "@/services/soundcloud";
import { shuffleArray } from "@/utils/format";
import type { Track } from "@/types";

function normalizeText(v: string) {
  return v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    const key = `${normalizeText(t.title)}|${normalizeText(t.artist)}`;
    if (seen.has(t.id) || seen.has(key)) return false;
    seen.add(t.id); seen.add(key);
    return true;
  });
}

function scoreTrack(q: string, t: Track): number {
  const nq = normalizeText(q);
  const title = normalizeText(t.title);
  let s = 0;
  if (title === nq) s += 200;
  if (title.startsWith(nq)) s += 100;
  if (title.includes(nq)) s += 50;
  if (t.source === "youtube") s += 60;
  if (t.source === "soundcloud") s += 40;
  if (t.source === "jiosaavn") s += 35;
  if (t.source === "audius") s += 15;
  if (t.playCount && t.playCount > 1_000_000) s += 10;
  return s;
}

const TIMEOUT = 5500;
function cap<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), TIMEOUT))]);
}

export interface CatalogQuery { limit?: number; signal?: AbortSignal }

/**
 * YouTube Music is the catalogue. The other sources (JioSaavn, SoundCloud,
 * Audius, Jamendo, Internet Archive) are a separate catalogue that is only
 * ever asked from Search → "Other Sources" — never mixed into YouTube lists,
 * never as a fallback.
 */
export async function fetchPopular(opts: CatalogQuery = {}): Promise<Track[]> {
  const { limit = 40 } = opts;
  return (await youtube.searchTracks("popular music hits 2026", limit).catch(() => [] as Track[])).slice(0, limit);
}

export async function searchYTMusic(query: string, limit = 100): Promise<Track[]> {
  return youtube.searchTracks(query, limit).catch(() => []);
}

export async function searchOtherSources(query: string, limit = 60): Promise<Track[]> {
  const [sc, js, au, ja, ia] = await Promise.all([
    cap(soundcloud.searchTracks(query, 20), []),
    cap(jiosaavn.searchTracks(query, 25), []),
    cap(audius.searchTracks(query, { limit: 15 }), []),
    cap(jamendo.searchTracks(query, 12), []),
    cap(archive.searchTracks(query, { limit: 10 }), []),
  ]);
  return dedupe([...sc, ...js, ...au, ...ja, ...ia])
    .sort((a, b) => scoreTrack(query, b) - scoreTrack(query, a))
    .slice(0, limit);
}

/** YouTube Music only (kept for callers that used the old mixed search). */
export async function searchEverything(query: string, opts: CatalogQuery = {}): Promise<Track[]> {
  return searchYTMusic(query, opts.limit ?? 80);
}

export { fetchSearchSuggestions } from "./suggest";

export async function fetchForYou(favorites: Track[]): Promise<Track[]> {
  if (favorites.length === 0) return [];
  
  // Aggregate all artists to find the most common ones
  const artistCounts = new Map<string, number>();
  favorites.forEach((f) => {
    if (f.artist) {
      artistCounts.set(f.artist, (artistCounts.get(f.artist) || 0) + 1);
    }
  });
  
  // Pick the top 3 most favorited artists
  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((e) => e[0])
    .slice(0, 3);

  if (topArtists.length === 0) {
    const randomPick = favorites[Math.floor(Math.random() * favorites.length)].title;
    return searchEverything(randomPick, { limit: 16 });
  }

  // Search for the top artists and interleave the results
  const results = await Promise.all(
    topArtists.map((artist) => searchEverything(artist, { limit: 12 }))
  );
  
  // Interleave logic
  const interleaved: Track[] = [];
  const maxLen = Math.max(...results.map(r => r.length));
  for (let i = 0; i < maxLen; i++) {
    for (const list of results) {
      if (list[i]) interleaved.push(list[i]);
    }
  }

  // Exclude tracks already in favorites
  const favIds = new Set(favorites.map((f) => f.id));
  const merged = dedupe(interleaved).filter((t) => !favIds.has(t.id));
  
  return merged.slice(0, 16);
}

export async function fetchGenre(genre: string, opts: CatalogQuery = {}): Promise<Track[]> {
  return searchEverything(genre, { limit: opts.limit ?? 30 });
}

export async function fetchCollection(slug: string, opts: CatalogQuery = {}): Promise<Track[]> {
  const { limit = 30, signal } = opts;
  const albums = await cap(archive.searchAlbums({ collection: slug, rows: 26, sort: "downloads desc", signal }), []);
  return cap(archive.tracksFromAlbums(shuffleArray(albums), { perAlbum: 3, max: limit, signal }), []);
}

export { ARCHIVE_COLLECTIONS } from "@/services/archive";

export const GENRE_CHIPS = [
  { label: "Pop", value: "pop hits" },
  { label: "Hip-Hop", value: "hip hop" },
  { label: "Bollywood", value: "bollywood" },
  { label: "Remix", value: "remix" },
  { label: "Slowed", value: "slowed reverb" },
  { label: "Lo-Fi", value: "lofi" },
  { label: "Electronic", value: "electronic" },
  { label: "Rock", value: "rock" },
  { label: "Jazz", value: "jazz" },
  { label: "K-Pop", value: "kpop" },
  { label: "Funk", value: "funk" },
  { label: "Classical", value: "classical" },
];
