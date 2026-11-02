/**
 * PC: resting the mouse on a thumbnail plays a preview inside it — muted at
 * first; the speaker turns sound on (remembered). The bar along the bottom
 * can be scrubbed. A click anywhere else opens the full player as usual.
 * Website only (the app's thumbnails are tapped, not hovered).
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { storage } from "@/utils/storage";
import { isNative } from "@/services/video/net";
import { loadYT, YTState, type YTPlayer } from "./yt";

const K_SOUND = "video:previewSound";
export const hoverPreviewOk = () => !isNative && typeof window !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches;

export function HoverPreview({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(() => storage.get<boolean>(K_SOUND, false));
  const [t, setT] = useState({ cur: 0, dur: 0 });

  useEffect(() => {
    let alive = true;
    let p: YTPlayer | null = null;
    const el = document.createElement("div");
    host.current?.appendChild(el);
    loadYT()
      .then((YT) => {
        if (!alive) return;
        p = new YT.Player(el, {
          host: "https://www.youtube-nocookie.com",
          videoId: id,
          width: "100%",
          height: "100%",
          playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0, enablejsapi: 1, origin: location.origin },
          events: {
            onReady: (e) => {
              if (!alive) return;
              player.current = e.target;
              e.target.mute();
              if (storage.get<boolean>(K_SOUND, false)) e.target.unMute();
              e.target.playVideo();
            },
            onStateChange: (e) => alive && setPlaying(e.data === YTState.PLAYING),
          },
        });
      })
      .catch(() => undefined);
    const iv = window.setInterval(() => {
      const pl = player.current;
      if (pl) setT({ cur: pl.getCurrentTime() || 0, dur: pl.getDuration() || 0 });
    }, 250);
    return () => {
      alive = false;
      window.clearInterval(iv);
      try {
        p?.destroy();
      } catch {
        /* already gone */
      }
      player.current = null;
    };
  }, [id]);

  const stop = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const toggleSound = (e: React.MouseEvent) => {
    stop(e);
    const on = !sound;
    setSound(on);
    storage.set(K_SOUND, on);
    if (on) player.current?.unMute();
    else player.current?.mute();
  };
  const seekAt = (e: RPointerEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (t.dur) player.current?.seekTo(f * t.dur, true);
  };

  return (
    <div className="absolute inset-0 animate-fade-in">
      {/* the picture stays until the video really plays */}
      <div ref={host} className={`pointer-events-none absolute inset-0 transition-opacity duration-300 [&_iframe]:h-full [&_iframe]:w-full ${playing ? "opacity-100" : "opacity-0"}`} />
      <span
        role="button"
        tabIndex={-1}
        aria-label={sound ? "Mute preview" : "Sound on"}
        onClick={toggleSound}
        className="absolute top-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
      >
        {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </span>
      {/* scrub bar */}
      <span
        role="slider"
        aria-label="Preview position"
        aria-valuemin={0}
        aria-valuemax={Math.round(t.dur)}
        aria-valuenow={Math.round(t.cur)}
        onClick={stop}
        onPointerDown={(e) => {
          stop(e);
          e.currentTarget.setPointerCapture(e.pointerId);
          seekAt(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && seekAt(e)}
        className="absolute inset-x-0 bottom-0 flex h-4 cursor-pointer items-end"
      >
        <span className="relative h-1 w-full bg-white/30">
          <span className="absolute inset-y-0 left-0 bg-red-600" style={{ width: t.dur ? `${(t.cur / t.dur) * 100}%` : "0%" }} />
        </span>
      </span>
    </div>
  );
}
