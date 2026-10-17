import { Music2, Tv } from "lucide-react";
import { cn } from "@/utils/cn";
import { storage } from "@/utils/storage";
import { isVideoRoute, type RouteKey } from "@/routes";

const LAST = { music: "lastRoute:music", video: "lastRoute:video" } as const;

/** Called by the shell on every navigation so each mode reopens where you left it. */
export function rememberRoute(route: RouteKey) {
  storage.set(isVideoRoute(route) ? LAST.video : LAST.music, route);
}

export function lastRouteFor(mode: "music" | "video"): RouteKey {
  const r = storage.get<RouteKey | null>(LAST[mode], null);
  if (r && isVideoRoute(r) === (mode === "video")) return r;
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
  const video = isVideoRoute(route);
  const opts = [
    { mode: "music" as const, label: "Music", icon: Music2, active: !video },
    { mode: "video" as const, label: "Video", icon: Tv, active: video },
  ];
  return (
    <div
      role="tablist"
      aria-label="Music or video"
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
          onClick={() => (active ? undefined : onNavigate(lastRouteFor(mode)))}
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
