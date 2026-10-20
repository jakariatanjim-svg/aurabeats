import { memo, useState } from "react";
import { Clock, Radio as LiveIcon } from "lucide-react";
import { cn } from "@/utils/cn";
import { formatCount, formatTime, gradientFrom, initials, relativeTime } from "@/utils/format";
import { routeToPath } from "@/routes";
import type { ChannelItem, VideoItem } from "@/services/video/types";
import { ytImgProps } from "@/utils/ytImg";

export function Avatar({ name, src, className }: { name: string; src?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn("shrink-0 rounded-full bg-ink/10 object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ background: gradientFrom(name || "?") }}
      className={cn("flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white", className)}
    >
      {initials(name || "?")}
    </span>
  );
}

function Thumb({ v, progress, className }: { v: VideoItem; progress?: number; className?: string }) {
  const [src, setSrc] = useState(v.thumbnail);
  return (
    <div className={cn("relative aspect-video w-full overflow-hidden rounded-2xl bg-ink/[0.06]", className)}>
      <img
        {...(src === v.thumbnail ? ytImgProps(src) : { src })}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => src !== `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` && setSrc(`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`)}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      />
      {v.live ? (
        <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
          <LiveIcon className="h-3 w-3" /> LIVE
        </span>
      ) : v.duration > 0 ? (
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
          {formatTime(v.duration)}
        </span>
      ) : null}
      {progress !== undefined && progress > 0 && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-white/30">
          <span className="block h-full bg-red-600" style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

export function metaLine(v: VideoItem): string {
  const parts: string[] = [];
  if (v.views !== undefined) parts.push(`${formatCount(v.views)} views`);
  const when = v.published ? relativeTime(v.published) : v.publishedText;
  if (when) parts.push(when);
  return parts.join(" · ");
}

/** Large grid card (home / channel / search on wide screens). */
export const VideoCard = memo(function VideoCard({
  v,
  progress,
  hideChannel,
}: {
  v: VideoItem;
  progress?: number;
  hideChannel?: boolean;
}) {
  return (
    <div className="group min-w-0">
      <a href={routeToPath(`watch:${v.id}`)} data-nav="true" className="focus-ring block rounded-2xl" aria-label={v.title}>
        <Thumb v={v} progress={progress} />
      </a>
      <div className="mt-2.5 flex gap-2.5">
        {!hideChannel &&
          (v.authorId ? (
            <a href={routeToPath(`channel:${v.authorId}`)} data-nav="true" aria-label={v.author} className="shrink-0">
              <Avatar name={v.author} src={v.authorAvatar} className="h-9 w-9" />
            </a>
          ) : (
            <Avatar name={v.author} src={v.authorAvatar} className="h-9 w-9" />
          ))}
        <div className="min-w-0 flex-1">
          <a href={routeToPath(`watch:${v.id}`)} data-nav="true" className="line-clamp-2 text-[14px] leading-snug font-bold text-ink">
            {v.title}
          </a>
          {!hideChannel && (
            v.authorId ? (
              <a href={routeToPath(`channel:${v.authorId}`)} data-nav="true" className="mt-0.5 block truncate text-xs text-ink3 hover:text-ink">
                {v.author}
              </a>
            ) : (
              <p className="mt-0.5 truncate text-xs text-ink3">{v.author}</p>
            )
          )}
          <p className="truncate text-xs text-ink3">{metaLine(v)}</p>
        </div>
      </div>
    </div>
  );
});

/** Compact row (related videos, history, small screens). */
export const VideoRow = memo(function VideoRow({
  v,
  progress,
  action,
}: {
  v: VideoItem;
  progress?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="group relative flex gap-3">
      <a href={routeToPath(`watch:${v.id}`)} data-nav="true" className="focus-ring w-40 shrink-0 rounded-xl sm:w-44" aria-label={v.title}>
        <Thumb v={v} progress={progress} className="rounded-xl" />
      </a>
      <div className="min-w-0 flex-1 py-0.5">
        <a href={routeToPath(`watch:${v.id}`)} data-nav="true" className="line-clamp-2 text-[13.5px] leading-snug font-bold text-ink">
          {v.title}
        </a>
        <p className="mt-1 truncate text-xs text-ink3">{v.author}</p>
        <p className="truncate text-xs text-ink3">{metaLine(v)}</p>
      </div>
      {action}
    </div>
  );
});

export function ChannelRow({ c }: { c: ChannelItem }) {
  return (
    <a
      href={routeToPath(`channel:${c.id}`)}
      data-nav="true"
      className="focus-ring flex items-center gap-4 rounded-2xl p-2 transition hover:bg-ink/[0.05]"
    >
      <span className="flex w-40 shrink-0 justify-center sm:w-44">
        <Avatar name={c.name} src={c.avatar} className="h-20 w-20 text-lg" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold text-ink">{c.name}</span>
        {c.subscribers && <span className="block truncate text-xs text-ink3">{c.subscribers}</span>}
        <span className="mt-1 inline-block rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-semibold text-ink2">Channel</span>
      </span>
    </a>
  );
}

export function VideoGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-4 gap-y-7 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4", className)}>
      {children}
    </div>
  );
}

export function VideoGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <VideoGrid>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton aspect-video w-full rounded-2xl" />
          <div className="mt-2.5 flex gap-2.5">
            <div className="skeleton h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="skeleton h-3.5 w-11/12 rounded-full" />
              <div className="skeleton h-3 w-2/3 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </VideoGrid>
  );
}

export function VideoRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-3">
          <div className="skeleton aspect-video w-40 shrink-0 rounded-xl sm:w-44" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="skeleton h-3.5 w-11/12 rounded-full" />
            <div className="skeleton h-3 w-1/2 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export { Clock };
