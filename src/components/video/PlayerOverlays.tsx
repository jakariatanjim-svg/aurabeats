/**
 * Shown over the picture by both players: the creator's end-screen
 * suggestions (last seconds of the video) and the info cards behind the "i"
 * button, with their short teaser when a card comes up. Positions follow
 * YouTube's (fractions of the picture), so they sit where the creator put them.
 */
import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { routeToPath } from "@/routes";
import { useVideoExtras, type EndItem, type InfoCard } from "./videoExtras";

function hrefOf(x: { kind: string; target: string; playlist?: string }): { href: string; app: boolean } {
  if (x.kind === "video" || (x.kind === "playlist" && x.target)) return { href: routeToPath(`watch:${x.target}`), app: true };
  if (x.kind === "channel") return { href: routeToPath(`channel:${x.target}`), app: true };
  if (x.kind === "playlist" && x.playlist) return { href: `https://www.youtube.com/playlist?list=${x.playlist}`, app: false };
  return { href: x.target, app: false };
}

function Link({
  x,
  className,
  style,
  children,
  onClick,
}: {
  x: EndItem | InfoCard;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const { href, app } = hrefOf(x);
  return (
    <a
      href={href}
      {...(app ? { "data-nav": "true" } : { target: "_blank", rel: "noreferrer" })}
      title={x.title}
      // (no stopPropagation here: the app's link handler listens on the page)
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        onClick?.();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      className={className}
      style={style}
    >
      {children}
    </a>
  );
}

export function PlayerOverlays({ id, time, hidden, controlsShown }: { id: string; time: number; hidden?: boolean; controlsShown?: boolean }) {
  const { ends, cards } = useVideoExtras(id);
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState<InfoCard | null>(null);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    setOpen(false);
    setTeaser(null);
    setSeen(new Set());
  }, [id]);

  // a card's teaser shows for a few seconds when its moment comes
  useEffect(() => {
    const i = cards.findIndex((c, k) => !seen.has(k) && time >= c.at && time < c.at + 2);
    if (i === -1) return;
    setSeen((s) => new Set(s).add(i));
    setTeaser(cards[i]);
  }, [time, cards, seen]);
  useEffect(() => {
    if (!teaser) return;
    const t = setTimeout(() => setTeaser(null), 6000);
    return () => clearTimeout(t);
  }, [teaser]);

  if (hidden) return null;
  const live = ends.filter((e) => time >= e.start && time < e.end);

  return (
    <>
      {live.length > 0 && (
        <div className="pointer-events-none absolute inset-0">
          {live.map((e, i) => (
            <Link
              key={i}
              x={e}
              style={{ left: `${e.left * 100}%`, top: `${e.top * 100}%`, width: `${e.width * 100}%`, aspectRatio: String(e.aspect) }}
              className={cn(
                "group/end pointer-events-auto absolute block animate-fade-in overflow-hidden bg-black/60 shadow-lg ring-1 ring-white/20 transition hover:ring-2 hover:ring-white",
                e.kind === "channel" ? "rounded-full" : "rounded-lg",
              )}
            >
              {e.image && <img src={e.image} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
              {e.kind !== "channel" && (
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pt-4 pb-1 text-[11px] leading-tight font-bold text-white opacity-0 transition group-hover/end:opacity-100">
                  <span className="line-clamp-2">{e.title}</span>
                  {e.meta && <span className="block truncate font-medium text-white/70">{e.meta}</span>}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {cards.length > 0 && (
        <div className={cn("absolute top-2 right-2 z-[5] flex items-center gap-2 transition-opacity sm:top-3 sm:right-3", !controlsShown && !teaser && !open && "opacity-0")}>
          {teaser && !open && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={() => setOpen(true)}
              className="max-w-56 animate-fade-in truncate rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold text-white"
            >
              {teaser.teaser || teaser.title}
            </button>
          )}
          <button
            type="button"
            aria-label="Info cards"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={() => setOpen((o) => !o)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            {open ? <X className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </button>
        </div>
      )}

      {open && cards.length > 0 && (
        <div
          className="absolute top-12 right-2 z-[5] max-h-[70%] w-64 animate-fade-in space-y-1 overflow-y-auto rounded-xl bg-black/85 p-2 text-white shadow-2xl sm:right-3"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          {cards.map((c, i) => (
            <Link key={i} x={c} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-white/10">
              {c.image && (
                <img src={c.image} alt="" referrerPolicy="no-referrer" className={cn("h-10 shrink-0 object-cover", c.kind === "channel" ? "w-10 rounded-full" : "w-16 rounded-md")} />
              )}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-xs font-bold">{c.title}</span>
                {c.meta && <span className="block truncate text-[11px] text-white/60">{c.meta}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
