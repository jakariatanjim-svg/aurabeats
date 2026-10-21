import { storage } from "@/utils/storage";

export interface VideoSettings {
  /** "auto" or a max height (360, 480, 720, 1080, 1440, 2160) */
  quality: "auto" | number;
  autoplayNext: boolean;
  /** Your own Invidious or Piped API URL; empty = automatic public servers */
  customServer: string;
  /** app: on mobile data, videos start at 480p at most */
  dataSaver: boolean;
  /** app: turning the phone sideways opens full screen (off by default) */
  rotateFullscreen: boolean;
}

const KEY = "videoSettings";
const DEFAULTS: VideoSettings = { quality: "auto", autoplayNext: true, customServer: "", dataSaver: false, rotateFullscreen: false };

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
