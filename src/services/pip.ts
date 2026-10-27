/**
 * Android app: the floating video window (picture-in-picture).
 *
 * While a video plays, leaving the app (Home / Recents) shrinks the app into
 * a small window and only the video is shown in it — like YouTube. The
 * native side lives in native/android/PipPlugin.java.
 */
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { useSyncExternalStore } from "react";
import { isNative } from "@/services/video/net";

interface PipNative {
  isSupported(): Promise<{ supported: boolean }>;
  configure(o: { auto: boolean; playing: boolean; width: number; height: number }): Promise<void>;
  enter(): Promise<{ entered: boolean }>;
  addListener(event: "change", fn: (e: { active: boolean; dismissed: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: "action", fn: (e: { action: string }) => void): Promise<PluginListenerHandle>;
}

const Pip = registerPlugin<PipNative>("Pip");

let active = false;
let supported = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Called when the window is closed with ✕ / swiped away (the video should stop). */
const dismissHandlers = new Set<() => void>();
/** The window's play / pause button. */
const toggleHandlers = new Set<() => void>();

if (isNative) {
  Pip.isSupported()
    .then((r) => {
      supported = Boolean(r?.supported);
      emit();
    })
    .catch(() => undefined);
  void Pip.addListener("change", (e) => {
    active = Boolean(e?.active);
    document.documentElement.toggleAttribute("data-pip", active);
    emit();
    if (!active && e?.dismissed) dismissHandlers.forEach((f) => f());
  }).catch(() => undefined);
  void Pip.addListener("action", (e) => {
    if (e?.action === "toggle") toggleHandlers.forEach((f) => f());
  }).catch(() => undefined);
}

export const pip = {
  get active() {
    return active;
  },
  get supported() {
    return isNative && supported;
  },
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  },
  /** What the window should do right now. auto = enter when the app is left. */
  configure(o: { auto: boolean; playing: boolean; width: number; height: number }) {
    if (!isNative) return;
    void Pip.configure({
      auto: o.auto,
      playing: o.playing,
      width: Math.max(1, Math.round(o.width || 16)),
      height: Math.max(1, Math.round(o.height || 9)),
    }).catch(() => undefined);
  },
  enter() {
    if (!isNative) return Promise.resolve(false);
    return Pip.enter()
      .then((r) => Boolean(r?.entered))
      .catch(() => false);
  },
  onDismiss(fn: () => void) {
    dismissHandlers.add(fn);
    return () => {
      dismissHandlers.delete(fn);
    };
  },
  onToggle(fn: () => void) {
    toggleHandlers.add(fn);
    return () => {
      toggleHandlers.delete(fn);
    };
  },
};

const getActive = () => active;
const getSupported = () => isNative && supported;

/** True while the app is shown as the floating window. */
export function usePipActive(): boolean {
  return useSyncExternalStore(pip.subscribe, getActive, getActive);
}

export function usePipSupported(): boolean {
  return useSyncExternalStore(pip.subscribe, getSupported, getSupported);
}
