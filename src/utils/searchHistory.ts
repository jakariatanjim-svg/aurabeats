/**
 * Device-local search history shared by the top-bar search (Music + Video)
 * and Settings → History. Nothing leaves the device.
 */
import { useSyncExternalStore } from "react";
import { storage } from "@/utils/storage";
import { undoable } from "@/components/UndoToast";

export type SearchMode = "music" | "video";
export interface SearchEntry {
  q: string;
  mode: SearchMode;
  at: number;
}

const KEY = "searchHistory";
const MAX = 60;

function load(): SearchEntry[] {
  const saved = storage.get<SearchEntry[] | null>(KEY, null);
  if (Array.isArray(saved)) return saved.filter((e) => e && typeof e.q === "string");
  // One-time move from the old per-page lists.
  const now = Date.now();
  const old: SearchEntry[] = [
    ...storage.get<string[]>("searchRecent", []).map((q, i) => ({ q, mode: "music" as const, at: now - i * 1000 })),
    ...storage.get<string[]>("videoSearchRecent", []).map((q, i) => ({ q, mode: "video" as const, at: now - i * 1000 - 500 })),
  ].sort((a, b) => b.at - a.at);
  storage.set(KEY, old);
  storage.remove("searchRecent");
  storage.remove("videoSearchRecent");
  return old;
}

let entries: SearchEntry[] | null = null;
const listeners = new Set<() => void>();

function get(): SearchEntry[] {
  if (!entries) entries = load();
  return entries;
}

function commit(next: SearchEntry[]) {
  entries = next;
  storage.set(KEY, next);
  listeners.forEach((l) => l());
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const searchHistory = {
  all: get,
  add(q: string, mode: SearchMode) {
    const t = q.trim();
    if (!t) return;
    commit([{ q: t, mode, at: Date.now() }, ...get().filter((e) => !(e.mode === mode && same(e.q, t)))].slice(0, MAX));
  },
  remove(q: string, mode: SearchMode) {
    commit(get().filter((e) => !(e.mode === mode && same(e.q, q))));
  },
  clear(mode?: SearchMode) {
    const snap = get();
    commit(mode ? snap.filter((e) => e.mode !== mode) : []);
    if (snap.length) undoable({ message: "Search history cleared", undo: () => commit(snap) });
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useSearchHistory(): SearchEntry[] {
  return useSyncExternalStore(searchHistory.subscribe, get, get);
}
