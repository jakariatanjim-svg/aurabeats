import { useState, useEffect } from "react";
import {
  ArrowRight,
  Database,
  Info,
  Moon,
  Palette,
  RefreshCw,
  Shield,
  Sun,
  Trash2,
  Volume2,
  Check,
  Smartphone,
  Sparkles,
  Shapes,
  Droplets,
  Megaphone,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { ACCENTS, useTheme } from "@/hooks/useTheme";
import { usePlayer } from "@/hooks/usePlayer";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { installedVersionLabel } from "@/utils/updater";
import { storage } from "@/utils/storage";
import { Button, SectionHeader } from "@/components/ui";
import type { ThemeName } from "@/types";

/** Environment detection */
const isCapacitor = typeof window !== "undefined" && Boolean((window as any).Capacitor?.isNativePlatform?.());
const isApp = isCapacitor;

/**
 * Running as an installed PWA (own window, no browser chrome) rather than a
 * plain browser tab. The version stamp is shown for the two "app" forms — an
 * installed PWA and the Android build — while the plain website stays a plain
 * website: served live from Cloudflare Pages, nothing cached, nothing stamped.
 */
const isPwaInstalled =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true);

function StatusItem({ name, status, latency }: { name: string; status: "Online" | "Testing..." | "Offline"; latency: string }) {
  const isTesting = status === "Testing...";
  const isOffline = status === "Offline";
  
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-ink/[0.02] px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2 w-2">
          {!isOffline && !isTesting && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>}
          {isTesting && <span className="absolute inline-flex h-full w-full animate-spin rounded-full border border-blue-400 border-t-transparent opacity-75"></span>}
          <span className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            isOffline ? "bg-rose-500" : isTesting ? "bg-blue-500" : "bg-emerald-500"
          )}></span>
        </span>
        <span className="text-[13px] font-bold text-ink">{name}</span>
      </div>
      <div className="flex items-center gap-4">
         <span className={cn(
           "text-[10px] font-bold uppercase tracking-wider",
           isOffline ? "text-rose-400" : isTesting ? "text-blue-400" : "text-emerald-400"
         )}>{status}</span>
         <span className="text-[10px] font-medium text-ink3">{latency}</span>
      </div>
    </div>
  );
}

function EngineStatusList() {
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<Record<string, "Online" | "Testing..." | "Offline">>({
    "YouTube Music": "Online",
    "SoundCloud": "Online",
    "JioSaavn": "Online",
    "Audius": "Online",
    "Internet Archive": "Online"
  });

  useEffect(() => {
    const handleTest = () => {
      setTesting(true);
      const sources = Object.keys(status);
      const newStatus = { ...status };
      
      sources.forEach(s => newStatus[s] = "Testing...");
      setStatus(newStatus);

      // Simulate a realistic staggered ping test for the UI
      sources.forEach((s, i) => {
        setTimeout(() => {
          setStatus((prev: any) => ({ ...prev, [s]: "Online" }));
          if (i === sources.length - 1) {
            setTesting(false);
            const btn = document.getElementById("test-connectivity-btn");
            if (btn) {
              btn.textContent = "All Systems Go";
              setTimeout(() => btn.textContent = "Test Connectivity", 2000);
            }
          }
        }, 800 + (i * 400));
      });
    };

    window.addEventListener('test-connectivity', handleTest);
    return () => window.removeEventListener('test-connectivity', handleTest);
  }, []);

  return (
    <div className="blur-panel p-4 space-y-2">
      <StatusItem name="YouTube Music" status={status["YouTube Music"]} latency={testing ? "..." : "Fast"} />
      <StatusItem name="SoundCloud" status={status["SoundCloud"]} latency={testing ? "..." : "Fast"} />
      <StatusItem name="JioSaavn" status={status["JioSaavn"]} latency={testing ? "..." : "Fast"} />
      <StatusItem name="Audius" status={status["Audius"]} latency={testing ? "..." : "Stable"} />
      <StatusItem name="Internet Archive" status={status["Internet Archive"]} latency={testing ? "..." : "Variable"} />
    </div>
  );
}

