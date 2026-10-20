import { Heart, Home, Library, Radio, Rss } from "lucide-react";
import { cn } from "@/utils/cn";
import type { RouteKey } from "@/routes";
import { modeOf } from "@/components/video/AppModeSwitch";

const ITEMS: { key: RouteKey; label: string; icon: typeof Home }[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "radio", label: "Radio", icon: Radio },
  { key: "library", label: "Library", icon: Library },
  { key: "favorites", label: "Saved", icon: Heart },
];

const VIDEO_ITEMS: { key: RouteKey; label: string; icon: typeof Home }[] = [
  { key: "video", label: "Home", icon: Home },
  { key: "video-subs", label: "Following", icon: Rss },
  { key: "video-library", label: "Library", icon: Library },
];

export function MobileNav({
  route,
  onNavigate,
  favoritesCount,
}: {
  route: RouteKey;
  onNavigate: (r: RouteKey) => void;
  favoritesCount: number;
}) {
  const mode = modeOf(route);
  const items = mode === "video" ? VIDEO_ITEMS : ITEMS;
  return (
    <nav className="ab-navbar blur-panel surface-raised fixed inset-x-0 bottom-0 z-50 border-x-0! border-b-0! pb-[calc(var(--sa-bottom)+0.35rem)] pl-[calc(var(--sa-left)+0.5rem)] pr-[calc(var(--sa-right)+0.5rem)] pt-2 md:hidden">
      <div className={cn("grid gap-1.5", items.length === 3 ? "grid-cols-3" : items.length === 4 ? "grid-cols-4" : "grid-cols-5")}>
        {items.map(({ key, label, icon: Icon }) => {
          const active = route === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              data-active={active ? "true" : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "ab-navbtn focus-ring relative flex min-h-[4.1rem] flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-semibold transition-all",
                active ? "bg-accent/14 text-accent shadow-[0_12px_28px_-20px_var(--glow)]" : "text-ink3 hover:bg-ink/[0.05] hover:text-ink",
              )}
            >
              <span className="ab-navicon relative">
                <Icon className={cn("h-[18px] w-[18px] transition-all", active ? "scale-110 text-accent" : "text-current")} />
                {key === "favorites" && favoritesCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[14px] rounded-full bg-accent px-1 text-[9px] leading-[14px] font-bold text-white">
                    {favoritesCount > 99 ? "99+" : favoritesCount}
                  </span>
                )}
              </span>
              <span className="max-w-full truncate px-1">{label}</span>
              {active && <span className="ab-navline absolute inset-x-4 top-0 h-[2px] rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
