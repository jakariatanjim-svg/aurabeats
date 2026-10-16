/**
 * Singleton YouTube IFrame player — the engine behind every YouTube /
 * YouTube Music track.
 *
 * First-launch reliability is the whole point of this module. On a cold start
 * (empty HTTP cache, no YouTube cookies yet) the player can take many seconds
 * to boot, and the old implementation had no way to recover if anything in
 * that chain went wrong — the first session stayed silent until a restart:
 *
 *  • A failed / stalled `iframe_api` or player load was never retried, so the
 *    ready promise could hang for the whole session.
 *  • The player lived 9999px off-screen. Browsers deprioritise and throttle
 *    off-screen cross-origin iframes, and YouTube wants a visible ≥200×200
 *    player, so a cold boot could stall there.
 *  • The boot player (no video yet) could emit an error that was blamed on the
 *    track the user had just tapped, which then got paused.
 *  • `loadVideoById` issued straight from `onReady` can leave a cold player
 *    "unstarted" without ever playing.
 *  • Volume / mute were never pushed into the player.
 *
 * Every one of those is handled below.
 */

type YTPlayer = {
  loadVideoById: (o: { videoId: string; startSeconds?: number }) => void;
  cueVideoById: (o: { videoId: string; startSeconds?: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (s: number, allowSeekAhead: boolean) => void;
  setVolume: (v: number) => void;
  mute: () => void;
  unMute: () => void;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  getVideoLoadedFraction: () => number;
  getIframe: () => HTMLIFrameElement;
  destroy: () => void;
};

type YTNamespace = { Player?: new (el: string | HTMLElement, opts: unknown) => YTPlayer };

const yt = () => (window as unknown as { YT?: YTNamespace }).YT;

/** YT.PlayerState */
const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

const SCRIPT_ID = "yt-iframe-api";
const CONTAINER_ID = "yt-hidden-player-container";
const PLAYER_ID = "yt-hidden-player";
/** How long one boot attempt (script + player) may take before it is rebuilt. */
const BOOT_TIMEOUT_MS = 15000;
const MAX_BACKOFF_MS = 20000;

let ytPlayer: YTPlayer | null = null;
let ytReady = false;
let readyPromise: Promise<void> | null = null;
let resolveReady: (() => void) | null = null;

let bootAttempt = 0;
let bootTimer: number | null = null;
let retryTimer: number | null = null;
let onlineHooked = false;
let apiReadyHandler: (() => void) | null = null;

/** Video currently loaded in the player (null after an error, so a retry reloads). */
let currentVideoId: string | null = null;
/** The video the app last asked for — survives until the player can take it. */
let requestedVideoId: string | null = null;
let requestedAutoplay = true;
let kickTimers: number[] = [];

/** Desired output level, applied whenever a player (re)appears. */
let desiredVolume = 85;
let desiredMuted = false;

/* ------------------------------------------------------------------------ */
/* boot                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Starts (or joins) the player boot. Safe to call any number of times; the
 * returned promise resolves once the player is ready — after however many
 * automatic retries that takes.
 */
export function initYouTubePlayer(): Promise<void> {
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    hookOnline();
    boot();
  }
  return readyPromise;
}

function boot() {
  if (ytReady) return;
  clearTimer("boot");
  ensureContainer();

  // Each attempt gets a deadline; a stalled script or a player that never
  // reports ready is torn down and rebuilt instead of hanging forever.
  bootTimer = window.setTimeout(() => {
    console.warn("[YT Player] boot timed out — rebuilding");
    scheduleRetry();
  }, BOOT_TIMEOUT_MS);

  if (yt()?.Player) {
    createPlayer();
    return;
  }

  // Chain onto any foreign handler rather than replace it (once — retries
  // must not stack wrappers).
  const w = window as unknown as { onYouTubeIframeAPIReady?: () => void };
  if (w.onYouTubeIframeAPIReady !== apiReadyHandler) {
    const previous = w.onYouTubeIframeAPIReady;
    apiReadyHandler = () => {
      try {
        previous?.();
      } catch {
        /* ignore foreign handler errors */
      }
      if (!ytReady && !ytPlayer) createPlayer();
    };
    w.onYouTubeIframeAPIReady = apiReadyHandler;
  }

  if (!document.getElementById(SCRIPT_ID)) {
    const tag = document.createElement("script");
    tag.id = SCRIPT_ID;
    tag.async = true;
    // A cache-buster on retries makes sure a failed response is not reused.
    tag.src = `https://www.youtube.com/iframe_api${bootAttempt > 0 ? `?r=${Date.now()}` : ""}`;
    tag.onerror = () => {
      console.warn("[YT Player] iframe_api failed to load");
      scheduleRetry();
    };
    document.head.appendChild(tag);
  }
}

function scheduleRetry() {
  if (ytReady) return;
  clearTimer("boot");
  clearTimer("retry");
  teardown();
  bootAttempt += 1;
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(bootAttempt - 1, 5));
  retryTimer = window.setTimeout(boot, delay);
}

