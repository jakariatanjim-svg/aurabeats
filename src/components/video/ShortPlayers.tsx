/**
 * The player inside one Short. Website: YouTube's official player (no
 * controls, looping). App: the ad-free streams in a plain <video> (HLS when
 * YouTube offers it, else one file, else picture + sound kept in step).
 */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { getVideo } from "@/services/video/api";
import type { StreamSet } from "@/services/video/types";
import { attachHls } from "./hls";
import { canPlay } from "./streams";
import { loadYT, type YTPlayer } from "./yt";

export interface ShortHandle {
  toggle: () => void;
  seekBy: (s: number) => void;
}

export interface ShortPlayerProps {
  id: string;
  muted: boolean;
  /** sound was refused before a tap: playing muted */
  onMutedStart?: () => void;
  onState: (s: { playing: boolean; time: number; duration: number; failed?: string }) => void;
  ref?: Ref<ShortHandle>;
}

/* --------------------------------- website -------------------------------- */

export function EmbedShort({ id, muted, onMutedStart, onState, ref }: ShortPlayerProps) {
  const host = useRef<HTMLDivElement>(null);
  const p = useRef<YTPlayer | null>(null);
  const cb = useRef({ onState, onMutedStart });
  cb.current = { onState, onMutedStart };
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const el = document.createElement("div");
    host.current?.appendChild(el);
    loadYT()
      .then((YT) => {
        if (!alive) return;
        new YT.Player(el, {
          host: "https://www.youtube-nocookie.com",
          videoId: id,
          width: "100%",
          height: "100%",
          playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0, loop: 1, playlist: id, enablejsapi: 1, origin: window.location.origin },
          events: {
            onReady: (e) => {
              if (!alive) return;
              p.current = e.target;
              if (mutedRef.current) e.target.mute();
              else e.target.unMute();
              e.target.playVideo();
              timer = setInterval(() => {
                const pl = p.current;
                if (!pl) return;
                try {
                  cb.current.onState({ playing: pl.getPlayerState() === 1, time: pl.getCurrentTime() || 0, duration: pl.getDuration() || 0 });
                } catch {
                  /* player gone */
                }
              }, 250);
            },
            onAutoplayBlocked: () => {
              if (!alive || !p.current) return;
              p.current.mute();
              p.current.playVideo();
              cb.current.onMutedStart?.();
            },
            onError: (e) => alive && cb.current.onState({ playing: false, time: 0, duration: 0, failed: `YouTube error ${e.data}` }),
          },
        });
      })
      .catch(() => alive && cb.current.onState({ playing: false, time: 0, duration: 0, failed: "Couldn't load the YouTube player" }));
    return () => {
      alive = false;
      clearInterval(timer);
      try {
        p.current?.destroy();
      } catch {
        /* already gone */
      }
      p.current = null;
      el.remove();
    };
  }, [id]);

  useEffect(() => {
    const pl = p.current;
    if (!pl) return;
    if (muted) pl.mute();
    else pl.unMute();
  }, [muted]);

  useImperativeHandle(ref, () => ({
    toggle: () => {
      const pl = p.current;
      if (!pl) return;
      if (pl.getPlayerState() === 1) pl.pauseVideo();
      else pl.playVideo();
    },
    seekBy: (s) => {
      const pl = p.current;
      if (!pl) return;
      const d = pl.getDuration() || 0;
      pl.seekTo(Math.max(0, Math.min(d ? d - 0.3 : Infinity, (pl.getCurrentTime() || 0) + s)), true);
    },
  }));

  return <div ref={host} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />;
}

/* ----------------------------------- app ---------------------------------- */

type Pick = { hls: string } | { src: string } | { video: string; audio: string } | null;

