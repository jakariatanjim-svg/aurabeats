/**
 * Thin bar along the top while a page opens (like YouTube's red line).
 * Starts on every page change, holds while a page's code is still loading
 * (<ProgressHold/> in the Suspense fallback), then finishes and fades.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

let holds = 0;
let phase: "idle" | "run" | "done" = "idle";
let runId = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let doneTimer = 0;

export const topProgress = {
  start() {
    runId++;
    phase = "run";
    emit();
    window.clearTimeout(doneTimer);
    // finish soon unless a page is still loading its code
    const id = runId;
    doneTimer = window.setTimeout(() => id === runId && holds === 0 && topProgress.done(), 260);
  },
  done() {
    if (phase !== "run") return;
    phase = "done";
    emit();
    window.setTimeout(() => {
      if (phase === "done") {
        phase = "idle";
        emit();
      }
    }, 420);
  },
};

/** Keeps the bar running while mounted. */
export function ProgressHold() {
  useEffect(() => {
    holds++;
    if (phase !== "run") topProgress.start();
    return () => {
      holds--;
      if (holds === 0) topProgress.done();
    };
  }, []);
  return null;
}

export function TopProgress() {
  const p = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => phase,
  );
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (p === "run") setKey(runId);
  }, [p]);
  if (p === "idle") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]" aria-hidden>
      <div
        key={key}
        className="h-full origin-left bg-accent shadow-[0_0_8px_var(--color-accent,currentColor)]"
        style={{
          animation: p === "run" ? "ab-progress 1.6s cubic-bezier(.1,.7,.2,1) forwards" : undefined,
          transform: p === "done" ? "scaleX(1)" : undefined,
          opacity: p === "done" ? 0 : 1,
          transition: p === "done" ? "transform 180ms ease-out, opacity 300ms ease 160ms" : undefined,
        }}
      />
    </div>
  );
}
