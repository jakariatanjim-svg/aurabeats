import { useState, useSyncExternalStore } from "react";
import { ShieldCheck, Tv } from "lucide-react";
import { cn } from "@/utils/cn";
import { SectionHeader } from "@/components/ui";
import { appEnv, playbackMethodLabel } from "@/services/video/net";
import { getVideoSettings, setVideoSettings, subscribeVideoSettings } from "@/services/video/settings";

const QUALITIES: { value: "auto" | number; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: 2160, label: "4K" },
  { value: 1440, label: "1440p" },
  { value: 1080, label: "1080p" },
  { value: 720, label: "720p" },
  { value: 480, label: "480p" },
  { value: 360, label: "360p" },
];

export function VideoSettingsSection() {
  const s = useSyncExternalStore(subscribeVideoSettings, getVideoSettings, getVideoSettings);
  const [server, setServer] = useState(s.customServer);

  return (
    <section>
      <SectionHeader title="Video" subtitle="Ad-free YouTube" icon={<Tv className="h-4 w-4 text-accent" />} />
      <div className="blur-panel space-y-4 p-4">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink3">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <span>
            Playback on this device: <b className="text-ink">{playbackMethodLabel()}</b>.{" "}
            {appEnv === "apk"
              ? "The app fetches streams straight from YouTube, like NewPipe. If that fails it switches to ad-free servers."
              : "The browser can't talk to YouTube directly, so streams come through public ad-free servers (Invidious / Piped) with automatic failover. For the fastest, most reliable playback use the Android app."}
          </span>
        </p>

        <div className="border-b border-line pb-4">
          <p className="text-sm font-bold text-ink">Default quality</p>
          <p className="mt-0.5 mb-2.5 text-[11px] text-ink3">Auto picks the best fit for your screen and connection (up to 1080p).</p>
          <div className="flex flex-wrap gap-1.5">
            {QUALITIES.map((q) => (
              <button
                key={String(q.value)}
                type="button"
                onClick={() => setVideoSettings({ quality: q.value })}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  s.quality === q.value ? "border-transparent bg-accent text-white" : "border-line text-ink2 hover:border-accent/60",
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-sm font-bold text-ink">Autoplay next video</p>
            <p className="mt-0.5 text-[11px] text-ink3">Play the first suggestion when a video ends.</p>
          </div>
          <button
            type="button"
            aria-pressed={s.autoplayNext}
            onClick={() => setVideoSettings({ autoplayNext: !s.autoplayNext })}
            className={cn("relative h-6 w-11 shrink-0 rounded-full transition", s.autoplayNext ? "bg-emerald-500" : "bg-ink/15")}
          >
            <span
              className={cn(
                "absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition",
                s.autoplayNext ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setVideoSettings({ customServer: server.trim() });
          }}
        >
          <p className="text-sm font-bold text-ink">Custom server (optional)</p>
          <p className="mt-0.5 mb-2.5 text-[11px] text-ink3">
            Your own Invidious URL or Piped API URL. It's tried first. Leave empty for automatic servers.
          </p>
          <div className="flex gap-2">
            <input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="https://invidious.example.com"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-line bg-ink/[0.03] px-3 py-2 text-sm text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
            <button type="submit" className="rounded-xl bg-accent px-4 text-xs font-bold text-white">
              {server.trim() === s.customServer ? "Saved" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
