/**
 * Songs already on the phone (Android app only): everything Android's media
 * library knows — Music folder, Chrome / WhatsApp downloads, earlier saves.
 * Read through the native DeviceMusic plugin and played straight from the
 * file via Capacitor's local server.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { isNative } from "@/services/video/net";
import type { Track } from "@/types";

interface RawSong {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  duration: number; // ms
  uri: string;
  art: string;
  added: number; // epoch s
  size: number;
  mime?: string;
  folder?: string;
}
interface ListResult {
  granted: boolean;
  tracks: RawSong[];
}
interface DeviceMusicPlugin {
  list(): Promise<ListResult>;
  request(): Promise<ListResult>;
}

const DeviceMusic = registerPlugin<DeviceMusicPlugin>("DeviceMusic");

export const deviceMusicAvailable = isNative && Capacitor.isPluginAvailable("DeviceMusic");

const toTrack = (s: RawSong): Track => {
  const art = Capacitor.convertFileSrc(s.art);
  const folder = (s.folder || "").replace(/^\/storage\/emulated\/0\//, "").replace(/\/[^/]*\.[a-z0-9]+$/i, "").replace(/\/$/, "");
  return {
    id: `local:${s.id}`,
    title: s.title || "Unknown",
    artist: s.artist || "",
    album: s.album || folder || undefined,
    artwork: art,
    artworkLarge: art,
    duration: Math.round((s.duration || 0) / 1000),
    source: "local",
    streamUrl: Capacitor.convertFileSrc(s.uri),
    fallbackUrls: [],
    codec: s.mime,
    isLive: false,
    addedAt: s.added ? s.added * 1000 : undefined,
    tags: folder ? [folder] : undefined,
  };
};

/** Last list read this session (Library tile count, instant revisits). */
export let cachedDeviceSongs: Track[] | null = null;

export async function listDeviceSongs(ask = false): Promise<{ granted: boolean; tracks: Track[] }> {
  const r = ask ? await DeviceMusic.request() : await DeviceMusic.list();
  const tracks = (r.tracks || []).map(toTrack);
  if (r.granted) cachedDeviceSongs = tracks;
  return { granted: r.granted, tracks };
}
