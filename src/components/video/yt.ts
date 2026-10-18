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
    highres: "4K+", hd2880: "2880p", hd2160: "4K", hd1440: "1440p", hd1080: "1080p", hd720: "720p",
    large: "480p", medium: "360p", small: "240p", tiny: "144p",
  };
  return map[q] || "Auto";
}

export const YT_ERRORS: Record<number, string> = {
  2: "This video link looks invalid.",
  5: "This video can't be played in the browser.",
  100: "This video was removed or is private.",
  101: "The owner doesn't allow this video to be played outside YouTube.",
  150: "The owner doesn't allow this video to be played outside YouTube.",
  153: "YouTube refused to load this player.",
};
