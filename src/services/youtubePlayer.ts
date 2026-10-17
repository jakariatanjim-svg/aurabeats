/**
 * Singleton YouTube IFrame player — the engine behind every YouTube /
 * YouTube Music track.
 *
 * ── Why the first launch used to stay silent ────────────────────────────────
 * The player iframe was created the moment the app loaded — before the user
 * had touched the page. Browsers refuse audible autoplay on a page with no
 * user interaction yet, and the YouTube player settles into that "autoplay
 * blocked" state when it boots. Every later `loadVideoById` / `playVideo`
 * then just sat "unstarted" until the watchdog skipped the track, for every
 * track, for the whole session.
 *
 * A reload "fixed" it because browsers carry the earlier click over to the
 * reloaded page (same-origin navigation), so the new player booted already
 * allowed to play. That is why it failed even in a fresh incognito window
 * and only ever on the first load.
 *
 * ── What happens now ────────────────────────────────────────────────────────
 *  1. The IFrame API script is still fetched at startup (warm cache), with
 *     retries if it fails.
 *  2. The player itself is only created once the user has interacted with
 *     the page (first tap / click / key), so it boots in the "allowed" state.
 *  3. If a loaded track still does not start, the player is torn down and
 *     rebuilt for that track automatically, which is exactly what a manual
 *     restart used to do.
 * ------------------------------------------------------------------------- */

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
/** How long the API script may take before it is re-fetched. */
const SCRIPT_TIMEOUT_MS = 15000;
/** How long a created player may take to report ready before it is rebuilt. */
const PLAYER_TIMEOUT_MS = 15000;
const MAX_BACKOFF_MS = 20000;
/** A loaded track that has not started after this long gets a fresh player. */
const STUCK_REBUILD_MS = 7000;
/** Rebuilds allowed per requested track (then the watchdog takes over). */
const MAX_REBUILDS_PER_TRACK = 2;

let ytPlayer: YTPlayer | null = null;
let ytReady = false;
let readyPromise: Promise<void> | null = null;
let resolveReady: (() => void) | null = null;

let scriptAttempt = 0;
let scriptTimer: number | null = null;
let scriptRetryTimer: number | null = null;
let playerTimer: number | null = null;
let apiReadyHandler: (() => void) | null = null;
let started = false;

/** True once the user has interacted with the page (tap / click / key). */
let activated = false;

/** Video currently loaded in the player (null after an error, so a retry reloads). */
let currentVideoId: string | null = null;
/** The video the app last asked for — survives until the player can take it. */
let requestedVideoId: string | null = null;
let requestedAutoplay = true;
let rebuildsForRequest = 0;
let kickTimers: number[] = [];

/** Desired output level, applied whenever a player (re)appears. */
let desiredVolume = 85;
let desiredMuted = false;

/* ------------------------------------------------------------------------ */
/* boot                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Starts the boot (idempotent). The returned promise resolves once a player
 * is ready, which needs a first user interaction.
 */
export function initYouTubePlayer(): Promise<void> {
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
  }
  if (!started) {
    started = true;
    watchActivation();
    window.addEventListener("online", () => {
      if (!yt()?.Player) {
        clearScriptTimers();
        removeScript();
        loadScript();
      } else ensurePlayer();
    });
    loadScript();
  }
  return readyPromise;
}

/* ---- user activation ---------------------------------------------------- */

function hasBeenActive() {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return Boolean(ua?.hasBeenActive);
}

function watchActivation() {
  if (activated || hasBeenActive()) {
    activated = true;
    return;
  }
  // These are the events that grant user activation. Listen in the capture
  // phase so the player starts booting on the very first tap, even when that
  // tap is the one that picks a track.
  const events = ["pointerup", "click", "keydown", "touchend"] as const;
  const onActivate = () => {
    if (activated) return;
    activated = true;
    events.forEach((e) => window.removeEventListener(e, onActivate, true));
    ensurePlayer();
  };
  events.forEach((e) => window.addEventListener(e, onActivate, { capture: true, passive: true }));
}

/* ---- API script --------------------------------------------------------- */