function pickStreams(s: StreamSet): Pick {
  if (s.hls) return { hls: s.hls };
  const muxed = s.muxed.filter((m) => canPlay(m.mime)).sort((a, b) => b.height - a.height)[0];
  const video = s.video.filter((v) => canPlay(v.mime) && /avc1/.test(v.mime) && v.height <= 1920).sort((a, b) => b.height - a.height)[0] ?? s.video.filter((v) => canPlay(v.mime)).sort((a, b) => a.height - b.height)[0];
  const audio = s.audio.filter((a) => canPlay(a.mime)).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  if (video && audio && (!muxed || video.height > muxed.height)) return { video: video.url, audio: audio.url };
  if (muxed) return { src: muxed.url };
  return null;
}

export function NativeShort({ id, muted, onState, ref }: ShortPlayerProps) {
  const v = useRef<HTMLVideoElement>(null);
  const a = useRef<HTMLAudioElement>(null);
  const [pick, setPick] = useState<Pick | undefined>();
  const cb = useRef(onState);
  cb.current = onState;
  const dual = !!pick && "audio" in pick;

  useEffect(() => {
    let alive = true;
    setPick(undefined);
    getVideo(id)
      .then((d) => {
        if (!alive) return;
        const p = pickStreams(d.streams);
        setPick(p);
        if (!p) cb.current({ playing: false, time: 0, duration: 0, failed: "No playable stream" });
      })
      .catch((e: unknown) => alive && cb.current({ playing: false, time: 0, duration: 0, failed: e instanceof Error ? e.message : "Couldn't load" }));
    return () => {
      alive = false;
    };
  }, [id]);

  // attach the picked streams
  useEffect(() => {
    const el = v.current;
    if (!el || !pick) return;
    let stop = () => {};
    let alive = true;
    if ("hls" in pick) {
      attachHls(el, pick.hls, (why) => alive && cb.current({ playing: false, time: 0, duration: 0, failed: why })).then((s) => (alive ? (stop = s) : s()));
    } else {
      el.src = "src" in pick ? pick.src : pick.video;
      if (a.current && "audio" in pick) a.current.src = pick.audio;
    }
    const master = () => ("audio" in pick ? a.current : el);
    master()?.play().catch(() => {});
    if ("audio" in pick) el.play().catch(() => {});
    // keep the picture with the sound; loop both
    const timer = setInterval(() => {
      const m = master();
      if (!m) return;
      if ("audio" in pick && Math.abs(el.currentTime - m.currentTime) > 0.25) el.currentTime = m.currentTime;
      cb.current({ playing: !m.paused, time: m.currentTime, duration: Number.isFinite(m.duration) ? m.duration : 0 });
    }, 250);
    const onEnd = () => {
      const m = master();
      if (!m) return;
      m.currentTime = 0;
      el.currentTime = 0;
      void m.play();
      if ("audio" in pick) void el.play();
    };
    const endEl = master();
    endEl?.addEventListener("ended", onEnd);
    return () => {
      alive = false;
      clearInterval(timer);
      endEl?.removeEventListener("ended", onEnd);
      stop();
      el.pause();
      el.removeAttribute("src");
      a.current?.pause();
      a.current?.removeAttribute("src");
    };
  }, [pick]);

  useEffect(() => {
    if (dual) {
      if (a.current) a.current.muted = muted;
    } else if (v.current) v.current.muted = muted;
  }, [muted, dual, pick]);

  useImperativeHandle(ref, () => ({
    toggle: () => {
      const el = v.current;
      const m = dual ? a.current : el;
      if (!el || !m) return;
      if (m.paused) {
        void m.play();
        if (dual) void el.play();
      } else {
        m.pause();
        if (dual) el.pause();
      }
    },
    seekBy: (s) => {
      const el = v.current;
      const m = dual ? a.current : el;
      if (!el || !m) return;
      const t = Math.max(0, Math.min((m.duration || Infinity) - 0.3, m.currentTime + s));
      m.currentTime = t;
      if (dual) el.currentTime = t;
    },
  }));

  return (
    <>
      <video ref={v} playsInline muted={dual || muted} loop={!dual} className="absolute inset-0 h-full w-full object-contain" />
      {dual && <audio ref={a} preload="auto" />}
    </>
  );
}
