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
import { showVolumeUi } from "@/utils/device";
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
  Captions,
  ShieldAlert,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Repeat,
  Repeat1,
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
import { loadYT, QUALITY_WIDTH, qualityLabel, qualityTag, YT_ERRORS, YTState, type YTPlayer } from "./yt";

const Q_ORDER = ["tiny", "small", "medium", "large", "hd720", "hd1080", "hd1440", "hd2160", "hd2880", "highres"];
const qRank = (q: string) => Q_ORDER.indexOf(q);
import { adBlockState } from "./adblock";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// Faster speeds, shown only when YouTube's player says it can do them (the
// embed is normally capped at 2x; the Android app's own player does 3x/4x).
const FAST = [3, 4];
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
  const { isPlaying: musicPlaying, pause: pauseMusic } = usePlayer();

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
  // phones: no volume control in the player, the phone's buttons do it
  const [volume, setVolumeState] = useState(() => (showVolumeUi ? storage.get<number>("video:ytVolume", 100) : 100));
  const [rate, setRate] = useState(1);
  const [quality, setQuality] = useState("auto");
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [passThrough, setPassThrough] = useState(false); // see "Pass-through" below
  const [error, setError] = useState<string | null>(null);
  // Ad playing in YouTube's player (only possible when no blocker is active):
  // its "Skip" button sits outside our crop, so the crop opens up until it's over.
  const [ad, setAd] = useState(false);
  const [qPref, setQPref] = useState(() => storage.get<string>("video:ytQuality", "auto"));
  const [levels, setLevels] = useState<string[]>([]);
  // Levels YouTube listed but never delivered for this video (checked live).
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [qNote, setQNote] = useState<string | null>(null);
  const qCheck = useRef<{ q: string; at: number } | null>(null);
  const maxSeen = useRef(-1);
  const [tracks, setTracks] = useState<{ languageCode: string; displayName: string }[]>([]);
  const [cc, setCc] = useState<string | null>(null);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<null | "main" | "speed" | "quality" | "cc">(null);
  const [held, setHeld] = useState(false);
  // Volume bubble (wheel / ↑↓ keys), like YouTube's: icon + percentage.
  const [volFx, setVolFx] = useState<{ v: number; key: number } | null>(null);
  useEffect(() => {
    if (!volFx) return;
    const t = setTimeout(() => setVolFx(null), 800);
    return () => clearTimeout(t);
  }, [volFx]);
  const [seekFx, setSeekFx] = useState<{ side: "l" | "r"; secs: number; key: number } | null>(null);
  const [flash, setFlash] = useState<{ icon: "play" | "pause"; key: number } | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [fs, setFs] = useState<"off" | "native" | "css">("off");
  const [frame, setFrame] = useState({ w: 0, h: 0, boxH: 0, x: 0, y: 0 });
  const [miniPos, setMiniPos] = useState(() => storage.get<{ side: "l" | "r"; y: number }>("video:miniPos", { side: "r", y: 0 }));
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  // full-screen pinch zoom: 1 = Fit, then Fill (no black bars), then any %
  const [zoom, setZoom] = useState(1);
  const [zoomSnap, setZoomSnap] = useState(true);
  const [zoomPill, setZoomPill] = useState<string | null>(null);

  const mode = fs !== "off" ? "full" : d.mode; // "inline" | "mini" | "full"
  const playing = state === YTState.PLAYING || state === YTState.BUFFERING;
  const ended = state === YTState.ENDED;
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  // Did WE (the user, music starting…) pause it? Anything else that stops
  // the video is a stall the player recovers from by itself.
  const wantPlay = useRef(true);
  const call = useCallback((fn: keyof YTPlayer, ...args: unknown[]): unknown => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return undefined;
    if (fn === "pauseVideo") wantPlay.current = false;
    else if (fn === "playVideo" || fn === "loadVideoById") wantPlay.current = true;
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
            controls: 0, // our own controls only
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
              e.target.setVolume(showVolumeUi ? storage.get<number>("video:ytVolume", 100) : 100);
              e.target.unMute(); // YouTube remembers "muted" across embeds; every video starts with sound
              unmuteAt.current = Date.now();
              e.target.playVideo();
              setReady(true);
            },
            onStateChange: (e) => alive && setState(e.data),
            onPlaybackRateChange: (e) => alive && setRate(e.data),
            onPlaybackQualityChange: (e) => alive && setQuality(e.data),
            onError: (e) => {
              if (!alive) return;
              setError(YT_ERRORS[e.data] || `YouTube error ${e.data}`);
            },
            // Browser refused sound before any tap/click on the page: play muted
            // now, unmute automatically on the first interaction anywhere.
            onAutoplayBlocked: () => {
              if (!alive || !playerRef.current) return;
              playerRef.current.mute();
              playerRef.current.playVideo();
              setNeedsUnmute(true);
            },
            onApiChange: () => {
              if (!alive || !playerRef.current) return;
              try {
                const list = playerRef.current.getOption("captions", "tracklist");
                if (Array.isArray(list)) setTracks(list as { languageCode: string; displayName: string }[]);
              } catch {
                /* no captions module */
              }
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
    startedRef.current = false;
    setError(null);
    setAd(false);
    adRef.current = false;
    setLevels([]);
    setUnavailable([]);
    setQNote(null);
    qCheck.current = null;
    maxSeen.current = -1;
    setTracks([]);
    setCc(null);
    setTime(d.startAt);
    setDuration(0);
    setState(YTState.UNSTARTED);
    recover.current = { since: 0, step: 0, reloaded: false };
    if (!needsUnmuteRef.current) {
      call("unMute");
      unmuteAt.current = Date.now();
    }
    soundTest.current = null;
    call("loadVideoById", { videoId: d.id!, startSeconds: Math.floor(d.startAt) });
  }, [d.claim, d.id, d.startAt, call]);

  // Autoplay safety net. Never shows YouTube's UI; only nudges the player.
  useEffect(() => {
    if (!ready || started || error) return;
    const idle = () => {
      const st = call("getPlayerState");
      return st === YTState.UNSTARTED || st === YTState.CUED || st === YTState.PAUSED;
    };
    // 1) still idle → ask again (with sound)
    const t1 = setTimeout(() => idle() && call("playVideo"), 2500);
    // 2) still idle → the browser silently refused sound: play muted, unmute on first tap
    const t2 = setTimeout(() => {
      if (!idle()) return;
      call("mute");
      call("playVideo");
      setNeedsUnmute(true);
    }, 6000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [ready, started, error, d.claim, call]);

  // Auto-unmute: the first tap / click / key anywhere on the page gives the
  // browser permission, so sound comes back without hunting for a button.
  const needsUnmuteRef = useRef(false);
  needsUnmuteRef.current = needsUnmute;
  const unmutedAt = useRef(0);
  useEffect(() => {
    // After the browser refused sound twice, stop retrying on every tap
    // (each retry pauses the video): sound comes back from the button only.
    if (!needsUnmute || passThrough || soundBlocks.current >= 2) return;
    const go = () => {
      call("unMute");
      unmuteAt.current = Date.now();
      if (call("getPlayerState") !== YTState.PLAYING) call("playVideo");
      unmutedAt.current = Date.now();
      setMuted(false);
      setNeedsUnmute(false);
    };
    const opts = { capture: true } as const;
    window.addEventListener("pointerdown", go, opts);
    window.addEventListener("keydown", go, opts);
    return () => {
      window.removeEventListener("pointerdown", go, opts);
      window.removeEventListener("keydown", go, opts);
    };
  }, [needsUnmute, passThrough, call]);

  /* ------------------------------- ads ---------------------------------- */
  // Sound blocked by the browser (no tap yet, or a frame that may not play
  // sound, like an embedded preview): unmuting then pauses the video, or
  // "plays" with a frozen clock. That is neither an ad nor a stall, so before
  // either is assumed the player tries the same thing muted. If it plays
  // muted, sound was the problem → keep playing muted + show the sound button.
  const unmuteAt = useRef(0);
  const soundTest = useRef<{ at: number } | null>(null);
  const soundBlocks = useRef(0);
  // "Pass-through": a tap on OUR page doesn't give the YouTube frame the right
  // to play sound when the page itself is inside a frame without it (e.g. a
  // preview window). Then our layer steps aside for one tap so it lands on
  // YouTube's player itself; that tap is the permission, and sound comes on.
  const passRef = useRef(false);
  passRef.current = passThrough;
  const passTried = useRef(false);
  const passDone = useCallback(() => {
    if (!passRef.current) return;
    passRef.current = false;
    passTried.current = true;
    setPassThrough(false);
    call("unMute");
    call("playVideo"); // YouTube's own click paused it; play on, now with sound
    unmuteAt.current = Date.now();
    setMuted(false);
    setNeedsUnmute(false);
    // give the keyboard back to our page (shortcuts)
    try {
      playerRef.current?.getIframe().blur();
      window.focus();
    } catch {
      /* gone */
    }
  }, [call]);
  const passDoneRef = useRef(passDone);
  passDoneRef.current = passDone;
  useEffect(() => {
    if (!passThrough) return;
    // a tap inside the YouTube frame moves focus into it
    const onBlur = () =>
      setTimeout(() => {
        const ifr = playerRef.current?.getIframe();
        if (ifr && document.activeElement === ifr) passDone();
      }, 0);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [passThrough, passDone]);
  const adRef = useRef(false);
  const startedRef = useRef(false);
  // An ad only changes what is shown (YouTube's own layer, so its Skip
  // button works). Sound and play/pause are never touched for it.
  const enterAd = useCallback(() => {
    if (adRef.current) return;
    adRef.current = true;
    setAd(true);
  }, []);
  const leaveAd = useCallback(() => {
    if (!adRef.current) return;
    adRef.current = false;
    setAd(false);
  }, []);

  /* ------------------------------ polling ------------------------------- */
  const lastSave = useRef(0);
  const stuck = useRef({ t: -1, since: 0, tested: false });
  // Stall recovery. Switching the sound on makes YouTube fetch an ad; when an
  // extension (or the browser) blocks that request, YouTube sits paused /
  // buffering until its ad wait times out (~15–20 s). Not an ad and nothing
  // the user asked for, so: play again → nudge the position → reload the same
  // video at the same second (with sound). A real ad (YouTube says PLAYING)
  // is never touched.
  const recover = useRef({ since: 0, step: 0, reloaded: false });
  const errRef = useRef<string | null>(null);
  errRef.current = error;
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
      const advancing = Math.abs(t - stuck.current.t) > 0.01;
      if (s === YTState.PLAYING && advancing) {
        startedRef.current = true;
        setStarted(true);
      }

      const now = Date.now();
      const isMuted = Boolean(call("isMuted"));
      const vd = call("getVideoData") as { video_id?: string } | undefined;
      const want = dock.get().id;
      const otherId = Boolean(vd?.video_id && want && vd.video_id !== want);

      // 0) Pass-through tap landed on YouTube's player (its click pauses it).
      if (passRef.current && s === YTState.PAUSED && wantPlay.current) {
        passDoneRef.current();
        stuck.current.t = t;
        return;
      }

      // 1) A sound test is running: muted and moving → the browser blocked sound.
      const test = soundTest.current;
      if (test) {
        if (s === YTState.PLAYING && advancing) {
          soundTest.current = null;
          soundBlocks.current += 1;
          stuck.current.since = 0;
          recover.current = { since: 0, step: 0, reloaded: recover.current.reloaded };
          setNeedsUnmute(true);
          // Our page was already tapped and sound was still refused → the next
          // tap must reach YouTube's frame itself (once; no loops).
          const tapped = (navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? soundBlocks.current >= 2;
          if ((tapped || soundBlocks.current >= 2) && !passTried.current) {
            passRef.current = true;
            setPassThrough(true);
          }
        } else if (now - test.at > 2500) {
          soundTest.current = null; // muted didn't help: not a sound problem
          stuck.current.tested = true;
          if (!needsUnmuteRef.current) call("unMute");
        }
      }
      // 2) Start one when the video froze with sound on: "playing" but the clock
      //    stands still, or paused by itself right after sound was switched on.
      const frozen = s === YTState.PLAYING && !advancing && !otherId;
      const pausedAfterUnmute =
        (s === YTState.PAUSED || s === YTState.UNSTARTED || s === YTState.CUED) && now - unmuteAt.current < 4000;
      if (!soundTest.current && !isMuted && !needsUnmuteRef.current && wantPlay.current && !errRef.current && !adRef.current) {
        const frozenFor = frozen ? (stuck.current.since ? now - stuck.current.since : 0) : 0;
        if ((frozen && frozenFor > 1500 && !stuck.current.tested) || (pausedAfterUnmute && !advancing)) {
          call("mute");
          call("playVideo");
          soundTest.current = { at: now };
        }
      }

      // 3) Ads: only a real one counts — the player reports another video id,
      //    or says PLAYING while the video's own clock stands still for 2 s
      //    even after the muted test (the ad is what plays). Slow starts,
      //    buffering, blocked ads (extension, DNS, anything) and blocked sound
      //    are NOT ads. With a blocker detected, never.
      if (adBlockState() !== "on") {
        if (s === YTState.PLAYING && advancing && !otherId) {
          stuck.current.since = 0;
          stuck.current.tested = false;
          leaveAd();
        } else if (s === YTState.PLAYING) {
          if (otherId) enterAd();
          else if (!stuck.current.since) stuck.current.since = now;
          else if (now - stuck.current.since > 2000 && !soundTest.current && (stuck.current.tested || isMuted || needsUnmuteRef.current)) enterAd();
        } else {
          stuck.current.since = 0;
          if (s !== YTState.BUFFERING && s !== YTState.PAUSED) leaveAd();
        }
      } else {
        if (s === YTState.PLAYING && advancing) stuck.current.tested = false;
        if (s === YTState.PLAYING && !advancing) {
          if (!stuck.current.since) stuck.current.since = now;
        } else stuck.current.since = 0;
        leaveAd();
      }
      stuck.current.t = t;

      const rec = recover.current;
      const stalled =
        startedRef.current &&
        wantPlay.current &&
        dock.get().mode !== "none" &&
        !adRef.current &&
        !soundTest.current &&
        !errRef.current &&
        !advancing &&
        (s === YTState.PAUSED || s === YTState.BUFFERING || s === YTState.UNSTARTED || s === YTState.CUED);
      if (!stalled) {
        if (advancing) {
          rec.since = 0;
          rec.step = 0;
        }
      } else {
        const now = Date.now();
        if (!rec.since) rec.since = now;
        const age = now - rec.since;
        if (rec.step === 0 && age > (s === YTState.BUFFERING ? 1500 : 500)) {
          rec.step = 1;
          call("playVideo");
        } else if (rec.step === 1 && age > 3500) {
          rec.step = 2;
          call("seekTo", t + 0.1, true);
          call("playVideo");
        } else if (rec.step === 2 && age > 6500 && !rec.reloaded && dock.get().id) {
          rec.step = 3;
          rec.reloaded = true; // once per video — a real network problem shouldn't loop
          call("loadVideoById", { videoId: dock.get().id!, startSeconds: t });
        }
      }

      const lv = call("getAvailableQualityLevels");
      if (Array.isArray(lv)) {
        const clean = (lv as string[]).filter((q) => q !== "auto");
        setLevels((old) => (old.join() === clean.join() ? old : clean));
      }
      const q = call("getPlaybackQuality");
      if (typeof q === "string" && q) {
        setQuality(q);
        if (s === YTState.PLAYING) maxSeen.current = Math.max(maxSeen.current, qRank(q));
        // A picked level that YouTube never reaches isn't really there for this
        // video (the embed lists the whole ladder for some) → drop it.
        const chk = qCheck.current;
        if (chk && s === YTState.PLAYING) {
          if (qRank(q) >= qRank(chk.q)) qCheck.current = null;
          else if (Date.now() - chk.at > 12000) {
            qCheck.current = null;
            if (qRank(chk.q) > maxSeen.current) {
              setUnavailable((u) => (u.includes(chk.q) ? u : [...u, chk.q]));
              setQNote(`${qualityLabel(chk.q)} isn't available for this video`);
            }
          }
        }
      }

      const meta = dock.get().meta;
      if (meta && meta.id === dock.get().id && t > 1 && Date.now() - lastSave.current > 5000) {
        lastSave.current = Date.now();
        videoLibrary.recordProgress({ ...meta, duration: meta.duration || Math.round(dur) }, t);
      }
    }, 250);
    return () => clearInterval(iv);
  }, [ready, call]);

  // Loop: plays the same video again and again (per video, like YouTube).
  const [loop, setLoop] = useState(false);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  useEffect(() => setLoop(false), [d.id]);

  // Ended → history + autoplay next (handled by the watch page when inline).
  useEffect(() => {
    if (!ended) return;
    if (loopRef.current) {
      call("seekTo", 0, true);
      call("playVideo");
      return;
    }
    dockRefs.ended = true;
    setControls(true);
    const meta = dock.get().meta;
    if (meta) videoLibrary.recordProgress(meta, meta.duration || duration);
    dockRefs.onEnded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, duration]);
  useEffect(() => {
    if (playing) dockRefs.ended = false;
  }, [playing]);

  // Music ↔ video: never both at once.
  const musicRef = useRef(musicPlaying);
  musicRef.current = musicPlaying;
  useEffect(() => {
    if (state === YTState.PLAYING && musicRef.current) pauseMusic();
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
    unmuteAt.current = Date.now();
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
  // Which of the faster speeds YouTube's player accepts for this video.
  const fastOk = menu === "speed" ? ((call("getAvailablePlaybackRates") as number[] | undefined) ?? []) : [];
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
  const closeNow = () => {
    call("pauseVideo");
    dock.close();
  };
  // Never just vanish: slide (or shrink) away first, then close.
  const close = (to?: { x: number; y: number }) => {
    const box = boxRef.current;
    if (!box) return closeNow();
    const st = box.style;
    st.transition = "translate 240ms cubic-bezier(.4,0,1,1), scale 240ms ease, opacity 240ms ease";
    if (to) st.translate = `${to.x}px ${to.y}px`;
    else st.scale = "0.85";
    st.opacity = "0";
    window.setTimeout(() => {
      closeNow();
      st.transition = st.translate = st.scale = st.opacity = "";
      setDrag(null);
    }, 240);
  };
  const playNext = () => {
    if (d.next) navigate(`watch:${d.next.id}`);
  };

  /* ------------------- position: follow slot / mini --------------------- */
  const mobileNav = typeof window !== "undefined" && innerWidth < 768;
  const miniW = mobileNav ? Math.min(innerWidth * 0.62, 300) : 400;
  const prevMode = useRef(mode);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const st = box.style;
    // inline ↔ mini is animated: the player glides from where it was
    const from = prevMode.current;
    prevMode.current = mode;
    const before = from !== mode && (from === "inline" || from === "mini") && (mode === "inline" || mode === "mini") ? box.getBoundingClientRect() : null;
    const glide = () => {
      if (!before || !before.width) return;
      const after = box.getBoundingClientRect();
      if (!after.width || st.visibility === "hidden") return;
      st.transition = "none";
      st.transformOrigin = "0 0";
      st.translate = `${before.left - after.left}px ${before.top - after.top}px`;
      st.scale = `${before.width / after.width} ${before.height / after.height}`;
      void box.offsetWidth;
      st.transition = "translate 320ms cubic-bezier(.2,.8,.2,1), scale 320ms cubic-bezier(.2,.8,.2,1)";
      st.translate = "";
      st.scale = "";
      window.setTimeout(() => {
        st.transition = "";
      }, 340);
    };
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
      glide();
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
          // snapped to device pixels (no sub-pixel video layer)
          const dpr = window.devicePixelRatio || 1;
          const px = (v: number) => `${Math.round(v * dpr) / dpr}px`;
          box.style.left = px(r.left);
          box.style.top = px(r.top);
          box.style.width = px(r.width);
          box.style.height = px(r.height);
          box.style.borderRadius = radius;
          box.style.clipPath = top || bottom ? `inset(${top}px 0 ${bottom}px 0 round ${radius})` : "";
          box.style.visibility = r.width && top < r.height && bottom < r.height ? "visible" : "hidden";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    glide();
    return () => cancelAnimationFrame(raf);
  }, [mode, fs, miniPos, musicBar, miniW, mobileNav]);

  // Settings menu closes on any tap / click outside it, like YouTube. A tap
  // on the video then only closes the menu (no play/pause, no controls flip).
  const menuZone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || menuZone.current?.contains(t)) return;
      setMenu(null);
      if ((e.target as HTMLElement).closest?.("button, a, input, [role=slider]")) return; // other controls still work
      if (boxRef.current?.contains(t)) e.stopPropagation();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const blur = () => setMenu(null); // e.g. a click into another frame
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [menu]);

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
      // Whole pixels only (size and position): half-pixel offsets on the
      // video layer can show up as a thin line on some GPUs.
      const w = Math.floor(Math.min(W, (H * 16) / 9));
      const h = Math.floor((w * 9) / 16);
      setFrame({ w, h, boxH: H, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) });
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

  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<null | { d0: number; z0: number }>(null);
  const ptDist = () => {
    const [a, b] = [...pts.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const fillScale = () => {
    const box = boxRef.current;
    if (!box || !frame.w || !frame.h) return 1;
    return Math.max(box.clientWidth / frame.w, box.clientHeight / frame.h);
  };
  const zoomLabel = (z: number, fill: number) =>
    Math.abs(z - 1) < 0.01 ? "Fit" : Math.abs(z - fill) < 0.01 ? "Fill screen" : `${Math.round(z * 100)}%`;
  const endPinch = () => {
    if (!pinch.current) return;
    pinch.current = null;
    const fill = fillScale();
    setZoom((z) => {
      const next = z < 1 + (fill - 1) * 0.5 ? 1 : z < fill * 1.06 ? fill : z;
      setZoomPill(zoomLabel(next, fill));
      return next;
    });
    setZoomSnap(true);
  };
  useEffect(() => {
    if (fs === "off") setZoom(1);
  }, [fs]);
  useEffect(() => {
    if (!zoomPill) return;
    const t = setTimeout(() => setZoomPill(null), 1100);
    return () => clearTimeout(t);
  }, [zoomPill, zoom]);

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size >= 2) {
      // second finger: zoom in full screen; never a tap / swipe / hold
      const s = g.current;
      clearTimeout(s.holdTimer);
      s.moved = true;
      if (pts.current.size === 2 && fs !== "off") {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        pinch.current = { d0: ptDist() || 1, z0: zoom };
        setZoomSnap(false);
      }
      return;
    }
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
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current) {
      const z = Math.min(4, Math.max(0.85, (pinch.current.z0 * ptDist()) / pinch.current.d0));
      setZoom(z);
      setZoomPill(zoomLabel(Math.max(1, z), fillScale()));
      return;
    }
    if (pts.current.size > 1) return;
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
    const multi = pts.current.size > 1 || pinch.current !== null;
    pts.current.delete(e.pointerId);
    if (multi) {
      if (pts.current.size < 2) endPinch();
      g.current.id = -1;
      return;
    }
    const s = g.current;
    if (s.id !== e.pointerId) return;
    s.id = -1;
    if (endHold()) return;
    if (Date.now() - unmutedAt.current < 800) return; // that tap was "give me sound", not play/pause
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;

    if (mode === "mini") {
      if (s.dragging) {
        const box = boxRef.current;
        // Pushed clearly off the screen (or flung out) → close; merely
        // touching the edge just parks it there.
        if (box) {
          const r = box.getBoundingClientRect();
          const dt = Math.max(1, Date.now() - s.t);
          const vx = dx / dt;
          const vy = dy / dt;
          const outY = r.bottom - innerHeight;
          const outX = Math.max(-r.left, r.right - innerWidth);
          const fling = Math.hypot(vx, vy) > 1.2 && Math.hypot(dx, dy) > 60;
          if (outY > r.height * 0.5 || outX > r.width * 0.5 || (fling && (outY > 0 || outX > 0))) {
            const far = Math.max(innerWidth, innerHeight);
            const len = Math.hypot(dx, dy) || 1;
            close({ x: (dx / len) * far * 0.6, y: (dy / len) * far * 0.6 });
            return;
          }
        }
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

  const onCancel = (e?: RPointerEvent<HTMLDivElement>) => {
    if (e) pts.current.delete(e.pointerId);
    else pts.current.clear();
    endPinch();
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
      else if (k === "arrowup" || k === "arrowdown") {
        const n = Math.max(0, Math.min(100, (muted || needsUnmute ? 0 : volume) + (k === "arrowup" ? 5 : -5)));
        setVolume(n);
        setVolFx({ v: n, key: Date.now() });
      }
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

  // Mouse wheel over the volume control (speaker icon + bar) = volume ±10 %
  // (PC). Anywhere else on the video the wheel does nothing special, so the
  // page scrolls as usual. Native listener: React's wheel handler is passive
  // and couldn't stop the page from scrolling while over the control.
  const volRef = useRef(setVolume);
  volRef.current = setVolume;
  const fxRef = useRef(setVolFx);
  const volNow = useRef(volume);
  volNow.current = muted || needsUnmute ? 0 : volume;
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !showVolumeUi || mode === "mini") return;
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY || !(e.target as HTMLElement | null)?.closest("[data-volume]")) return;
      e.preventDefault();
      const n = Math.max(0, Math.min(100, Math.round(volNow.current / 10) * 10 + (e.deltaY < 0 ? 10 : -10)));
      volRef.current(n);
      fxRef.current({ v: n, key: Date.now() });
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [mode]);

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
  const showUi = !ad && (controls || !playing || ended);
  // Fixed quality: lay the iframe out at that level's width, scale to fit.
  const fw = frame.w || 1;
  const fh = frame.h || 1;
  // Auto: like youtube.com — size × screen density, but never below 720p.
  const autoW = Math.max(fw * Math.min(2, window.devicePixelRatio || 1), QUALITY_WIDTH.hd720);
  // Only the levels this video really has: YouTube's list minus the ones it
  // never delivered. A saved preference above them falls back to the best.
  const realLevels = levels.filter((q) => !unavailable.includes(q));
  const effQ = qPref === "auto" ? "auto" : realLevels.length && !realLevels.includes(qPref) ? (realLevels.find((q) => qRank(q) <= qRank(qPref)) ?? realLevels[realLevels.length - 1]) : qPref;
  const layoutW = ad ? fw : effQ !== "auto" && QUALITY_WIDTH[effQ] ? QUALITY_WIDTH[effQ] : autoW;
  const k = fw / layoutW;
  const hostStyle: React.CSSProperties = ad
    ? { left: 0, top: 0, width: fw, height: fh } // full player while an ad runs (its Skip button is at the bottom)
    : k === 1
      ? { left: 0, top: -Math.round(fh / 2), width: layoutW, height: fh * 2 }
      : // CSS zoom, not transform: scale(). A scaled iframe is drawn from
        // tiles at full size and then shrunk, which left a thin seam line
        // across the middle of the picture (measured on Chrome; fullscreen
        // had no line only because it isn't scaled). With zoom the page is
        // drawn at the final size — no seam — while YouTube still sees the
        // big layout width and keeps the chosen quality.
        // Lengths on a zoomed element are in its own (pre-zoom) units.
        { left: 0, top: -fh / 2 / k, width: layoutW, height: (fh * 2) / k, zoom: k };
  const pickQuality = (q: string) => {
    setQPref(q);
    storage.set("video:ytQuality", q);
    setMenu(null);
    setQNote(null);
    qCheck.current = q === "auto" ? null : { q, at: Date.now() };
    // YouTube keeps playing what it already buffered at the old quality, so a
    // change could take half a minute to show. Re-seeking to the same moment
    // (after the new size applies) drops that buffer → switches right away.
    setTimeout(() => {
      const t = Number(call("getCurrentTime")) || 0;
      if (t > 0) call("seekTo", t, true);
    }, 350);
  };
  const pickCc = (lang: string | null) => {
    if (lang) {
      call("loadModule", "captions");
      call("setOption", "captions", "track", { languageCode: lang });
    } else call("setOption", "captions", "track", {});
    setCc(lang);
    setMenu(null);
  };
  const retry = () => {
    setError(null);
    setStarted(false);
    call("loadVideoById", { videoId: d.id!, startSeconds: Math.floor(time) });
  };
  // only the drag offset goes through React; position is set in the layout effect above
  const boxStyle: React.CSSProperties = mode === "mini" && drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {};

  return (
    <div
      ref={boxRef}
      data-video-player
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
        className="absolute overflow-hidden"
        style={{
          ...(frame.w ? { left: frame.x, top: frame.y, width: frame.w, height: frame.h } : { inset: 0 }),
          scale: zoom > 1 ? String(zoom) : undefined,
          transition: zoomSnap ? "scale 220ms cubic-bezier(.2,.8,.2,1)" : "none",
        }}
      >
        <div
          ref={hostRef}
          className="absolute [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0"
          style={hostStyle}
        />
        {/* poster until the picture is really there (hides YouTube's start UI) */}
        {((!started && !ad) || error) && (
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
        className={cn("absolute inset-0 touch-none", (ad || passThrough) && "pointer-events-none", showUi ? "cursor-default" : "cursor-none")}
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
        {!error && !ad && (!started || state === YTState.BUFFERING) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 className={cn("animate-spin text-white drop-shadow", mode === "mini" ? "h-8 w-8" : "h-12 w-12")} />
          </div>
        )}

        {/* error */}
        {error && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <p className={cn("max-w-sm font-semibold", mode === "mini" ? "text-xs" : "text-sm")}>{error}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-xs font-bold text-white ring-1 ring-white/25 hover:bg-white/25"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Try again
              </button>
              <a
                href={`https://www.youtube.com/watch?v=${d.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-black"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open on YouTube
              </a>
            </div>
          </div>
        )}

        {/* pass-through: the tap goes to the video itself */}
        {passThrough && !error && !ad && (
          <span
            className={cn(
              "pointer-events-none absolute top-3 left-3 z-10 inline-flex animate-pulse items-center gap-2 rounded-full bg-white px-3.5 py-2 text-xs font-bold text-black shadow-lg",
              mode === "mini" && "top-2 left-2 px-2.5 py-1.5 text-[11px]",
            )}
          >
            <VolumeX className="h-4 w-4" /> Tap the video for sound
          </span>
        )}
        {/* tap to unmute */}
        {needsUnmute && !passThrough && !error && !ad && (
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
            <VolumeX className="h-4 w-4" />
            {soundBlocks.current >= 2 ? "Tap for sound" : "Tap anywhere for sound"}
          </button>
        )}

        {/* 2x hold pill */}
        {volFx && (
          <div
            key={volFx.key}
            className="pointer-events-none absolute top-[12%] left-1/2 z-10 flex -translate-x-1/2 animate-fade-in items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-[15px] font-bold tabular-nums"
          >
            {volFx.v === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            {volFx.v}%
          </div>
        )}
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
              <MiniBtn label="Close" onClick={() => close()}>
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
                <div className="group/vol flex items-center" data-volume>
                  <CtrlBtn label={muted || needsUnmute ? "Unmute (m)" : "Mute (m)"} onClick={toggleMute}>
                    {muted || needsUnmute || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                  </CtrlBtn>
                  {showVolumeUi && <input
                    type="range"
                    min={0}
                    max={100}
                    value={muted || needsUnmute ? 0 : volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    aria-label="Volume"
                    className="hidden h-1 w-0 cursor-pointer accent-white opacity-0 transition-all group-hover/vol:w-20 group-hover/vol:opacity-100 focus:w-20 focus:opacity-100 sm:block"
                  />}
                </div>
                <span className="ml-1.5 text-[12px] font-semibold tabular-nums text-white/90 sm:text-[13px]">
                  {formatTime(shownTime)} <span className="text-white/60">/ {duration ? formatTime(duration) : "--:--"}</span>
                </span>

                <span className="flex-1" />

                {rate !== 1 && <span className="mr-1 rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-bold">{rate}x</span>}
                <CtrlBtn label={loop ? "Loop on" : "Loop"} onClick={() => setLoop((l) => !l)} className={cn(loop && "text-accent")}>
                  {loop ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
                </CtrlBtn>
                <div className="relative" ref={menuZone}>
                  <CtrlBtn label="Settings" onClick={() => setMenu((m) => (m ? null : "main"))}>
                    <Settings2 className={cn("h-5 w-5 transition-transform", menu && "rotate-45")} />
                  </CtrlBtn>
                  {menu && (
                    <div
                      className="absolute right-0 bottom-11 z-20 w-64 overflow-y-auto overscroll-contain rounded-2xl bg-[rgb(28_28_30/0.94)] py-1.5 text-[13px] shadow-2xl ring-1 ring-white/10 backdrop-blur-md [scrollbar-width:thin]"
                      // stays inside the player (the box clips anything outside)
                      style={{ maxHeight: Math.max(120, (frame.boxH || 300) - 64) }}
                      data-menu
                      onWheel={(e) => e.stopPropagation()}
                    >
                      {menu === "main" ? (
                        <>
                          <MenuRow icon={<Gauge className="h-4 w-4" />} label="Playback speed" value={rate === 1 ? "Normal" : `${rate}x`} onClick={() => setMenu("speed")} />
                          <MenuRow
                            icon={<SlidersHorizontal className="h-4 w-4" />}
                            label="Quality"
                            value={effQ === "auto" ? `Auto${qualityLabel(quality) !== "Auto" ? ` (${qualityLabel(quality)})` : ""}` : qualityLabel(effQ)}
                            onClick={() => setMenu("quality")}
                          />
                          {tracks.length > 0 && (
                            <MenuRow
                              icon={<Captions className="h-4 w-4" />}
                              label="Subtitles"
                              value={cc ? (tracks.find((t) => t.languageCode === cc)?.displayName ?? cc) : "Off"}
                              onClick={() => setMenu("cc")}
                            />
                          )}
                        </>
                      ) : menu === "quality" ? (
                        <>
                          <SubHead title="Quality" onBack={() => setMenu("main")} />
                          <div className="ab-menu-list">
                            {[...realLevels, "auto"].map((q) => (
                              <MenuPick key={q} on={effQ === q} onClick={() => pickQuality(q)}>
                                {q === "auto" ? `Auto${qualityLabel(quality) !== "Auto" ? ` (${qualityLabel(quality)})` : ""}` : qualityLabel(q)}
                                {qualityTag(q) && <sup className="ml-1 text-[9px] font-black text-red-400">{qualityTag(q)}</sup>}
                              </MenuPick>
                            ))}
                          </div>
                          {levels.length === 0 && <p className="px-4 py-2 text-[11px] text-white/55">Loading qualities from YouTube…</p>}
                          {qNote && <p className="px-4 pt-1 pb-1.5 text-[11px] text-amber-300/90">{qNote}</p>}
                          {effQ !== "auto" && qualityLabel(quality) !== qualityLabel(effQ) && (
                            <p className="px-4 pt-1 pb-1.5 text-[11px] text-white/55">Switching… now {qualityLabel(quality)}</p>
                          )}
                        </>
                      ) : menu === "cc" ? (
                        <>
                          <SubHead title="Subtitles" onBack={() => setMenu("main")} />
                          <div className="ab-menu-list">
                            <MenuPick on={!cc} onClick={() => pickCc(null)}>
                              Off
                            </MenuPick>
                            {tracks.map((t) => (
                              <MenuPick key={t.languageCode} on={cc === t.languageCode} onClick={() => pickCc(t.languageCode)}>
                                {t.displayName}
                              </MenuPick>
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <SubHead title="Playback speed" onBack={() => setMenu("main")} />
                          {[...SPEEDS, ...FAST.filter((f) => fastOk.includes(f))].map((s) => (
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

      {zoomPill && fs !== "off" && (
        <span className="pointer-events-none absolute top-[calc(var(--sa-top)+1rem)] left-1/2 z-30 -translate-x-1/2 animate-fade-in rounded-full bg-black/70 px-3.5 py-1.5 text-sm font-bold">
          {zoomPill}
        </span>
      )}
      {/* an ad is running inside YouTube's player (no blocker): label it, keep Skip reachable */}
      {ad && (
        <div
          className={cn(
            "pointer-events-none absolute top-2 left-2 z-30 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 font-bold text-white shadow-lg",
            mode === "mini" ? "text-[10px]" : "text-[11px]",
          )}
        >
          <ShieldAlert className="h-3.5 w-3.5" /> YouTube ad{mode !== "mini" && " · a free blocker removes these"}
        </div>
      )}
      {ad && mode === "mini" && (
        <div className="absolute top-1 right-1 z-30 flex gap-1">
          <MiniBtn label="Expand" onClick={expand}>
            <Maximize2 className="h-4 w-4" />
          </MiniBtn>
          <MiniBtn label="Close" onClick={() => close()}>
            <X className="h-4 w-4" />
          </MiniBtn>
        </div>
      )}
    </div>
  );
}

function SubHead({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="sticky -top-1.5 z-10 flex w-full items-center gap-2 border-b border-white/10 bg-[rgb(28_28_30)] px-4 py-2.5 font-bold">
      <ChevronLeft className="h-4 w-4" /> {title}
    </button>
  );
}

function MenuPick({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/10">
      <Check className={cn("h-4 w-4 shrink-0", on ? "opacity-100" : "opacity-0")} />
      <span>{children}</span>
    </button>
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
