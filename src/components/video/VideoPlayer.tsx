/**
 * Ad-free video player.
 *
 *  - "dual":   separate video + audio files (how YouTube serves 480p…4K).
 *              A muted <video> follows an <audio> master clock; drift is
 *              corrected with tiny playback-rate nudges, big drift with a seek.
 *  - "single": one muxed file (360p and similar) in one <video>.
 *  - "hls":    live streams via the browser's native HLS support.
 *
 * Extras: quality ladder with Auto, speed, audio-only (stops downloading
 * video), background listening, Picture-in-Picture, fullscreen with
 * orientation lock, double-tap seek, keyboard shortcuts, lock-screen
 * controls (Media Session), loop, pinch zoom in full screen (Fit → Fill →
 * any %), turning the phone sideways = full screen, and the YouTube-app
 * gestures: drag down = miniplayer, swipe up = full screen.
 */
import { useBackHandler } from "@/utils/backStack";
import { ScreenOrientation } from "@capacitor/screen-orientation";
import { isNative } from "@/services/video/net";
import { baseOrientation } from "@/utils/orientation";
import { showVolumeUi } from "@/utils/device";
import { layerControls, watchLayer } from "./watchLayer";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  Check,
  FastForward,
  Gauge,
  Headphones,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw,
  Settings2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { formatTime } from "@/utils/format";
import { storage } from "@/utils/storage";
import type { VideoDetails } from "@/services/video/types";
import { getVideoSettings } from "@/services/video/settings";
import { autoHeight, dataCap, makePlan, pickQuality, type Plan } from "./streams";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];

export interface VideoPlayerProps {
  details: VideoDetails;
  startAt?: number;
  /** Music started playing elsewhere → pause the video. */
  musicPlaying: boolean;
  onPlayStart?: () => void;
  onTime?: (t: number, duration: number) => void;
  onEnded?: () => void;
  /** This source can't be played here → parent switches server. */
  onFatal: (reason: string, at: number) => void;
  /** shown small in the miniplayer bar: no controls, the bar takes the touches */
  mini?: boolean;
  /** dragging the video down (the watch layer turns it into the miniplayer) */
  onDrag?: (phase: "move" | "end", dy: number, velocity: number) => void;
}

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

/** " (code 2: …)" from a failed media element, for the error screen. */
const mediaErr = (el: HTMLMediaElement) => {
  const e = el.error;
  return e ? ` (code ${e.code}${e.message ? `: ${e.message.slice(0, 80)}` : ""})` : "";
};

