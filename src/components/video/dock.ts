/**
 * Shared state for the website's single YouTube player ("dock").
 *
 * The iframe is created once in the app shell and never moved in the DOM
 * (moving an iframe reloads it). The watch page only reserves a slot; the
 * dock sits over that slot ("inline") or floats in a corner ("mini") while
 * the user browses — like YouTube's miniplayer.
 */
import { useSyncExternalStore } from "react";
import { storage } from "@/utils/storage";
import type { VideoItem } from "@/services/video/types";

export type DockMode = "none" | "inline" | "mini";

export interface DockState {
  id: string | null;
  /** bumps on every new claim so the player can seek/reload */
  claim: number;
  startAt: number;
  mode: DockMode;
  meta: VideoItem | null;
  /** next video for autoplay / the ⏭ button */
  next: VideoItem | null;
  theater: boolean;
}

let state: DockState = {
  id: null,
  claim: 0,
  startAt: 0,
  mode: "none",
  meta: null,
  next: null,
  theater: storage.get<boolean>("video:theater", false),
};
const listeners = new Set<() => void>();
const set = (patch: Partial<DockState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

/** Non-reactive bits the player reads directly. */
export const dockRefs: {
  slot: HTMLElement | null;
  ended: boolean;
  onEnded: (() => void) | null;
  /** current position, for handing over to a reload or history */
  time: number;
} = { slot: null, ended: false, onEnded: null, time: 0 };

export const dock = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Watch page mounted: play `id` in its slot (keeps playing if it's already the mini video). */
  claim(id: string, startAt: number, slot: HTMLElement) {
    dockRefs.slot = slot;
    if (state.id === id && state.mode !== "none") {
      set({ mode: "inline" });
      return;
    }
    dockRefs.ended = false;
    dockRefs.time = startAt;
    set({ id, startAt, mode: "inline", claim: state.claim + 1, meta: null, next: null });
  },
  /** Watch page unmounted: keep playing in the corner unless it finished. */
  release(slot: HTMLElement) {
    if (dockRefs.slot !== slot) return;
    dockRefs.slot = null;
    dockRefs.onEnded = null;
    if (state.mode === "inline") set({ mode: state.id && !dockRefs.ended ? "mini" : "none" });
  },
  setMeta(meta: VideoItem | null, next: VideoItem | null) {
    set({ meta, next });
  },
  close() {
    dockRefs.slot = null;
    set({ id: null, mode: "none", meta: null, next: null });
  },
  toggleTheater() {
    storage.set("video:theater", !state.theater);
    set({ theater: !state.theater });
  },
};

export function useDock(): DockState {
  return useSyncExternalStore(dock.subscribe, dock.get, dock.get);
}