function loadScript() {
  if (yt()?.Player) {
    ensurePlayer();
    return;
  }

  // Chain onto any foreign handler rather than replace it (once).
  const w = window as unknown as { onYouTubeIframeAPIReady?: () => void };
  if (w.onYouTubeIframeAPIReady !== apiReadyHandler) {
    const previous = w.onYouTubeIframeAPIReady;
    apiReadyHandler = () => {
      try {
        previous?.();
      } catch {
        /* ignore foreign handler errors */
      }
      clearScriptTimers();
      scriptAttempt = 0;
      ensurePlayer();
    };
    w.onYouTubeIframeAPIReady = apiReadyHandler;
  }

  if (document.getElementById(SCRIPT_ID)) return;
  const tag = document.createElement("script");
  tag.id = SCRIPT_ID;
  tag.async = true;
  // Cache-buster on retries so a failed response is not reused.
  tag.src = `https://www.youtube.com/iframe_api${scriptAttempt > 0 ? `?r=${Date.now()}` : ""}`;
  tag.onerror = () => {
    console.warn("[YT Player] iframe_api failed to load");
    retryScript();
  };
  document.head.appendChild(tag);

  if (scriptTimer !== null) window.clearTimeout(scriptTimer);
  scriptTimer = window.setTimeout(() => {
    if (!yt()?.Player) {
      console.warn("[YT Player] iframe_api timed out — retrying");
      retryScript();
    }
  }, SCRIPT_TIMEOUT_MS);
}

function retryScript() {
  clearScriptTimers();
  removeScript();
  scriptAttempt += 1;
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(scriptAttempt - 1, 5));
  scriptRetryTimer = window.setTimeout(loadScript, delay);
}

function clearScriptTimers() {
  if (scriptTimer !== null) window.clearTimeout(scriptTimer);
  if (scriptRetryTimer !== null) window.clearTimeout(scriptRetryTimer);
  scriptTimer = scriptRetryTimer = null;
}

/** Removes a failed API load, including the stub `YT` object it leaves behind. */
function removeScript() {
  if (yt()?.Player) return;
  document.getElementById(SCRIPT_ID)?.remove();
  document.getElementById("www-widgetapi-script")?.remove();
  const w = window as unknown as { YT?: YTNamespace };
  if (w.YT && !w.YT.Player) delete w.YT;
}

/* ---- player ------------------------------------------------------------- */

/** Creates the player once the API is loaded AND the user has interacted. */
function ensurePlayer() {
  if (ytPlayer || !yt()?.Player) return;
  if (!activated) {
    if (!hasBeenActive()) return;
    activated = true;
  }
  createPlayer();
}

/**
 * Host for the player: inside the viewport and at least 200×200 (YouTube's
 * minimum), because browsers throttle off-screen cross-origin iframes. It
 * sits behind the whole UI (z-index -1), fully transparent and click-through.
 */
function ensureContainer() {
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = CONTAINER_ID;
    container.setAttribute("aria-hidden", "true");
    container.style.cssText =
      "position:fixed;left:0;bottom:0;width:240px;height:240px;opacity:0.01;pointer-events:none;overflow:hidden;z-index:-1;";
    document.body.appendChild(container);
  }
  container.replaceChildren();
  const playerDiv = document.createElement("div");
  playerDiv.id = PLAYER_ID;
  container.appendChild(playerDiv);
}

