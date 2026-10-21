import {
  ArrowRight,
  Check,
  Droplets,
  GraduationCap,
  Info,
  Moon,
  Palette,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Shapes,
  Sun,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { ACCENTS, useTheme } from "@/hooks/useTheme";
import { usePlayer } from "@/hooks/usePlayer";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { installedVersionLabel } from "@/utils/updater";
import { showVolumeUi } from "@/utils/device";
import { Button, SectionHeader, Slider } from "@/components/ui";
import { openTour } from "@/components/Tutorial";
import { AccountSection } from "@/components/AccountSection";
import type { ThemeName } from "@/types";
import { VideoSettingsSection } from "@/components/video/VideoSettingsSection";
import { HistorySection } from "@/components/HistorySection";
import { DangerZone, DataSection, Switch } from "@/components/DataSection";
import { SyncSection } from "@/components/SyncSection";

/** Environment detection */
const isCapacitor = typeof window !== "undefined" && Boolean((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
const isApp = isCapacitor;

/**
 * Running as an installed PWA (own window, no browser chrome) rather than a
 * plain browser tab. The version stamp is shown for the two "app" forms — an
 * installed PWA and the Android build — while the plain website stays a plain
 * website.
 */
const isPwaInstalled =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true);

/** Theme cores shown in Settings. */
const THEME_CORES: { key: ThemeName; name: string; desc: string; icon: typeof Sparkles }[] = [
  { key: "glassmorphism", name: "Glassmorphism", desc: "Frosted glass", icon: Sparkles },
  { key: "material", name: "Material UI", desc: "Material 3", icon: Shapes },
  { key: "liquid", name: "Liquid Glass", desc: "iOS 26 style", icon: Droplets },
];

/**
 * Settings: only things you can change. Explanations, the privacy policy and
 * how the app works live on the About page.
 */
export function SettingsView() {
  const { volume, setVolume, toast, settings, updateSettings } = usePlayer();
  const { theme, setTheme, mode, toggleMode, accent, setAccent } = useTheme();
  // Native builds update in-app (download + progress + installer).
  const update = useAppUpdate(isApp, toast);

  return (
    <div className="mx-auto max-w-3xl space-y-7 pb-4">
      <section>
        <SectionHeader title="Appearance" icon={<Palette className="h-4 w-4 text-accent" />} />
        <div className="blur-panel space-y-4 p-4">
          <div className="grid grid-cols-3 gap-2">
            {THEME_CORES.map((opt) => {
              const Icon = opt.icon;
              const selected = theme === opt.key;
              return (
                <button
                  key={opt.name}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTheme(opt.key)}
                  className={cn(
                    "relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition active:scale-[0.98]",
                    selected ? "border-accent bg-accent/10" : "border-line bg-ink/[0.02] hover:border-accent/50",
                  )}
                >
                  {selected && <Check className="absolute top-2 right-2 h-3.5 w-3.5 text-accent" />}
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-[12px] leading-tight font-bold text-ink">{opt.name}</span>
                  <span className="hidden text-[10px] text-ink3 sm:block">{opt.desc}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-bold text-ink">Mode</p>
            <div className="flex items-center gap-0.5 rounded-full border border-line p-1">
              {(["dark", "light"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => mode !== key && toggleMode()}
                  className={cn(
                    "focus-ring flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition",
                    mode === key ? "bg-accent text-white" : "text-ink3 hover:text-ink",
                  )}
                >
                  {key === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                  <span className="capitalize">{key}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2.5 text-[13px] font-bold text-ink">Accent colour</p>
            <div className="flex flex-wrap gap-2.5">
              {ACCENTS.map((a) => {
                const on = accent.toLowerCase() === a.value.toLowerCase();
                return (
                  <button
                    key={a.value}
                    type="button"
                    aria-label={`Accent ${a.value}`}
                    aria-pressed={on}
                    onClick={() => setAccent(a.value)}
                    className={cn(
                      "focus-ring relative h-9 w-9 rounded-full transition hover:scale-105",
                      on && "ring-2 ring-ink ring-offset-2 ring-offset-[var(--c-base)]",
                    )}
                    style={{ background: `linear-gradient(135deg, ${a.value}, ${a.value}aa)` }}
                  >
                    {on && <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionHeader title="Playback" icon={<SlidersHorizontal className="h-4 w-4 text-accent" />} />
        <div className="blur-panel space-y-4 p-4">
          {showVolumeUi && (
            <div className="border-b border-line pb-4">
              <div className="mb-2 flex items-center justify-between text-[13px] font-bold text-ink">
                <span>Volume</span>
                <span className="text-xs font-semibold text-ink3 tabular-nums">{Math.round(volume * 100)}%</span>
              </div>
              <Slider ariaLabel="Volume" value={volume * 100} max={100} onChange={(v) => setVolume(v / 100)} />
            </div>
          )}
          <SettingRow title="Playback queue" hint="Play next, add to queue">
            <Switch on={settings.queueEnabled} label="Playback queue" onClick={() => updateSettings({ queueEnabled: !settings.queueEnabled })} />
          </SettingRow>
          <SettingRow title="Remember search tab" hint="YT Music or Other Sources" last>
            <Switch on={settings.rememberSearchTab} label="Remember search tab" onClick={() => updateSettings({ rememberSearchTab: !settings.rememberSearchTab })} />
          </SettingRow>
        </div>
      </section>

      <VideoSettingsSection />

      <HistorySection />

      <DataSection />

      <SyncSection />

      {(isApp || isPwaInstalled) && (
        <section>
          <SectionHeader title="App" icon={<Smartphone className="h-4 w-4 text-accent" />} />
          <div className="blur-panel space-y-3 p-4">
            {isApp ? (
              <>
                <Button
                  variant="outline"
                  disabled={update.downloading || update.checking}
                  onClick={() => void update.runUpdate()}
                  className="w-full justify-start border-sky-500/30 text-sky-400 hover:border-sky-500 hover:text-sky-300"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  {update.label}
                </Button>
                {update.progress !== null && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                    <div className="h-full rounded-full bg-sky-400 transition-all duration-200" style={{ width: `${Math.round(update.progress * 100)}%` }} />
                  </div>
                )}
                {update.hint && <p className="text-[10px] leading-relaxed text-ink3">{update.hint}</p>}
              </>
            ) : (
              <Button variant="outline" onClick={() => window.location.reload()} className="w-full justify-start">
                <RefreshCw className="h-3.5 w-3.5" /> Reload app
              </Button>
            )}
            <p className="text-[11px] text-ink3">
              Version <span className="font-bold text-ink2">{installedVersionLabel()}</span>
            </p>
          </div>
        </section>
      )}

      <AccountSection />

      <button
        type="button"
        onClick={openTour}
        className="blur-panel group flex w-full items-center gap-3 p-4 text-left transition-transform hover:-translate-y-0.5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <GraduationCap className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-ink transition-colors group-hover:text-accent">Watch the tour</span>
          <span className="block truncate text-[11px] text-ink3">Where everything is and how to use it</span>
        </span>
        <Play className="h-4 w-4 text-ink3" />
      </button>

      <a
        href="/about"
        data-nav="true"
        className="blur-panel group flex items-center gap-3 p-4 transition-transform hover:-translate-y-0.5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Info className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-ink transition-colors group-hover:text-accent">About AuraBeats</span>
          <span className="block truncate text-[11px] text-ink3">How it works, sources, privacy policy</span>
        </span>
        <ArrowRight className="h-4 w-4 text-ink3" />
      </a>

      <DangerZone />
    </div>
  );
}

function SettingRow({ title, hint, last, children }: { title: string; hint?: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-4", !last && "border-b border-line pb-4")}>
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-ink">{title}</p>
        {hint && <p className="mt-0.5 text-[11px] text-ink3">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
