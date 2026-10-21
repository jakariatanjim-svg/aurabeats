import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, Music2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { usePlaybackClock, usePlayer } from "@/hooks/usePlayer";
import { fetchLyrics, type LyricLine, type Lyrics } from "@/services/lyrics";
import type { Track } from "@/types";

/** Highlight a touch early so the line lights up as it is sung, not after. */
const LEAD = 0.15;

function activeIndex(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t + LEAD) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Smooth song position: the player reports time only every few hundred ms
 * (YouTube), so between reports the clock is advanced on every frame.
 */
function useActiveLine(lines: LyricLine[] | null): { index: number; now: () => number } {
  const { currentTime } = usePlaybackClock();
  const { isPlaying } = usePlayer();
  const anchor = useRef({ t: currentTime, at: performance.now() });
  const shown = useRef(currentTime);
  const [index, setIndex] = useState(-1);

  const now = useCallback(() => {
    const a = anchor.current;
    let t = isPlaying ? a.t + Math.min(1, (performance.now() - a.at) / 1000) : a.t;
    // a fresh report slightly behind the interpolated time must not step back
    if (isPlaying && shown.current > t && shown.current - t < 0.6) t = shown.current;
    shown.current = t;
    return t;
  }, [isPlaying]);

  useEffect(() => {
    anchor.current = { t: currentTime, at: performance.now() };
    if (Math.abs(shown.current - currentTime) > 0.6) shown.current = currentTime; // seek
  }, [currentTime]);

  useEffect(() => {
    if (!lines?.length) {
      setIndex(-1);
      return;
    }
    let raf = 0;
    const tick = () => {
      const i = activeIndex(lines, now());
      setIndex((p) => (p === i ? p : i));
      if (isPlaying) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [lines, isPlaying, now, currentTime]);

  return { index, now };
}

interface Props {
  track: Track;
  romanized: boolean;
  /** tells the parent whether the "Aa" switch makes sense for this song */
  onRomanizable?: (can: boolean) => void;
}

export function LyricsViewer({ track, romanized, onRomanizable }: Props) {
  const { seek } = usePlayer();
  const [data, setData] = useState<Lyrics | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "none">("loading");
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const lineEls = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const ctl = new AbortController();
    setStatus("loading");
    setData(null);
    setFollow(true);
    scroller.current?.scrollTo({ top: 0 });
    fetchLyrics({ title: track.title, artist: track.artist, duration: track.duration }, ctl.signal)
      .then((l) => {
        setData(l);
        setStatus(l ? "ready" : "none");
      })
      .catch(() => !ctl.signal.aborted && setStatus("none"));
    return () => ctl.abort();
  }, [track.id, track.title, track.artist, track.duration]);

  useEffect(() => {
    onRomanizable?.(Boolean(data?.canRomanize));
  }, [data, onRomanizable]);

  // The transliterator is big (character tables): loaded only when needed.
  const [romanizeLines, setRomanizeLines] = useState<((l: string[]) => string[]) | null>(null);
  const wantRomanizer = Boolean(romanized && data?.canRomanize && !(data.latin && (data.latin.synced || !data.main.synced)));
  useEffect(() => {
    if (!wantRomanizer || romanizeLines) return;
    let alive = true;
    void import("@/utils/romanize").then((m) => alive && setRomanizeLines(() => m.romanizeLines));
    return () => {
      alive = false;
    };
  }, [wantRomanizer, romanizeLines]);

  /* what to show: synced lines if any, otherwise plain text */
  const view = useMemo(() => {
    if (!data) return null;
    const { main, latin } = data;
    const roman = romanized && data.canRomanize;
    // A human-written Roman version is best; fall back to our transliteration
    // when it would cost the timing.
    if (roman && latin && (latin.synced || !main.synced)) return latin;
    if (!roman || !romanizeLines) return main;
    if (main.synced) {
      const r = romanizeLines(main.synced.map((l) => l.text));
      return { synced: main.synced.map((l, i) => ({ t: l.t, text: r[i] })), plain: [] };
    }
    return { synced: null, plain: romanizeLines(main.plain) };
  }, [data, romanized, romanizeLines]);

  const synced = view?.synced ?? null;
  const { index } = useActiveLine(synced);

  const centre = useCallback((i: number, smooth = true) => {
    const box = scroller.current;
    const el = lineEls.current[Math.max(0, i)];
    if (!box || !el) return;
    const top = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }, []);

  // keep the sung line in the middle while following
  useLayoutEffect(() => {
    if (follow && synced) centre(index);
  }, [index, follow, synced, centre]);

  // switching original ↔ Roman changes line heights: re-centre at once
  useLayoutEffect(() => {
    if (follow && synced) centre(index, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [romanized]);

  useEffect(() => {
    const onResize = () => follow && synced && centre(index, false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [follow, synced, index, centre]);

  // the user's own scrolling (wheel, touch, drag, keys) stops following
  const stopFollowing = () => synced && setFollow(false);
  const onKey = (e: React.KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) stopFollowing();
  };

  const resync = () => {
    setFollow(true);
    centre(index);
  };

  if (status === "loading") {
    return (
      <div className="flex h-full flex-col justify-center gap-5 px-6 sm:px-10" aria-busy="true">
        {[78, 62, 88, 54, 70].map((w, i) => (
          <div key={i} className="h-7 animate-pulse rounded-full bg-ink/8 sm:h-8" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    );
  }

  if (status === "none" || !view || (!synced && !view.plain.some(Boolean))) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink3">
        <Music2 className="h-9 w-9 opacity-60" />
        <p className="text-[15px] font-semibold">No lyrics for this song</p>
      </div>
    );
  }

  const introDots = synced && index < 0 && synced[0].t > 4;

  return (
    <div className="relative h-full">
      <div
        ref={scroller}
        tabIndex={0}
        onWheel={stopFollowing}
        onTouchStart={stopFollowing}
        onPointerDown={(e) => e.pointerType === "mouse" && e.target === e.currentTarget && stopFollowing()}
        onKeyDown={onKey}
        className="no-scrollbar scroll-area h-full overflow-y-auto overscroll-contain px-6 outline-none sm:px-10"
        style={{
          maskImage: "linear-gradient(to bottom, transparent 0, #000 14%, #000 82%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 14%, #000 82%, transparent 100%)",
        }}
      >
        <div className={synced ? "py-[42vh] lg:py-[38vh]" : "py-16"}>
          {introDots && (
            <div className="mb-8 flex gap-2" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-3 w-3 animate-pulse rounded-full bg-ink/70"
                  style={{ animationDelay: `${i * 250}ms`, animationDuration: "1.6s" }}
                />
              ))}
            </div>
          )}

          {synced
            ? synced.map((l, i) => {
                const on = i === index;
                return (
                  <p
                    key={i}
                    ref={(el) => {
                      lineEls.current[i] = el;
                    }}
                    onClick={() => {
                      seek(l.t);
                      setFollow(true);
                    }}
                    className={cn(
                      "origin-left cursor-pointer py-2.5 text-[1.65rem] leading-[1.22] font-extrabold tracking-tight break-words transition-[color,transform,opacity] duration-500 ease-out sm:text-[2.1rem]",
                      on ? "scale-100 text-ink" : "scale-[0.97] text-ink/28 hover:text-ink/55",
                      !l.text && "text-[1.2rem] sm:text-[1.4rem]",
                    )}
                  >
                    {l.text || "♪"}
                  </p>
                );
              })
            : view.plain.map((line, i) =>
                line ? (
                  <p key={i} className="py-1.5 text-[1.35rem] leading-snug font-bold tracking-tight text-ink/85 sm:text-[1.6rem]">
                    {line}
                  </p>
                ) : (
                  <div key={i} className="h-6" />
                ),
              )}

          <p className="mt-10 text-[11px] font-medium text-ink3/70">Lyrics: LRCLIB</p>
        </div>
      </div>

      {synced && !follow && (
        <button
          type="button"
          onClick={resync}
          aria-label="Sync lyrics"
          className="surface-raised animate-fade-in absolute right-4 bottom-4 flex h-11 items-center gap-2 rounded-full px-4 text-[13px] font-bold text-ink shadow-lg transition-transform active:scale-95"
        >
          <LocateFixed className="h-4 w-4 text-accent" />
          Sync
        </button>
      )}
    </div>
  );
}
