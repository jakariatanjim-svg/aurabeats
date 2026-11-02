/**
 * The player inside one Short. Website: YouTube's official player (no
 * controls, looping). App: the ad-free streams in a plain <video> (HLS when
 * YouTube offers it, else one file, else picture + sound kept in step).
 */
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { storage } from "@/utils/storage";
import { getVideo } from "@/services/video/api";
import type { StreamSet } from "@/services/video/types";
import { attachHls } from "./hls";
import { canPlay } from "./streams";
import { loadYT, qualityLabel, YT_ERRORS, YTState, type YTPlayer } from "./yt";

export interface ShortChoice {
  id: string;
  label: string;
}

/** What the ⋮ menu can change. */
export interface ShortOptions {
  qualities: ShortChoice[];
  quality: string;
  captions: ShortChoice[];
  caption: string | null;
  rates: number[];
  rate: number;
}

export interface ShortHandle {
  toggle: () => void;
  seekBy: (s: number) => void;
  options: () => ShortOptions;
  setQuality: (id: string) => void;
  setCaption: (id: string | null) => void;
  setRate: (r: number) => void;
}

export interface ShortPlayerProps {
  id: string;
  muted: boolean;
  /** sound was refused before a tap: playing muted */
  onMutedStart?: () => void;
  onState: (s: { playing: boolean; time: number; duration: number; failed?: string }) => void;
  ref?: Ref<ShortHandle>;
}

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/* --------------------------------- website -------------------------------- */

// A vertical video's width at each YouTube quality (1080p = 1080 × 1920).
const SHORT_WIDTH: Record<string, number> = { tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160 };
const Q_ORDER = ["hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny"];

export function EmbedShort({ id, muted, onMutedStart, onState, ref }: ShortPlayerProps) {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const p = useRef<YTPlayer | null>(null);
  const cb = useRef({ onState, onMutedStart });
  cb.current = { onState, onMutedStart };
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [quality, setQualityPref] = useState(() => storage.get<string>("shorts:quality", "auto"));
  const [cc, setCc] = useState<string | null>(null);
  const tracks = useRef<ShortChoice[]>([]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

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
          // no playlist / loop parameters: they turn the embed into a playlist
          // with its own previous / next buttons. Looping is done below.
          playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0, cc_load_policy: 0, enablejsapi: 1, origin: window.location.origin },
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
            onStateChange: (e) => {
              // a Short loops, like on YouTube
              if (e.data === YTState.ENDED) {
                e.target.seekTo(0, true);
                e.target.playVideo();
              }
            },
            onAutoplayBlocked: () => {
              if (!alive || !p.current) return;
              p.current.mute();
              p.current.playVideo();
              cb.current.onMutedStart?.();
            },
            onApiChange: () => {
              try {
                const list = p.current?.getOption("captions", "tracklist");
                if (Array.isArray(list)) tracks.current = (list as { languageCode: string; displayName: string }[]).map((t) => ({ id: t.languageCode, label: t.displayName }));
              } catch {
                /* no captions */
              }
            },
            onError: (e) => alive && cb.current.onState({ playing: false, time: 0, duration: 0, failed: YT_ERRORS[e.data] ?? `YouTube error ${e.data}` }),
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
    options: () => {
      const pl = p.current;
      let levels: string[] = [];
      let rates = RATES;
      let rate = 1;
      try {
        levels = (pl?.getAvailableQualityLevels() ?? []).filter((q) => SHORT_WIDTH[q]);
        rates = pl?.getAvailablePlaybackRates()?.length ? pl.getAvailablePlaybackRates() : RATES;
        rate = pl?.getPlaybackRate() || 1;
        const list = pl?.getOption("captions", "tracklist");
        if (Array.isArray(list) && list.length) tracks.current = (list as { languageCode: string; displayName: string }[]).map((t) => ({ id: t.languageCode, label: t.displayName }));
      } catch {
        /* not ready */
      }
      return {
        qualities: [{ id: "auto", label: "Auto" }, ...Q_ORDER.filter((q) => levels.includes(q)).map((q) => ({ id: q, label: qualityLabel(q) }))],
        quality,
        captions: tracks.current,
        caption: cc,
        rates,
        rate,
      };
    },
    setQuality: (q) => {
      setQualityPref(q);
      storage.set("shorts:quality", q);
      // drop what was buffered at the old size so the change shows at once
      setTimeout(() => {
        const pl = p.current;
        const t = pl?.getCurrentTime() || 0;
        if (pl && t > 0) pl.seekTo(t, true);
      }, 350);
    },
    setCaption: (lang) => {
      const pl = p.current;
      if (!pl) return;
      if (lang) {
        pl.loadModule("captions");
        pl.setOption("captions", "track", { languageCode: lang });
      } else pl.setOption("captions", "track", {});
      setCc(lang);
    },
    setRate: (r) => p.current?.setPlaybackRate(r),
  }));

  // The player is laid out twice as tall as the box and centred, so YouTube's
  // own title bar and end screens fall outside it (the picture fits the width
  // and is unaffected). It is also laid out at the chosen quality's width and
  // zoomed down to fit: YouTube picks the quality from the player's size.
  const w = size.w || 1;
  const h = size.h || 1;
  const layoutW = quality !== "auto" && SHORT_WIDTH[quality] ? SHORT_WIDTH[quality] : Math.max(w * Math.min(2, window.devicePixelRatio || 1), SHORT_WIDTH.hd720);
  const k = w / layoutW;
  const style: React.CSSProperties = { position: "absolute", left: 0, top: -h / 2 / k, width: layoutW, height: (h * 2) / k, zoom: k };

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden">
      <div ref={host} style={style} className="[&>iframe]:h-full [&>iframe]:w-full" />
    </div>
  );
}

