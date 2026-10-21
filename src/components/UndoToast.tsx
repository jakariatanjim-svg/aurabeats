/**
 * "Deleted · Undo" instead of asking first. The thing is removed right away;
 * the toast stays for a few seconds (Settings → Danger zone → Undo time,
 * 5–30 s, default 7) and Undo puts it back. Anything final (deleting a file)
 * waits in `commit` until the time is up. One at a time: a new one finishes
 * the previous.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { RotateCcw, X } from "lucide-react";
import { storage } from "@/utils/storage";

export const UNDO_CHOICES = [5, 7, 10, 15, 20, 30] as const;
const KEY = "undo:secs";
const clampSecs = (n: number) => Math.min(30, Math.max(5, Math.round(Number(n) || 7)));

interface Pending {
  id: number;
  message: string;
  undo: () => void | Promise<void>;
  commit?: () => void | Promise<void>;
  until: number;
  secs: number;
  timer: ReturnType<typeof setTimeout>;
}

let pending: Pending | null = null;
let secs = clampSecs(storage.get<number>(KEY, 7));
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function finish(run: "commit" | "undo") {
  const p = pending;
  if (!p) return;
  clearTimeout(p.timer);
  pending = null;
  emit();
  void Promise.resolve(run === "undo" ? p.undo() : p.commit?.()).catch(() => {});
}

/** Show "message · Undo". Call after the thing was already removed. */
export function undoable(o: { message: string; undo: () => void | Promise<void>; commit?: () => void | Promise<void> }) {
  finish("commit");
  const id = Date.now();
  pending = { ...o, id, secs, until: Date.now() + secs * 1000, timer: setTimeout(() => pending?.id === id && finish("commit"), secs * 1000) };
  emit();
}

if (typeof window !== "undefined") window.addEventListener("pagehide", () => finish("commit"));

/** Settings: how long Undo stays. */
export function useUndoSeconds(): [number, (n: number) => void] {
  const s = useSyncExternalStore(subscribe, () => secs, () => secs);
  return [
    s,
    (n: number) => {
      secs = clampSecs(n);
      storage.set(KEY, secs);
      emit();
    },
  ];
}

/** Rendered inside the Toaster column. Bigger than a normal toast so Undo is easy to hit. */
export function UndoToast() {
  const p = useSyncExternalStore(subscribe, () => pending, () => pending);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!p) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [p]);
  if (!p) return null;
  const left = Math.max(0, p.until - Date.now());

  return (
    <div key={p.id} role="status" className="blur-panel surface-raised pointer-events-auto relative animate-fade-up overflow-hidden shadow-xl">
      <div className="flex min-h-14 items-center gap-2 py-2 pr-2 pl-4">
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold text-ink">{p.message}</p>
        <button
          type="button"
          onClick={() => finish("undo")}
          className="focus-ring inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent/15 px-4 text-[13px] font-black text-accent transition hover:bg-accent/25 active:scale-95"
        >
          <RotateCcw className="h-4 w-4" /> Undo
          <span className="w-5 text-right text-[11px] font-bold tabular-nums opacity-70">{Math.ceil(left / 1000)}</span>
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => finish("commit")}
          className="focus-ring flex h-10 w-9 shrink-0 items-center justify-center rounded-full text-ink3 transition hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="absolute bottom-0 left-0 h-0.5 bg-accent/70" style={{ width: `${(left / (p.secs * 1000)) * 100}%`, transition: "width 250ms linear" }} />
    </div>
  );
}