export function VideoPlayer({ details, startAt = 0, musicPlaying, onPlayStart, onTime, onEnded, onFatal, mini = false, onDrag }: VideoPlayerProps) {
  const plan: Plan | null = useMemo(() => makePlan(details.streams), [details.streams]);
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const dual = plan?.mode === "dual";
  const master = useCallback(() => (dual ? audioRef.current : videoRef.current), [dual]);

  const settings = getVideoSettings();
  const [auto, setAuto] = useState(settings.quality === "auto");
  const [qIndex, setQIndex] = useState(() =>
    plan && plan.qualities.length
      ? pickQuality(plan.qualities, settings.quality === "auto" ? autoHeight(null) : Math.min(settings.quality, dataCap()))
      : 0,
  );
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [time, setTime] = useState(startAt);
  const [duration, setDuration] = useState(details.duration || 0);
  const [buffered, setBuffered] = useState(0);
  const [rate, setRate] = useState(1);
  // phones: the phone's volume buttons, no in-player volume (always 100 %)
  const [volume, setVolume] = useState(() => (showVolumeUi ? storage.get("video:volume", 1) : 1));
  const [loop, setLoop] = useState(false);
  // full-screen zoom: 1 = whole picture (Fit); `fill` = no black bars
  const [zoom, setZoom] = useState(1);
  const [zoomSnap, setZoomSnap] = useState(true);
  const [zoomPill, setZoomPill] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [audioOnly, setAudioOnly] = useState(false);
  const [menu, setMenu] = useState(false);
  // The menu closes on any tap outside it, like YouTube; a tap on the video
  // then only closes it (no play/pause, no controls flip).
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.closest?.("[data-menu-zone]")) return;
      setMenu(false);
      if (el.closest?.("button, a, input, [role=slider]")) return; // other controls still work
      if (boxRef.current?.contains(el)) {
        e.stopPropagation();
        // …and its matching "up", or the surface would still read a tap
        const id = e.pointerId;
        const up = (u: PointerEvent) => {
          if (u.pointerId !== id) return;
          u.stopPropagation();
          window.removeEventListener("pointerup", up, true);
          window.removeEventListener("pointercancel", up, true);
        };
        window.addEventListener("pointerup", up, true);
        window.addEventListener("pointercancel", up, true);
      }
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);
  const [controls, setControls] = useState(true);
  const [fs, setFs] = useState<"off" | "native" | "css">("off");
  const [flash, setFlash] = useState<{ side: "l" | "r"; key: number } | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  const wantPlay = useRef(true);
  const started = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badQualities = useRef(new Set<number>());
  const lastTap = useRef(0);
  const cbs = useRef({ onTime, onEnded, onFatal, onPlayStart });
  cbs.current = { onTime, onEnded, onFatal, onPlayStart };

  const quality = plan?.qualities[qIndex];
  const qIndexRef = useRef(qIndex);
  qIndexRef.current = qIndex;
  const videoSrc = plan?.mode === "hls" ? plan.hls : dual ? (audioOnly ? undefined : quality?.video?.url) : quality?.muxed?.url;

  /* ----------------------------- transport ------------------------------ */

  const playBoth = useCallback(async () => {
    wantPlay.current = true;
    const a = audioRef.current;
    const v = videoRef.current;
    try {
      if (dual && a) {
        await a.play();
        if (v && v.getAttribute("src")) {
          v.currentTime = a.currentTime;
          void v.play().catch(() => {});
        }
      } else if (v) {
        await v.play();
      }
    } catch (err) {
      // Autoplay blocked → show the big play button.
      if ((err as DOMException)?.name === "NotAllowedError") {
        wantPlay.current = false;
        setPlaying(false);
        setBuffering(false);
      }
    }
  }, [dual]);

  const pauseBoth = useCallback(() => {
    wantPlay.current = false;
    audioRef.current?.pause();
    videoRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const m = master();
    if (!m) return;
    if (m.paused) void playBoth();
    else pauseBoth();
  }, [master, playBoth, pauseBoth]);

  const seek = useCallback(
    (t: number) => {
      const m = master();
      if (!m) return;
      const d = Number.isFinite(m.duration) ? m.duration : duration;
      const to = Math.max(0, Math.min(d ? d - 0.25 : t, t));
      m.currentTime = to;
      if (dual && videoRef.current?.getAttribute("src")) videoRef.current.currentTime = to;
      setTime(to);
    },
    [master, dual, duration],
  );

  const seekBy = useCallback((d: number) => seek((master()?.currentTime ?? 0) + d), [seek, master]);

  /* ------------------------------ wiring -------------------------------- */

  // Music started elsewhere → pause.
  useEffect(() => {
    if (musicPlaying && !master()?.paused) pauseBoth();
  }, [musicPlaying, master, pauseBoth]);

  useEffect(() => {
    const m = master();
    if (m) m.loop = loop;
  }, [loop, master, qIndex]);

  // Apply volume / mute / rate.
  useEffect(() => {
    const m = master();
    if (m) {
      m.volume = volume;
      m.muted = muted;
    }
    if (dual && videoRef.current) videoRef.current.muted = true;
    if (showVolumeUi) storage.set("video:volume", volume);
  }, [volume, muted, master, dual]);

  useEffect(() => {
    const m = master();
    if (m) m.playbackRate = rate;
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate, master]);

  // Master element events.
  useEffect(() => {
    const m = master();
    if (!m) return;
    const onLoaded = () => {
      if (Number.isFinite(m.duration) && m.duration > 0) setDuration(m.duration);
      if (!started.current) {
        started.current = true;
        if (startAt > 1 && !details.live) {
          m.currentTime = startAt;
          if (dual && videoRef.current) videoRef.current.currentTime = startAt;
        }
        if (wantPlay.current) void playBoth();
      }
    };
    const onPlay = () => {
      setPlaying(true);
      cbs.current.onPlayStart?.();
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onTimeUpdate = () => {
      setTime(m.currentTime);
      if (m.buffered.length) setBuffered(m.buffered.end(m.buffered.length - 1));
      cbs.current.onTime?.(m.currentTime, Number.isFinite(m.duration) ? m.duration : 0);
    };
    const onEnd = () => {
      setPlaying(false);
      videoRef.current?.pause();
      cbs.current.onEnded?.();
    };
    const onError = () => {
      // Single (muxed) mode: try another quality before giving up on the server.
      if (!dual && plan?.mode === "single") {
        badQualities.current.add(qIndexRef.current);
        const next = plan.qualities.findIndex((_, i) => !badQualities.current.has(i));
        if (next !== -1) {
          setQIndex(next);
          return;
        }
      }
      cbs.current.onFatal(`${dual ? "audio" : "video"} failed${mediaErr(m)}`, m.currentTime || startAt);
    };
    m.addEventListener("loadedmetadata", onLoaded);
    m.addEventListener("play", onPlay);
    m.addEventListener("pause", onPause);
    m.addEventListener("waiting", onWaiting);
    m.addEventListener("playing", onPlaying);
    m.addEventListener("canplay", onPlaying);
    m.addEventListener("timeupdate", onTimeUpdate);
    m.addEventListener("ended", onEnd);
    m.addEventListener("error", onError);
    if (m.readyState >= 1) onLoaded();
    return () => {
      m.removeEventListener("loadedmetadata", onLoaded);
      m.removeEventListener("play", onPlay);
      m.removeEventListener("pause", onPause);
      m.removeEventListener("waiting", onWaiting);
      m.removeEventListener("playing", onPlaying);
      m.removeEventListener("canplay", onPlaying);
      m.removeEventListener("timeupdate", onTimeUpdate);
      m.removeEventListener("ended", onEnd);
      m.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master, dual, playBoth]);

  // Startup watchdog: nothing loads in 15 s → let the parent try another server.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!started.current) cbs.current.onFatal("no data in 15 s", startAt);
    }, 15000);
    return () => clearTimeout(t);
  }, [startAt]);

  // Dual mode: keep the muted video glued to the audio clock.
  useEffect(() => {
    if (!dual) return;
    const a = audioRef.current;
    const v = videoRef.current;
    if (!a || !v) return;

    const onVideoWaiting = () => {
      if (!a.paused && wantPlay.current) {
        a.pause();
        wantPlay.current = true; // resume once video catches up
        setBuffering(true);
      }
    };
    const onVideoReady = () => {
      if (wantPlay.current && a.paused && started.current) void a.play().catch(() => {});
    };
    const onVideoLoaded = () => {
      v.currentTime = a.currentTime;
      v.playbackRate = a.playbackRate;
      if (!a.paused || wantPlay.current) void v.play().catch(() => {});
    };
    const onVideoError = () => {
      // This quality failed: drop to the next one, else whole source fails.
      badQualities.current.add(qIndex);
      const next = plan!.qualities.findIndex((_, i) => i > qIndex && !badQualities.current.has(i));
      if (next !== -1) setQIndex(next);
      else cbs.current.onFatal(`video failed${mediaErr(v)}`, a.currentTime);
    };
    const onAudioPlay = () => {
      if (v.getAttribute("src") && v.paused) void v.play().catch(() => {});
    };
    const onAudioPause = () => {
      if (!v.paused) v.pause();
    };
    const onAudioSeeking = () => {
      if (v.getAttribute("src")) v.currentTime = a.currentTime;
    };

    v.addEventListener("waiting", onVideoWaiting);
    v.addEventListener("canplay", onVideoReady);
    v.addEventListener("playing", onVideoReady);
    v.addEventListener("loadedmetadata", onVideoLoaded);
    v.addEventListener("error", onVideoError);
    a.addEventListener("play", onAudioPlay);
    a.addEventListener("pause", onAudioPause);
    a.addEventListener("seeking", onAudioSeeking);

    const loop = setInterval(() => {
      if (a.paused || !v.getAttribute("src") || v.readyState < 2 || document.hidden) return;
      const diff = v.currentTime - a.currentTime;
      if (Math.abs(diff) > 0.8) {
        v.currentTime = a.currentTime + 0.1;
        v.playbackRate = a.playbackRate;
      } else if (Math.abs(diff) > 0.06) {
        v.playbackRate = a.playbackRate * (diff > 0 ? 0.92 : 1.08);
      } else if (v.playbackRate !== a.playbackRate) {
        v.playbackRate = a.playbackRate;
      }
      if (v.paused && wantPlay.current) void v.play().catch(() => {});
    }, 250);

    return () => {
      clearInterval(loop);
      v.removeEventListener("waiting", onVideoWaiting);
      v.removeEventListener("canplay", onVideoReady);
      v.removeEventListener("playing", onVideoReady);
      v.removeEventListener("loadedmetadata", onVideoLoaded);
      v.removeEventListener("error", onVideoError);
      a.removeEventListener("play", onAudioPlay);
      a.removeEventListener("pause", onAudioPause);
      a.removeEventListener("seeking", onAudioSeeking);
    };
  }, [dual, qIndex, plan]);

  // Single mode: changing quality reloads the file → keep position.
  const resumeAt = useRef<number | null>(null);
  const changeQuality = (i: number, isAuto = false) => {
    setAuto(isAuto);
    if (i === qIndex) return;
    if (!dual) {
      const v = videoRef.current;
      resumeAt.current = v?.currentTime ?? 0;
      started.current = true;
    }
    setQIndex(i);
  };
  useEffect(() => {
    if (dual || resumeAt.current === null) return;
    const v = videoRef.current;
    if (!v) return;
    const at = resumeAt.current;
    const onMeta = () => {
      v.currentTime = at;
      resumeAt.current = null;
      if (wantPlay.current) void v.play().catch(() => {});
    };
    v.addEventListener("loadedmetadata", onMeta, { once: true });
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [qIndex, dual]);

  // Auto quality follows player size (e.g. entering fullscreen).
  useEffect(() => {
    if (!auto || !plan?.qualities.length) return;
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const i = pickQuality(plan.qualities, autoHeight(el));
      // Only step up automatically; stepping down mid-play is jarring.
      setQIndex((cur) => (i < cur && !badQualities.current.has(i) ? i : cur));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [auto, plan]);

  // Background: in dual mode stop decoding video while hidden (keeps the
  // audio going — background listening), resync on return.
  useEffect(() => {
    if (!dual) return;
    const onVis = () => {
      const v = videoRef.current;
      const a = audioRef.current;
      if (!v || !a || !v.getAttribute("src")) return;
      if (document.hidden && document.pictureInPictureElement !== v) v.pause();
      else if (!a.paused) {
        v.currentTime = a.currentTime;
        void v.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [dual]);

  // Lock-screen / notification controls.
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms || typeof MediaMetadata === "undefined") return;
    ms.metadata = new MediaMetadata({
      title: details.title,
      artist: details.author,
      artwork: [{ src: details.thumbnail, sizes: "480x360", type: "image/jpeg" }],
    });
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* unsupported action */
      }
    };
    set("play", () => void playBoth());
    set("pause", pauseBoth);
    set("seekbackward", () => seekBy(-10));
    set("seekforward", () => seekBy(10));
    set("seekto", (e) => e.seekTime !== undefined && seek(e.seekTime));
    return () => {
      (["play", "pause", "seekbackward", "seekforward", "seekto"] as MediaSessionAction[]).forEach((a) => set(a, null));
    };
  }, [details.title, details.author, details.thumbnail, playBoth, pauseBoth, seek, seekBy]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 650);
    return () => clearTimeout(t);
  }, [flash]);

  // Audio only: actually stop downloading video (React only drops the
  // attribute; the element keeps its buffer until load()).
  useEffect(() => {
    const v = videoRef.current;
    if (!dual || !v || !audioOnly) return;
    v.pause();
    v.removeAttribute("src");
    v.load();
  }, [audioOnly, dual]);

  /* ---------------------------- fullscreen ------------------------------ */

  // How full screen was entered: by turning the phone (then turning it back
  // leaves) or by a button / swipe (then the screen is held in landscape).
  const fsByRotation = useRef(false);
  const isLandscapeVideo = () => {
    const v = videoRef.current;
    return !v || !v.videoHeight || v.videoWidth >= v.videoHeight;
  };
  const enterFs = async (byRotation = false) => {
    fsByRotation.current = byRotation;
    const box = boxRef.current as FsEl | null;
    try {
      if (box?.requestFullscreen) await box.requestFullscreen({ navigationUI: "hide" });
      else if (box?.webkitRequestFullscreen) await box.webkitRequestFullscreen();
      else throw new Error("no fullscreen api");
      setFs("native");
    } catch {
      setFs("css");
    }
    if (isLandscapeVideo() && !byRotation) {
      // The app: landscape even with auto-rotate off (no rotate button to tap).
      try {
        if (isNative) await ScreenOrientation.lock({ orientation: "landscape" });
        else await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape");
      } catch {
        /* not allowed (desktop / iOS) */
      }
    }
  };
  const exitFs = async () => {
    const d = document as FsDoc;
    try {
      if (d.fullscreenElement) await d.exitFullscreen();
      else if (d.webkitFullscreenElement) await d.webkitExitFullscreen?.();
    } catch {
      /* ignore */
    }
    setFs("off");
    setZoom(1);
    if (!isNative) {
      try {
        screen.orientation?.unlock?.();
      } catch {
        /* ignore */
      }
      return;
    }
    // Rotation off (default): straight back to the app's upright screen.
    if (!getVideoSettings().rotateFullscreen) {
      await baseOrientation();
      return;
    }
    if (fsByRotation.current) return;
    // Back to portrait. If the phone is still held sideways, stay portrait
    // until it is really upright — else it would flip straight back to full
    // screen (YouTube does the same).
    try {
      await ScreenOrientation.lock({ orientation: "portrait" });
    } catch {
      return;
    }
    let got = false;
    const done = () => {
      window.removeEventListener("deviceorientation", onTilt);
      void ScreenOrientation.unlock().catch(() => {});
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      got = true;
      if (e.beta !== null && e.gamma !== null && Math.abs(e.beta) > 50 && Math.abs(e.gamma) < 35) done();
    };
    window.addEventListener("deviceorientation", onTilt);
    window.setTimeout(() => !got && done(), 1500); // no tilt sensor → just let go
  };
  useEffect(() => {
    const onChange = () => {
      const d = document as FsDoc;
      if (!d.fullscreenElement && !d.webkitFullscreenElement) setFs((f) => (f === "native" ? "off" : f));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);
  // Optional (Settings → Video, off by default): turning the phone sideways
  // = full screen, upright again = leave it. Swipe up always works.
  const fsRef = useRef(fs);
  fsRef.current = fs;
  const rotateRef = useRef({ enterFs, exitFs, mini, started: () => started.current });
  rotateRef.current = { enterFs, exitFs, mini, started: () => started.current };
  useEffect(() => {
    if (!isNative) return;
    const mq = window.matchMedia("(orientation: landscape)");
    const on = () => {
      const r = rotateRef.current;
      if (!getVideoSettings().rotateFullscreen) return;
      if (mq.matches && fsRef.current === "off" && !r.mini && r.started() && isLandscapeVideo()) void r.enterFs(true);
      else if (!mq.matches && fsRef.current !== "off" && fsByRotation.current) void r.exitFs();
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const toggleFs = () => void (fs === "off" ? enterFs() : exitFs());
  useEffect(() => {
    if (fs === "off") setZoom(1);
  }, [fs]);
  // Android back leaves full screen first (native or CSS fallback).
  useBackHandler(fs !== "off", () => void exitFs());

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else {
        if (audioOnly) setAudioOnly(false);
        await v.requestPictureInPicture();
      }
    } catch {
      /* unsupported */
    }
  };

  /* ----------------------------- keyboard ------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") togglePlay();
      else if (k === "arrowleft") seekBy(-5);
      else if (k === "arrowright") seekBy(5);
      else if (k === "j") seekBy(-10);
      else if (k === "l") seekBy(10);
      else if (k === "f") toggleFs();
      else if (k === "m") setMuted((m) => !m);
      else if (k === "arrowup") setVolume((v: number) => Math.min(1, v + 0.05));
      else if (k === "arrowdown") setVolume((v: number) => Math.max(0, v - 0.05));
      else if (k === "escape" && fs === "css") void exitFs();
      else if (/^[0-9]$/.test(k) && duration) seek((Number(k) / 10) * duration);
      else return;
      e.preventDefault();
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ------------------------- controls visibility ------------------------ */
  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!master()?.paused) {
        setControls(false);
        setMenu(false);
      }
    }, 3000);
  }, [master]);
  useEffect(() => {
    if (!playing) setControls(true);
    else poke();
  }, [playing, poke]);

  // The miniplayer bar drives play / pause and shows our state.
  useEffect(() => {
    layerControls.toggle = togglePlay;
    layerControls.pause = pauseBoth;
  });
  useEffect(() => {
    watchLayer.setPlaying(playing);
  }, [playing]);
  useEffect(
    () => () => {
      layerControls.toggle = null;
      layerControls.pause = null;
      void baseOrientation();
    },
    [],
  );
  // Going small leaves full screen and closes menus.
  useEffect(() => {
    if (!mini) return;
    setMenu(false);
    if (fsRef.current !== "off") void exitFs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mini]);

  /* ------------------------------ zoom ---------------------------------- */
  // Scale that fills the screen with no black bars (crops the edges).
  const fillScale = () => {
    const box = boxRef.current;
    const v = videoRef.current;
    if (!box || !v || !v.videoWidth || !v.videoHeight) return 1;
    const W = box.clientWidth;
    const H = box.clientHeight;
    const r = v.videoWidth / v.videoHeight;
    const fitW = W / H > r ? H * r : W;
    const fitH = W / H > r ? H : W / r;
    return Math.max(W / fitW, H / fitH);
  };
  const zoomLabel = (z: number, fill: number) =>
    Math.abs(z - 1) < 0.01 ? "Fit" : Math.abs(z - fill) < 0.01 ? "Fill screen" : `${Math.round(z * 100)}%`;
  useEffect(() => {
    if (!zoomPill) return;
    const t = setTimeout(() => setZoomPill(null), 1100);
    return () => clearTimeout(t);
  }, [zoomPill, zoom]);

  /* ---------------------------- gestures -------------------------------- */
  // Press & hold = 2× while held. Swipe up = full screen; drag down = the
  // miniplayer (follows the finger), or leaves full screen. Two fingers in
  // full screen = zoom.
  const hold = useRef({
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
    on: false,
    prev: 1,
    x: 0,
    y: 0,
    moved: false,
    dragging: false,
    lastY: 0,
    lastT: 0,
    vy: 0,
    pinch: null as null | { d0: number; z0: number },
    pts: new Map<number, { x: number; y: number }>(),
  });
  const [held, setHeld] = useState(false);
  const dist = () => {
    const [a, b] = [...hold.current.pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onSurfacePointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const h = hold.current;
    h.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (h.pts.size === 2) {
      // second finger: zoom (full screen only), never a tap / swipe
      clearTimeout(h.timer);
      h.moved = true;
      if (h.dragging) {
        h.dragging = false;
        onDrag?.("end", 0, 0);
      }
      if (fs !== "off") {
        h.pinch = { d0: dist() || 1, z0: zoom };
        setZoomSnap(false);
      }
      return;
    }
    if (h.pts.size > 2) return;
    h.x = e.clientX;
    h.y = e.clientY;
    h.lastY = e.clientY;
    h.lastT = e.timeStamp;
    h.vy = 0;
    h.moved = false;
    h.dragging = false;
    h.pinch = null;
    clearTimeout(h.timer);
    h.timer = setTimeout(() => {
      if (h.moved || !playing) return;
      h.on = true;
      h.prev = rate;
      setRate(2);
      setHeld(true);
    }, 420);
  };
  const onSurfacePointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const h = hold.current;
    if (!h.pts.has(e.pointerId)) return;
    h.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (h.pinch) {
      const fill = fillScale();
      const raw = (h.pinch.z0 * dist()) / h.pinch.d0;
      // a little give below Fit, up to 4×
      const z = Math.min(4, Math.max(0.85, raw));
      setZoom(z);
      setZoomPill(zoomLabel(z < 1 ? 1 : z, fill));
      return;
    }
    if (h.pts.size > 1) return;
    const dx = e.clientX - h.x;
    const dy = e.clientY - h.y;
    if (e.timeStamp > h.lastT) {
      h.vy = h.vy * 0.4 + ((e.clientY - h.lastY) / (e.timeStamp - h.lastT)) * 0.6;
      h.lastY = e.clientY;
      h.lastT = e.timeStamp;
    }
    if (!h.moved && Math.hypot(dx, dy) > 10) {
      h.moved = true;
      clearTimeout(h.timer);
      // a downward drag on the page-sized player → it follows the finger
      if (onDrag && fs === "off" && e.pointerType !== "mouse" && !h.on && dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        h.dragging = true;
        setMenu(false);
      }
    }
    if (h.dragging) onDrag?.("move", Math.max(0, dy), h.vy);
  };
  const endPinch = () => {
    const h = hold.current;
    if (!h.pinch) return;
    h.pinch = null;
    const fill = fillScale();
    // Fit ↔ Fill are steps; past Fill it stays at the percentage you chose.
    setZoom((z) => {
      const next = z < 1 + (fill - 1) * 0.5 ? 1 : z < fill * 1.06 ? fill : z;
      setZoomPill(zoomLabel(next, fill));
      return next;
    });
    setZoomSnap(true);
  };
  const onSurfacePointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const h = hold.current;
    const multi = h.pts.size > 1 || h.pinch !== null;
    h.pts.delete(e.pointerId);
    if (multi) {
      if (h.pts.size < 2) endPinch();
      return;
    }
    clearTimeout(h.timer);
    if (h.on) {
      h.on = false;
      setRate(h.prev);
      setHeld(false);
      return;
    }
    if (h.dragging) {
      h.dragging = false;
      onDrag?.("end", Math.max(0, e.clientY - h.y), h.vy);
      return;
    }
    if (h.moved) {
      const dx = e.clientX - h.x;
      const dy = e.clientY - h.y;
      if (e.pointerType !== "mouse" && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.3) {
        if (dy < 0 && fs === "off") void enterFs();
        else if (dy > 0 && fs !== "off") void exitFs();
      }
      return;
    }
    if (menu) {
      setMenu(false);
      return;
    }
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const isTouch = e.pointerType !== "mouse";
    if (now - lastTap.current < 300 && (x < 0.35 || x > 0.65)) {
      // double tap on the sides = ±10 s
      seekBy(x < 0.5 ? -10 : 10);
      setFlash({ side: x < 0.5 ? "l" : "r", key: now });
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    if (isTouch) {
      if (controls && playing) {
        setControls(false);
        setMenu(false);
      } else poke();
    } else {
      togglePlay();
      poke();
    }
  };
  const onSurfaceCancel = (e: RPointerEvent<HTMLDivElement>) => {
    const h = hold.current;
    h.pts.delete(e.pointerId);
    endPinch();
    clearTimeout(h.timer);
    if (h.on) {
      h.on = false;
      setRate(h.prev);
      setHeld(false);
    }
    if (h.dragging) {
      h.dragging = false;
      onDrag?.("end", 0, 0);
    }
  };

  /* ------------------------------ render -------------------------------- */

  if (!plan) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-black p-6 text-center text-sm text-white/80">
        {details.live ? "This browser can't play live streams. Try the app or Chrome/Safari." : "No playable format for this device."}
      </div>
    );
  }

  const shown = scrub ?? time;
  const pct = duration ? (shown / duration) * 100 : 0;
  const bufPct = duration ? Math.min(100, (buffered / duration) * 100) : 0;
  const showUi = !mini && (controls || !playing);

  return (
    <div
      ref={boxRef}
      data-video-player
      onPointerMove={(e) => e.pointerType === "mouse" && poke()}
      className={cn(
        "group/player relative w-full overflow-hidden bg-black text-white select-none",
        fs === "off" && "aspect-video sm:rounded-2xl",
        fs === "native" && "h-full",
        fs === "css" && "fixed inset-0 z-[200] pt-(--sa-top) pb-(--sa-bottom)",
        !showUi && "cursor-none",
      )}
    >
      <video
        ref={videoRef}
        src={videoSrc}
        poster={details.thumbnail}
        playsInline
        preload="auto"
        muted={dual}
        className={cn("absolute inset-0 h-full w-full object-contain", audioOnly && "opacity-0")}
        style={
          zoom !== 1 || !zoomSnap
            ? { transform: `scale(${Math.max(1, zoom)})`, transition: zoomSnap ? "transform 220ms cubic-bezier(.2,.8,.2,1)" : "none" }
            : { transition: "transform 220ms cubic-bezier(.2,.8,.2,1)" }
        }
      />
      {dual && <audio ref={audioRef} src={plan.audio!.url} preload="auto" />}

      {audioOnly && (
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={details.thumbnail} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl" />
          <span className="relative flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-bold">
            <Headphones className="h-4 w-4" /> Audio only · saving data
          </span>
        </div>
      )}

      {/* tap surface */}
      <div
        className={cn("absolute inset-0 touch-none", mini && "pointer-events-none")}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onSurfacePointerMove}
        onPointerUp={onSurfacePointerUp}
        onPointerCancel={onSurfaceCancel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {zoomPill && fs !== "off" && (
        <span className="pointer-events-none absolute top-[calc(var(--sa-top)+1rem)] left-1/2 -translate-x-1/2 animate-fade-in rounded-full bg-black/70 px-3.5 py-1.5 text-sm font-bold">
          {zoomPill}
        </span>
      )}
      {held && (
        <span className="pointer-events-none absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3.5 py-1.5 text-sm font-bold">
          2x <FastForward className="h-4 w-4 fill-current" />
        </span>
      )}

      {flash && (
        <span
          key={flash.key}
          className={cn(
            "pointer-events-none absolute top-1/2 flex -translate-y-1/2 animate-fade-in items-center gap-1 rounded-full bg-black/55 px-4 py-2 text-sm font-bold",
            flash.side === "l" ? "left-[12%]" : "right-[12%]",
          )}
        >
          {flash.side === "l" ? <RotateCcw className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />} 10s
        </span>
      )}

      {/* center */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {buffering && wantPlay.current ? (
          <Loader2 className={cn("animate-spin text-white/90 drop-shadow", mini ? "h-16 w-16" : "h-12 w-12")} />
        ) : (
          showUi && (
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              className="pointer-events-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm transition active:scale-95"
            >
              {playing ? <Pause className="h-7 w-7 fill-current" /> : <Play className="ml-1 h-7 w-7 fill-current" />}
            </button>
          )
        )}
      </div>

      {/* top title in fullscreen */}
      {fs !== "off" && showUi && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-5 pt-[calc(var(--sa-top)+0.9rem)] pb-10">
          <p className="truncate text-[15px] font-bold">{details.title}</p>
        </div>
      )}

      {/* bottom bar */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pt-10 pb-2 transition-opacity duration-200 sm:px-4",
          fs !== "off" && "pb-[calc(var(--sa-bottom)+0.6rem)]",
          showUi ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {!details.live && (
          <div className="group/seek relative flex h-5 items-center">
            <div className="absolute inset-x-0 h-1 rounded-full bg-white/25 transition-all group-hover/seek:h-1.5">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: `${bufPct}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <span
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-accent shadow"
              style={{ left: `${pct}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={shown}
              aria-label="Seek"
              onPointerDown={() => poke()}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={() => {
                if (scrub !== null) seek(scrub);
                setScrub(null);
              }}
              onKeyUp={() => {
                if (scrub !== null) seek(scrub);
                setScrub(null);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
        )}

        <div className="mt-0.5 flex items-center gap-1 sm:gap-2">
          <CtlBtn label={playing ? "Pause (k)" : "Play (k)"} onClick={togglePlay}>
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </CtlBtn>
          {showVolumeUi && (
          <CtlBtn label={muted ? "Unmute (m)" : "Mute (m)"} onClick={() => setMuted((m) => !m)}>
            {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </CtlBtn>
          )}
          {showVolumeUi && <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(e) => {
              setVolume(Number(e.target.value));
              setMuted(false);
            }}
            className="hidden w-20 accent-white md:block"
          />}
          <span className="ml-1 text-xs font-semibold tabular-nums text-white/90">
            {details.live ? (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500" /> LIVE
              </span>
            ) : (
              `${formatTime(shown)} / ${formatTime(duration)}`
            )}
          </span>
          <span className="flex-1" />
          {!details.live && (
            <CtlBtn label={loop ? "Loop on" : "Loop"} active={loop} onClick={() => setLoop((l) => !l)}>
              {loop ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
            </CtlBtn>
          )}
          {dual && (
            <CtlBtn label={audioOnly ? "Show video" : "Audio only"} active={audioOnly} onClick={() => setAudioOnly((x) => !x)}>
              <Headphones className="h-5 w-5" />
            </CtlBtn>
          )}
          <span data-menu-zone className="contents">
          <CtlBtn label="Quality & speed" active={menu} onClick={() => setMenu((m) => !m)}>
            <Settings2 className="h-5 w-5" />
            {quality && quality.height >= 720 && (
              <span className="absolute top-0 -right-0.5 rounded bg-accent px-1 text-[9px] leading-[13px] font-black text-white">
                {quality.height >= 2160 ? "4K" : "HD"}
              </span>
            )}
          </CtlBtn>
          </span>
          {typeof document !== "undefined" && document.pictureInPictureEnabled && (
            <CtlBtn label="Picture in picture" onClick={togglePip}>
              <PictureInPicture2 className="h-5 w-5" />
            </CtlBtn>
          )}
          <CtlBtn label={fs !== "off" ? "Exit full screen (f)" : "Full screen (f)"} onClick={toggleFs}>
            {fs !== "off" ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </CtlBtn>
        </div>
      </div>

      {menu && (
        <div
          data-menu-zone
          className="absolute right-2 bottom-14 z-10 max-h-[70%] w-60 animate-fade-in overflow-y-auto rounded-2xl bg-black/85 p-3 text-sm shadow-2xl backdrop-blur-md sm:right-4"
        >
          {plan.qualities.length > 0 && (
            <>
              <p className="mb-1.5 px-1 text-[10px] font-bold tracking-widest text-white/50 uppercase">Quality</p>
              <MenuItem
                active={auto}
                onClick={() => changeQuality(pickQuality(plan.qualities, autoHeight(boxRef.current)), true)}
              >
                Auto {auto && quality ? <span className="text-white/50">({quality.label})</span> : null}
              </MenuItem>
              {plan.qualities.map((q, i) => (
                <MenuItem key={q.height} active={!auto && i === qIndex} onClick={() => changeQuality(i)}>
                  {q.label}
                  {q.height >= 2160 ? <Badge>4K</Badge> : q.height >= 1440 ? <Badge>QHD</Badge> : q.height >= 720 ? <Badge>HD</Badge> : null}
                </MenuItem>
              ))}
            </>
          )}
          <p className="mt-3 mb-1.5 flex items-center gap-1 px-1 text-[10px] font-bold tracking-widest text-white/50 uppercase">
            <Gauge className="h-3 w-3" /> Speed
          </p>
          <div className="grid grid-cols-5 gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setRate(s)}
                className={cn("rounded-lg py-1.5 text-xs font-bold transition", s === rate ? "bg-accent text-white" : "bg-white/10 hover:bg-white/20")}
              >
                {s === 1 ? "1×" : `${s}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CtlBtn({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-white/15 active:scale-95",
        active && "text-accent",
      )}
    >
      {children}
    </button>
  );
}

function MenuItem({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10", active && "font-bold")}
    >
      <span className="w-4 shrink-0">{active && <Check className="h-4 w-4 text-accent" />}</span>
      <span className="flex flex-1 items-center gap-1.5">{children}</span>
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-white/15 px-1 text-[9px] font-black">{children}</span>;
}
