/**
 * Songs like the one playing, for the full screen player's "Up next" drawer
 * (like YouTube Music's suggestions): YouTube's own related songs for the
 * track; a song from another source is first matched to its YouTube copy.
 */
import type { Track } from "@/types";
import { videoIdOfTrack } from "@/utils/watchVideo";
import { looksLikeMusic } from "@/services/discover";

const cache = new Map<string, Promise<Track[]>>();

function norm(s: string): string {
  return s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function load(t: Track): Promise<Track[]> {
  const yt = await import("@/services/youtube");
  let id = videoIdOfTrack(t);
  if (!id) {
    const hit = (await yt.searchTracks(`${t.title} ${t.artist}`, 5).catch(() => [] as Track[]))[0];
    id = videoIdOfTrack(hit);
  }
  if (!id) return [];
  const list = await yt.fetchRelated(id, 40, t.title, t.artist);
  const seen = new Set<string>([norm(t.title)]);
  const out: Track[] = [];
  for (const x of list) {
    if (!looksLikeMusic(x)) continue;
    const k = norm(x.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out.slice(0, 30);
}

/** Songs like `t` (cached for the visit). */
export function songsLike(t: Track): Promise<Track[]> {
  let p = cache.get(t.id);
  if (!p) {
    p = load(t);
    p.catch(() => cache.delete(t.id));
    p.then(
      (r) => {
        if (!r.length) cache.delete(t.id); // try again next time
      },
      () => {},
    );
    cache.set(t.id, p);
    if (cache.size > 40) cache.delete(cache.keys().next().value!);
  }
  return p;
}