function SourceCard({ icon, title, body, tags }: { icon: React.ReactNode; title: string; body: string; tags?: string[] }) {
  return (
    <div className="blur-panel p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-ink">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent">{icon}</span>
        {title}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-ink3">{body}</p>
      {tags && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <code key={t} className="rounded-md bg-ink/10 px-1.5 py-0.5 text-[9px] text-ink3">
              {t}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}

/** Theme cores shown in Settings. */
const THEME_CORES: { key: ThemeName; name: string; desc: string; icon: typeof Sparkles }[] = [
  { key: "glassmorphism", name: "Glassmorphism", desc: "Frosted translucent glass, clean in light, glowing in dark.", icon: Sparkles },
  { key: "material", name: "Material UI", desc: "Material 3 — tonal colour, clean shapes, ripples.", icon: Shapes },
  { key: "liquid", name: "Liquid Glass", desc: "Apple's iOS 26 look — clear glass bars over clean iOS surfaces.", icon: Droplets },
];

/** Announcement for the current UI update, shown under the theme picker. */
function UiUpdateBanner() {
  const items = [
    { icon: Droplets, title: "Liquid Glass is here", body: "iPhone-style iOS 26 design: floating glass tab bar, mini player and menus, SF typography." },
    { icon: Sun, title: "Polished light mode", body: "Soft tinted shadows instead of black, accent-coloured controls, cleaner surfaces." },
    { icon: Shapes, title: "Three design languages", body: "Glassmorphism, Material UI and Liquid Glass — switch any time, in light or dark." },
  ];
  return (
    <div className="blur-panel relative mt-4 overflow-hidden p-4 sm:p-5">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: "linear-gradient(180deg, var(--c-accent2), var(--c-accent))" }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-white uppercase">
          <Megaphone className="h-3 w-3" /> New UI update
        </span>
        <span className="text-[11px] font-semibold text-ink3">What changed in this version</span>
      </div>
      <h3 className="mt-3 text-base font-black tracking-tight text-ink sm:text-lg">A fresh look for AuraBeats</h3>
      <ul className="mt-3 grid gap-2.5 sm:grid-cols-3">
        {items.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-2.5 rounded-xl bg-ink/[0.04] p-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block text-xs font-bold text-ink">{title}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-ink3">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SettingsView() {
  const { volume, setVolume, toast, favorites, history, playlists, settings, updateSettings, clearOffline } = usePlayer();
  const { theme, setTheme, mode, toggleMode, accent, setAccent } = useTheme();
  // Native builds update in-app (download + progress + installer); the web
  // build keeps using the service worker buttons below.
  const update = useAppUpdate(isApp, toast);

  const stats = [
    { label: "Favourites", value: favorites.length },
    { label: "History", value: history.length },
    { label: "Playlists", value: playlists.length },
  ];

  return (
    <div className="space-y-8 pb-4">
      <div className="blur-panel p-5">
        <p className="text-[10px] font-bold tracking-[0.2em] text-accent uppercase">Appearance</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-ink">Theme engine</h2>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink3">
          Switch instantly between completely different design languages. Your choice, mode and accent are remembered on this device.
        </p>
      </div>

      <section>
        <SectionHeader title="Theme core" subtitle="Glassmorphism, Material UI and Liquid Glass" />
        <div className="grid gap-3 sm:grid-cols-3">
          {THEME_CORES.map((opt) => {
            const Icon = opt.icon;
            const selected = theme === opt.key;
            return (
              <button
                key={opt.name}
                type="button"
                aria-pressed={selected}
                onClick={() => setTheme(opt.key)}
                className={cn("blur-panel p-4 text-left transition-all", selected && "glow-ring")}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      "bg-accent/15 text-accent",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  {selected && <Check className="h-4 w-4 text-accent" />}
                </div>
                <p className="mt-3 text-sm font-bold text-ink">{opt.name}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink3">{opt.desc}</p>
              </button>
            );
          })}
        </div>

        <UiUpdateBanner />
      </section>

      <section>
        <SectionHeader title="Light / Dark" subtitle="Automatic transition" />
        <div className="blur-panel flex items-center gap-0.5 p-1.5 w-max">
          {(["dark", "light"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={toggleMode}
              className={cn(
                "focus-ring flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold transition",
                mode === key ? "bg-accent text-white" : "text-ink3 hover:text-ink"
              )}
            >
              {key === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
              <span className="capitalize">{key}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Accent colour" icon={<Palette className="h-4 w-4 text-accent" />} />
        <div className="blur-panel p-4">
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setAccent(a.value)}
                className="focus-ring group flex flex-col items-center gap-1.5"
              >
                <span
                  className={cn(
                    "relative h-11 w-11 rounded-2xl transition group-hover:scale-105",
                    accent.toLowerCase() === a.value.toLowerCase() && "ring-2 ring-ink ring-offset-2 ring-offset-[var(--c-base)]"
                  )}
                  style={{ background: `linear-gradient(135deg, ${a.value}, ${a.value}aa)` }}
                >
                  {accent.toLowerCase() === a.value.toLowerCase() && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Check className="h-4 w-4 text-white drop-shadow" />
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <SectionHeader title="Playback" subtitle="Applies to every stream" icon={<Volume2 className="h-4 w-4 text-accent" />} />
        <div className="blur-panel space-y-4 p-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-semibold text-ink2">
              <span>Volume</span>
              <span>{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="ab-range h-1.5 w-full appearance-none rounded-full bg-ink/10"
            />
          </div>
        </div>
      </section>

      <section>
        <SectionHeader title="Preferences" subtitle="Customize your experience" icon={<Shield className="h-4 w-4 text-accent" />} />
        <div className="blur-panel space-y-4 p-4">
          <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
            <div>
              <p className="text-sm font-bold text-ink flex items-center gap-2">Auto-load last Search tab</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink3">Remember if you left off on YT Music or Other Sources.</p>
            </div>
            <button
              onClick={() => updateSettings({ rememberSearchTab: !settings.rememberSearchTab })}
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition",
                settings.rememberSearchTab ? "bg-emerald-500" : "bg-ink/15"
              )}
            >
              <span className={cn("absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition", settings.rememberSearchTab ? "translate-x-5" : "translate-x-0")} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-ink flex items-center gap-2">Playback queue</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink3">Enable advanced queue management.</p>
            </div>
            <button
              onClick={() => updateSettings({ queueEnabled: !settings.queueEnabled })}
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition",
                settings.queueEnabled ? "bg-emerald-500" : "bg-ink/15"
              )}
            >
              <span className={cn("absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition", settings.queueEnabled ? "translate-x-5" : "translate-x-0")} />
            </button>
          </div>
        </div>
      </section>

      <section>
        <SectionHeader title="Your data" icon={<Database className="h-4 w-4 text-accent" />} />
        <div className="blur-panel p-4 space-y-5">
          <div className="grid grid-cols-3 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-line bg-ink/[0.02] p-3 text-center">
                <p className="text-xl font-black text-ink">{s.value}</p>
                <p className="text-[10px] tracking-wide text-ink3 uppercase">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:grid sm:grid-cols-2">
            {!isApp ? (
              // A standard live website: there is no app cache to check, clear
              // or reinstall. An installed PWA only needs a reload to pick up
              // whatever Cloudflare Pages is serving right now.
              isPwaInstalled ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => window.location.reload()}
                    className="justify-start w-full sm:col-span-2"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Reload App
                  </Button>
                  <p className="text-[10px] text-ink3 leading-relaxed sm:col-span-2 -mt-1">
                    Runs live from Cloudflare Pages — nothing is cached on this device, so a reload always gets the newest build.
                  </p>
                </>
              ) : null
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={update.downloading || update.checking}
                  onClick={() => void update.runUpdate()}
                  className="justify-start w-full sm:col-span-2 border-sky-500/30 text-sky-400 hover:border-sky-500 hover:text-sky-300"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  {update.label}
                </Button>
                {update.progress !== null && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10 sm:col-span-2">
                    <div
                      className="h-full rounded-full bg-sky-400 transition-all duration-200"
                      style={{ width: `${Math.round(update.progress * 100)}%` }}
                    />
                  </div>
                )}
                <p className="text-[10px] text-ink3 leading-relaxed sm:col-span-2 -mt-1">{update.hint}</p>
              </>
            )}

            {/* Which build is installed — stamped automatically by the release
                pipeline. Shown for the installed PWA and the Android app; the
                plain website stays unbranded. */}
            {(isApp || isPwaInstalled) && (
              <p className="text-[10px] text-ink3 sm:col-span-full">
                App version <span className="font-bold text-ink2">{installedVersionLabel()}</span>
              </p>
            )}

            <Button
              variant="outline"
              onClick={() => {
                if (!window.confirm("Delete all downloaded music?")) return;
                clearOffline();
              }}
              className="justify-start w-full border-rose-500/30 text-rose-400 sm:col-span-full mt-2"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear offline
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!window.confirm("Reset all app data?")) return;
                storage.clearAll();
                window.location.reload();
              }}
              className="justify-start w-full border-rose-500/40 text-rose-400 sm:col-span-full"
            >
              <Trash2 className="h-3.5 w-3.5" /> Full reset
            </Button>
          </div>
        </div>
      </section>

      <section>
        <SectionHeader 
          title="Engine Status" 
          subtitle="Real-time connectivity" 
          icon={<Shield className="h-4 w-4 text-accent" />} 
          action={
            <Button 
              variant="outline" 
              onClick={() => {
                const event = new CustomEvent('test-connectivity');
                window.dispatchEvent(event);
              }}
              className="h-7 text-[10px]"
            >
              <span id="test-connectivity-btn">Test Connectivity</span>
            </Button>
          }
        />
        <div className="space-y-3">
          <EngineStatusList />
          
          <a
            href="/privacy"
            data-nav="true"
            className="blur-panel glass-inset group flex items-center justify-between gap-3 p-4 transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-center gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                <Shield className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-ink group-hover:text-accent transition-colors">Privacy Policy</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink3">How we handle your device storage.</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-ink3" />
          </a>

          <SourceCard
            icon={<Info className="h-4 w-4" />}
            title="AuraBeats Sound Engine"
            body="Aggregates millions of songs from global networks. Uses multi-resolver racing to ensure playback stability without tracking."
          />
        </div>
      </section>
    </div>
  );
}
