/**
 * Last on-device fallback (Android app only): YouTube's TV client through
 * youtubei.js. TV stream URLs are signed, so youtubei.js downloads YouTube's
 * player script and deciphers them (no PO token needed). Loaded on demand —
 * never part of the website bundle's start-up code.
 */
import { CapacitorHttp } from "@capacitor/core";
import { Innertube, Platform } from "youtubei.js/web";
import { toDetails, type ItFormat, type PlayerResponse } from "./innertube";
import type { VideoDetails } from "./types";

type Format = NonNullable<Awaited<ReturnType<Innertube["getBasicInfo"]>>["streaming_data"]>["formats"][number];

// Run the deciphering code youtubei.js extracts from YouTube's player.
Platform.shim.eval = async (data) => new Function(data.output)();

/** fetch() over the phone's native HTTP stack (no CORS, phone's own IP). */
async function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : undefined;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method || req?.method || "GET").toUpperCase();
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? req?.headers).forEach((v, k) => (headers[k] = v));

  let body: unknown;
  const raw = init?.body;
  if (typeof raw === "string") body = raw;
  else if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) body = new TextDecoder().decode(raw as ArrayBuffer);
  else if (!raw && req && method !== "GET" && method !== "HEAD") body = await req.clone().text();
  // Capacitor sends JSON bodies as objects.
  if (typeof body === "string" && /json/i.test(headers["content-type"] || "")) {
    try {
      body = JSON.parse(body);
    } catch {
      /* send as text */
    }
  }

  const res = await CapacitorHttp.request({
    url,
    method,
    headers,
    data: body,
    responseType: "text",
    connectTimeout: 12000,
    readTimeout: 15000,
  });
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
  const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
  return new Response(nullBody ? null : text, { status: res.status || 200, headers: res.headers });
}

let session: Promise<Innertube> | null = null;
function yt(visitorData: string): Promise<Innertube> {
  if (!session) {
    session = Innertube.create({
      fetch: nativeFetch as typeof fetch,
      visitor_data: visitorData,
      generate_session_locally: true,
      enable_session_cache: false,
      retrieve_player: true,
    }).catch((e) => {
      session = null;
      throw e;
    });
  }
  return session;
}

export async function tvPlayer(videoId: string, visitorData: string): Promise<VideoDetails> {
  const it = await yt(visitorData);
  const info = await it.getBasicInfo(videoId, { client: "TV" });
  const ps = info.playability_status;
  if (ps?.status !== "OK") throw new Error(ps?.reason || ps?.status || "unplayable");
  const sd = info.streaming_data;
  if (!sd) throw new Error("no streams in answer");
  const player = it.session.player;

  const conv = async (f: Format): Promise<ItFormat> => {
    let url: string | undefined;
    try {
      url = await f.decipher(player);
    } catch {
      url = undefined;
    }
    return {
      itag: f.itag,
      url,
      mimeType: f.mime_type,
      bitrate: f.bitrate,
      width: f.width,
      height: f.height,
      fps: f.fps,
      qualityLabel: f.quality_label,
      isDrc: f.is_drc,
      audioTrack: f.audio_track ? { audioIsDefault: f.audio_track.audio_is_default } : undefined,
    };
  };

  const b = info.basic_info;
  const resp: PlayerResponse = {
    playabilityStatus: { status: "OK" },
    videoDetails: {
      videoId: b.id || videoId,
      title: b.title || "",
      lengthSeconds: String(b.duration ?? 0),
      channelId: b.channel_id || b.channel?.id,
      author: b.author || b.channel?.name,
      viewCount: b.view_count != null ? String(b.view_count) : undefined,
      shortDescription: b.short_description,
      isLive: b.is_live,
    },
    streamingData: {
      formats: await Promise.all(sd.formats.map(conv)),
      adaptiveFormats: await Promise.all(sd.adaptive_formats.map(conv)),
      hlsManifestUrl: sd.hls_manifest_url,
    },
  };
  return toDetails(resp);
}
