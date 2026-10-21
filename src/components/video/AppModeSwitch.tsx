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
  session.set(LAST[mode], route);
}

export function lastRouteFor(mode: AppMode): RouteKey {
  const r = session.get<RouteKey | null>(LAST[mode], null);
  if (r && !isSharedRoute(r) && isVideoRoute(r) === (mode === "video")) return r;
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
  return (
    <div
      role="tablist"
      aria-label="Music or video"
      data-tour="mode"
      className={cn("ab-seg blur-panel flex gap-0.5 p-1", vertical ? "flex-col" : "items-center", className)}
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
          onClick={() => (active && !shared ? undefined : onNavigate(lastRouteFor(mode)))}
          className={cn(
            "focus-ring flex flex-1 items-center justify-center gap-1.5 text-xs font-bold transition-all",
            vertical ? "rounded-xl" : "rounded-full",
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
