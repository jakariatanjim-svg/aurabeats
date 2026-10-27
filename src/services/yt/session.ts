/**
 * The signed-in session in use (account + channel), if any, and calls made
 * with it. Lists are cached in memory per session only (never saved).
 */
import { useSyncExternalStore } from "react";
import { storage } from "@/utils/storage";
import { ytAccounts, ytAccountsSupported } from "./accounts";
import { ytCall, ytPing } from "./transport";

export interface YtSession {
  account: string;
  pageId: string;
  /** cache key: changes with account / channel */
  key: string;
  channelId?: string;
}

let cached: YtSession | null = null;
function compute(): YtSession | null {
  const a = ytAccounts.active();
  if (!a || a.needsSignIn || !ytAccountsSupported()) return null;
  const key = `${a.id}:${a.pageId}`;
  if (cached?.key === key && cached.channelId === a.channelId) return cached;
  return { account: a.id, pageId: a.pageId, key, channelId: a.channelId };
}
const read = () => (cached = compute());

export function ytSession(): YtSession | null {
  return read();
}

export function useYtSession(): YtSession | null {
  return useSyncExternalStore(ytAccounts.subscribe, read, read);
}

export function call<T = unknown>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
  const s = ytSession();
  if (!s) return Promise.reject(new Error("Not signed in"));
  return ytCall<T>(s.account, endpoint, body, s.pageId || undefined);
}

export function ping(url: string): Promise<number> {
  const s = ytSession();
  if (!s) return Promise.reject(new Error("Not signed in"));
  return ytPing(s.account, url, s.pageId || undefined);
}

/* ------------------------------- preferences ------------------------------ */

interface Prefs {
  /** add what you watch to your YouTube history */
  recordHistory: boolean;
}
const K_PREFS = "ytacct:prefs";
let prefs: Prefs = { recordHistory: true, ...storage.get<Partial<Prefs>>(K_PREFS, {}) };
const prefSubs = new Set<() => void>();

export const ytPrefs = {
  get: () => prefs,
  set(patch: Partial<Prefs>) {
    prefs = { ...prefs, ...patch };
    storage.set(K_PREFS, prefs);
    prefSubs.forEach((f) => f());
  },
};

export function useYtPrefs(): Prefs {
  return useSyncExternalStore(
    (f) => {
      prefSubs.add(f);
      return () => prefSubs.delete(f);
    },
    ytPrefs.get,
    ytPrefs.get,
  );
}
