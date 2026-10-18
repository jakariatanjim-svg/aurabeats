/**
 * The website's video player: YouTube's official player (IFrame API) with
 * AuraBeats' own controls on top, YouTube-app style.
 *
 *  - YouTube's own UI (title, logo, buttons, "More videos") is pushed out of
 *    view: the iframe is twice as tall as the visible box, so those overlays
 *    land in the clipped black bars. A transparent layer above it receives
 *    every click/tap, so YouTube's hover UI never wakes up.
 *  - Gestures: click = play/pause, double-click = fullscreen, press & hold =
 *    2× speed, double-tap left/right = ∓10 s, swipe up = fullscreen, swipe
 *    down = exit fullscreen / miniplayer, tap = show controls (touch).
 *  - Modes: inline (over the watch page's slot), theater, fullscreen and a
 *    draggable miniplayer that keeps playing while browsing / searching.
 *  - Autoplay: starts with sound when the browser allows it, otherwise
 *    muted with a "Tap to unmute" button.
 *  - "YouTube controls" reveals the untouched YouTube player (e.g. to pick a
 *    fixed quality or skip an ad); it is also shown automatically when the
 *    video doesn't start or seems stuck on an ad.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  Check,
  ChevronLeft,
  ExternalLink,
  FastForward,
  Gauge,
  Loader2,
  Maximize,
  Maximize2,
  Minimize,
  MonitorPlay,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  RotateCcw,
  RotateCw,
  Settings2,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { formatTime } from "@/utils/format";
import { storage } from "@/utils/storage";
import { usePlayer } from "@/hooks/usePlayer";
import { videoLibrary } from "@/hooks/useVideoLibrary";
import type { RouteKey } from "@/routes";
import { dock, dockRefs, useDock } from "./dock";
import { loadYT, qualityLabel, YT_ERRORS, YTState, type YTPlayer } from "./yt";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const HOLD_MS = 420;
const TAP_MS = 280;

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const fsElement = () => {
  const d = document as FsDoc;
  return d.fullscreenElement || d.webkitFullscreenElement || null;
};

export function YouTubeDock({ navigate, musicBar }: { navigate: (r: RouteKey) => void; musicBar: boolean }) {
  const d = useDock();
  if (!d.id || d.mode === "none") return null;
  return <DockPlayer navigate={navigate} musicBar={musicBar} />;
}

function DockPlayer({ navigate, musicBar }: { navigate: (r: RouteKey) => void; musicBar: boolean }) {
  const d = useDock();
  const { isPlaying: musicPlaying, toggle: toggleMusic } = usePlayer();

  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [state, setState] = useState<number>(YTState.UNSTARTED);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(d.startAt);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolumeState] = useState(() => storage.get<number>("video:ytVolume", 100));
  const [rate, setRate] = useState(1);
  const [quality, setQuality] = useState("auto");
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [native, setNative] = useState<false | "user" | "auto">(false);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<null | "main" | "speed">(null);
  const [held, setHeld] = useState(false);
  const [seekFx, setSeekFx] = useState<{ side: "l" | "r"; secs: number; key: number } | null>(null);
  const [flash, setFlash] = useState<{ icon: "play" | "pause"; key: number } | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [fs, setFs] = useState<"off" | "native" | "css">("off");
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [miniPos, setMiniPos] = useState(() => storage.get<{ side: "l" | "r"; y: number }>("video:miniPos", { side: "r", y: 0 }));
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);

  const mode = fs !== "off" ? "full" : d.mode; // "inline" | "mini" | "full"
  const playing = state === YTState.PLAYING || state === YTState.BUFFERING;
  const ended = state === YTState.ENDED;
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  const call = useCallback((fn: keyof YTPlayer, ...args: unknown[]): unknown => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return undefined;
    try {
      return (p[fn] as unknown as (...a: unknown[]) => unknown).apply(p, args);
    } catch {
      return undefined;
    }
  }, []);

  /* --------------------------- create player ---------------------------- */
  useEffect(() => {
    let alive = true;
    let p: YTPlayer | null = null;
    loadYT()
      .then((YT) => {
        if (!alive || !hostRef.current) return;
        const el = document.createElement("div");
        hostRef.current.appendChild(el);
        p = new YT.Player(el, {
          host: "https://www.youtube-nocookie.com",
          videoId: dock.get().id!,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 1,
            controls: 1, // kept for the "YouTube controls" view; hidden by the crop otherwise
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            disablekb: 1,
            fs: 0,
            cc_load_policy: 0,
            enablejsapi: 1,
            origin: window.location.origin,
            start: Math.floor(dock.get().startAt),
          },
          events: {
            onReady: (e) => {
              if (!alive) return;
              playerRef.current = e.target;
              readyRef.current = true;
              const ifr = e.target.getIframe();
              ifr.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
              ifr.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
              ifr.tabIndex = -1;
              e.target.setVolume(storage.get<number>("video:ytVolume", 100));
              e.target.playVideo();
              setReady(true);
            },
            onStateChange: (e) => alive && setState(e.data),
            onPlaybackRateChange: (e) => alive && setRate(e.data),
            onPlaybackQualityChange: (e) => alive && setQuality(e.data),
            onError: (e) => {
              if (!alive) return;
              setError(YT_ERRORS[e.data] || `YouTube error ${e.data}`);
              // YouTube's own screen explains it best (sign-in / bot check / blocked) and links out.
              setNative((n) => n || "auto");
            },
            onAutoplayBlocked: () => {
              if (!alive || !playerRef.current) return;
              playerRef.current.mute();
              playerRef.current.playVideo();
              setNeedsUnmute(true);
            },
          },
        });
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Couldn't load the YouTube player"));
    return () => {
      alive = false;
      readyRef.current = false;
      try {
        (playerRef.current ?? p)?.destroy();
      } catch {
        /* already gone */
      }
      playerRef.current = null;
    };
  }, []);

  // A new video was opened (watch page claimed the dock with another id).
  const lastClaim = useRef(d.claim);
  useEffect(() => {
    if (d.claim === lastClaim.current) return;
    lastClaim.current = d.claim;
    setStarted(false);
    setError(null);
    setNative(false);
    setTime(d.startAt);
    setDuration(0);
    setState(YTState.UNSTARTED);
    call("loadVideoById", { videoId: d.id!, startSeconds: Math.floor(d.startAt) });
  }, [d.claim, d.id, d.startAt, call]);

  // Autoplay safety net: still not running shortly after load → start muted.
  useEffect(() => {
    if (!ready || started || error) return;
    const t = setTimeout(() => {
      const s = call("getPlayerState");
      if (s !== YTState.PLAYING && s !== YTState.BUFFERING && s !== YTState.ENDED) {
        call("mute");
        call("playVideo");
        setNeedsUnmute(true);
      }
    }, 2200);
    return () => clearTimeout(t);
  }, [ready, started, error, d.claim, call]);

  // Nothing at all after a while (bot check, region block…) → show YouTube's own view.
  useEffect(() => {
    if (!ready || started || error) return;
    const t = setTimeout(() => setNative((n) => n || "auto"), 9000);
    return () => clearTimeout(t);
  }, [ready, started, error, d.claim]);

  /* ------------------------------ polling ------------------------------- */
  const lastSave = useRef(0);
  const stuck = useRef({ t: -1, since: 0 });
  useEffect(() => {
    if (!ready) return;
    const iv = setInterval(() => {
      const t = Number(call("getCurrentTime")) || 0;
      const dur = Number(call("getDuration")) || 0;
      const s = Number(call("getPlayerState"));
      setTime(t);
      dockRefs.time = t;
      if (dur) setDuration(dur);
      setLoaded(Number(call("getVideoLoadedFraction")) || 0);
      setMuted(Boolean(call("isMuted")));
      if (s === YTState.PLAYING && t > 0.05) setStarted(true);

      // Playing but the clock doesn't move → most likely an ad; let the
      // user see YouTube's own UI (skip button) until the video resumes.
      if (s === YTState.PLAYING) {
        if (Math.abs(t - stuck.current.t) < 0.01) {
          if (!stuck.current.since) stuck.current.since = Date.now();
          else if (Date.now() - stuck.current.since > 3000) setNative((n) => n || "auto");
        } else {
          stuck.current.since = 0;
          setNative((n) => (n === "auto" ? false : n));
        }
      } else stuck.current.since = 0;
      stuck.current.t = t;

      const meta = dock.get().meta;
      if (meta && meta.id === dock.get().id && t > 1 && Date.now() - lastSave.current > 5000) {
        lastSave.current = Date.now();
        videoLibrary.recordProgress({ ...meta, duration: meta.duration || Math.round(dur) }, t);
      }
    }, 250);
    return () => clearInterval(iv);
  }, [ready, call]);

  // Ended → history + autoplay next (handled by the watch page when inline).
  useEffect(() => {
    if (!ended) return;
    dockRefs.ended = true;
    setControls(true);
    const meta = dock.get().meta;
    if (meta) videoLibrary.recordProgress(meta, meta.duration || duration);
    dockRefs.onEnded?.();
  }, [ended, duration]);
  useEffect(() => {
    if (playing) dockRefs.ended = false;
  }, [playing]);

  // Music ↔ video: never both at once.
  const musicRef = useRef(musicPlaying);
  musicRef.current = musicPlaying;
  useEffect(() => {
    if (state === YTState.PLAYING && musicRef.current) toggleMusic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => {
    if (musicPlaying && playerRef.current && call("getPlayerState") === YTState.PLAYING) call("pauseVideo");
  }, [musicPlaying, call]);

  /* ----------------------------- transport ------------------------------ */
  const play = useCallback(() => {
    if (ended) call("seekTo", 0, true);
    call("playVideo");
  }, [call, ended]);
  const pause = useCallback(() => call("pauseVideo"), [call]);
  const togglePlay = useCallback(() => {
    if (playing) {
      pause();
      setFlash({ icon: "pause", key: Date.now() });
    } else {
      play();
      setFlash({ icon: "play", key: Date.now() });
    }
  }, [playing, play, pause]);
  const seek = useCallback(
    (t: number) => {
      const c = Math.max(0, duration ? Math.min(t, duration - 0.5) : t);
      call("seekTo", c, true);
      setTime(c);
    },
    [call, duration],
  );
  const seekBy = useCallback((s: number) => seek((Number(call("getCurrentTime")) || time) + s), [seek, call, time]);
  const unmute = useCallback(() => {
    call("unMute");
    if (volume === 0) {
      call("setVolume", 60);
      setVolumeState(60);
    }
    setMuted(false);
    setNeedsUnmute(false);
  }, [call, volume]);
  const toggleMute = () => {
    if (muted || needsUnmute) unmute();
    else {
      call("mute");
      setMuted(true);
    }
  };
  const setVolume = (v: number) => {
    const n = Math.round(Math.max(0, Math.min(100, v)));
    setVolumeState(n);
    storage.set("video:ytVolume", n);
    call("setVolume", n);
    if (n > 0 && (muted || needsUnmute)) unmute();
    if (n === 0) {
      call("mute");
      setMuted(true);
    }
  };
  const setSpeed = (r: number) => {
    call("setPlaybackRate", r);
    setRate(r);
  };

  /* ---------------------------- fullscreen ------------------------------ */
  const enterFs = async () => {
    const box = boxRef.current as FsEl | null;
    try {
      if (box?.requestFullscreen) await box.requestFullscreen({ navigationUI: "hide" });
      else if (box?.webkitRequestFullscreen) await box.webkitRequestFullscreen();
      else throw new Error("no fullscreen api");
      setFs("native");
    } catch {
      setFs("css");
    }
    try {
      await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape");
    } catch {
      /* desktop / iOS */
    }
  };
  const exitFs = async () => {
    const doc = document as FsDoc;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else if (doc.webkitFullscreenElement) await doc.webkitExitFullscreen?.();
    } catch {
      /* ignore */
    }
    try {
      screen.orientation?.unlock?.();
    } catch {
      /* ignore */
    }
    setFs("off");
  };
  const toggleFs = () => void (fs === "off" ? enterFs() : exitFs());
  useEffect(() => {
    const onChange = () => {
      if (!fsElement()) setFs((f) => (f === "native" ? "off" : f));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toMini = () => {
    if (fs !== "off") void exitFs();
    navigate("video");
  };
  const expand = () => navigate(`watch:${d.id}`);
  const close = () => {
    call("pauseVideo");
    dock.close();
  };
  const playNext = () => {
    if (d.next) navigate(`watch:${d.next.id}`);
  };

  /* ------------------- position: follow slot / mini --------------------- */
  const mobileNav = typeof window !== "undefined" && innerWidth < 768;
  const miniW = mobileNav ? Math.min(innerWidth * 0.62, 300) : 400;
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const st = box.style;
    for (const k of ["left", "top", "right", "bottom", "width", "height", "clipPath", "visibility", "borderRadius", "inset"] as const) st[k] = "";
    if (mode === "full") {
      if (fs === "css") {
        st.inset = "0";
        st.width = "100%";
        st.height = "100%";
      }
      return;
    }
    if (mode === "mini") {
      const base = mobileNav ? (musicBar ? 10.4 : 5.6) : musicBar ? 7.25 : 1.25; // rem, clears nav / music bar
      st.width = `${miniW}px`;
      st.height = `${(miniW * 9) / 16}px`;
      st.bottom = `calc(${base}rem + var(--sa-bottom, 0px) + ${miniPos.y}px)`;
      if (miniPos.side === "r") st.right = "max(12px, var(--sa-right, 0px))";
      else st.left = "max(12px, var(--sa-left, 0px))";
      st.borderRadius = "14px";
      return;
    }
    const scroller = document.getElementById("ab-scroll");
    let raf = 0;
    let last = "";
    const tick = () => {
      const slot = dockRefs.slot;
      if (slot && !fsElement()) {
        const r = slot.getBoundingClientRect();
        const sc = scroller?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
        const top = Math.max(0, sc.top - r.top);
        const bottom = Math.max(0, r.bottom - sc.bottom);
        const radius = getComputedStyle(slot).borderTopLeftRadius || "0px";
        const key = `${r.left}|${r.top}|${r.width}|${r.height}|${top}|${bottom}|${radius}`;
        if (key !== last) {
          last = key;
          box.style.left = `${r.left}px`;
          box.style.top = `${r.top}px`;
          box.style.width = `${r.width}px`;
          box.style.height = `${r.height}px`;
          box.style.borderRadius = radius;
          box.style.clipPath = top || bottom ? `inset(${top}px 0 ${bottom}px 0 round ${radius})` : "";
          box.style.visibility = r.width && top < r.height && bottom < r.height ? "visible" : "hidden";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [mode, fs, miniPos, musicBar, miniW, mobileNav]);

  // Entering the miniplayer while playing: start with clean picture.
  useEffect(() => {
    if (mode === "mini" && playing) setControls(false);
    setMenu(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Fit a 16:9 frame inside whatever box we have (fullscreen can be any shape).
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      const W = box.clientWidth;
      const H = box.clientHeight;
      const w = Math.min(W, (H * 16) / 9);
      setFrame({ w: Math.round(w), h: Math.round((w * 9) / 16) });
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  /* --------------------------- controls UI ------------------------------ */
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), touch ? 3200 : 2600);
  }, [touch]);
  useEffect(() => {
    if (!playing || menu || scrub !== null) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setControls(true);
    } else poke();
  }, [playing, menu, scrub, poke]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    if (!seekFx) return;
    const t = setTimeout(() => setSeekFx(null), 700);
    return () => clearTimeout(t);
  }, [seekFx]);

  /* ----------------------------- gestures ------------------------------- */
  const g = useRef({
    x: 0, y: 0, t: 0, id: -1, type: "mouse", moved: false, holdTimer: 0 as unknown as ReturnType<typeof setTimeout>,
    holding: false, prevRate: 1, lastTap: 0, lastSide: "" as "" | "l" | "r" | "c", tapTimer: 0 as unknown as ReturnType<typeof setTimeout>,
    dragging: false,
  });

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const s = g.current;
    s.x = e.clientX;
    s.y = e.clientY;
    s.t = Date.now();
    s.id = e.pointerId;
    s.type = e.pointerType;
    s.moved = false;
    s.dragging = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (mode === "mini") return;
    clearTimeout(s.holdTimer);
    s.holdTimer = setTimeout(() => {
      if (s.moved || !playing) return;
      s.holding = true;
      s.prevRate = rate;
      call("setPlaybackRate", 2);
      setHeld(true);
    }, HOLD_MS);
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (e.pointerType === "mouse" && e.buttons === 0) {
      if (mode !== "mini") poke();
      return;
    }
    if (s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(dx, dy) > 10) {
      s.moved = true;
      clearTimeout(s.holdTimer);
    }
    if (mode === "mini" && s.moved) {
      s.dragging = true;
      setDrag({ dx, dy });
    }
  };

  const endHold = () => {
    const s = g.current;
    clearTimeout(s.holdTimer);
    if (s.holding) {
      s.holding = false;
      call("setPlaybackRate", s.prevRate);
      setHeld(false);
      return true;
    }
    return false;
  };

  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (s.id !== e.pointerId) return;
    s.id = -1;
    if (endHold()) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;

    if (mode === "mini") {
      if (s.dragging) {
        const box = boxRef.current;
        if (box) {
          const r = box.getBoundingClientRect();
          const side: "l" | "r" = r.left + r.width / 2 < innerWidth / 2 ? "l" : "r";
          const next = { side, y: Math.max(0, Math.min(innerHeight * 0.6, miniPos.y - dy)) };
          setMiniPos(next);
          storage.set("video:miniPos", next);
        }
        setDrag(null);
        return;
      }
      if (s.type === "mouse") togglePlay();
      else setControls((c) => !c);
      return;
    }

    // swipes (touch)
    if (s.type !== "mouse" && s.moved) {
      if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.3) {
        if (dy < 0 && fs === "off") void enterFs();
        else if (dy > 0 && fs !== "off") void exitFs();
        else if (dy > 0 && mode === "inline") toMini();
      }
      return;
    }
    if (s.moved) return;

    const now = Date.now();
    const box = boxRef.current!.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    const side: "l" | "r" | "c" = rel < 0.35 ? "l" : rel > 0.65 ? "r" : "c";
    const isDouble = now - s.lastTap < TAP_MS;
    s.lastTap = now;

    if (s.type === "mouse") {
      if (isDouble) {
        togglePlay(); // undo the first click's toggle, like YouTube
        toggleFs();
      } else togglePlay();
      return;
    }

    // touch: double-tap sides seek (keeps counting on further taps)
    if ((isDouble || (seekFx && now - seekFx.key < 700)) && side !== "c" && (s.lastSide === side || seekFx)) {
      clearTimeout(s.tapTimer);
      const step = side === "l" ? -10 : 10;
      seekBy(step);
      setSeekFx((f) => ({ side, secs: f && f.side === side ? f.secs + 10 : 10, key: now }));
      s.lastSide = side;
      return;
    }
    s.lastSide = side;
    if (needsUnmute) {
      unmute();
      return;
    }
    if (controls && playing) setControls(false);
    else poke();
  };

  const onCancel = () => {
    endHold();
    setDrag(null);
    g.current.id = -1;
  };

  /* ----------------------------- keyboard ------------------------------- */
  useEffect(() => {
    if (mode === "mini") return;
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
      else if (k === "t" && fs === "off") dock.toggleTheater();
      else if (k === "i") toMini();
      else if (k === "m") toggleMute();
      else if (k === "arrowup") setVolume(volume + 5);
      else if (k === "arrowdown") setVolume(volume - 5);
      else if (e.key === ">") setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(rate) + 1)] ?? 2);
      else if (e.key === "<") setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(rate) - 1)] ?? 0.25);
      else if (k === "escape" && fs === "css") void exitFs();
      else if (/^[0-9]$/.test(k) && duration) seek((Number(k) / 10) * duration);
      else return;
      e.preventDefault();
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ------------------------------ progress ------------------------------ */
  const barRef = useRef<HTMLDivElement>(null);
  const tAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (duration || 0);
  };
  const barDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setScrub(tAt(e.clientX));
  };
  const barMove = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const t = tAt(e.clientX);
    const r = barRef.current!.getBoundingClientRect();
    setHover({ x: Math.max(24, Math.min(r.width - 24, e.clientX - r.left)), t });
    if (scrub !== null) setScrub(t);
  };
  const barUp = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (scrub !== null) seek(scrub);
    setScrub(null);
  };

  /* ------------------------------- layout ------------------------------- */
  const shownTime = scrub ?? time;
  const pct = duration ? (shownTime / duration) * 100 : 0;
  const nativeOn = Boolean(native);
  const showUi = !nativeOn && (controls || !playing || ended);
  // only the drag offset goes through React; position is set in the layout effect above
  const boxStyle: React.CSSProperties = mode === "mini" && drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {};

  return (
    <div
      ref={boxRef}
      style={boxStyle}
      className={cn(
        "fixed overflow-hidden bg-black text-white select-none [-webkit-tap-highlight-color:transparent]",
        mode === "inline" && "z-[25]",
        mode === "mini" && "z-[48] shadow-[0_12px_40px_rgb(0_0_0/0.45)] ring-1 ring-white/10",
        fs === "css" && "z-[200]",
      )}
    >
      {/* the YouTube iframe, cropped so only the picture shows */}
      <div
        ref={frameRef}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden"
        style={{ width: frame.w || "100%", height: frame.h || "100%" }}
      >
        <div
          ref={hostRef}
          className={cn("absolute inset-x-0 [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0", nativeOn ? "inset-y-0" : "")}
          style={nativeOn ? undefined : { top: "-50%", height: "200%" }}
        />
        {/* poster until the picture is really there (hides YouTube's start UI) */}
        {(!started || error) && !nativeOn && (
          <img
            src={`https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        )}
      </div>

      {/* gesture surface + our controls */}
      <div
        className={cn("absolute inset-0 touch-none", nativeOn && "pointer-events-none", showUi ? "cursor-default" : "cursor-none")}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onPointerLeave={(e) => e.pointerType === "mouse" && playing && !menu && setControls(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* dim + gradients */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 transition-opacity duration-200",
            showUi ? "opacity-100" : "opacity-0",
            mode === "mini" || touch ? "bg-black/35" : "bg-[linear-gradient(to_bottom,rgb(0_0_0/0.45),transparent_22%,transparent_70%,rgb(0_0_0/0.7))]",
          )}
        />

        {/* loading */}
        {!error && (!started || state === YTState.BUFFERING) && !nativeOn && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 className={cn("animate-spin text-white drop-shadow", mode === "mini" ? "h-8 w-8" : "h-12 w-12")} />
          </div>
        )}

        {/* error */}
        {error && !nativeOn && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center" onPointerUp={(e) => e.stopPropagation()}>
            <p className="max-w-sm text-sm font-semibold">{error}</p>
            <a
              href={`https://www.youtube.com/watch?v=${d.id}`}
              target="_blank"
              rel="noreferrer"
              onPointerDown={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-black"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open on YouTube
            </a>
          </div>
        )}

        {/* tap to unmute */}
        {needsUnmute && !error && !nativeOn && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={unmute}
            className={cn(
              "absolute top-3 left-3 z-10 inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-xs font-bold text-black shadow-lg",
              mode === "mini" && "top-2 left-2 px-2.5 py-1.5 text-[11px]",
            )}
          >
            <VolumeX className="h-4 w-4" /> Tap to unmute
          </button>
        )}

        {/* 2x hold pill */}
        {held && (
          <div className="pointer-events-none absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3.5 py-1.5 text-sm font-bold">
            2x <FastForward className="h-4 w-4 fill-current" />
          </div>
        )}

        {/* double-tap seek ripple */}
        {seekFx && (
          <div
            key={seekFx.key}
            className={cn(
              "pointer-events-none absolute inset-y-0 flex w-[38%] items-center justify-center bg-white/10",
              seekFx.side === "l" ? "left-0 rounded-r-[50%]" : "right-0 rounded-l-[50%]",
            )}
          >
            <span className="flex flex-col items-center gap-1 text-xs font-bold">
              {seekFx.side === "l" ? <RotateCcw className="h-6 w-6" /> : <RotateCw className="h-6 w-6" />}
              {seekFx.secs} seconds
            </span>
          </div>
        )}

        {/* click feedback (desktop) */}
        {flash && !touch && mode !== "mini" && (
          <div key={flash.key} className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="animate-[ping_0.6s_ease-out_1] rounded-full bg-black/50 p-4">
              {flash.icon === "play" ? <Play className="h-8 w-8 fill-current" /> : <Pause className="h-8 w-8 fill-current" />}
            </span>
          </div>
        )}

        {/* ---------------- mini player chrome ---------------- */}
        {mode === "mini" && (
          <div className={cn("absolute inset-0 transition-opacity", showUi || drag ? "opacity-100" : "opacity-0 hover:opacity-100")}>
            <div className="absolute inset-x-0 top-0 flex items-center justify-between p-1.5">
              <MiniBtn label="Expand" onClick={expand}>
                <Maximize2 className="h-4 w-4" />
              </MiniBtn>
              <MiniBtn label="Close" onClick={close}>
                <X className="h-4.5 w-4.5" />
              </MiniBtn>
            </div>
            <div className="absolute inset-0 flex items-center justify-center gap-5 pointer-events-none">
              <MiniBtn label="Back 10 seconds" onClick={() => seekBy(-10)} className="pointer-events-auto">
                <RotateCcw className="h-5 w-5" />
              </MiniBtn>
              <MiniBtn label={playing ? "Pause" : "Play"} onClick={togglePlay} className="pointer-events-auto bg-black/40 p-2.5">
                {playing ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 fill-current" />}
              </MiniBtn>
              <MiniBtn label="Forward 10 seconds" onClick={() => seekBy(10)} className="pointer-events-auto">
                <RotateCw className="h-5 w-5" />
              </MiniBtn>
            </div>
            {d.meta?.title && (
              <p className="pointer-events-none absolute inset-x-2 bottom-2 truncate text-[11px] font-bold drop-shadow">{d.meta.title}</p>
            )}
          </div>
        )}
        {mode === "mini" && duration > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        )}

        {/* ---------------- full chrome (inline / fullscreen) ---------------- */}
        {mode !== "mini" && (
          <>
            {/* top: title in fullscreen */}
            {mode === "full" && (
              <div className={cn("absolute inset-x-0 top-0 flex items-center gap-2 p-3 transition-opacity sm:p-4", showUi ? "opacity-100" : "pointer-events-none opacity-0")}>
                <CtrlBtn label="Exit fullscreen" onClick={() => void exitFs()}>
                  <ChevronLeft className="h-6 w-6" />
                </CtrlBtn>
                <p className="min-w-0 truncate text-sm font-bold sm:text-base">{d.meta?.title}</p>
              </div>
            )}

            {/* touch: big center controls */}
            {touch && !error && started && (
              <div className={cn("absolute inset-0 flex items-center justify-center gap-10 transition-opacity", showUi ? "opacity-100" : "pointer-events-none opacity-0")}>
                <CtrlBtn label="Back 10 seconds" onClick={() => seekBy(-10)} className="p-2.5">
                  <RotateCcw className="h-6 w-6" />
                </CtrlBtn>
                <CtrlBtn label={playing ? "Pause" : "Play"} onClick={togglePlay} className="bg-black/45 p-4">
                  {playing ? <Pause className="h-8 w-8 fill-current" /> : <Play className="h-8 w-8 fill-current" />}
                </CtrlBtn>
                <CtrlBtn label="Forward 10 seconds" onClick={() => seekBy(10)} className="p-2.5">
                  <RotateCw className="h-6 w-6" />
                </CtrlBtn>
              </div>
            )}

            {/* ended */}
            {ended && !error && (
              <div className="absolute inset-0 flex items-center justify-center gap-4">
                <CtrlBtn label="Replay" onClick={play} className="bg-black/50 p-4">
                  <RotateCcw className="h-8 w-8" />
                </CtrlBtn>
              </div>
            )}

            {/* bottom bar */}
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 px-2.5 pb-1 transition-opacity duration-200 sm:px-3.5 sm:pb-1.5",
                mode === "full" && "pb-[max(0.5rem,var(--sa-bottom))] sm:pb-4",
                showUi ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onPointerMove={(e) => {
                e.stopPropagation();
                if (e.pointerType === "mouse") poke();
              }}
            >
              {/* progress */}
              <div
                ref={barRef}
                className="group/bar relative flex h-5 cursor-pointer touch-none items-center"
                onPointerDown={barDown}
                onPointerMove={barMove}
                onPointerUp={barUp}
                onPointerLeave={() => setHover(null)}
              >
                {(hover || scrub !== null) && duration > 0 && (
                  <span
                    className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                    style={{ left: scrub !== null ? `${pct}%` : hover!.x }}
                  >
                    {formatTime(scrub ?? hover!.t)}
                  </span>
                )}
                <div className={cn("relative h-[3px] w-full rounded-full bg-white/25 transition-[height] group-hover/bar:h-[5px]", scrub !== null && "h-[5px]")}>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: `${loaded * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  <span
                    className={cn(
                      "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-transform",
                      scrub !== null || touch ? "scale-100" : "scale-0 group-hover/bar:scale-100",
                    )}
                    style={{ left: `${pct}%` }}
                  />
                </div>
              </div>

              {/* buttons */}
              <div className="flex items-center gap-0.5 sm:gap-1">
                <CtrlBtn label={playing ? "Pause (k)" : "Play (k)"} onClick={togglePlay}>
                  {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
                </CtrlBtn>
                {d.next && (
                  <CtrlBtn label="Next video" onClick={playNext}>
                    <SkipForward className="h-5 w-5 fill-current" />
                  </CtrlBtn>
                )}
                <div className="group/vol flex items-center">
                  <CtrlBtn label={muted || needsUnmute ? "Unmute (m)" : "Mute (m)"} onClick={toggleMute}>
                    {muted || needsUnmute || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                  </CtrlBtn>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={muted || needsUnmute ? 0 : volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    aria-label="Volume"
                    className="hidden h-1 w-0 cursor-pointer accent-white opacity-0 transition-all group-hover/vol:w-20 group-hover/vol:opacity-100 focus:w-20 focus:opacity-100 sm:block"
                  />
                </div>
                <span className="ml-1.5 text-[12px] font-semibold tabular-nums text-white/90 sm:text-[13px]">
                  {formatTime(shownTime)} <span className="text-white/60">/ {duration ? formatTime(duration) : "--:--"}</span>
                </span>

                <span className="flex-1" />

                {rate !== 1 && <span className="mr-1 rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-bold">{rate}x</span>}
                <div className="relative">
                  <CtrlBtn label="Settings" onClick={() => setMenu((m) => (m ? null : "main"))}>
                    <Settings2 className={cn("h-5 w-5 transition-transform", menu && "rotate-45")} />
                  </CtrlBtn>
                  {menu && (
                    <div className="absolute right-0 bottom-11 z-20 w-64 overflow-hidden rounded-2xl bg-[rgb(28_28_30/0.94)] py-1.5 text-[13px] shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
                      {menu === "main" ? (
                        <>
                          <MenuRow icon={<Gauge className="h-4 w-4" />} label="Playback speed" value={rate === 1 ? "Normal" : `${rate}x`} onClick={() => setMenu("speed")} />
                          <MenuRow
                            icon={<SlidersHorizontal className="h-4 w-4" />}
                            label="Quality"
                            value={`Auto${quality !== "auto" && qualityLabel(quality) !== "Auto" ? ` (${qualityLabel(quality)})` : ""}`}
                            onClick={() => {
                              setMenu(null);
                              setNative("user");
                            }}
                          />
                          <p className="px-4 pb-1.5 text-[11px] leading-snug text-white/55">
                            YouTube picks the quality for the player size. To fix one (up to 4K), choose Quality → it opens YouTube's own menu.
                          </p>
                          <MenuRow
                            icon={<MonitorPlay className="h-4 w-4" />}
                            label="YouTube controls"
                            value="Show"
                            onClick={() => {
                              setMenu(null);
                              setNative("user");
                            }}
                          />
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => setMenu("main")} className="flex w-full items-center gap-2 border-b border-white/10 px-4 py-2.5 font-bold">
                            <ChevronLeft className="h-4 w-4" /> Playback speed
                          </button>
                          {SPEEDS.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => {
                                setSpeed(s);
                                setMenu(null);
                              }}
                              className="flex w-full items-center gap-3 px-4 py-2 hover:bg-white/10"
                            >
                              <Check className={cn("h-4 w-4", rate === s ? "opacity-100" : "opacity-0")} />
                              {s === 1 ? "Normal" : `${s}x`}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
                <CtrlBtn label="Miniplayer (i)" onClick={toMini}>
                  <PictureInPicture2 className="h-5 w-5" />
                </CtrlBtn>
                {fs === "off" && (
                  <CtrlBtn label={d.theater ? "Default view (t)" : "Theater mode (t)"} onClick={dock.toggleTheater} className="hidden lg:inline-flex">
                    <RectangleHorizontal className={cn("h-5 w-5", d.theater && "fill-current")} />
                  </CtrlBtn>
                )}
                <CtrlBtn label={fs !== "off" ? "Exit full screen (f)" : "Full screen (f)"} onClick={toggleFs}>
                  {fs !== "off" ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
                </CtrlBtn>
              </div>
            </div>
          </>
        )}
      </div>

      {/* back from YouTube's own view */}
      {nativeOn && mode !== "mini" && (
        <button
          type="button"
          onClick={() => setNative(false)}
          className="absolute top-2 right-2 z-30 inline-flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/20"
        >
          <X className="h-3.5 w-3.5" /> {native === "auto" ? "AuraBeats controls" : "Done"}
        </button>
      )}
      {nativeOn && mode === "mini" && (
        <div className="absolute top-1 right-1 z-30 flex gap-1">
          <MiniBtn label="Expand" onClick={expand}>
            <Maximize2 className="h-4 w-4" />
          </MiniBtn>
          <MiniBtn label="Close" onClick={close}>
            <X className="h-4 w-4" />
          </MiniBtn>
        </div>
      )}
    </div>
  );
}

function CtrlBtn({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn("inline-flex items-center justify-center rounded-full p-2 text-white transition hover:bg-white/15 active:scale-95", className)}
    >
      {children}
    </button>
  );
}

const MiniBtn = CtrlBtn;

function MenuRow({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10">
      {icon}
      <span className="flex-1 font-semibold">{label}</span>
      <span className="text-white/60">{value}</span>
      <ChevronLeft className="h-4 w-4 rotate-180 text-white/50" />
    </button>
  );
}
