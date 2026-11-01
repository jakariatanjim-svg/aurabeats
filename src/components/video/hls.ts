/**
 * Live streams (HLS). Browsers with Media Source Extensions — the Android
 * WebView included — play them through hls.js (loaded only when a live video
 * opens); Safari-style native HLS is the fallback. In the app every playlist
 * and segment is fetched by the phone's own HTTP stack, so the stream's
 * addresses (bound to the phone's IP) work without browser CORS rules.
 */
import { CapacitorHttp } from "@capacitor/core";
import type { Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats } from "hls.js";
import { isNative } from "@/services/video/net";

const nativeHls = () => typeof document !== "undefined" && document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
const mse = () => typeof window !== "undefined" && ("MediaSource" in window || "ManagedMediaSource" in window);

/** Something can play HLS here. */
export const hlsPlayable = () => mse() || nativeHls();

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function freshStats(): LoaderStats {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

/** hls.js loader over CapacitorHttp (app only). */
class NativeLoader implements Loader<LoaderContext> {
  context: LoaderContext | null = null;
  stats: LoaderStats = freshStats();
  private gone = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(_config: unknown) {}

  destroy() {
    this.abort();
    this.context = null;
  }

  abort() {
    this.gone = true;
    this.stats.aborted = true;
    if (this.timer) clearTimeout(this.timer);
  }

  load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
    this.context = context;
    this.gone = false;
    this.stats = freshStats();
    const stats = this.stats;
    stats.loading.start = performance.now();
    const binary = context.responseType === "arraybuffer";
    const headers: Record<string, string> = { ...(context.headers ?? {}) };
    if (context.rangeEnd) headers.Range = `bytes=${context.rangeStart ?? 0}-${context.rangeEnd - 1}`;
    const timeout = config.loadPolicy?.maxLoadTimeMs || config.timeout || 20000;
    this.timer = setTimeout(() => {
      if (this.gone) return;
      this.gone = true;
      callbacks.onTimeout(stats, context, null);
    }, timeout);
    CapacitorHttp.request({ url: context.url, method: "GET", headers, responseType: binary ? "arraybuffer" : "text", readTimeout: timeout, connectTimeout: timeout })
      .then((res) => {
        if (this.gone) return;
        if (this.timer) clearTimeout(this.timer);
        const now = performance.now();
        stats.loading.first = stats.loading.first || now;
        stats.loading.end = now;
        if (res.status < 200 || res.status >= 300) {
          callbacks.onError({ code: res.status, text: `HTTP ${res.status}` }, context, null, stats);
          return;
        }
        const data: string | ArrayBuffer = binary ? (typeof res.data === "string" ? b64ToBuffer(res.data) : (res.data as ArrayBuffer)) : String(res.data ?? "");
        const size = typeof data === "string" ? data.length : data.byteLength;
        stats.loaded = stats.total = size;
        callbacks.onSuccess({ url: res.url || context.url, data, code: res.status }, stats, context, null);
      })
      .catch((e: unknown) => {
        if (this.gone) return;
        if (this.timer) clearTimeout(this.timer);
        callbacks.onError({ code: 0, text: e instanceof Error ? e.message : "network error" }, context, null, stats);
      });
  }
}

/**
 * Plays `url` in `video`; returns a stop function. `onFatal` reports a stream
 * that can't be played (so the player can try another source).
 */
export async function attachHls(video: HTMLVideoElement, url: string, onFatal: (why: string) => void): Promise<() => void> {
  // website: the browser's own HLS when it has one (no cross-site fetching)
  if (!mse() || (!isNative && nativeHls())) {
    video.src = url;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }
  // the light build: plain HLS playback is all that's needed (no DRM / subtitles)
  const { default: Hls } = await import("hls.js/light");
  if (!Hls.isSupported()) {
    video.src = url;
    return () => video.removeAttribute("src");
  }
  const hls = new Hls({
    ...(isNative ? { loader: NativeLoader as unknown as typeof Hls.DefaultConfig.loader } : {}),
    liveSyncDurationCount: 3,
    backBufferLength: 30,
  });
  let mediaRetries = 0;
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 2) return hls.recoverMediaError();
    onFatal(`live stream failed (${data.details})`);
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => hls.destroy();
}
