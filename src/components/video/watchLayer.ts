/**
 * Android app: the watch page is a layer above the app, like the YouTube app.
 *
 *  - "full": the video page covers the screen.
 *  - "mini": the same player keeps playing in a bar above the bottom
 *            navigation while you browse; tap or drag it up to return.
 *
 * The player is never re-created between the two (WatchView stays mounted
 * and portals its player into `host`), so nothing reloads or restarts.
 */
import { useSyncExternalStore } from "react";

export type LayerMode = "none" | "full" | "mini";

interface LayerState {
  id: string | null;
  mode: LayerMode;
  /** the element the player is portalled into */
  host: HTMLElement | null;
  /** live info for the mini bar */
  title: string;
  author: string;
  playing: boolean;
}

let state: LayerState = { id: null, mode: "none", host: null, title: "", author: "", playing: false };
const subs = new Set<() => void>();
const set = (p: Partial<LayerState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};

/** Non-reactive bits: the page's player spot and the drag handler. */
export const layerRefs: {
  slot: HTMLElement | null;
  drag: ((phase: "move" | "end", dy: number, velocity: number) => void) | null;
} = { slot: null, drag: null };

/** Player controls the mini bar can use (set by the mounted player). */
export const layerControls: { toggle: (() => void) | null; pause: (() => void) | null } = { toggle: null, pause: null };

/** Next open() comes from autoplay: stay small if we are small. */
let keepMini = false;

export const watchLayer = {
  get: () => state,
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  open(id: string) {
    const mode: LayerMode = keepMini && state.mode === "mini" && state.id ? "mini" : "full";
    keepMini = false;
    if (state.id !== id) set({ id, mode, title: "", author: "", playing: false });
    else if (state.mode !== mode) set({ mode });
  },
  autoplayNext() {
    keepMini = true;
  },
  minimize() {
    if (state.id && state.mode === "full") set({ mode: "mini" });
  },
  expand() {
    if (state.id) set({ mode: "full" });
  },
  close() {
    layerControls.pause?.();
    set({ id: null, mode: "none", title: "", author: "", playing: false });
  },
  setHost(host: HTMLElement | null) {
    if (state.host !== host) set({ host });
  },
  setInfo(title: string, author: string) {
    if (state.title !== title || state.author !== author) set({ title, author });
  },
  setPlaying(playing: boolean) {
    if (state.playing !== playing) set({ playing });
  },
};

export function useWatchLayer(): LayerState {
  return useSyncExternalStore(watchLayer.subscribe, watchLayer.get, watchLayer.get);
}
