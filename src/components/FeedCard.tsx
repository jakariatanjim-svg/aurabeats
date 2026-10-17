import { useState } from "react";
import { Heart, Play } from "lucide-react";
import { cn } from "@/utils/cn";
import { formatCount, formatTime, gradientFrom, initials } from "@/utils/format";
import { usePlayer } from "@/hooks/usePlayer";
import { Equalizer } from "@/components/ui";
import { TrackMenu } from "@/components/TrackList";
import type { Track } from "@/types";

const SOURCE_LABEL: Record<string, string> = {
  youtube: "YouTube Music",
  jiosaavn: "JioSaavn",
  soundcloud: "SoundCloud",
  audius: "Audius",
  jamendo: "Jamendo",
  archive: "Internet Archive",
  radio: "Live radio",
};

/**
 * YouTube-style song card: big 16:9 thumbnail, channel avatar, title, artist
 * and plays. The whole card plays the song.
 */
export function FeedCard({ track, context }: { track: Track; context?: Track[] }) {
  const { playNow, current, isPlaying, toggle, isFavorite, toggleFavorite } = usePlayer();
  const isCurrent = current?.id === track.id;
  const fav = isFavorite(track.id);
  const [imgStage, setImgStage] = useState(0);
  const chain = [track.artworkLarge && track.source !== "youtube" ? track.artworkLarge : track.artwork, track.artworkFallback].filter(Boolean) as string[];
  const img = chain[imgStage];
  const wide = track.source === "youtube"; // YouTube thumbnails are already 16:9 video frames

  const play = () => {
    if (isCurrent) toggle();
    else playNow(track, context);
  };

  const meta = [track.playCount ? `${formatCount(track.playCount)} plays` : null, SOURCE_LABEL[track.source] ?? null]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Play ${track.title} by ${track.artist}`}
      onClick={play}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          play();
        }
      }}
      className="group focus-ring min-w-0 cursor-pointer select-none rounded-2xl"
    >
      {/* thumbnail */}
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-elev2 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.55)]">
        {img ? (
          wide ? (
            <img
              src={img}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setImgStage((s) => s + 1)}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <>
              {/* square cover art: blurred fill + the cover itself, YT Music style */}
              <img src={img} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl" />
              <img
                src={img}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setImgStage((s) => s + 1)}
                className="absolute inset-y-[8%] left-1/2 aspect-square h-[84%] -translate-x-1/2 rounded-xl object-cover shadow-xl transition-transform duration-500 group-hover:scale-[1.04]"
              />
            </>
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-3xl font-black text-white/90" style={{ backgroundImage: gradientFrom(track.title) }}>
            {initials(track.title)}
          </div>
        )}

        {/* play affordance */}
        <div className={cn(
          "absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200",
          isCurrent ? "bg-black/35" : "group-hover:bg-black/20",
        )}>
          {isCurrent ? (
            <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-md">
              <Equalizer active={isPlaying} className="text-accent2" />
              {isPlaying ? "Now playing" : "Paused"}
            </span>
          ) : (
            <span className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-white/95 text-black opacity-0 shadow-xl transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
              <Play className="h-5 w-5 translate-x-[1px] fill-current" />
            </span>
          )}
        </div>

        {track.duration > 0 && (
          <span className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
            {formatTime(track.duration)}
          </span>
        )}
      </div>

      {/* details */}
      <div className="mt-3 flex gap-3 px-0.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ backgroundImage: gradientFrom(track.artist || track.title) }}
        >
          {initials(track.artist || track.title)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={cn("line-clamp-2 text-[15px] leading-snug font-semibold", isCurrent ? "text-accent" : "text-ink")}>
            {track.title}
          </h3>
          <p className="mt-1 truncate text-[13px] text-ink2">{track.artist}</p>
          {meta && <p className="truncate text-[12px] text-ink3">{meta}</p>}
        </div>
        <div className="-mr-1 flex shrink-0 flex-col items-center" onClick={(e) => e.stopPropagation()}>
          <TrackMenu track={track} context={context} triggerClassName="text-ink3" />
          <button
            type="button"
            aria-label={fav ? "Remove from favourites" : "Add to favourites"}
            onClick={() => toggleFavorite(track)}
            className={cn(
              "focus-ring flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-ink/[0.08]",
              fav ? "text-accent" : "text-ink3 hover:text-ink",
            )}
          >
            <Heart className={cn("h-4 w-4", fav && "fill-current")} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function FeedCardSkeleton() {
  return (
    <div className="min-w-0">
      <div className="skeleton aspect-video rounded-2xl" />
      <div className="mt-3 flex gap-3">
        <div className="skeleton h-9 w-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="skeleton h-3.5 w-11/12 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
        </div>
      </div>
    </div>
  );
}
