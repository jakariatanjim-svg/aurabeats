/**
 * Android back button / back gesture, the way native apps behave:
 *   1. close whatever is on top (full-screen player, queue, dialog, …),
 *   2. else go to the previous page inside the app,
 *   3. else return to the start page of the current mode,
 *   4. only then leave the app (it goes to the background, so music keeps
 *      playing — like YouTube Music / Spotify).
 *
 * Overlays register a closer with `useBackHandler(open, close)`; the most
 * recently opened one is closed first.
 */
import { useEffect, useRef } from "react";

type Handler = () => void;
const stack: Handler[] = [];

export function pushBackHandler(h: Handler): () => void {
  stack.push(h);
  return () => {
    const i = stack.lastIndexOf(h);
    if (i !== -1) stack.splice(i, 1);
  };
}

/** Runs the top-most closer; false when nothing was open. */
export function runBackHandler(): boolean {
  const h = stack[stack.length - 1];
  if (!h) return false;
  h();
  return true;
}

/** While `active`, the back button calls `onBack` (latest version) instead of navigating. */
export function useBackHandler(active: boolean, onBack: Handler): void {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => ref.current());
  }, [active]);
}
