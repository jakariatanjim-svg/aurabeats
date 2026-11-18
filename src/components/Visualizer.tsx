import { useId } from "react";
import { usePlaybackClock, usePlayer } from "@/hooks/usePlayer";
import { cn } from "@/utils/cn";

interface VisualizerProps {
  variant?: "bars" | "wave" | "mirror";
  barCount?: number;
  className?: string;
  active: boolean;
}

/** Playback-position waveform, not an audio spectrum. YouTube embeds cannot
 * expose their audio samples. Never invent beats when there is no analyser.
 * Its contour stays still; only the actual playback position changes colour.
 * SVG remains sharp at any display density and needs no animation loop.
 */
export function Visualizer({ variant = "bars", barCount = 44, className, active }: VisualizerProps) {
  const { currentTime, duration } = usePlaybackClock();
  const { current } = usePlayer();
  const id = useId();
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const count = Math.max(2, barCount);
  let seed = 0;
  for (const c of current?.id || "AuraBeats") seed = (Math.imul(seed, 31) + c.charCodeAt(0)) >>> 0;
  const heights = Array.from({ length: count }, (_, i) => {
    // A stable, song-specific decorative contour — never claimed as samples.
    const envelope = Math.sin((i / (count - 1)) * Math.PI);
    const detail = ((Math.imul(seed ^ (i + 1), 16807) >>> 0) % 100) / 100;
    return 4 + envelope * (9 + detail * 22);
  });
  return (
    <svg viewBox={`0 0 ${count * 5} 40`} preserveAspectRatio="none" className={cn("block h-full w-full", className)} aria-hidden="true">
      <defs>
        <linearGradient id={id}>
          <stop offset="0%" stopColor="var(--c-accent2)" />
          <stop offset="100%" stopColor="var(--c-accent)" />
        </linearGradient>
        <clipPath id={`${id}-played`}>
          <rect width={progress * count * 5} height="40" />
        </clipPath>
      </defs>
      <g fill="currentColor" opacity="0.16">
        {heights.map((h, i) => <rect key={i} x={i * 5 + 1} y={variant === "bars" ? 39 - h : 20 - h / 2} width="2" height={h} rx="1" />)}
      </g>
      <g fill={`url(#${id})`} clipPath={`url(#${id}-played)`} opacity={active ? 0.95 : 0.5}>
        {heights.map((h, i) => <rect key={i} x={i * 5 + 1} y={variant === "bars" ? 39 - h : 20 - h / 2} width="2" height={h} rx="1" />)}
      </g>
    </svg>
  );
}
