/** Minimal loader + types for YouTube's official IFrame Player API. */

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(v: number): void;
  getVolume(): number;
  setPlaybackRate(r: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  getPlayerState(): number;
  getPlaybackQuality(): string;
  getAvailableQualityLevels(): string[];
  loadModule(m: string): void;
  getOption(module: string, option: string): unknown;
  setOption(module: string, option: string, value: unknown): void;
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      host?: string;
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onPlaybackRateChange?: (e: { data: number }) => void;
        onPlaybackQualityChange?: (e: { data: string }) => void;
        onError?: (e: { data: number }) => void;
        onAutoplayBlocked?: () => void;
        onApiChange?: () => void;
      };
    },
  ) => YTPlayer;
}

export const YTState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

export function loadYT(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load the YouTube player"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** "hd1080" → "1080p" */
export function qualityLabel(q: string): string {
  const map: Record<string, string> = {
    highres: "4320p", hd2880: "2880p", hd2160: "2160p", hd1440: "1440p", hd1080: "1080p", hd720: "720p",
    large: "480p", medium: "360p", small: "240p", tiny: "144p",
  };
  return map[q] || "Auto";
}

export const YT_ERRORS: Record<number, string> = {
  2: "This video link looks invalid.",
  5: "This video can't be played in the browser.",
  100: "This video was removed or is private.",
  101: "YouTube won't play this video here — the owner may not allow it on other sites, or YouTube wants a sign-in.",
  150: "YouTube won't play this video here — the owner may not allow it on other sites, or YouTube wants a sign-in.",
  152: "YouTube won't play this video outside YouTube right now.",
  153: "YouTube refused to load this player.",
};

/**
 * YouTube ignores setPlaybackQuality() and picks the quality from the
 * player's size, so a fixed quality = render the iframe at that width and
 * scale it down with CSS. Widths per level:
 */
export const QUALITY_WIDTH: Record<string, number> = {
  tiny: 256, small: 426, medium: 640, large: 854, hd720: 1280, hd1080: 1920, hd1440: 2560, hd2160: 3840, hd2880: 5120, highres: 7680,
};

/** YouTube-style tag next to a quality (HD / 4K / 8K). */
export function qualityTag(q: string): string {
  if (q === "highres") return "8K";
  if (q === "hd2880") return "5K";
  if (q === "hd2160") return "4K";
  return q.startsWith("hd") ? "HD" : "";
}
