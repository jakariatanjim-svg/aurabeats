import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initYouTubePlayer,
  playYouTubeVideo,
  pauseYouTubeVideo,
  seekYouTubeVideo,
  setYouTubeVolume,
  muteYouTubeVideo,
  unMuteYouTubeVideo,
  getYouTubeTime,
  getYouTubeDuration,
  getYouTubeBuffered,
  resetYTCurrentId,
  releaseYouTubeVideo,
} from "@/services/youtubePlayer";

export interface AudioEngine {
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  bufferedAhead: number;
  volume: number;
  muted: boolean;
  isLive: boolean;
  error: string | null;
  endTick: number;
  errorTick: number;
  blockedTick: number;
  load: (src: string, opts?: LoadOptions) => void;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  nudge: (delta: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
}

export interface LoadOptions {
  autoplay?: boolean;
  live?: boolean;
}

export function useAudioEngine(): AudioEngine {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isYtMode, setIsYtMode] = useState(false);
  const currentYtIdRef = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedAhead, setBufferedAhead] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [muted, setMutedState] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endTick, setEndTick] = useState(0);
  const [errorTick, setErrorTick] = useState(0);
  const [blockedTick, setBlockedTick] = useState(0);

  /** Whether the user currently wants the YouTube track playing (vs. cued/paused). */
  const ytWantPlayRef = useRef(false);

  // Boot the YouTube player at startup so it is warm before the first tap.
  // initYouTubePlayer retries on its own until the player is ready.
  useEffect(() => {
    void initYouTubePlayer();
  }, []);

  if (!audioRef.current && typeof window !== "undefined") {
    const el = new Audio();
    el.preload = "auto";
    el.volume = 0.85;
    audioRef.current = el;
  }

  const load = useCallback((src: string, opts: LoadOptions = {}) => {
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedAhead(0);
    setIsBuffering(true);
    setIsLive(Boolean(opts.live));

    if (src.startsWith("yt-resolve:")) {
      const videoId = src.replace("yt-resolve:", "");
      setIsYtMode(true);
      currentYtIdRef.current = videoId;
      audioRef.current?.pause(); // Stop native audio

      // Safe before the player is ready: the request is kept and started as
      // soon as it is (after any boot retries). autoplay:false (a restored
      // session after a refresh) only cues the track, like native audio.
      const autoplay = opts.autoplay !== false;
      ytWantPlayRef.current = autoplay;
      if (!autoplay) setIsBuffering(false);
      playYouTubeVideo(videoId, autoplay);
    } else {
      setIsYtMode(false);
      currentYtIdRef.current = null;
      ytWantPlayRef.current = false;
      // Drop any pending YouTube request too, or a still-booting player would
      // start it later on top of this stream.
      releaseYouTubeVideo();

      const el = audioRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("crossorigin");
        el.src = src;
        el.load();

        if (opts.autoplay !== false) {
          const p = el.play();
          if (p && typeof p.catch === "function") {
            p.catch((err: unknown) => {
              if (err instanceof Error && err.name === "NotAllowedError") {
                setBlockedTick((n) => n + 1);
                setError("Tap play to start — your browser blocked autoplay");
              }
              setIsBuffering(false);
            });
          }
        }
      }
    }
  }, []);

  // Transport controls key off currentYtIdRef (updated synchronously in load)
  // instead of the isYtMode state, which lags one render behind.
  const play = useCallback(async () => {
    if (currentYtIdRef.current) {
      ytWantPlayRef.current = true;
      playYouTubeVideo(currentYtIdRef.current);
    } else {
      try {
        await audioRef.current?.play();
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") setBlockedTick((n) => n + 1);
        setError(err instanceof Error ? err.message : "Playback could not start");
      }
    }
  }, []);

  const pause = useCallback(() => {
    if (currentYtIdRef.current) {
      ytWantPlayRef.current = false;
      pauseYouTubeVideo();
    } else audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const ytId = currentYtIdRef.current;
    if (ytId) {
      if (isPlaying || ytWantPlayRef.current) {
        ytWantPlayRef.current = false;
        pauseYouTubeVideo();
        setIsBuffering(false);
      } else {
        ytWantPlayRef.current = true;
        playYouTubeVideo(ytId);
      }
    } else {
      const el = audioRef.current;
      if (el) {
        if (el.paused) void play();
        else el.pause();
      }
    }
  }, [isPlaying, play]);

  const seek = useCallback((seconds: number) => {
    if (currentYtIdRef.current) {
      seekYouTubeVideo(seconds);
      setCurrentTime(seconds);
    } else {
      const el = audioRef.current;
      if (el && Number.isFinite(seconds) && el.duration > 0) {
        try {
          el.currentTime = Math.min(Math.max(0, seconds), el.duration - 0.25);
          setCurrentTime(el.currentTime);
        } catch {}
      }
    }
  }, []);

  const nudge = useCallback((delta: number) => seek(currentTime + delta), [seek, currentTime]);

  const setVolume = useCallback((v: number) => {
    const nextV = Math.min(1, Math.max(0, v));
    setVolumeState(nextV);
    // Both outputs always get the level. Before, the YouTube player only got
    // it while already in YouTube mode, so a freshly booted player never
    // received the saved volume / mute state.
    setYouTubeVolume(nextV * 100);
    const el = audioRef.current;
    if (el) el.volume = nextV;
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    if (m) muteYouTubeVideo();
    else unMuteYouTubeVideo();
    if (audioRef.current) audioRef.current.muted = m;
  }, []);

  // Sync YouTube time
  useEffect(() => {
    if (!isYtMode) return;
    const interval = setInterval(() => {
      if (isPlaying) {
        setCurrentTime(getYouTubeTime());
        setDuration(getYouTubeDuration());
        setBufferedAhead(getYouTubeBuffered());
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isYtMode, isPlaying]);

  // Handle YouTube Events
  useEffect(() => {
    const handleStateChange = (e: any) => {
      const state = e.detail;
      // YT.PlayerState: -1 (unstarted), 0 (ended), 1 (playing), 2 (paused), 3 (buffering), 5 (video cued).
      if (state === 1) {
        setIsPlaying(true);
        setIsBuffering(false);
        setError(null);
      } else if (state === 2) {
        setIsPlaying(false);
      } else if (state === 3) {
        setIsBuffering(true);
      } else if (state === 5) {
        // cued: when the user paused / it is a restored session, it is simply
        // ready and waiting. If playback was requested the player is still
        // being nudged to start, so keep showing the spinner.
        setIsPlaying(false);
        if (!ytWantPlayRef.current) setIsBuffering(false);
      } else if (state === 0) {
        setIsPlaying(false);
        setEndTick((n) => n + 1);
      }
    };

    const handleError = (e: any) => {
      setIsBuffering(false);
      setIsPlaying(false);
      // Reset currentVideoId so that retrying the same video triggers a fresh load
      resetYTCurrentId();
      setErrorTick((n) => n + 1);
      const code = e?.detail;
      const message =
        code === 2
          ? "Invalid YouTube video ID."
          : code === 5
            ? "HTML5 playback error (YouTube player rejected this embed)."
            : code === 100
              ? "Video unavailable or private."
              : code === 101 || code === 150
                ? "Embedding blocked by YouTube / uploader settings."
                : `Unknown YouTube playback error${code ? ` (code ${code})` : ""}.`;
      setError(message);
    };

    window.addEventListener("yt-state-change", handleStateChange);
    window.addEventListener("yt-error", handleError);
    return () => {
      window.removeEventListener("yt-state-change", handleStateChange);
      window.removeEventListener("yt-error", handleError);
    };
  }, []);

  // Native audio event listeners
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const syncDuration = () => {
      if (isYtMode) return;
      const d = el.duration;
      const live = !Number.isFinite(d) || d === 0 || d > 60 * 60 * 6;
      setIsLive(live);
      setDuration(live ? 0 : d);
    };

    const onPlay = () => { if (!isYtMode) { setIsPlaying(true); setError(null); } };
    const onPause = () => { if (!isYtMode) setIsPlaying(false); };
    const onPlaying = () => { if (!isYtMode) { setIsBuffering(false); setIsPlaying(true); setError(null); } };
    const onCanPlay = () => { if (!isYtMode) setIsBuffering(false); };
    const onWaiting = () => { if (!isYtMode) setIsBuffering(true); };
    const onTime = () => {
      if (!isYtMode) {
        setCurrentTime(el.currentTime);
        if (el.currentTime > 0) setIsBuffering(false);
      }
    };
    const onProgress = () => {
      if (!isYtMode) {
        try {
          if (el.buffered.length > 0) setBufferedAhead(el.buffered.end(el.buffered.length - 1));
        } catch {}
      }
    };
    const onEnded = () => { if (!isYtMode) { setIsPlaying(false); setEndTick((n) => n + 1); } };
    const onError = () => {
      if (!isYtMode) {
        setIsBuffering(false);
        setIsPlaying(false);
        setErrorTick((n) => n + 1);
        setError("This open stream could not be reached");
      }
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("canplaythrough", onCanPlay);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("stalled", onWaiting);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", syncDuration);
    el.addEventListener("durationchange", syncDuration);
    el.addEventListener("progress", onProgress);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);

    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("canplaythrough", onCanPlay);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("stalled", onWaiting);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", syncDuration);
      el.removeEventListener("durationchange", syncDuration);
      el.removeEventListener("progress", onProgress);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, [isYtMode]);

  useEffect(() => () => {
    audioRef.current?.pause();
    releaseYouTubeVideo();
  }, []);

  return useMemo(
    () => ({
      isPlaying,
      isBuffering,
      currentTime,
      duration,
      bufferedAhead,
      volume,
      muted,
      isLive,
      error,
      endTick,
      errorTick,
      blockedTick,
      load,
      play,
      pause,
      toggle,
      seek,
      nudge,
      setVolume,
      setMuted,
    }),
    [
      isPlaying,
      isBuffering,
      currentTime,
      duration,
      bufferedAhead,
      volume,
      muted,
      isLive,
      error,
      endTick,
      errorTick,
      blockedTick,
      load,
      play,
      pause,
      toggle,
      seek,
      nudge,
      setVolume,
      setMuted,
    ]
  );
}
