/**
 * On-device YouTube extraction (Android app only), the NewPipe approach:
 * the phone asks YouTube's own player API for the stream list and plays the
 * files directly. No ads exist in these streams — ads are a separate system
 * the official player inserts — and the URLs are bound to the phone's own IP,
 * which is why this only works when the phone itself makes the request.
 *
 * Client chain:
 *  1. VISIONOS — stream URLs need no signature / n-parameter deciphering and
 *     no PO token (yt-dlp's JS-less default; values mirrored Oct 2026). Sent
 *     WITH a visitor identity (visitorData), like YouTube's own apps and
 *     yt-dlp — without one YouTube often answers "Sign in to confirm you're
 *     not a bot" (LOGIN_REQUIRED) on mobile-network IPs.
 *  2. Same again with a fresh identity.
 *  3. TV client via youtubei.js (deciphers URLs with YouTube's player JS).
 * Every failure reason is kept, so the app can show what YouTube said.
 */
import { http, isNative } from "./net";
import { guessRegion } from "./settings";
import type { AudioStream, MuxedStream, StreamSet, VideoDetails, VideoStream } from "./types";
import { thumbFor } from "./types";

export const DEVICE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

const CLIENT = {
  clientName: "VISIONOS",
  clientVersion: "1.02",
  deviceMake: "Apple",
  deviceModel: "RealityDevice17,1",
  userAgent: DEVICE_UA,
  osName: "visionOS",
  osVersion: "26.5.23O471",
  hl: "en",
};
const CLIENT_ID = "101";

export interface ItFormat {
  itag: number;
  url?: string;
  mimeType: string;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  qualityLabel?: string;
  audioQuality?: string;
  isDrc?: boolean;
  audioTrack?: { audioIsDefault?: boolean };
}

export interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds?: string;
    channelId?: string;
    author?: string;
    viewCount?: string;
    shortDescription?: string;
    isLive?: boolean;
    isLiveContent?: boolean;
  };
  streamingData?: {
    formats?: ItFormat[];
    adaptiveFormats?: ItFormat[];
    hlsManifestUrl?: string;
  };
  microformat?: { playerMicroformatRenderer?: { publishDate?: string; uploadDate?: string; ownerProfileUrl?: string } };
}

export const deviceExtractionAvailable = isNative;

/* ------------------------- visitor identity ----------------------------- */

const VD_KEY = "ab:yt-visitor";
const VD_TTL = 3 * 24 * 60 * 60 * 1000;
let vdMem: { v: string; at: number } | null = null;

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_");
}

/** Same format YouTube issues (protobuf {1: id, 5: timestamp}) — offline fallback. */
function localVisitorData(): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const rnd = crypto.getRandomValues(new Uint8Array(11));
  const id = Array.from(rnd, (n) => abc[n % 64]).join("");
  const out: number[] = [0x0a, id.length, ...Array.from(id, (c) => c.charCodeAt(0)), 0x28];
  let ts = Math.floor(Date.now() / 1000);
  while (ts > 127) {
    out.push((ts & 127) | 128);
    ts = Math.floor(ts / 128);
  }
  out.push(ts);
  return encodeURIComponent(b64url(new Uint8Array(out)));
}

async function fetchVisitorData(): Promise<string | undefined> {
  try {
    const text = await http<string>(
      "https://www.youtube.com/sw.js_data",
      { timeout: 6000, headers: { "User-Agent": DEVICE_UA, Referer: "https://www.youtube.com/sw.js", Accept: "*/*" } },
      "text",
    );
    const data = JSON.parse(String(text).replace(/^\)\]\}'\s*/, ""));
    const v = data?.[0]?.[2]?.[0]?.[0]?.[13];
    return typeof v === "string" && v.length > 10 ? v : undefined;
  } catch {
    return undefined;
  }
}

async function visitorData(fresh = false): Promise<string> {
  if (!fresh) {
    if (!vdMem) {
      try {
        const saved = JSON.parse(localStorage.getItem(VD_KEY) || "null");
        if (saved?.v) vdMem = saved;
      } catch {
        /* ignore */
      }
    }
    if (vdMem && Date.now() - vdMem.at < VD_TTL) return vdMem.v;
  }
  const v = (await fetchVisitorData()) || localVisitorData();
  vdMem = { v, at: Date.now() };
  try {
    localStorage.setItem(VD_KEY, JSON.stringify(vdMem));
  } catch {
    /* ignore */
  }
  return v;
}

/* ------------------------------ player ---------------------------------- */

