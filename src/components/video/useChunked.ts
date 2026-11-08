/**
 * The address to put on a media element: nothing while the piece-by-piece
 * loader (./chunked) feeds the element itself, or the plain file address
 * when that way isn't possible (the browser then loads the file as before).
 * Several files (picture + sound) go into the one element together.
 * If the loader fails mid-way, `onPlain` lets the player switch over.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { attachChunked, chunkedPossible, type ChunkTrack } from "./chunked";

/** Can these files be played piece by piece here? (website and app) */
export const chunkedOk = (tracks: (ChunkTrack | undefined)[]): boolean =>
  tracks.length > 0 && tracks.every((t) => !!t && chunkedPossible(t.mime, t.layout));

export function useChunkedSrc(
  el: RefObject<HTMLMediaElement | null>,
  tracks: (ChunkTrack | undefined)[],
  opts: { startHint?: () => number; onPlain?: (at: number, playing: boolean) => void } = {},
): { src: string | undefined; chunked: boolean } {
  const key = tracks.map((t) => t?.url ?? "").join("|");
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const o = useRef(opts);
  o.current = opts;
  const can = !!tracks[0] && plainKey !== key && chunkedOk(tracks);

  useEffect(() => {
    const m = el.current;
    if (!m || !can) return;
    let alive = true;
    let stop: (() => void) | null = null;
    const toPlain = () => {
      if (!alive) return;
      const at = m.currentTime;
      const playing = !m.paused;
      stop?.();
      stop = null;
      setPlainKey(key);
      o.current.onPlain?.(at, playing);
    };
    attachChunked(m, tracks as ChunkTrack[], toPlain, () => o.current.startHint?.() ?? 0)
      .then((s) => (alive ? (stop = s) : s()))
      .catch(() => {
        if (!alive) return;
        setPlainKey(key);
        o.current.onPlain?.(m.currentTime, false);
      });
    return () => {
      alive = false;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, can]);

  return { src: can ? undefined : tracks.length === 1 ? tracks[0]?.url : undefined, chunked: can };
}
