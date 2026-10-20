import { Floating } from "@/components/Floating";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Droplets, Moon, Palette, Settings, Shapes, Sparkles, Sun, Wifi } from "lucide-react";
import { cn } from "@/utils/cn";
import { ACCENTS, useTheme } from "@/hooks/useTheme";
import { isVideoRoute, routeLabel, type RouteKey } from "@/routes";
import { AppModeSwitch, modeOf } from "@/components/video/AppModeSwitch";
import { TopSearch, usePcSearch } from "@/components/TopSearch";
import { useUrlQuery } from "@/utils/searchNav";
import { isNative, playbackMethodLabel } from "@/services/video/net";
import { IconButton, WaveformLogo } from "@/components/ui";
import { usePlayer } from "@/hooks/usePlayer";

function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={cn("ab-seg blur-panel flex items-center gap-0.5 p-1", className)}>
      {(
        [
          { key: "glassmorphism", label: "Glassmorphism", icon: Sparkles },
          { key: "material", label: "Material UI", icon: Shapes },
          { key: "liquid", label: "Liquid Glass", icon: Droplets },
        ] as const
      ).map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => setTheme(key)}
          title={label}
          aria-pressed={theme === key}
          className={cn(
            "focus-ring flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-bold transition-all duration-200 sm:px-3 sm:text-[11px]",
            theme === key ? "bg-accent text-white shadow-[0_4px_18px_-6px_var(--glow)]" : "text-ink3 hover:text-ink",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className={cn("hidden", theme === key ? "lg:inline" : "2xl:inline")}>{label}</span>
        </button>
      ))}
    </div>
  );
}

function ModeSwitch() {
  const { mode, toggleMode } = useTheme();
  return (
    <IconButton onClick={toggleMode} aria-label="Toggle light / dark" className="border border-line">
      {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </IconButton>
  );
}

function AccentPicker() {
  const { accent, setAccent } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <IconButton onClick={() => setOpen((v) => !v)} aria-label="Accent colour" className="border border-line">
        <span
          className="h-4 w-4 rounded-full"
          style={{ background: "linear-gradient(135deg, var(--c-accent2), var(--c-accent))" }}
        />
      </IconButton>
      {open && (
        <Floating anchor={wrapRef} align="right" layerRef={popRef}>
        <div className="blur-panel surface-raised w-[15rem] animate-scale-in p-3.5 shadow-2xl">
          <p className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] text-ink3 uppercase">
            <Palette className="h-3 w-3" /> Accent colour
          </p>
          <div className="grid grid-cols-4 gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                type="button"
                title={a.name}
                onClick={() => setAccent(a.value)}
                className={cn(
                  "focus-ring relative flex h-9 items-center justify-center rounded-xl transition-transform hover:scale-105",
                  accent.toLowerCase() === a.value.toLowerCase() && "ring-2 ring-ink",
                )}
                style={{ background: `linear-gradient(135deg, ${a.value}, ${a.value}cc)` }}
              >
                {accent.toLowerCase() === a.value.toLowerCase() && <Check className="h-4 w-4 text-white drop-shadow" />}
              </button>
            ))}
          </div>
          <label className="mt-3 flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-xs text-ink2 transition hover:border-accent">
            Custom colour
            <span className="relative h-6 w-6 overflow-hidden rounded-full border border-line" style={{ background: accent }}>
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="absolute -top-2 -left-2 h-12 w-12 cursor-pointer opacity-0"
                aria-label="Custom accent colour"
              />
            </span>
          </label>
          <p className="mt-2.5 text-[10px] leading-relaxed text-ink3">
            Accents tint every control, progress bar and glow in real time.
          </p>
        </div>
        </Floating>
      )}
    </div>
  );
}

export function TopBar({
  route,
  onNavigate,
}: {
  route: RouteKey;
  onNavigate: (r: RouteKey) => void;
}) {
  const { failoverNote } = usePlayer();
  const live = route === "radio";
  const video = isVideoRoute(route);
  const mode = modeOf(route);
  const q = useUrlQuery();
  // Phone results page: the bar becomes ← + the search term (YouTube).
  const pc = usePcSearch();
  const resultsBar = !pc && (route === "search" || route === "video-search") && Boolean(q);

  return (
    <header className="ab-topbar blur-panel glass-inset sticky top-0 z-40 flex items-center gap-2.5 rounded-none! border-x-0! border-t-0! px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
      {resultsBar && (
        <IconButton onClick={() => (window.history.length > 1 ? window.history.back() : onNavigate(video ? "video" : "home"))} aria-label="Back" className="-ml-1 shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
      )}
      <button
        type="button"
        onClick={() => onNavigate(video ? "video" : "home")}
        className={cn("focus-ring flex min-w-0 shrink items-center gap-2.5 rounded-2xl md:hidden", resultsBar && "hidden")}
        aria-label="AuraBeats — go to home"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3b82f6] to-[#22d3ee] text-white shadow-[0_8px_20px_-6px_rgba(59,130,246,0.5)]">
          <WaveformLogo className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex flex-col items-start leading-tight">
          <span className="truncate text-[15px] font-black tracking-tight text-ink">AuraBeats</span>
          <span className="truncate text-[10px] font-semibold text-ink3">{routeLabel(route)}</span>
        </span>
      </button>

      <div className={cn("hidden min-w-0 flex-1", pc ? "lg:block" : "md:block", resultsBar && "md:hidden")}>
        <p
          className="w-fit max-w-full truncate text-lg font-black tracking-tight text-ink drop-shadow-sm sm:text-xl"
          data-tip={live ? "Live radio streams" : video ? `${isNative ? "Ad-free YouTube" : "YouTube"} · ${playbackMethodLabel()}` : undefined}
        >
          {routeLabel(route)}
        </p>
        {failoverNote && (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] font-medium text-accent sm:text-xs">
            <Wifi className="h-3.5 w-3.5 shrink-0" /> {failoverNote}
          </p>
        )}
      </div>

      <TopSearch mode={mode} route={route} onNavigate={onNavigate} className="flex-[1.4]" />

      <div className={cn("flex shrink-0 items-center gap-2 sm:gap-2.5", resultsBar ? "hidden" : "md:ml-auto")}>
        <AppModeSwitch route={route} onNavigate={onNavigate} compact className="md:hidden" />
        <IconButton
          onClick={() => onNavigate("settings")}
          aria-label="Open settings"
          className={cn("border border-line md:hidden", route === "settings" && "text-accent")}
        >
          <Settings className="h-4 w-4" />
        </IconButton>
        <ThemeSwitch className="hidden sm:flex" />
        <ModeSwitch />
        <AccentPicker />
      </div>
    </header>
  );
}
