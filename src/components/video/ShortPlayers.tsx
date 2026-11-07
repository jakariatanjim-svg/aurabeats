/**
 * The player inside one Short. Website: YouTube's official player (no
 * controls, looping). App: the ad-free streams in a plain <video> (HLS when
 * YouTube offers it, else one file, else picture + sound kept in step).
 */
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { storage } from "@/utils/storage";
import { getVideo } from "@/services/video/api";
import { audioFor, type StreamSet } from "@/services/video/types";
import { attachHls } from "./hls";
import { canPlay } from "./streams";
import type { ChunkTrack } from "./chunked";
import { chunkedOk, useChunkedSrc } from "./useChunked";
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
  pause: () => void;
  seekBy: (s: number) => void;
  /** jump to a time (seconds) */
  seekTo: (t: number) => void;
  options: () => ShortOptions;
  setQuality: (id: string) => void;
  setCaption: (id: string | null) => void;
  setRate: (r: number) => void;
}

export interface ShortPlayerProps {
  id: string;
  muted: boolean;
  onState: (s: { playing: boolean; time: number; duration: number; failed?: string }) => void;
  ref?: Ref<ShortHandle>;
}

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/* --------------------------------- website -------------------------------- */

// A vertical video's width at each YouTube quality (1080p = 1080 × 1920).
const SHORT_WIDTH: Record<string, number> = { tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160 };
const Q_ORDER = ["hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny"];