function createPlayer() {
  const YT = yt();
  if (!YT?.Player || ytPlayer) return;
  ensureContainer();
  ytReady = false;
  currentVideoId = null;

  const pendingId = requestedVideoId;
  const pendingAutoplay = requestedAutoplay;

  ytPlayer = new YT.Player(PLAYER_ID, {
    height: "240",
    width: "240",
    // When a track is already waiting, boot straight into it (most reliable
    // path: a plain autoplaying embed). Otherwise boot empty.
    ...(pendingId ? { videoId: pendingId } : {}),
    playerVars: {
      autoplay: pendingId && pendingAutoplay ? 1 : 0,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      playsinline: 1,
      rel: 0,
      iv_load_policy: 3,
      enablejsapi: 1,
      // Real origin needed for the postMessage channel (site = https, the
      // Android app = https://localhost). Skip it for opaque origins.
      ...(window.location.protocol === "https:" || window.location.protocol === "http:"
        ? { origin: window.location.origin }
        : {}),
    },
    events: {
      onReady: () => {
        ytReady = true;
        clearPlayerTimer();
        patchIframe();
        applyOutput();
        if (pendingId && pendingId === requestedVideoId) {
          // Booted with this track already; make sure it is actually going.
          currentVideoId = pendingId;
          if (requestedAutoplay) {
            try {
              ytPlayer?.playVideo();
            } catch {
              /* ignore */
            }
            scheduleKicks(pendingId);
          }
        } else if (requestedVideoId) {
          startRequested();
        }
        resolveReady?.();
        window.dispatchEvent(new CustomEvent("yt-ready"));
      },
      onStateChange: (event: { data: number }) => {
        if (event.data === STATE.PLAYING) clearKicks();
        window.dispatchEvent(new CustomEvent("yt-state-change", { detail: event.data }));
      },
      onError: (event: { data: number }) => {
        console.warn("[YT Player] Error code:", event.data);
        clearKicks();
        // Errors before a video was handed to the player belong to the empty
        // boot player; they must not fail the track the user tapped.
        if (!requestedVideoId || !currentVideoId) return;
        currentVideoId = null; // reset so retry works
        window.dispatchEvent(new CustomEvent("yt-error", { detail: event.data }));
      },
    },
  });
  patchIframe();

  clearPlayerTimer();
  playerTimer = window.setTimeout(() => {
    if (!ytReady) {
      console.warn("[YT Player] player did not become ready — rebuilding");
      rebuildPlayer();
    }
  }, PLAYER_TIMEOUT_MS);
}

function clearPlayerTimer() {
  if (playerTimer !== null) window.clearTimeout(playerTimer);
  playerTimer = null;
}

function destroyPlayer() {
  clearKicks();
  clearPlayerTimer();
  try {
    ytPlayer?.destroy();
  } catch {
    /* ignore */
  }
  ytPlayer = null;
  ytReady = false;
  currentVideoId = null;
}

/** Throws the current player away and boots a fresh one (picks up the pending track). */
function rebuildPlayer() {
  destroyPlayer();
  ensurePlayer();
}

/**
 * Makes sure the iframe delegates autoplay + EME. YouTube's own `allow` list
 * is kept (merged, not replaced). Never touches iframe.src.
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

/* ------------------------------------------------------------------------ */
/* playback                                                                 */
/* ------------------------------------------------------------------------ */

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

function clearKicks() {
  kickTimers.forEach((t) => window.clearTimeout(t));
  kickTimers = [];
}

/**
 * After a load: nudge a player that sits "unstarted"/"cued", and if the track
 * still has not started, rebuild the player for it.
 */
function scheduleKicks(videoId: string) {
  clearKicks();
  const stillWanted = () => ytReady && ytPlayer && requestedVideoId === videoId && requestedAutoplay;
  [1500, 4000].forEach((delay) => {
    kickTimers.push(
      window.setTimeout(() => {
        if (!stillWanted()) return;
        try {
          const state = ytPlayer!.getPlayerState();
          if (state === STATE.UNSTARTED || state === STATE.CUED) {
            applyOutput();
            ytPlayer!.playVideo();
          }
        } catch {
          /* ignore */
        }
      }, delay),
    );
  });
  kickTimers.push(
    window.setTimeout(() => {
      if (!stillWanted()) return;
      let state: number = STATE.UNSTARTED;
      try {
        state = ytPlayer!.getPlayerState();
      } catch {
        /* treat as stuck */
      }
      if (state === STATE.UNSTARTED || state === STATE.CUED) {
        if (rebuildsForRequest >= MAX_REBUILDS_PER_TRACK) return;
        rebuildsForRequest += 1;
        console.warn(`[YT Player] track did not start — rebuilding player (${rebuildsForRequest})`);
        rebuildPlayer();
      }
    }, STUCK_REBUILD_MS),
  );
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
 * before the player exists the request is kept and the player boots straight
 * into it.
 */
export function playYouTubeVideo(videoId: string, autoplay = true) {
  if (videoId !== requestedVideoId) rebuildsForRequest = 0;
  requestedVideoId = videoId;
  requestedAutoplay = autoplay;

  if (!ytPlayer) {
    void initYouTubePlayer();
    // A play request normally follows a tap, so this usually creates the
    // player right here (booting directly into the track).
    if (autoplay) {
      if (hasBeenActive()) activated = true;
      ensurePlayer();
    }
    return;
  }
  if (!ytReady) return; // booting: onReady picks the request up

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
