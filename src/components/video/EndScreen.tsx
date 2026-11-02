/**
 * What a player shows when the video is over (both players), like YouTube:
 *  - autoplay on and a next video → "Up next" with a short countdown,
 *    Cancel / Play now;
 *  - otherwise → Replay plus the next video as a card you can tap.
 * The small player (miniplayer) gets just the two round buttons.
 */
import { useEffect, useState } from "react";
import { Play, RotateCcw, SkipForward } from "lucide-react";
import { cn } from "@/utils/cn";
import { formatTime } from "@/utils/format";
import type { VideoItem } from "@/services/video/types";

const stop = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onPointerUp: (e: React.PointerEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
};

function RoundBtn({ label, onClick, children, big }: { label: string; onClick: () => void; children: React.ReactNode; big?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/15 transition hover:bg-black/75 active:scale-95",
        big ? "h-14 w-14" : "h-10 w-10",
      )}
    >
      {children}
    </button>
  );
}

export function EndScreen({
  next,
  autoplay,
  onReplay,
  onNext,
  compact,
  touch,
}: {
  next: VideoItem | null | undefined;
  /** count down and play the next video by itself */
  autoplay: boolean;
  onReplay: () => void;
  onNext: () => void;
  /** miniplayer / tiny box: buttons only */
  compact?: boolean;
  touch?: boolean;
}) {
  const total = touch ? 5 : 8;
  const counting = autoplay && !!next && !compact;
  const [left, setLeft] = useState<number | null>(counting ? total : null);

  useEffect(() => {
    setLeft(counting ? total : null);
  }, [counting, next?.id, total]);
  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      onNext();
      return;
    }
    const t = setTimeout(() => setLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  if (compact) {
    return (
      <div className="absolute inset-0 z-[6] flex items-center justify-center gap-3 bg-black/55" {...stop}>
        <RoundBtn label="Replay" onClick={onReplay}>
          <RotateCcw className="h-5 w-5" />
        </RoundBtn>
        {next && (
          <RoundBtn label="Next video" onClick={onNext}>
            <SkipForward className="h-5 w-5 fill-current" />
          </RoundBtn>
        )}
      </div>
    );
  }

  const ring = 2 * Math.PI * 22;
  return (
    <div className="absolute inset-0 z-[6] flex animate-fade-in items-center justify-center overflow-hidden [container-type:size]" {...stop}>
      {/* the next video's picture, blurred, hides YouTube's own end screen */}
      <div className="absolute inset-0 bg-black/80" />
      {next?.thumbnail && <img src={next.thumbnail} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" />}

      {next ? (
        <div className="relative flex w-full max-w-[34rem] flex-col items-center gap-[min(0.75rem,3cqh)] px-4 pb-[min(3rem,10cqh)] text-center">
          <p className="text-[clamp(0.7rem,4cqh,0.85rem)] font-semibold text-white/75">
            {left !== null ? (
              <>
                Up next in <span className="font-black text-white tabular-nums">{left}</span>
              </>
            ) : (
              "Up next"
            )}
          </p>
          <button
            type="button"
            onClick={onNext}
            aria-label={`Play next: ${next.title}`}
            className="group/next relative block aspect-video h-[min(9.5rem,30cqh)] overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/20 transition hover:ring-2 hover:ring-white"
          >
            <img src={next.thumbnail} alt="" className="h-full w-full object-cover transition duration-300 group-hover/next:scale-105" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/25">
              <span className="relative flex h-12 w-12 items-center justify-center">
                {left !== null && (
                  <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90">
                    <circle cx="24" cy="24" r="22" fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="3" />
                    <circle
                      cx="24"
                      cy="24"
                      r="22"
                      fill="none"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={ring}
                      strokeDashoffset={ring * (left / total)}
                      style={{ transition: "stroke-dashoffset 1s linear" }}
                    />
                  </svg>
                )}
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60">
                  <Play className="ml-0.5 h-5 w-5 fill-current" />
                </span>
              </span>
            </span>
            {next.duration > 0 && (
              <span className="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1 py-px text-[11px] font-bold tabular-nums">{formatTime(next.duration)}</span>
            )}
          </button>
          <div className="w-full min-w-0">
            <p className="line-clamp-2 text-[clamp(0.8rem,5cqh,1rem)] leading-snug font-bold text-white">{next.title}</p>
            {next.author && <p className="truncate text-[clamp(0.7rem,4cqh,0.8rem)] text-white/65">{next.author}</p>}
          </div>
          <div className="flex items-center gap-2">
            {left !== null ? (
              <>
                <button type="button" onClick={() => setLeft(null)} className="rounded-full bg-white/15 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/25">
                  Cancel
                </button>
                <button type="button" onClick={onNext} className="rounded-full bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/85">
                  Play now
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onReplay}
                  className="flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/25"
                >
                  <RotateCcw className="h-4 w-4" /> Replay
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/85"
                >
                  <SkipForward className="h-4 w-4 fill-current" /> Next
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="relative flex flex-col items-center gap-2">
          <RoundBtn label="Replay" onClick={onReplay} big>
            <RotateCcw className="h-7 w-7" />
          </RoundBtn>
          <span className="text-sm font-bold text-white/80">Replay</span>
        </div>
      )}
    </div>
  );
}