export function EmbedShort({ id, muted, onState, ref }: ShortPlayerProps) {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const p = useRef<YTPlayer | null>(null);
  const cb = useRef({ onState });
  cb.current = { onState };
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [quality, setQualityPref] = useState(() => storage.get<string>("shorts:quality", "auto"));
  const [cc, setCc] = useState<string | null>(null);
  const ccRef = useRef(cc);
  ccRef.current = cc;
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
    let probed = false;
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
              // captions are only listed once their part is loaded: load it
              // quietly once, note the tracks, hide them again (unless chosen)
              if (e.data === YTState.PLAYING && !probed) {
                probed = true;
                e.target.loadModule("captions");
                setTimeout(() => {
                  if (!alive || !p.current) return;
                  try {
                    const list = p.current.getOption("captions", "tracklist");
                    if (Array.isArray(list) && list.length) tracks.current = (list as { languageCode: string; displayName: string }[]).map((t) => ({ id: t.languageCode, label: t.displayName }));
                    if (!ccRef.current) p.current.unloadModule?.("captions");
                  } catch {
                    /* no captions */
                  }
                }, 1500);
              }
              // a Short loops, like on YouTube
              if (e.data === YTState.ENDED) {
                e.target.seekTo(0, true);
                e.target.playVideo();
              }
            },
            // the browser wants a tap before sound: start right away and turn
            // the sound on by itself at the very first touch / click / key
            // (the sound button never flips to muted)
            onAutoplayBlocked: () => {
              if (!alive || !p.current) return;
              p.current.mute();
              p.current.playVideo();
              const unmute = () => {
                for (const t of ["pointerdown", "keydown"]) window.removeEventListener(t, unmute, true);
                if (alive && !mutedRef.current) p.current?.unMute();
              };
              for (const t of ["pointerdown", "keydown"]) window.addEventListener(t, unmute, true);
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
    pause: () => p.current?.pauseVideo(),
    seekBy: (s) => {
      const pl = p.current;
      if (!pl) return;
      const d = pl.getDuration() || 0;
      pl.seekTo(Math.max(0, Math.min(d ? d - 0.3 : Infinity, (pl.getCurrentTime() || 0) + s)), true);
    },
    seekTo: (t) => {
      const pl = p.current;
      if (!pl) return;
      const d = pl.getDuration() || 0;
      pl.seekTo(Math.max(0, Math.min(d ? d - 0.3 : Infinity, t)), true);
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

type Pick = { hls: string } | { src: string } | { video: ChunkTrack; audio: ChunkTrack } | null;
type Level = { height: number; pick: Exclude<Pick, null> };

/** Playable heights, best first: picture + sound files, else single files; HLS last. */
function levelsOf(s: StreamSet): Level[] {
  const audio = audioFor(s.audio).filter((a) => canPlay(a.mime)).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
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
      if (!cur || (avc && !cur.avc)) byH.set(h, { height: h, avc, pick: { video: { url: v.url, mime: v.mime, layout: v.layout }, audio: { url: audio.url, mime: audio.mime, layout: audio.layout } } });
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
  // Picture + sound go piece by piece into ONE <video> (one clock, like
  // YouTube): no second sound player to keep in step — that drift and the
  // re-syncing was the stuck sound / frozen Short. A Short needs no
  // background play, so this is fine in the app. Falls back to the two
  // players with plain file addresses when it can't work.
  const [comboOff, setComboOff] = useState(false);
  useEffect(() => setComboOff(false), [id]);
  const comboTracks = pick && "audio" in pick && !comboOff ? [pick.video, pick.audio] : [];
  const combo = comboTracks.length === 2 && chunkedOk(comboTracks);
  const dual = !!pick && "audio" in pick && !combo;
  useChunkedSrc(v, combo ? comboTracks : [], {
    startHint: () => startAt.current,
    onPlain: (at) => {
      startAt.current = at;
      setComboOff(true);
    },
  });

  // attach the picked streams (again after a quality change, at the same moment)
  useEffect(() => {
    const el = v.current;
    if (!el || !pick) return;
    let stop = () => {};
    let alive = true;
    if ("hls" in pick) {
      attachHls(el, pick.hls, (why) => alive && cb.current({ playing: false, time: 0, duration: 0, failed: why })).then((s) => (alive ? (stop = s) : s()));
    } else if (!combo) {
      el.src = "src" in pick ? pick.src : pick.video.url;
      if (a.current && dual) a.current.src = pick.audio.url;
    }
    const master = () => (dual ? a.current : el);
    const m0 = master();
    const resume = startAt.current;
    const onMeta = () => {
      if (resume && m0 && Math.abs(m0.currentTime - resume) > 0.5) m0.currentTime = resume;
      if (dual && resume) el.currentTime = resume;
    };
    m0?.addEventListener("loadedmetadata", onMeta, { once: true });
    // plays straight away with sound (the app allows it, see MainActivity);
    // should the phone still refuse, it starts at the very next touch
    let retry = () => {};
    const play = () =>
      m0?.play().catch((e: unknown) => {
        if (!alive || !m0 || (e as { name?: string })?.name !== "NotAllowedError") return;
        retry = () => {
          for (const t of ["pointerdown", "keydown"]) window.removeEventListener(t, go, true);
        };
        const go = () => {
          retry();
          if (alive && m0.paused) void m0.play().catch(() => {});
        };
        for (const t of ["pointerdown", "keydown"]) window.addEventListener(t, go, true);
      });
    void play();
    if (dual) el.play().catch(() => {});

    // two players (fallback only): the picture follows the sound; if either
    // has to wait for data, the other waits too instead of running ahead
    let heldForPicture = false;
    const onSoundWait = () => dual && el.pause();
    const onSoundPlaying = () => {
      if (!dual || !m0) return;
      if (Math.abs(el.currentTime - m0.currentTime) > 0.15) el.currentTime = m0.currentTime;
      el.play().catch(() => {});
    };
    const onPictureWait = () => {
      if (!dual || !m0 || m0.paused) return;
      heldForPicture = true;
      m0.pause();
    };
    const onPictureReady = () => {
      if (!heldForPicture || !m0) return;
      heldForPicture = false;
      void m0.play().catch(() => {});
    };
    if (dual && m0) {
      m0.addEventListener("waiting", onSoundWait);
      m0.addEventListener("playing", onSoundPlaying);
      el.addEventListener("waiting", onPictureWait);
      el.addEventListener("canplay", onPictureReady);
    }
    const timer = setInterval(() => {
      const m = master();
      if (!m) return;
      // only a real drift is corrected (each correction makes the picture skip)
      if (dual && !m.paused && !el.seeking && Math.abs(el.currentTime - m.currentTime) > 0.4) el.currentTime = m.currentTime;
      startAt.current = m.currentTime;
      cb.current({ playing: !m.paused || heldForPicture, time: m.currentTime, duration: Number.isFinite(m.duration) ? m.duration : 0 });
    }, 250);
    const onEnd = () => {
      const m = master();
      if (!m) return;
      m.currentTime = 0;
      if (dual) el.currentTime = 0;
      void m.play().catch(() => {});
      if (dual) void el.play().catch(() => {});
    };
    m0?.addEventListener("ended", onEnd);
    return () => {
      alive = false;
      retry();
      clearInterval(timer);
      m0?.removeEventListener("ended", onEnd);
      m0?.removeEventListener("loadedmetadata", onMeta);
      if (m0) {
        m0.removeEventListener("waiting", onSoundWait);
        m0.removeEventListener("playing", onSoundPlaying);
      }
      el.removeEventListener("waiting", onPictureWait);
      el.removeEventListener("canplay", onPictureReady);
      stop();
      el.pause();
      if (!combo) el.removeAttribute("src");
      a.current?.pause();
      a.current?.removeAttribute("src");
    };
  }, [pick, combo, dual]);

  useEffect(() => {
    if (a.current) a.current.muted = muted;
    if (v.current) v.current.muted = dual || muted;
  }, [muted, dual, pick, combo]);

  useEffect(() => {
    if (v.current) v.current.playbackRate = rate;
    if (a.current) a.current.playbackRate = rate;
  }, [rate, pick, combo]);

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
    pause: () => {
      a.current?.pause();
      v.current?.pause();
    },
    seekBy: (s) => {
      const el = v.current;
      const m = dual ? a.current : el;
      if (!el || !m) return;
      const t = Math.max(0, Math.min((m.duration || Infinity) - 0.3, m.currentTime + s));
      m.currentTime = t;
      if (dual) el.currentTime = t;
    },
    seekTo: (to) => {
      const el = v.current;
      const m = dual ? a.current : el;
      if (!el || !m) return;
      const t = Math.max(0, Math.min((m.duration || Infinity) - 0.3, to));
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
      <video ref={v} playsInline muted={dual || muted} loop={!dual && !combo} className="absolute inset-0 h-full w-full object-contain" />
      {dual && <audio ref={a} preload="auto" />}
    </>
  );
}
