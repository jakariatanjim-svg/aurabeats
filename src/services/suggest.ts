/**
 * Real-time search suggestions — the same autocomplete youtube.com uses.
 *
 * Primary: YouTube's suggest endpoint (`client=youtube&ds=yt`). It returns
 * real search phrases ("tum hi ho arijit singh", "kesariya lofi") rather
 * than full video titles. The endpoint has no CORS headers, so it is loaded
 * as JSONP through a <script> tag, which works in browsers, the PWA and the
 * Capacitor WebView alike.
 *
 * Fallbacks (only when YouTube's endpoint is unreachable):
 *   1. Invidious /api/v1/suggestions (proxied YouTube suggestions)
 *   2. JioSaavn song names (clean song titles, never "Title - Artist" strings)
 */
import * as youtube from "./youtube";

const ENDPOINTS = [
  "https://suggestqueries-clients6.youtube.com/complete/search",
  "https://suggestqueries.google.com/complete/search",
];

const MAX = 10;
const cache = new Map<string, string[]>();
let seq = 0;

function lang(): string {
  const l = (typeof navigator !== "undefined" && navigator.language) || "en";
  return l.split("-")[0] || "en";
}

/** Load a JSONP URL; resolves with the callback payload. */
function jsonp<T>(url: string, timeout: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const name = `__abSuggest${Date.now().toString(36)}${(seq++).toString(36)}`;
    const w = window as unknown as Record<string, unknown>;
    const script = document.createElement("script");
    let done = false;
    const cleanup = () => {
      done = true;
      clearTimeout(timer);
      script.remove();
      // Keep a no-op in place: a late response must not throw "not a function".
      w[name] = () => { delete w[name]; };
    };
    const timer = setTimeout(() => { if (!done) { cleanup(); reject(new Error("timeout")); } }, timeout);
    w[name] = (data: T) => { if (done) return; cleanup(); delete w[name]; resolve(data); };
    script.onerror = () => { if (!done) { cleanup(); reject(new Error("load failed")); } };
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = `${url}&callback=${name}`;
    document.head.appendChild(script);
  });
}

/** `["q", [["phrase", 0, [..]], "phrase2", ...], {...}]` → phrases. */
function parseGoogle(data: unknown): string[] {
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  return (data[1] as unknown[])
    .map((item) => (Array.isArray(item) ? item[0] : item))
    .filter((s): s is string => typeof s === "string")
    .map(decodeEntities);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

async function fromYouTube(q: string): Promise<string[]> {
  const params = `client=youtube&ds=yt&hl=${lang()}&q=${encodeURIComponent(q)}`;
  for (const base of ENDPOINTS) {
    try {
      const list = parseGoogle(await jsonp<unknown>(`${base}?${params}`, 2500));
      if (list.length) return list;
      return []; // reachable but genuinely no suggestions
    } catch { /* try next endpoint */ }
  }
  throw new Error("youtube suggest unreachable");
}

async function fromFallbacks(q: string): Promise<string[]> {
  // YouTube's own suggestions via the servers — never another catalogue.
  const inv = await youtube.fetchSuggestions(q).catch(() => [] as string[]);
  return inv.map(decodeEntities);
}

/** YouTube-style suggestions for what the user has typed so far. */
export async function fetchSearchSuggestions(query: string): Promise<string[]> {
  const q = query.trim().replace(/\s+/g, " ");
  if (!q) return [];
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  let list: string[];
  try {
    list = await fromYouTube(q);
  } catch {
    list = await fromFallbacks(q);
  }

  const seen = new Set<string>();
  const out = list
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => {
      const k = s.toLowerCase();
      if (!s || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX);

  if (out.length) {
    cache.set(key, out);
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  }
  return out;
}
