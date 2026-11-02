/**
 * Seek bar extras shared by both players, like YouTube's:
 *  - the bubble over the bar while pointing at it or dragging: a preview
 *    picture of that moment (when YouTube provides one), the chapter there
 *    and the time;
 *  - small gaps in the bar where chapters start.
 */
import { formatTime } from "@/utils/format";
import { chapterAt, storyFrame, useVideoExtras } from "./videoExtras";

export function SeekPreview({ id, t, duration, left, barWidth }: { id: string; t: number; duration: number; left: number | string; barWidth?: number }) {
  const { storyboard, chapters } = useVideoExtras(id);
  const f = storyFrame(storyboard, t, duration);
  const ch = chapterAt(chapters, t);
  // keep the bubble inside the bar
  const half = f ? f.w / 2 : 40;
  const x = typeof left === "number" && barWidth ? Math.max(half, Math.min(barWidth - half, left)) : left;
  return (
    <span className="pointer-events-none absolute bottom-5 z-10 flex -translate-x-1/2 flex-col items-center gap-1" style={{ left: x }}>
      {f && (
        <span
          className="block overflow-hidden rounded-lg bg-black shadow-xl ring-2 ring-white/90"
          style={{
            width: f.w,
            height: f.h,
            backgroundImage: `url("${f.url}")`,
            backgroundPosition: `-${f.x}px -${f.y}px`,
            backgroundSize: `${f.sheetW}px auto`,
          }}
        />
      )}
      {ch && <span className="max-w-48 truncate text-[12px] font-bold text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)]">{ch.title}</span>}
      <span className="rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white">{formatTime(t)}</span>
    </span>
  );
}

/** Gaps in the seek bar where chapters start. */
export function ChapterMarks({ id, duration }: { id: string; duration: number }) {
  const { chapters } = useVideoExtras(id);
  if (!duration || chapters.length < 2) return null;
  return (
    <>
      {chapters.slice(1).map((c) =>
        c.t > 0 && c.t < duration ? (
          <span key={c.t} className="pointer-events-none absolute inset-y-0 z-[1] w-[2px] -translate-x-1/2 bg-black/70" style={{ left: `${(c.t / duration) * 100}%` }} />
        ) : null,
      )}
    </>
  );
}
