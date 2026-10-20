/**
 * Music → video handoff: open the YouTube video of the song that is playing,
 * at the same moment, in Video mode. The music is paused first (the two never
 * play together).
 */
import type { Track } from "@/types";
import { rememberVideo } from "@/services/video/hints";

let pending: { id: string; at: number } | null = null;

/** YouTube video id of a YouTube / YouTube Music track, else null. */
export function videoIdOfTrack(t: Track | null | undefined): string | null {
  if (!t || t.source !== "youtube" || t.isLive) return null;
  if (t.id.startsWith("yt:")) return t.id.slice(3);
  if (t.streamUrl?.startsWith("yt-resolve:")) return t.streamUrl.slice("yt-resolve:".length);
  return null;
}

export function watchTrackVideo(t: Track, at: number, pauseMusic: () => void) {
  const id = videoIdOfTrack(t);
  if (!id) return;
  pauseMusic();
  rememberVideo({ id, title: t.title, author: t.artist, duration: Math.round(t.duration || 0), thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
  pending = { id, at: Math.max(0, Math.floor(at)) };
  const path = `/watch/${encodeURIComponent(id)}`;
  if (window.location.pathname !== path) window.history.pushState(null, "", path);
  // App listens to popstate to follow the address bar.
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** WatchView asks once on open: start here instead of the saved position. */
export function takeHandoffStart(id: string): number | null {
  if (!pending || pending.id !== id) return null;
  const at = pending.at;
  pending = null;
  return at;
}

/**
 * "Save for offline" keeps the audio file inside the app. YouTube / YouTube
 * Music streams can't be stored that way, so those songs get the external
 * MP3 download (and "Download video") instead; other sources can be saved.
 */
export function canSaveOffline(t: Track | null | undefined): boolean {
  if (!t || t.isLive) return false;
  return t.source !== "youtube" && !t.streamUrl?.startsWith("yt-resolve:");
}
