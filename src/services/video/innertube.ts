/**
 * On-device YouTube extraction (Android app only), the NewPipe approach:
 * the phone asks YouTube's own player API for the stream list and plays the
 * files directly. No ads exist in these streams — ads are a separate system
 * the official player inserts — and the URLs are bound to the phone's own IP,
 * which is why this only works when the phone itself makes the request.
 *
 * Client: VISIONOS. Its stream URLs need no signature / n-parameter
 * deciphering and no PO token (same client yt-dlp uses as its JS-less
 * default; values mirrored from yt-dlp, Oct 2026). If YouTube changes it,
 * playback falls back to the ad-free proxy servers automatically.
 */
import { http, isNative } from "./net";
import { guessRegion } from "./settings";
import type { AudioStream, MuxedStream, StreamSet, VideoDetails, VideoStream } from "./types";
import { thumbFor } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

const CLIENT = {
  clientName: "VISIONOS",
  clientVersion: "1.02",
  deviceMake: "Apple",
  deviceModel: "RealityDevice17,1",
  userAgent: UA,
  osName: "visionOS",
  osVersion: "26.5.23O471",
  hl: "en",
};
const CLIENT_ID = "101";

interface ItFormat {
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

interface PlayerResponse {
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

export async function devicePlayer(videoId: string): Promise<VideoDetails> {
  if (!isNative) throw new Error("device extraction needs the app");
  const data = await http<PlayerResponse>(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      timeout: 10000,
      headers: {
        "User-Agent": UA,
        "X-YouTube-Client-Name": CLIENT_ID,
        "X-YouTube-Client-Version": CLIENT.clientVersion,
        Origin: "https://www.youtube.com",
      },
      body: {
        context: { client: { ...CLIENT, gl: guessRegion() } },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      },
    },
  );

  const status = data.playabilityStatus?.status;
  if (status !== "OK") throw new Error(data.playabilityStatus?.reason || status || "unplayable");
  const sd = data.streamingData;
  const vd = data.videoDetails;
  if (!sd || !vd) throw new Error("no streams");

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
