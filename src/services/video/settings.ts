import { useSyncExternalStore } from "react";
import { storage } from "@/utils/storage";

export interface VideoSettings {
  /** "auto" or a max height (360, 480, 720, 1080, 1440, 2160) */
  quality: "auto" | number;
  /** play the next video when one ends (off by default; the switch in the player) */
  autoplay: boolean;
  /** Your own Invidious or Piped API URL; empty = automatic public servers */
  customServer: string;
  /** app: on mobile data, videos start at 480p at most */
  dataSaver: boolean;
  /** app: turning the phone sideways opens full screen (off by default) */
  rotateFullscreen: boolean;
  /** app: leaving the app while a video plays keeps it in a floating window */
  pipOnLeave: boolean;
}

const KEY = "videoSettings";
const DEFAULTS: VideoSettings = { quality: "auto", autoplay: false, customServer: "", dataSaver: false, rotateFullscreen: false, pipOnLeave: true };

type Listener = () => void;
const listeners = new Set<Listener>();
let current: VideoSettings = { ...DEFAULTS, ...storage.get<Partial<VideoSettings>>(KEY, {}) };

export function getVideoSettings(): VideoSettings {
  return current;
}

export function setVideoSettings(patch: Partial<VideoSettings>) {
  current = { ...current, ...patch };
  storage.set(KEY, current);
  listeners.forEach((l) => l());
}

export function subscribeVideoSettings(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Two-letter region for trending, from the time zone / locale. */
export function guessRegion(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const TZ: Record<string, string> = {
      "Asia/Dhaka": "BD", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Karachi": "PK",
      "Asia/Kathmandu": "NP", "Asia/Colombo": "LK", "Asia/Dubai": "AE", "Asia/Riyadh": "SA",
      "Europe/London": "GB", "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Jakarta": "ID",
      "Asia/Singapore": "SG", "Asia/Kuala_Lumpur": "MY", "Australia/Sydney": "AU",
      "America/Toronto": "CA", "Europe/Berlin": "DE", "Europe/Paris": "FR",
    };
    if (TZ[tz]) return TZ[tz];
    const loc = navigator.language || "";
    const region = loc.split("-")[1];
    if (region && /^[A-Z]{2}$/i.test(region)) return region.toUpperCase();
    if (tz.startsWith("America/")) return "US";
  } catch {
    /* fall through */
  }
  return "US";
}

/* Repeat: once on, it stays on for every video until the page is closed. */
let repeatOn = false;
const repeatListeners = new Set<Listener>();
export const getRepeat = () => repeatOn;
export function setRepeat(on: boolean) {
  repeatOn = on;
  repeatListeners.forEach((l) => l());
}
const subscribeRepeat = (l: Listener) => {
  repeatListeners.add(l);
  return () => repeatListeners.delete(l);
};
export const useRepeat = () => useSyncExternalStore(subscribeRepeat, getRepeat, getRepeat);
export const useAutoplay = () => useSyncExternalStore(subscribeVideoSettings, () => current.autoplay, () => current.autoplay);
