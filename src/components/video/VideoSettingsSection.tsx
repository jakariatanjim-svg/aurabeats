import { useState, useSyncExternalStore } from "react";
import { Tv } from "lucide-react";
import { cn } from "@/utils/cn";
import { SectionHeader } from "@/components/ui";
import { appEnv } from "@/services/video/net";
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
      <SectionHeader title="Video" icon={<Tv className="h-4 w-4 text-accent" />} />
      <div className="blur-panel space-y-4 p-4">
        {appEnv === "apk" && (
        <div className="border-b border-line pb-4">
          <p className="text-sm font-bold text-ink">Default quality</p>
          <p className="mt-0.5 mb-2.5 text-[11px] text-ink3">Auto fits your screen and connection</p>
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
        )}

        {appEnv === "apk" && (
          <Toggle
            title="Rotate for full screen"
            hint="Turning the phone sideways opens full screen"
            on={s.rotateFullscreen}
            onChange={() => setVideoSettings({ rotateFullscreen: !s.rotateFullscreen })}
          />
        )}

        <Toggle
          title="Autoplay next video"
          hint="When a video ends"
          on={s.autoplayNext}
          onChange={() => setVideoSettings({ autoplayNext: !s.autoplayNext })}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setVideoSettings({ customServer: server.trim() });
          }}
        >
          <p className="text-sm font-bold text-ink">Custom server (optional)</p>
          <p className="mt-0.5 mb-2.5 text-[11px] text-ink3">Your own Invidious or Piped API URL, tried first</p>
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

function Toggle({ title, hint, on, onChange }: { title: string; hint: string; on: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
      <div>
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] text-ink3">{hint}</p>
      </div>
      <button
        type="button"
        aria-pressed={on}
        aria-label={title}
        onClick={onChange}
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-emerald-500" : "bg-ink/15")}
      >
        <span
          className={cn(
            "absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition",
            on ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}
