/**
 * What the app already knows about a video before its page opens: the card
 * you tapped (title, channel, views, date, avatar). The watch page shows it
 * instantly while the full info loads.
 */
import type { VideoItem } from "./types";

const hints = new Map<string, VideoItem>();

export function rememberVideo(v: VideoItem) {
  if (!v?.id || !v.title) return;
  const prev = hints.get(v.id);
  hints.set(v.id, prev ? { ...v, ...Object.fromEntries(Object.entries(prev).filter(([, x]) => x !== undefined && x !== "")) } as VideoItem : v);
  if (hints.size > 600) hints.delete(hints.keys().next().value as string);
}

export function videoHint(id: string): VideoItem | undefined {
  return hints.get(id);
}
