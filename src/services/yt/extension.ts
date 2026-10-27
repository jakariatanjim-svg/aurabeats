/**
 * Website: talks to the AuraBeats Connector browser extension, which makes
 * YouTube requests with the browser's own youtube.com sign-in.
 */
import { useSyncExternalStore } from "react";
import { isNative } from "@/services/video/net";

/** Version of the extension zip built with this website. */
export const EXTENSION_VERSION: string = import.meta.env.VITE_EXT_VERSION || "1.0.0";
export const EXTENSION_ZIP = "/aurabeats-extension.zip";

interface ExtState {
  connected: boolean;
  version: string | null;
}
let state: ExtState = { connected: false, version: null };
const subs = new Set<() => void>();
const set = (p: Partial<ExtState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};

export const extension = {
  get: () => state,
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

export function useExtension(): ExtState {
  return useSyncExternalStore(extension.subscribe, extension.get, extension.get);
}

/** Older than the zip on this website? */
export function extensionOutdated(v: string | null): boolean {
  if (!v) return false;
  const a = v.split(".").map(Number);
  const b = EXTENSION_VERSION.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

type Res = { status: number; body: string; error?: string };
const waiting = new Map<string, (r: Res) => void>();
let seq = 0;

const isBrowser = typeof window !== "undefined" && !isNative;

if (isBrowser) {
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "aurabeats-ext") return;
    const d = e.data as { type: string; id?: string; res?: Res; version?: string };
    if (d.type === "hello") {
      if (!state.connected || state.version !== (d.version ?? null)) set({ connected: true, version: d.version ?? null });
    } else if (d.type === "response" && d.id) {
      waiting.get(d.id)?.(d.res ?? { status: 0, body: "", error: "no answer" });
      waiting.delete(d.id);
    }
  });
  window.postMessage({ source: "aurabeats-page", type: "hello" }, location.origin);
}

/** One YouTube request through the extension. */
export function extensionRequest(req: { url: string; method: string; body?: string; headers?: Record<string, string>; pageId?: string; authUser?: string }): Promise<Res> {
  if (!state.connected) return Promise.reject(new Error("The AuraBeats extension isn't connected"));
  const id = `r${Date.now().toString(36)}${(seq++).toString(36)}`;
  return new Promise<Res>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("The AuraBeats extension didn't answer"));
    }, 30000);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      if (r.error === "reload") reject(new Error("The extension was updated: reload this page"));
      else if (r.error && !r.status) reject(new Error(r.error));
      else resolve(r);
    });
    window.postMessage({ source: "aurabeats-page", type: "request", id, req }, location.origin);
  });
}
