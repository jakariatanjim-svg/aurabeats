import { Music2, Tv } from "lucide-react";
import { cn } from "@/utils/cn";
import { session, storage } from "@/utils/storage";
import { isVideoRoute, type RouteKey } from "@/routes";

const LAST = { music: "lastRoute:music", video: "lastRoute:video" } as const;
const MODE = "lastMode";
export type AppMode = "music" | "video";

/** Settings / About / Privacy belong to both modes. */
export function isSharedRoute(route: RouteKey): boolean {
  return route === "settings" || route === "about" || route === "privacy";
}

/** The mode a route belongs to; shared pages keep the mode you came from. */
export function modeOf(route: RouteKey): AppMode {
  if (isSharedRoute(route)) return storage.get<AppMode>(MODE, "music") === "video" ? "video" : "music";
  return isVideoRoute(route) ? "video" : "music";
}

/** Called by the shell on every navigation so each mode reopens where you
 *  left it — within this visit only: a fresh launch opens Music on Discover.
 *  Shared pages and search results are never remembered (an empty results
 *  page is not a place to come back to). */
export function rememberRoute(route: RouteKey) {
  if (isSharedRoute(route)) return;
  const mode: AppMode = isVideoRoute(route) ? "video" : "music";
  storage.set(MODE, mode);
  if (route === "search" || route === "video-search") return;
  // Never the watch page: switching to Video must land on a page, not reopen
  // the last video (which, swiped down, went straight back to Music — a loop).
  if (route.startsWith("watch:")) return;
  session.set(LAST[mode], route);
}

/** The tab (Music / Video) used last, across visits. */
export function lastMode(): AppMode {
  return storage.get<AppMode>(MODE, "music") === "video" ? "video" : "music";
}

export function lastRouteFor(mode: AppMode): RouteKey {
  const r = session.get<RouteKey | null>(LAST[mode], null);
  if (r && !r.startsWith("watch:") && !isSharedRoute(r) && isVideoRoute(r) === (mode === "video")) return r;
  return mode === "video" ? "video" : "home";
}

/** Music | Video segmented switch. `compact` = icons only (mobile top bar). */
export function AppModeSwitch({
  route,
  onNavigate,
  compact,
  vertical,
  className,
}: {
  route: RouteKey;
  onNavigate: (r: RouteKey) => void;
  compact?: boolean;
  vertical?: boolean;
  className?: string;
}) {
  const video = modeOf(route) === "video";
  const shared = isSharedRoute(route);
  const opts = [
    { mode: "music" as const, label: "Music", icon: Music2, active: !video },
    { mode: "video" as const, label: "Video", icon: Tv, active: video },
  ];
  const go = (mode: AppMode, active: boolean) => (active && !shared ? undefined : onNavigate(lastRouteFor(mode)));
  // collapsed sidebar: two full-size buttons, one above the other (like
  // YouTube's narrow side menu), the current one highlighted
  if (vertical) {
    return (
      <div role="tablist" aria-label="Music or video" data-tour="mode" className={cn("flex flex-col items-center gap-1.5", className)}>
        {opts.map(({ mode, label, icon: Icon, active }) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={active}
            title={label}
            data-active={active ? "true" : undefined}
            onClick={() => go(mode, active)}
            className={cn(
              "focus-ring flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-bold transition-all",
              active ? "bg-accent text-white shadow-[0_8px_22px_-12px_var(--glow)]" : "text-ink3 hover:bg-ink/[0.06] hover:text-ink",
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div
      role="tablist"
      aria-label="Music or video"
      data-tour="mode"
      className={cn("ab-seg blur-panel flex items-center gap-0.5 p-1", className)}
    >
      {opts.map(({ mode, label, icon: Icon, active }) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={active}
          title={label}
          aria-label={label}
          data-active={active ? "true" : undefined}
          onClick={() => go(mode, active)}
          className={cn(
            "focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-full text-xs font-bold transition-all",
            compact ? "h-8 w-9" : "h-9 px-3",
            active ? "bg-accent text-white shadow-[0_8px_22px_-12px_var(--glow)]" : "text-ink3 hover:bg-ink/[0.06] hover:text-ink",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {!compact && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}