/** Network came back: retry right away instead of waiting out the backoff. */
function hookOnline() {
  if (onlineHooked) return;
  onlineHooked = true;
  window.addEventListener("online", () => {
    if (ytReady || !readyPromise) return;
    clearTimer("retry");
    teardown();
    boot();
  });
}

/** Removes a half-booted player (and the API script if it never arrived). */
function teardown() {
  try {
    ytPlayer?.destroy();
  } catch {
    /* ignore */
  }
  ytPlayer = null;
  ytReady = false;
  currentVideoId = null;
  document.getElementById(CONTAINER_ID)?.remove();
  if (!yt()?.Player) {
    document.getElementById(SCRIPT_ID)?.remove();
    // A script that ran but whose widget bundle failed leaves a stub YT object
    // flagged "loading", which would make the next iframe_api a no-op.
    const w = window as unknown as { YT?: YTNamespace & { loading?: number } };
    if (w.YT && !w.YT.Player) delete w.YT;
    document.getElementById("www-widgetapi-script")?.remove();
  }
}

function clearTimer(which: "boot" | "retry") {
  if (which === "boot" && bootTimer !== null) {
    window.clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (which === "retry" && retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * Host for the player. It must stay inside the viewport and at least 200×200
 * (YouTube's minimum embed size): browsers throttle off-screen cross-origin
 * iframes, which could stall a cold player boot. It sits behind the whole UI
 * (z-index -1), fully transparent and click-through, so it is never seen.
 */
function ensureContainer() {
  if (document.getElementById(CONTAINER_ID)) return;
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:fixed;left:0;bottom:0;width:240px;height:240px;opacity:0.01;pointer-events:none;overflow:hidden;z-index:-1;";
  const playerDiv = document.createElement("div");
  playerDiv.id = PLAYER_ID;
  container.appendChild(playerDiv);
  document.body.appendChild(container);
}

function createPlayer() {
  const YT = yt();
  if (!YT?.Player || ytPlayer) return;
  ensureContainer();

  ytPlayer = new YT.Player(PLAYER_ID, {
    height: "240",
    width: "240",
    // No videoId: the player boots empty and receives tracks via load/cue.
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      playsinline: 1,
      rel: 0,
      iv_load_policy: 3,
      enablejsapi: 1,
      // The player needs a real origin: the hosted site (https) and the
      // Android app (Capacitor serves it on https://localhost) both have one.
      // A direct file:// open would give an opaque origin, so skip the
      // parameter there instead of sending "null".
      ...(window.location.protocol === "https:" || window.location.protocol === "http:"
        ? { origin: window.location.origin }
        : {}),
    },
    events: {
      onReady: () => {
        ytReady = true;
        bootAttempt = 0;
        clearTimer("boot");
        clearTimer("retry");
        patchIframe();
        applyOutput();
        // Hand over whatever the user asked for while the player was booting.
        if (requestedVideoId) startRequested();
        resolveReady?.();
        window.dispatchEvent(new CustomEvent("yt-ready"));
      },
      onStateChange: (event: { data: number }) => {
        if (event.data === STATE.PLAYING || event.data === STATE.BUFFERING) clearKicks();
        window.dispatchEvent(new CustomEvent("yt-state-change", { detail: event.data }));
      },
      onError: (event: { data: number }) => {
        console.warn("[YT Player] Error code:", event.data);
        clearKicks();
        // Errors raised before a video was actually handed to the player
        // belong to the empty boot player — they must not fail (and pause)
        // the track the user tapped while it was still booting.
        if (!requestedVideoId || !currentVideoId) return;
        currentVideoId = null; // reset so retry works
        window.dispatchEvent(new CustomEvent("yt-error", { detail: event.data }));
      },
    },
  });
  patchIframe();
}

/**
 * Makes sure the iframe delegates autoplay + EME. YouTube's own `allow` list
 * is kept (merged, not replaced). Never touches iframe.src — that would
 * reload the player in a loop.
 */
function patchIframe() {
  try {
    const iframe = ytPlayer?.getIframe?.();
    if (!iframe) return;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    const allow = new Set(
      (iframe.getAttribute("allow") ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    ["autoplay", "encrypted-media", "picture-in-picture"].forEach((f) => allow.add(f));
    iframe.setAttribute("allow", [...allow].join("; "));
  } catch {
    /* ignore */
  }
}

function applyOutput() {
  if (!ytReady || !ytPlayer) return;
  try {
    ytPlayer.setVolume(desiredVolume);
    if (desiredMuted || desiredVolume === 0) ytPlayer.mute();
    else ytPlayer.unMute();
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------------ */
/* playback                                                                 */
/* ------------------------------------------------------------------------ */

function clearKicks() {
  kickTimers.forEach((t) => window.clearTimeout(t));
  kickTimers = [];
}

/**
 * A cold player sometimes accepts `loadVideoById` and then just sits in
 * "unstarted" / "cued". If it has not started after a moment, nudge it.
 */
function scheduleKicks(videoId: string) {
  clearKicks();
  [1500, 4000, 8000].forEach((delay) => {
    kickTimers.push(
      window.setTimeout(() => {
        if (!ytReady || !ytPlayer || requestedVideoId !== videoId || !requestedAutoplay) return;
        try {
          const state = ytPlayer.getPlayerState();
          if (state === STATE.UNSTARTED || state === STATE.CUED) {
            applyOutput();
            ytPlayer.playVideo();
          }
        } catch {
          /* ignore */
        }
      }, delay),
    );
  });
}

function startRequested() {
  if (!ytPlayer || !ytReady || !requestedVideoId) return;
  const videoId = requestedVideoId;
  try {
    applyOutput();
    if (requestedAutoplay) {
      ytPlayer.loadVideoById({ videoId, startSeconds: 0 });
      scheduleKicks(videoId);
    } else {
      ytPlayer.cueVideoById({ videoId, startSeconds: 0 });
      clearKicks();
    }
    currentVideoId = videoId;
  } catch (err) {
    console.warn("[YT Player] load failed:", err);
  }
}

/**
 * Plays (or, with `autoplay: false`, just cues) a video. Works at any time:
 * before the player is ready the request is remembered and started the moment
 * it is — after any number of boot retries.
 */
export function playYouTubeVideo(videoId: string, autoplay = true) {
  requestedVideoId = videoId;
  requestedAutoplay = autoplay;

  if (!ytReady || !ytPlayer) {
    void initYouTubePlayer();
    return;
  }

  patchIframe();

  if (currentVideoId === videoId) {
    try {
      const state = ytPlayer.getPlayerState();
      if (state === STATE.ENDED || state === STATE.UNSTARTED) {
        startRequested();
      } else if (autoplay) {
        applyOutput();
        ytPlayer.playVideo();
        if (state === STATE.CUED) scheduleKicks(videoId);
      }
    } catch {
      startRequested();
    }
  } else {
    startRequested();
  }
}

export function isYouTubePlayerReady() {
  return ytReady && ytPlayer !== null;
}

export function pauseYouTubeVideo() {
  clearKicks();
  requestedAutoplay = false;
  if (ytReady && ytPlayer) {
    try {
      ytPlayer.pauseVideo();
    } catch {
      /* ignore */
    }
  }
}

/** Fully hand the output over to another source (native audio). */
export function releaseYouTubeVideo() {
  pauseYouTubeVideo();
  requestedVideoId = null;
}

export function seekYouTubeVideo(seconds: number) {
  if (ytReady && ytPlayer) {
    try {
      ytPlayer.seekTo(seconds, true);
    } catch {
      /* ignore */
    }
  }
}

export function setYouTubeVolume(volume: number) {
  desiredVolume = Math.round(Math.min(100, Math.max(0, volume)));
  applyOutput();
}

export function muteYouTubeVideo() {
  desiredMuted = true;
  applyOutput();
}

export function unMuteYouTubeVideo() {
  desiredMuted = false;
  applyOutput();
}

export function getYouTubeTime(): number {
  try {
    if (ytReady && ytPlayer) return ytPlayer.getCurrentTime() || 0;
  } catch {
    /* ignore */
  }
  return 0;
}

export function getYouTubeDuration(): number {
  try {
    if (ytReady && ytPlayer) return ytPlayer.getDuration() || 0;
  } catch {
    /* ignore */
  }
  return 0;
}

export function getYouTubeBuffered(): number {
  try {
    if (ytReady && ytPlayer) return ytPlayer.getVideoLoadedFraction() * ytPlayer.getDuration() || 0;
  } catch {
    /* ignore */
  }
  return 0;
}

export function resetYTCurrentId() {
  currentVideoId = null;
}
