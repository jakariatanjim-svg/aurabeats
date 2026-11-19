/** Lyrics for the exact YouTube video. Website requests use the existing
 * connector; Android uses native HTTP. No new permissions or sign-in needed.
 */
import { extensionCanStream, extensionRequest } from "./extension";
import { MUSIC_CLIENT } from "./transport";
import { http, isNative } from "@/services/video/net";
import { findAll, isObj, text, type Obj } from "./parse";
import { needsRomanizing } from "@/utils/script";
import type { Lyrics, LyricLine } from "@/services/lyrics";

async function request(endpoint: string, body: Obj, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const url = `https://music.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`;
  const payload = { context: { client: MUSIC_CLIENT }, ...body };
  if (isNative) return http(url, { method: "POST", body: payload, timeout: 7000, signal });
  const r = await extensionRequest({ url, method: "POST", body: JSON.stringify(payload), anon: true,
    headers: { "X-Youtube-Client-Name": "67", "X-Youtube-Client-Version": MUSIC_CLIENT.clientVersion } });
  if (r.status < 200 || r.status >= 300) throw new Error("Lyrics unavailable");
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  return JSON.parse(r.body);
}

function timedLines(root: unknown, out: LyricLine[] = []): LyricLine[] {
  if (Array.isArray(root)) for (const item of root) timedLines(item, out);
  else if (isObj(root)) {
    if (isObj(root.cueRange) && root.cueRange.startTimeMilliseconds !== undefined) {
      const ms = Number(root.cueRange.startTimeMilliseconds);
      const line = text(root.lyricLine) || text(root.text);
      if (Number.isFinite(ms) && ms >= 0 && line.trim()) out.push({ t: ms / 1000, text: line.trim() });
    } else for (const item of Object.values(root)) timedLines(item, out);
  }
  return out;
}

export async function youtubeLyrics(videoId: string, signal?: AbortSignal): Promise<Lyrics | null> {
  if (!isNative && !extensionCanStream()) return null;
  try {
    const next = await request("next", { videoId }, signal);
    // Lyrics has its own browse endpoint. Never mistake a related playlist or
    // the Up Next tab for lyrics by taking the first arbitrary browse endpoint.
    const endpoint = findAll(next, "browseEndpoint").find((e) => typeof e.browseId === "string" && e.browseId.startsWith("MPLY"));
    if (!endpoint) return null;
    const data = await request("browse", { browseId: endpoint.browseId, ...(endpoint.params ? { params: endpoint.params } : {}) }, signal);
    if (signal?.aborted) return null;
    const synced = timedLines(data).sort((a, b) => a.t - b.t)
      .filter((line, i, lines) => !i || line.t !== lines[i - 1].t || line.text !== lines[i - 1].text);
    const shelves = findAll(data, "musicDescriptionShelfRenderer");
    const plain = (synced.length ? synced.map((l) => l.text) : shelves.flatMap((s) => text(s.description).split(/\r?\n/)))
      .map((line) => line.trim());
    if (!plain.some(Boolean)) return null;
    return { main: { synced: synced.length ? synced : null, plain }, canRomanize: needsRomanizing(plain), source: "YouTube Music" };
  } catch {
    return null;
  }
}
