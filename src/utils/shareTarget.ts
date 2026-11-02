import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { RouteKey } from "@/routes";
import { goSearch } from "@/utils/searchNav";

/** App only: "Share → AuraBeats" and YouTube links opened with the app. */
interface ShareTargetPlugin {
  take(): Promise<{ text?: string }>;
  addListener(event: "shared", cb: (e: { text?: string }) => void): Promise<PluginListenerHandle>;
}
const ShareTarget = registerPlugin<ShareTargetPlugin>("ShareTarget");

const VIDEO_RE = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/;
const CHANNEL_RE = /youtube\.com\/channel\/(UC[\w-]{22})/;

/** A shared text → where it should open (null = nothing usable). */
export function sharedRoute(text: string): RouteKey | null {
  const vid = text.match(VIDEO_RE)?.[1];
  if (vid) return `watch:${vid}`;
  const ch = text.match(CHANNEL_RE)?.[1];
  if (ch) return `channel:${ch}`;
  return null;
}

/** Listens for shared links and opens them. Returns a cleanup function. */
export function listenForShares(navigate: (r: RouteKey) => void): () => void {
  let handle: PluginListenerHandle | null = null;
  let stopped = false;
  const open = (text?: string) => {
    const t = text?.trim();
    if (!t) return;
    const route = sharedRoute(t);
    if (route) navigate(route);
    else goSearch("video", t.slice(0, 200)); // plain text: search for it
  };
  ShareTarget.addListener("shared", (e) => open(e.text))
    .then((h) => {
      if (stopped) void h.remove();
      else handle = h;
      return ShareTarget.take();
    })
    .then((r) => !stopped && open(r?.text))
    .catch(() => {}); // older APK without the plugin
  return () => {
    stopped = true;
    void handle?.remove();
  };
}
