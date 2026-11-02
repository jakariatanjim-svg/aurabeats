/**
 * The address to put on a media element for one stream file: nothing while
 * the piece-by-piece loader (./chunked) feeds the element itself, or the
 * plain file address when that way isn't possible (then the browser loads
 * the file as before). If the loader fails mid-way, it switches to the plain
 * address and carries on from the same moment.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { StreamLayout } from "@/services/video/types";
import { isNative } from "@/services/video/net";
import { attachChunked, chunkedPossible } from "./chunked";

export function useChunkedSrc(
  el: RefObject<HTMLMediaElement | null>,
  stream: { url: string; mime: string; layout?: StreamLayout } | undefined,
  startHint?: () => number,
): string | undefined {
  const [plain, setPlain] = useState<string | null>(null);
  const resume = useRef<{ t: number; play: boolean } | null>(null);
  const hint = useRef(startHint);
  hint.current = startHint;
  // the app keeps its proven playback path; the website gets the new loader
  const can = !!stream && !isNative && plain !== stream.url && chunkedPossible(stream.mime, stream.layout);
  const url = stream?.url;

  useEffect(() => {
    const m = el.current;
    if (!m || !stream || !can) return;
    let alive = true;
    let stop: (() => void) | null = null;
    const toPlain = () => {
      if (!alive) return;
      resume.current = { t: m.currentTime, play: !m.paused };
      stop?.();
      stop = null;
      setPlain(stream.url);
    };
    attachChunked(m, stream.url, stream.mime, stream.layout!, toPlain, () => hint.current?.() ?? 0)
      .then((s) => (alive ? (stop = s) : s()))
      .catch(() => alive && setPlain(stream.url));
    return () => {
      alive = false;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, can]);

  // after a mid-way switch to the plain address: same moment, same state
  useEffect(() => {
    const m = el.current;
    const r = resume.current;
    if (!m || !r || plain !== url) return;
    const go = () => {
      resume.current = null;
      if (r.t > 0) m.currentTime = r.t;
      if (r.play) void m.play().catch(() => {});
    };
    m.addEventListener("loadedmetadata", go, { once: true });
    return () => m.removeEventListener("loadedmetadata", go);
  }, [plain, url, el]);

  return !stream ? undefined : can ? undefined : stream.url;
}
