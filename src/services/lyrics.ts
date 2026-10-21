/**
 * Lyrics from LRCLIB (free, open, CORS-enabled). Several searches run at
 * once and every result is scored by title, artist and length, so the right
 * song wins instead of whatever came first. When the same song exists both
 * in its own script and in Roman letters (common for Hindi / Bangla songs),
 * both are kept: the Roman one is a real human transcription for the "Aa"
 * mode.
 */
import { needsRomanizing, nonLatinShare } from "@/utils/script";
import { storage } from "@/utils/storage";

export interface LyricLine {
  t: number; // seconds
  text: string;
}
export interface LyricsVersion {
  synced: LyricLine[] | null;
  plain: string[];
}
export interface Lyrics {
  main: LyricsVersion;
  /** same song in Roman letters, when `main` is in another script */
  latin?: LyricsVersion;
  canRomanize: boolean;
}

interface Hit {
  id: number;
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const API = "https://lrclib.net/api";
const memo = new Map<string, Lyrics | null>();
const CACHE_KEY = "lyricsCache:v2";

export function cleanTitle(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, " ")
    .replace(/\s[|•].*$/, "")
    .replace(/\b(official|music|lyrics?|lyrical|video|audio|full song|full|hd|4k|mv|visuali[sz]er)\b/gi, " ")
    .replace(/\s(ft|feat)\.?\s.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s\-–—:]+$/, "")
    .trim();
}

export function cleanArtist(raw: string): string {
  return raw
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\b(official|music)\b/gi, "")
    .split(/,|&| x | feat\.? | ft\.? /i)[0]
    .trim();
}

const norm = (s = "") =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const tokens = (s: string) => new Set(norm(s).split(" ").filter(Boolean));

function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const A = tokens(a);
  const B = tokens(b);
  let both = 0;
  A.forEach((t) => B.has(t) && both++);
  return (2 * both) / (A.size + B.size);
}

export function parseLRC(raw: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) {
      const t = parseInt(m[1]) * 60 + parseInt(m[2]) + (m[3] ? parseInt(m[3].padEnd(3, "0")) / 1000 : 0);
      out.push({ t, text });
    }
  }
  out.sort((a, b) => a.t - b.t);
  // drop empty lines at the very start / repeated blanks
  return out.filter((l, i) => l.text || (i > 0 && out[i - 1].text));
}

const version = (h: Hit): LyricsVersion => {
  const synced = h.syncedLyrics ? parseLRC(h.syncedLyrics) : null;
  const plain = (h.plainLyrics || (synced ? synced.map((l) => l.text).join("\n") : ""))
    .split(/\r?\n/)
    .map((l) => l.trim());
  // collapse runs of empty lines into one stanza break
  const tidy = plain.filter((l, i) => l || (i > 0 && plain[i - 1]));
  return { synced: synced && synced.some((l) => l.text) ? synced : null, plain: tidy };
};

const textOf = (h: Hit) => h.plainLyrics || h.syncedLyrics || "";

async function search(params: Record<string, string>, signal?: AbortSignal): Promise<Hit[] | null> {
  const qs = new URLSearchParams(params).toString();
  try {
    const r = await fetch(`${API}/search?${qs}`, { signal });
    if (!r.ok) return null;
    const j = (await r.json()) as Hit[];
    return Array.isArray(j) ? j : [];
  } catch {
    return null;
  }
}

function loadCache(): Record<string, Lyrics | null> {
  return storage.get<Record<string, Lyrics | null>>(CACHE_KEY, {});
}
function saveCache(key: string, value: Lyrics | null) {
  const all = loadCache();
  delete all[key];
  all[key] = value;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete all[k];
  storage.set(CACHE_KEY, all);
}

export async function fetchLyrics(
  t: { title: string; artist: string; duration?: number },
  signal?: AbortSignal,
): Promise<Lyrics | null> {
  const key = `${norm(t.title)}|${norm(t.artist)}|${Math.round(t.duration || 0)}`;
  if (memo.has(key)) return memo.get(key)!;
  const cached = loadCache()[key];
  if (cached !== undefined) {
    memo.set(key, cached);
    return cached;
  }

  const title = cleanTitle(t.title) || t.title;
  const artist = cleanArtist(t.artist);
  // "Artist - Song" uploads: try the right side as the song as well
  const dash = title.split(/\s[-–—]\s/);
  const variants: { song: string; by: string }[] = [{ song: title, by: artist }];
  if (dash.length === 2) variants.push({ song: dash[1], by: dash[0] }, { song: dash[0], by: dash[1] });

  const pages = await Promise.all([
    ...variants.map((v) => search({ track_name: v.song, ...(v.by ? { artist_name: v.by } : {}) }, signal)),
    search({ q: `${variants[variants.length > 1 ? 1 : 0].song} ${variants[variants.length > 1 ? 1 : 0].by}`.trim() }, signal),
    search({ q: title }, signal),
  ]);
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const offline = pages.every((p) => p === null);

  const seen = new Set<number>();
  const hits = pages.flatMap((p) => p ?? []).filter((h) => !seen.has(h.id) && seen.add(h.id) && !h.instrumental && textOf(h).trim());
  const dur = t.duration && t.duration > 0 ? t.duration : 0;

  const scored = hits
    .map((h) => {
      const ts = Math.max(...variants.map((v) => similarity(v.song, h.trackName || "")));
      const as = Math.max(...variants.map((v) => (v.by ? similarity(v.by, h.artistName || "") : 0.5)));
      let ds = 0;
      if (dur && h.duration) {
        const d = Math.abs(dur - h.duration);
        ds = d <= 2 ? 1 : d <= 5 ? 0.7 : d <= 10 ? 0.25 : -1.5;
      }
      return { h, ts, score: ts * 3 + as * 1.5 + ds * 2 + (h.syncedLyrics ? 0.6 : 0) };
    })
    .filter((x) => x.ts >= 0.5)
    .sort((a, b) => b.score - a.score);

  let result: Lyrics | null = null;
  if (scored.length) {
    const best = scored[0];
    const near = (x: (typeof scored)[number]) =>
      x.score >= best.score - 2 && (!dur || !x.h.duration || Math.abs(dur - x.h.duration) <= 5);
    const native = scored.find((x) => near(x) && nonLatinShare(textOf(x.h)) > 0.5);
    const latin = scored.find((x) => near(x) && nonLatinShare(textOf(x.h)) < 0.1);
    // Original script first when the song has one; Roman version alongside.
    const mainHit = native ?? best;
    const main = version(mainHit.h);
    const latinV = native && latin ? version(latin.h) : undefined;
    result = {
      main,
      latin: latinV,
      canRomanize: Boolean(latinV) || needsRomanizing(main.plain),
    };
  }
  if (offline) return null; // try again next time
  memo.set(key, result);
  saveCache(key, result);
  return result;
}
