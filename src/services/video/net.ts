/**
 * Environment detection + HTTP for Video mode.
 *
 *  - "apk": the Capacitor Android app. Requests go through the native HTTP
 *    stack (CapacitorHttp), so there is no CORS and the phone talks to
 *    YouTube directly, exactly like NewPipe.
 *  - "pwa" / "web": a browser. YouTube's API refuses cross-origin requests,
 *    so metadata comes from public ad-free front-ends (Invidious / Piped,
 *    which send CORS headers) with a CORS-proxy fallback for metadata only.
 *    Video bytes always come from the front-end's own proxy, never through a
 *    third party.
 */
import { CapacitorHttp } from "@capacitor/core";

export type AppEnv = "apk" | "pwa" | "web";

export const appEnv: AppEnv = (() => {
  if (typeof window === "undefined") return "web";
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return "apk";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return standalone ? "pwa" : "web";
})();

export const isNative = appEnv === "apk";

export interface HttpOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
}

const CORS_PROXIES = [
  (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

function withTimeout(ms: number, outer?: AbortSignal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  outer?.addEventListener("abort", onAbort);
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(t);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

async function nativeRequest(url: string, o: HttpOptions, responseType: "json" | "text"): Promise<unknown> {
  const timeout = o.timeout ?? 12000;
  const res = await CapacitorHttp.request({
    url,
    method: o.method ?? "GET",
    headers: {
      ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...o.headers,
    },
    data: o.body,
    responseType,
    connectTimeout: timeout,
    readTimeout: timeout,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  if (responseType === "json" && typeof res.data === "string") return JSON.parse(res.data);
  return res.data;
}

async function browserFetch(url: string, o: HttpOptions, as: "json" | "text"): Promise<unknown> {
  const t = withTimeout(o.timeout ?? 9000, o.signal);
  try {
    const res = await fetch(url, {
      method: o.method ?? "GET",
      headers: {
        ...(as === "json" ? { Accept: "application/json" } : {}),
        ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...o.headers,
      },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      signal: t.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return as === "json" ? await res.json() : await res.text();
  } finally {
    t.done();
  }
}

/**
 * GET/POST and parse. `viaProxy` allows a CORS-proxy fallback in browsers —
 * only ever used for metadata (JSON / RSS), never for video streams.
 */
export async function http<T = unknown>(
  url: string,
  o: HttpOptions = {},
  as: "json" | "text" = "json",
  viaProxy: "never" | "fallback" | "only" = "fallback",
): Promise<T> {
  if (isNative) return (await nativeRequest(url, o, as)) as T;
  if (viaProxy !== "only") {
    try {
      return (await browserFetch(url, o, as)) as T;
    } catch (err) {
      if (viaProxy === "never" || (o.method ?? "GET") !== "GET" || o.signal?.aborted) throw err;
    }
  }
  let lastErr: unknown = new Error("no proxy");
  for (const proxy of CORS_PROXIES) {
    try {
      return (await browserFetch(proxy(url), { ...o, timeout: o.timeout ?? 10000 }, as)) as T;
    } catch (err) {
      lastErr = err;
      if (o.signal?.aborted) break;
    }
  }
  throw lastErr;
}

/** Short, human description of how this device plays YouTube. */
export function playbackMethodLabel(): string {
  return isNative ? "On-device (direct from YouTube)" : "Ad-free proxy servers";
}
