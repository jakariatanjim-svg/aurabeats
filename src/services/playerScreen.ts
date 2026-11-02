/**
 * Brightness + sound for the video player's swipe gestures (app only:
 * native/android/PlayerScreenPlugin.java). The website changes the picture's
 * brightness and the player's own volume instead.
 */
import { registerPlugin } from "@capacitor/core";
import { isNative } from "@/services/video/net";

interface PlayerScreenNative {
  get(): Promise<{ brightness: number; volume: number }>;
  setBrightness(o: { value: number }): Promise<void>;
  setVolume(o: { value: number }): Promise<void>;
  reset(): Promise<void>;
}

const P = isNative ? registerPlugin<PlayerScreenNative>("PlayerScreen") : null;

/** at most one call per ~40 ms while the finger moves, the last value always lands */
function throttled(fn: (v: number) => void) {
  let last = 0;
  let pending: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (v: number) => {
    const now = Date.now();
    if (now - last >= 40) {
      last = now;
      fn(v);
      return;
    }
    pending = v;
    clearTimeout(timer);
    timer = setTimeout(() => {
      last = Date.now();
      if (pending !== null) fn(pending);
      pending = null;
    }, 40);
  };
}

export const playerScreen = {
  native: !!P,
  async get(): Promise<{ brightness: number; volume: number } | null> {
    if (!P) return null;
    try {
      return await P.get();
    } catch {
      return null;
    }
  },
  setBrightness: throttled((v) => void P?.setBrightness({ value: v }).catch(() => {})),
  setVolume: throttled((v) => void P?.setVolume({ value: v }).catch(() => {})),
  reset(): void {
    void P?.reset().catch(() => {});
  },
};
