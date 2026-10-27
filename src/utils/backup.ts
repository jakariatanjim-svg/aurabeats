/**
 * What AuraBeats keeps in localStorage, as one portable bundle: used by the
 * backup file (Settings → Your data) and by device sync. Caches, the YouTube
 * sign-in and device-only bits (window positions, volume…) never travel.
 */
import { storage } from "@/utils/storage";

export const NS = "aurabeats:v1:";
/** Caches the app re-creates by itself. */
export const isCacheKey = (k: string) =>
  k.startsWith(`${NS}feed:`) || k.startsWith(`${NS}lyricsCache`) || k === `${NS}video:instanceScore2` || k === `${NS}video:instances`;
export const RAW_CACHES = ["ab:avatars", "ab:yt-visitor"];
/** Look & behaviour; "Reset settings" puts these back, your library stays. */
export const SETTING_KEYS = [
  "theme", "mode", "accent", "settings", "videoSettings", "volume", "muted", "shuffle", "repeat",
  "sidebarCollapsed", "video:ytVolume", "video:ytQuality", "video:volume", "video:theater", "video:miniPos",
  "lyricsRomanized", "lastSearchTab",
];
/** Belong to this device only (never synced to another one). */
const DEVICE_ONLY = new Set([
  "sidebarCollapsed", "video:miniPos", "volume", "muted", "video:ytVolume", "video:volume",
  "tour:seen", "confirm:skip", "deviceMusic:asked", "sync:name", "undo:secs",
]);
const isPrivate = (k: string) => k.startsWith("account:") || k.startsWith("ytacct:");

export const lsKeys = () => {
  try {
    return Object.keys(window.localStorage);
  } catch {
    return [];
  }
};

/** Everything worth keeping, keyed without the namespace. */
export function collectData(forSync = false): Record<string, string> {
  const data: Record<string, string> = {};
  for (const full of lsKeys()) {
    if (!full.startsWith(NS) || isCacheKey(full)) continue;
    const k = full.slice(NS.length);
    if (isPrivate(k) || (forSync && DEVICE_ONLY.has(k))) continue;
    const v = localStorage.getItem(full);
    if (v !== null) data[k] = v;
  }
  return data;
}

export function backupJson(): string {
  return JSON.stringify({ app: "AuraBeats", kind: "backup", version: 1, at: new Date().toISOString(), data: collectData() }, null, 1);
}

const len = (data: Record<string, string>, k: string) => {
  try {
    const v = JSON.parse(data[k] ?? "[]");
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
};

/** Counts shown before applying a backup / sync. */
export function summarize(data: Record<string, string>): Record<string, number> {
  return {
    "Favourite songs": len(data, "favorites"),
    Playlists: len(data, "playlists"),
    "Songs played": len(data, "history"),
    "Followed channels": len(data, "video:follows"),
    "Videos watched": len(data, "video:history"),
    "Watch later": len(data, "video:later"),
    Searches: len(data, "searchHistory"),
  };
}

/** This device becomes a copy of the other (its own sign-in stays). */
export function applyReplace(data: Record<string, string>) {
  for (const full of lsKeys()) {
    if (!full.startsWith(NS)) continue;
    const k = full.slice(NS.length);
    if (isPrivate(k) || DEVICE_ONLY.has(k) || isCacheKey(full)) continue;
    if (!(k in data)) localStorage.removeItem(full);
  }
  for (const [k, v] of Object.entries(data)) if (typeof v === "string" && !isPrivate(k)) localStorage.setItem(NS + k, v);
}

const idOf = (x: unknown): string =>
  x && typeof x === "object" && "id" in x && (typeof (x as { id: unknown }).id === "string" || typeof (x as { id: unknown }).id === "number")
    ? `id:${(x as { id: string | number }).id}`
    : `json:${JSON.stringify(x)}`;

/**
 * Both devices' lists together: lists are joined (no duplicates, this
 * device's order first); settings this device already has are kept.
 */
export function applyMerge(data: Record<string, string>) {
  for (const [k, incoming] of Object.entries(data)) {
    if (typeof incoming !== "string" || isPrivate(k)) continue;
    const mine = storage.get<unknown>(k, undefined);
    if (mine === undefined) {
      localStorage.setItem(NS + k, incoming);
      continue;
    }
    let theirs: unknown;
    try {
      theirs = JSON.parse(incoming);
    } catch {
      continue;
    }
    if (Array.isArray(mine) && Array.isArray(theirs)) {
      const seen = new Set(mine.map(idOf));
      const extra = theirs.filter((x) => !seen.has(idOf(x)));
      if (extra.length) storage.set(k, [...mine, ...extra]);
    }
    // objects / values (settings): keep this device's
  }
}
