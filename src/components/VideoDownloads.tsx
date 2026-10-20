import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle2, ExternalLink, Film, Loader2, Play, X, AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui";
import { usePlayer } from "@/hooks/usePlayer";
import { cn } from "@/utils/cn";
import {
  cancelVideoDownload,
  downloadJobs,
  downloadOptions,
  openDownloadedVideo,
  openVideoSite,
  startVideoDownload,
  videoRequest,
  type DlOption,
} from "@/services/videoDownload";

const mb = (n?: number) => (n && n > 0 ? (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`) : "");

/** APK: pick a quality, the app downloads it into Download/AuraBeats. */
export function VideoDownloadSheet() {
  const req = useSyncExternalStore(videoRequest.subscribe, videoRequest.get);
  const { toast } = usePlayer();
  const [opts, setOpts] = useState<DlOption[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!req) return;
    let alive = true;
    setOpts(null);
    setErr(null);
    (async () => {
      try {
        const streams =
          req.streams?.source === "device" && req.streams.video.length
            ? req.streams
            : (await (await import("@/services/video/innertube")).devicePlayer(req.id)).streams;
        const list = downloadOptions(streams);
        if (!alive) return;
        if (!list.length) throw new Error("no downloadable formats");
        setOpts(list);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [req]);

  if (!req) return null;
  const close = () => videoRequest.close();

  return (
    <Modal open onClose={close} title="Download video">
      <p className="-mt-2 mb-3 truncate text-[13px] text-ink3">{req.title}</p>
      {err ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> Couldn't read this video in the app.
        </div>
      ) : !opts ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-ink/[0.06]" />
          ))}
        </div>
      ) : (
        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
          {opts.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                void startVideoDownload(req.id, req.title, o);
                toast(`Downloading ${o.label}…`, "info");
                close();
              }}
              className="flex w-full items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-left transition hover:border-accent hover:bg-accent/5 active:scale-[0.99]"
            >
              <Film className="h-4 w-4 shrink-0 text-accent" />
              <span className="flex-1 text-[15px] font-bold text-ink">{o.label}</span>
              <span className="text-[11px] font-semibold text-ink3 uppercase">{o.ext}</span>
              <span className="w-16 text-right text-xs tabular-nums text-ink3">{mb(o.bytes)}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          openVideoSite(req.id);
          close();
        }}
        data-tip="YouTubePrint, in the browser"
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold text-ink2 transition hover:text-accent"
      >
        <ExternalLink className="h-4 w-4" /> Download in browser
      </button>
    </Modal>
  );
}

/** Running / finished in-app downloads, bottom-right. */
export function DownloadTray() {
  const jobs = useSyncExternalStore(downloadJobs.subscribe, downloadJobs.get);
  const { toast } = usePlayer();

  // tell once when a file lands
  const told = useRef(new Set<string>());
  useEffect(() => {
    for (const j of jobs) {
      if (j.status !== "done" || told.current.has(j.id)) continue;
      told.current.add(j.id);
      toast("Saved to Download/AuraBeats", "success");
    }
  }, [jobs, toast]);

  if (!jobs.length) return null;
  return (
    <div className="pointer-events-none fixed right-3 bottom-[calc(var(--sa-bottom)+9.5rem)] z-[80] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2 sm:bottom-28">
      {jobs.slice(0, 3).map((j) => {
        const pct = j.total > 0 ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0;
        return (
          <div key={j.id} className="blur-panel surface-raised pointer-events-auto animate-fade-in rounded-2xl p-3 shadow-xl">
            <div className="flex items-center gap-2.5">
              {j.status === "done" ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              ) : j.status === "error" ? (
                <AlertCircle className="h-5 w-5 shrink-0 text-rose-400" />
              ) : (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-ink">{j.title}</p>
                <p className="text-[11px] text-ink3" data-tip={j.error}>
                  {j.label} ·{" "}
                  {j.status === "done" ? "Saved" : j.status === "error" ? "Failed" : j.status === "merging" ? "Finishing…" : `${pct}%`}
                </p>
              </div>
              {j.status === "done" && j.uri && (
                <button
                  type="button"
                  onClick={() => openDownloadedVideo(j).catch(() => toast("No app found to open the video", "error"))}
                  className="flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-[12px] font-bold text-white"
                >
                  <Play className="h-3.5 w-3.5 fill-current" /> Open
                </button>
              )}
              {j.status === "error" && (
                <button
                  type="button"
                  onClick={() => {
                    openVideoSite(j.videoId);
                    downloadJobs.dismiss(j.id);
                  }}
                  className="flex h-8 items-center gap-1 rounded-full border border-line px-3 text-[12px] font-bold text-ink2"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Browser
                </button>
              )}
              <button
                type="button"
                aria-label={j.status === "running" || j.status === "merging" ? "Cancel download" : "Dismiss"}
                onClick={() => (j.status === "running" || j.status === "merging" ? cancelVideoDownload(j.id) : downloadJobs.dismiss(j.id))}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink3 hover:bg-ink/10 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {(j.status === "running" || j.status === "merging") && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10">
                <div
                  className={cn("h-full rounded-full bg-accent transition-[width] duration-300", j.status === "merging" && "animate-pulse")}
                  style={{ width: `${j.status === "merging" ? 100 : pct}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