/* ----------------------------------- app ---------------------------------- */

type Pick = { hls: string } | { src: string } | { video: string; audio: string } | null;
type Level = { height: number; pick: Exclude<Pick, null> };

/** Playable heights, best first: picture + sound files, else single files; HLS last. */
function levelsOf(s: StreamSet): Level[] {
  const audio = s.audio.filter((a) => canPlay(a.mime)).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  // the level is the label's number ("1080p"), which is right for upright videos too
  const lv = (x: { label: string; height: number }) => parseInt(x.label, 10) || x.height;
  const byH = new Map<number, Level & { avc: boolean }>();
  if (audio) {
    for (const v of s.video) {
      const h = lv(v);
      if (!h || !canPlay(v.mime)) continue;
      const avc = /avc1/.test(v.mime);
      const cur = byH.get(h);
      // H.264 first (hardware decoding on every phone)
      if (!cur || (avc && !cur.avc)) byH.set(h, { height: h, avc, pick: { video: v.url, audio: audio.url } });
    }
  }
  for (const m of s.muxed) {
    const h = lv(m);
    if (h && canPlay(m.mime) && !byH.has(h)) byH.set(h, { height: h, avc: true, pick: { src: m.url } });
  }
  const out: Level[] = [...byH.values()].sort((a, b) => b.height - a.height);
  if (!out.length && s.hls) out.push({ height: 0, pick: { hls: s.hls } });
  return out;
}

/** Auto: the best level up to 1080p (a Short fills a phone screen). */
const autoLevel = (l: Level[]) => l.find((x) => x.height <= 1080) ?? l[l.length - 1];

export function NativeShort({ id, muted, onState, ref }: ShortPlayerProps) {
  const v = useRef<HTMLVideoElement>(null);
  const a = useRef<HTMLAudioElement>(null);
  const [levels, setLevels] = useState<Level[] | null>(null);
  const [qPref, setQPref] = useState<string>(() => storage.get<string>("shorts:quality:app", "auto"));
  const [rate, setRateState] = useState(1);
  const startAt = useRef(0);
  const cb = useRef(onState);
  cb.current = onState;

  useEffect(() => {
    let alive = true;
    setLevels(null);
    getVideo(id)
      .then((d) => {
        if (!alive) return;
        const l = levelsOf(d.streams);
        setLevels(l);
        if (!l.length) cb.current({ playing: false, time: 0, duration: 0, failed: "No playable stream" });
      })
      .catch((e: unknown) => alive && cb.current({ playing: false, time: 0, duration: 0, failed: e instanceof Error ? e.message : "Couldn't load" }));
    return () => {
      alive = false;
    };
  }, [id]);

  const level = levels?.length ? (qPref === "auto" ? autoLevel(levels) : (levels.find((l) => l.height <= Number(qPref)) ?? levels[levels.length - 1])) : undefined;
  const pick = level?.pick ?? null;
  const dual = !!pick && "audio" in pick;

  // attach the picked streams (again after a quality change, at the same moment)
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
    const m0 = master();
    if (m0 && startAt.current) m0.currentTime = startAt.current;
    if ("audio" in pick && startAt.current) el.currentTime = startAt.current;
    m0?.play().catch(() => {});
    if ("audio" in pick) el.play().catch(() => {});
    // keep the picture with the sound; loop both
    const timer = setInterval(() => {
      const m = master();
      if (!m) return;
      if ("audio" in pick && Math.abs(el.currentTime - m.currentTime) > 0.25) el.currentTime = m.currentTime;
      startAt.current = m.currentTime;
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
    m0?.addEventListener("ended", onEnd);
    return () => {
      alive = false;
      clearInterval(timer);
      m0?.removeEventListener("ended", onEnd);
      stop();
      el.pause();
      el.removeAttribute("src");
      a.current?.pause();
      a.current?.removeAttribute("src");
    };
  }, [pick]);

  useEffect(() => {
    if (a.current) a.current.muted = muted;
    if (v.current) v.current.muted = dual || muted;
  }, [muted, dual, pick]);

  useEffect(() => {
    if (v.current) v.current.playbackRate = rate;
    if (a.current) a.current.playbackRate = rate;
  }, [rate, pick]);

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
    options: () => ({
      qualities: [{ id: "auto", label: "Auto" }, ...(levels ?? []).filter((l) => l.height).map((l) => ({ id: String(l.height), label: `${l.height}p` }))],
      quality: qPref,
      captions: [],
      caption: null,
      rates: RATES,
      rate,
    }),
    setQuality: (q) => {
      setQPref(q);
      storage.set("shorts:quality:app", q);
    },
    setCaption: () => {},
    setRate: (r) => setRateState(r),
  }));

  return (
    <>
      <video ref={v} playsInline muted={dual || muted} loop={!dual} className="absolute inset-0 h-full w-full object-contain" />
      {dual && <audio ref={a} preload="auto" />}
    </>
  );
}