/** Thrown when every client failed; `message` is readable, `reasons` lists each try. */
export class DeviceError extends Error {
  constructor(public reasons: string[]) {
    super(reasons.join(" • ") || "YouTube refused this device");
    this.name = "DeviceError";
  }
}

/** Short, human version of what YouTube answered. */
function explain(status: string | undefined, reason: string | undefined): string {
  if (status === "LOGIN_REQUIRED" && /bot/i.test(reason || "")) return "YouTube bot check (sign-in requested)";
  if (status === "LOGIN_REQUIRED") return reason || "Sign-in required (age-restricted?)";
  return reason || status || "unplayable";
}

async function visionos(videoId: string, vd: string): Promise<PlayerResponse> {
  const data = await http<PlayerResponse>(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      timeout: 10000,
      headers: {
        "User-Agent": DEVICE_UA,
        "X-YouTube-Client-Name": CLIENT_ID,
        "X-YouTube-Client-Version": CLIENT.clientVersion,
        "X-Goog-Visitor-Id": vd,
        Origin: "https://www.youtube.com",
      },
      body: {
        context: { client: { ...CLIENT, gl: guessRegion(), visitorData: vd } },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      },
    },
  );
  const status = data.playabilityStatus?.status;
  if (status !== "OK") throw new Error(explain(status, data.playabilityStatus?.reason));
  if (!data.streamingData || !data.videoDetails) throw new Error("no streams in answer");
  return data;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 140);

export async function devicePlayer(videoId: string): Promise<VideoDetails> {
  if (!isNative) throw new Error("device extraction needs the app");
  const reasons: string[] = [];
  for (const fresh of [false, true]) {
    try {
      return toDetails(await visionos(videoId, await visitorData(fresh)));
    } catch (e) {
      reasons.push(`App client${fresh ? " (new id)" : ""}: ${msg(e)}`);
      // Removed / private / region-blocked: another client won't help.
      if (/unavailable|private|removed|not available in your country/i.test(msg(e))) throw new DeviceError(reasons);
    }
  }
  // APK builds only (VITE_APK=1 in the APK workflows): keeps youtubei.js
  // (~170 KB gzip) out of the website, which never extracts on-device.
  if (import.meta.env.VITE_APK === "1") {
    try {
      const { tvPlayer } = await import("./innertubeTv");
      return await tvPlayer(videoId, await visitorData());
    } catch (e) {
      reasons.push(`TV client: ${msg(e)}`);
    }
  }
  throw new DeviceError(reasons);
}

export function toDetails(data: PlayerResponse): VideoDetails {
  const sd = data.streamingData!;
  const vd = data.videoDetails!;

  const live = Boolean(vd.isLive);
  const video: VideoStream[] = [];
  const audio: AudioStream[] = [];
  const muxed: MuxedStream[] = [];

  for (const f of sd.adaptiveFormats ?? []) {
    if (!f.url || f.isDrc) continue;
    if (f.mimeType.startsWith("video/")) {
      const h = f.height ?? 0;
      video.push({ url: f.url, mime: f.mimeType, height: h, fps: f.fps, bitrate: f.bitrate, label: f.qualityLabel || `${h}p` });
    } else if (f.mimeType.startsWith("audio/")) {
      // Dubbed videos carry several audio tracks — keep the original one.
      if (f.audioTrack && f.audioTrack.audioIsDefault === false) continue;
      audio.push({ url: f.url, mime: f.mimeType, bitrate: f.bitrate });
    }
  }
  for (const f of sd.formats ?? []) {
    if (!f.url) continue;
    const h = f.height ?? 360;
    muxed.push({ url: f.url, mime: f.mimeType, height: h, label: f.qualityLabel || `${h}p` });
  }

  const streams: StreamSet = { source: "device", video, audio, muxed, hls: sd.hlsManifestUrl, live };
  if (!live && !muxed.length && !(video.length && audio.length)) throw new Error("no playable formats");
  if (live && !streams.hls) throw new Error("no live stream");

  const mf = data.microformat?.playerMicroformatRenderer;
  const date = mf?.publishDate || mf?.uploadDate;
  return {
    id: vd.videoId,
    title: vd.title,
    author: vd.author || "",
    authorId: vd.channelId,
    duration: Number(vd.lengthSeconds) || 0,
    views: Number(vd.viewCount) || undefined,
    published: date ? Date.parse(date) || undefined : undefined,
    live,
    thumbnail: thumbFor(vd.videoId),
    description: vd.shortDescription || "",
    related: [],
    streams,
  };
}
