import { showVolumeUi } from "@/utils/device";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  Download,
  DownloadCloud,
  Trash2,
  Moon,
  AlignLeft,
  ChevronUp,
  ListPlus,
  MonitorPlay, Film } from "lucide-react";
import { cn } from "@/utils/cn";
import { FavIcon } from "@/components/FavIcon";
import { videoIdOfTrack, watchTrackVideo, canSaveOffline } from "@/utils/watchVideo";
import { OpenIn } from "@/components/OpenIn";
import { requestVideoDownload } from "@/services/videoDownload";
import { formatTime, gradientFrom } from "@/utils/format";
import { usePlaybackClock, usePlayer } from "@/hooks/usePlayer";
import { Artwork, IconButton, Slider } from "@/components/ui";
import { Visualizer } from "@/components/Visualizer";
import { TrackRow } from "@/components/TrackList";
import { LyricsViewer } from "@/components/LyricsViewer";
import { storage } from "@/utils/storage";
import { useBackHandler, useEscape } from "@/utils/backStack";
import { songsLike } from "@/services/upNext";
import type { Track } from "@/types";

export function FullScreenPlayer() {
  const { currentTime, duration, bufferedAhead } = usePlaybackClock();
  const {
    current,
    queue,
    index,
    isPlaying,
    isBuffering,
    isLive,
    volume,
    muted,
    shuffle,
    repeat,
    expanded,
    setExpanded,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    isFavorite,
    toggleFavorite,
    jumpTo,
    playNow,
    settings,
    downloadTrack,
    isOffline,
    saveOffline,
    removeOffline,
    updateSettings,
    toast,
    pause,
  } = usePlayer();

  // Drag-to-close: the sheet follows the finger and slides down into the mini
  // player; a short pull springs back. Imperative transform (no re-renders).
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; y0: number; dy: number; locked: boolean; lastY: number; lastT: number; v: number } | null>(null);
  const closing = useRef(false);

  const moveTo = (y: number, animate: boolean) => {
    const el = rootRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    el.style.transform = y > 0 ? `translate3d(0, ${y}px, 0)` : "";
  };

  /** Slide down, then collapse to the mini player (chevron, back, swipe). */
  const dismiss = useCallback(() => {
    const el = rootRef.current;
    if (closing.current) return;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setExpanded(false);
      return;
    }
    closing.current = true;
    el.style.transition = "transform 260ms cubic-bezier(0.4, 0, 0.2, 1)";
    el.style.transform = "translate3d(0, 100%, 0)";
    window.setTimeout(() => {
      closing.current = false;
      setExpanded(false);
    }, 250);
  }, [setExpanded]);

  useBackHandler(expanded, dismiss);

  const [showLyrics, setShowLyrics] = useState(false);
  const [showTimerMenu, setShowTimerMenu] = useState(false);
  const [romanized, setRomanizedState] = useState(() => storage.get("lyricsRomanized", false));
  const [canRomanize, setCanRomanize] = useState(false);
  const setRomanized = (v: boolean) => {
    setRomanizedState(v);
    storage.set("lyricsRomanized", v);
  };

  // Phones: lyrics is a page to the right of the artwork. A right-to-left
  // swipe opens it; on lyrics, a swipe either way goes back. A left-to-right
  // swipe on the artwork only rubber-bands. Imperative transforms.
  const isPhone = !useMinWidth(768);
  const pagerRef = useRef<HTMLDivElement>(null);
  const artPaneRef = useRef<HTMLDivElement>(null);
  const lyricsPaneRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x0: number; y0: number; dx: number; lock: boolean; lastX: number; lastT: number; v: number } | null>(null);
  const paneBusy = useRef(false);
  const resetPanes = useRef(false);
  const [peek, setPeek] = useState(false); // lyrics pane drawn while swiping

  const placePane = (el: HTMLElement | null, x: number, animate: boolean) => {
    if (!el) return;
    el.style.transition = animate ? "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    el.style.transform = `translate3d(${x}px, 0, 0)`;
    el.style.visibility = "visible";
  };
  const clearPanes = () => {
    for (const el of [artPaneRef.current, lyricsPaneRef.current]) {
      if (!el) continue;
      el.style.transition = "";
      el.style.transform = "";
      el.style.visibility = "";
    }
  };
  useLayoutEffect(() => {
    if (!resetPanes.current) return;
    resetPanes.current = false;
    clearPanes();
    setPeek(false);
  }, [showLyrics]);

  /** Lay both pages out for a finger offset `dx` (current page moves by dx). */
  const layoutPanes = (dx: number, animate: boolean) => {
    const w = pagerRef.current?.clientWidth || window.innerWidth;
    const art = artPaneRef.current;
    const lyr = lyricsPaneRef.current;
    if (!showLyrics) {
      placePane(art, dx, animate);
      if (dx < 0) placePane(lyr, w + dx, animate);
      else if (lyr) lyr.style.visibility = "hidden";
    } else {
      placePane(lyr, dx, animate);
      placePane(art, dx > 0 ? dx - w : w + dx, animate);
    }
  };

  const onPagerTouchStart = (e: React.TouchEvent) => {
    if (!isPhone || paneBusy.current || closing.current) return;
    if ((e.target as HTMLElement).closest('[role="slider"], input[type="range"], [data-upnext]')) return;
    const t = e.touches[0];
    swipe.current = { x0: t.clientX, y0: t.clientY, dx: 0, lock: false, lastX: t.clientX, lastT: performance.now(), v: 0 };
  };
  const onPagerTouchMove = (e: React.TouchEvent) => {
    const s = swipe.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x0;
    const dy = t.clientY - s.y0;
    if (!s.lock) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        s.lock = true;
        setPeek(true);
      } else {
        swipe.current = null;
        return;
      }
    }
    const now = performance.now();
    s.v = 0.7 * ((t.clientX - s.lastX) / Math.max(1, now - s.lastT)) + 0.3 * s.v;
    s.lastX = t.clientX;
    s.lastT = now;
    s.dx = !showLyrics && dx > 0 ? dx * 0.2 : dx; // nothing to the left of the artwork
    layoutPanes(s.dx, false);
  };
  const onPagerTouchEnd = () => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || !s.lock) return;
    const w = pagerRef.current?.clientWidth || window.innerWidth;
    const dir = Math.sign(s.dx);
    const allowed = showLyrics || dir < 0;
    const far = Math.abs(s.dx) > w * 0.25;
    const flick = Math.abs(s.v) > 0.45 && Math.abs(s.dx) > 30 && Math.sign(s.v) === dir;
    paneBusy.current = true;
    if (allowed && dir !== 0 && (far || flick)) {
      const leaving = showLyrics ? lyricsPaneRef.current : artPaneRef.current;
      const coming = showLyrics ? artPaneRef.current : lyricsPaneRef.current;
      placePane(leaving, dir * w, true);
      placePane(coming, 0, true);
      window.setTimeout(() => {
        paneBusy.current = false;
        resetPanes.current = true;
        setShowLyrics((v) => !v);
      }, 280);
    } else {
      // spring back
      if (!showLyrics) {
        placePane(artPaneRef.current, 0, true);
        if (s.dx < 0) placePane(lyricsPaneRef.current, w, true);
      } else {
        placePane(lyricsPaneRef.current, 0, true);
        placePane(artPaneRef.current, s.dx > 0 ? -w : w, true);
      }
      window.setTimeout(() => {
        paneBusy.current = false;
        clearPanes();
        setPeek(false);
      }, 290);
    }
  };

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, dismiss]);

  const fav = current ? isFavorite(current.id) : false;
  const offline = current ? isOffline(current.id) : false;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (closing.current) return;
    const target = e.target as HTMLElement;
    // Lists / lyrics scrolled down scroll first; sliders keep their drag.
    const scrollEl = target.closest(".scroll-area");
    if (scrollEl && scrollEl.scrollTop > 0) return;
    if (target.closest('[role="slider"], input[type="range"], [data-upnext]')) return;
    const t = e.touches[0];
    drag.current = { x0: t.clientX, y0: t.clientY, dy: 0, locked: false, lastY: t.clientY, lastT: performance.now(), v: 0 };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    if (!d) return;
    const t = e.touches[0];
    const dy = t.clientY - d.y0;
    const dx = t.clientX - d.x0;
    if (!d.locked) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      // Only a mostly-downward pull grabs the sheet.
      if (dy > 0 && dy > Math.abs(dx) * 1.4) d.locked = true;
      else {
        drag.current = null;
        return;
      }
    }
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.v = 0.7 * ((t.clientY - d.lastY) / dt) + 0.3 * d.v; // px/ms, smoothed
    d.lastY = t.clientY;
    d.lastT = now;
    d.dy = Math.max(0, dy);
    moveTo(d.dy, false);
  };

  const handleTouchEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.locked) return;
    const h = rootRef.current?.clientHeight || window.innerHeight;
    if (d.dy > h * 0.22 || (d.v > 0.55 && d.dy > 40)) dismiss();
    else moveTo(0, true);
  };

  const setTimer = (mins: number) => {
    if (mins === 0) {
      updateSettings({ sleepTimer: undefined });
      toast("Sleep timer cancelled", "info");
      setShowTimerMenu(false);
    } else if (settings.sleepTimer && settings.sleepTimer > Date.now()) {
      // Add time to existing timer
      updateSettings({ sleepTimer: settings.sleepTimer + mins * 60000 });
      toast(`Added ${mins} minutes to sleep timer`, "success");
    } else {
      updateSettings({ sleepTimer: Date.now() + mins * 60000 });
      toast(`Sleep timer: ${mins} minutes`, "success");
      setShowTimerMenu(false);
    }
  };

  if (!expanded || !current) return null;

  const art = current.artworkLarge || current.artwork;
  /** Round glass control chip (top bar). */
  const chip = "blur-panel surface-raised glass-inset rounded-full! text-ink2 hover:bg-ink/[0.08] hover:text-ink";

  return (
    <div
      ref={rootRef}
      className="animate-sheet-up fixed inset-0 z-[85] overflow-hidden touch-pan-y bg-base text-ink"
      style={{ backgroundImage: "var(--app-bg-image)" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div className="relative z-10 flex h-full flex-col pt-[var(--sa-top)] pr-[var(--sa-right)] pb-[var(--sa-bottom)] pl-[var(--sa-left)]">
        {/* top bar */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
          <IconButton onClick={dismiss} aria-label="Close full screen" className={chip}>
            <ChevronDown className="h-5 w-5" />
          </IconButton>

          <div className="min-w-0 flex-1 text-center">
            <p className="text-[10px] font-bold tracking-[0.2em] text-ink3 uppercase">Now playing</p>
            <p className="truncate text-xs font-semibold text-ink2">{current.album || current.artist}</p>
          </div>

          <div className="relative flex items-center gap-2">
            {showLyrics && canRomanize && (
              <button
                type="button"
                onClick={() => setRomanized(!romanized)}
                aria-pressed={romanized}
                data-tip={romanized ? "Show original script" : "Show in Roman letters"}
                className={cn(
                  "flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-[14px] font-black tracking-tight transition-all",
                  romanized ? "bg-accent text-white shadow-[0_0_14px_-2px_var(--glow)]" : chip,
                )}
              >
                Aa
              </button>
            )}
            {videoIdOfTrack(current) && (
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  watchTrackVideo(current, currentTime, pause);
                }}
                aria-label="Watch the video"
                className={cn(chip, "flex h-10 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold text-accent")}
              >
                <MonitorPlay className="h-4 w-4" />
                <span className="hidden min-[400px]:inline">Video</span>
              </button>
            )}
            <IconButton
              onClick={() => setShowLyrics((v) => !v)}
              aria-label="Show lyrics"
              className={cn(chip, "max-md:hidden", showLyrics && "glow-ring text-accent hover:text-accent")}
            >
              <AlignLeft className="h-4 w-4" />
            </IconButton>
            <IconButton
              onClick={() => setShowTimerMenu((v) => !v)}
              aria-label="Sleep timer"
              className={cn(chip, settings.sleepTimer && "glow-ring text-accent hover:text-accent")}
            >
              <Moon className="h-4 w-4" />
            </IconButton>

            {showTimerMenu && (
              <div className="blur-panel surface-raised absolute top-full right-0 z-[100] mt-2 w-56 p-3 shadow-2xl animate-scale-in">
                <p className="px-1 pb-2 text-[10px] font-bold tracking-wider text-ink3 uppercase">Sleep timer</p>

                {settings.sleepTimer ? (
                  <div className="space-y-2">
                    <div className="rounded-xl bg-ink/[0.06] px-3 py-2 text-center">
                      <p className="text-[10px] text-ink3">Time remaining</p>
                      <p className="text-lg font-black text-accent tabular-nums">
                        {Math.max(0, Math.ceil((settings.sleepTimer - Date.now()) / 60000))} min
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {[5, 15, 30].map((m) => (
                        <button key={m} onClick={() => setTimer(m)} className="flex-1 rounded-lg bg-ink/[0.07] px-2 py-1.5 text-[11px] font-bold text-ink2 hover:bg-ink/[0.12] hover:text-ink">+{m} min</button>
                      ))}
                    </div>
                    <button onClick={() => setTimer(0)} className="w-full rounded-lg bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-500 hover:bg-rose-500/25">Cancel timer</button>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {[15, 30, 45, 60, 90, 120].map((m) => (
                      <button
                        key={m}
                        onClick={() => setTimer(m)}
                        className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-ink2 hover:bg-ink/[0.07] hover:text-ink"
                      >
                        {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}
                      </button>
                    ))}
                    <div className="mt-1 flex items-center gap-2 border-t border-line pt-2">
                      <input
                        type="number"
                        min="1"
                        max="480"
                        placeholder="Custom"
                        className="w-full rounded-lg bg-ink/[0.07] px-3 py-2 text-xs text-ink outline-none placeholder:text-ink3"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const val = parseInt((e.target as HTMLInputElement).value);
                            if (val > 0) setTimer(val);
                          }
                        }}
                      />
                      <span className="shrink-0 text-[10px] text-ink3">min</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 sm:px-8 lg:flex-row lg:items-stretch lg:gap-8">
          {/* Main area — artwork / lyrics on top, glass control card below */}
          <div className="flex min-w-0 flex-1 flex-col items-center">
            {/* artwork and lyrics: two pages side by side (phones swipe between them) */}
            <div
              ref={pagerRef}
              className="relative min-h-0 w-full flex-1 overflow-x-clip"
              onTouchStart={onPagerTouchStart}
              onTouchMove={onPagerTouchMove}
              onTouchEnd={onPagerTouchEnd}
              onTouchCancel={onPagerTouchEnd}
            >
              <div
                ref={artPaneRef}
                aria-hidden={showLyrics}
                className={cn("absolute inset-0 flex flex-col items-center justify-center gap-5 pt-3", showLyrics && "invisible")}
              >
                {/* artwork in a frosted glass frame */}
                <div key={current.id} className="ab-art-in relative w-[min(72vw,18rem,40dvh)] sm:w-[min(42vh,22rem)]">
                  <div
                    className={cn("absolute -inset-6 -z-10 rounded-[3rem] blur-[50px] transition-opacity duration-1000", isPlaying ? "opacity-70" : "opacity-30")}
                    style={art ? { backgroundImage: `url("${art}")`, backgroundSize: "cover", backgroundPosition: "center" } : { backgroundImage: gradientFrom(current.title) }}
                  />
                  <div className={cn(
                    "blur-panel glass-inset rounded-[2rem]! p-2 transition-transform duration-500 ease-out",
                    isPlaying ? "scale-100" : "scale-[0.94]",
                  )}>
                    <Artwork
                      src={art || undefined}
                      fallbackSrc={current.artworkFallback}
                      alt={current.title}
                      className="aspect-square w-full shadow-(--art-shadow)"
                      rounded="rounded-[1.5rem]"
                    />
                  </div>
                </div>
                <div key={`t-${current.id}`} className="ab-text-in w-full max-w-xl px-2 text-center">
                  <h2 className="truncate text-2xl font-black tracking-tight text-ink sm:text-3xl">{current.title}</h2>
                  <p className="mt-1 truncate text-sm text-ink2 sm:text-[1rem]">{current.artist}{current.genre ? ` • ${current.genre}` : ""}</p>
                  {current.source !== "local" && !current.isLive && (
                    <OpenIn kind="song" id={videoIdOfTrack(current)} query={`${current.title} ${current.artist}`} className="mt-2 justify-center" />
                  )}
                </div>
              </div>
              <div
                ref={lyricsPaneRef}
                aria-hidden={!showLyrics}
                className={cn("absolute inset-0 flex justify-center pt-3", !showLyrics && "invisible")}
              >
                {(showLyrics || peek) && (
                  <div className="blur-panel glass-inset h-full w-full max-w-2xl overflow-hidden rounded-[2rem]! p-2">
                    <LyricsViewer track={current} romanized={romanized} onRomanizable={setCanRomanize} />
                  </div>
                )}
              </div>
            </div>
            {/* phones: which page is showing (lyrics sits to the right) */}
            <div className="mt-2 flex items-center justify-center gap-1.5 md:hidden" aria-hidden>
              <span className={cn("h-1.5 rounded-full transition-all duration-300", showLyrics ? "w-1.5 bg-ink/25" : "w-4 bg-ink/70")} />
              <span className={cn("h-1.5 rounded-full transition-all duration-300", showLyrics ? "w-4 bg-ink/70" : "w-1.5 bg-ink/25")} />
            </div>

            {/* Controls — ALWAYS visible, on a raised glass card */}
            <div className="blur-panel surface-raised glass-inset mt-4 mb-4 w-full max-w-xl shrink-0 space-y-3 rounded-[2rem]! px-4 pt-4 pb-3 sm:mb-6 sm:px-6 sm:pt-5">
              {!showLyrics && (
                <div className="-mt-1 h-7 w-full opacity-80">
                  <Visualizer variant="mirror" barCount={48} active={isPlaying} />
                </div>
              )}
              <div className="w-full">
                <Slider ariaLabel="Seek" value={isLive ? 0 : currentTime} max={isLive ? 0 : duration} buffered={bufferedAhead} onChange={() => {}} onCommit={seek} height="h-1.5" disabled={isLive} />
                <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ink3">
                  <span>{isLive ? "LIVE" : formatTime(currentTime)}</span>
                  <span>{isLive ? "uninterrupted stream" : formatTime(duration)}</span>
                </div>
              </div>
              <div className="flex items-center justify-center gap-3 sm:gap-5">
                <IconButton active={shuffle} onClick={toggleShuffle} aria-label="Shuffle"><Shuffle className="h-[18px] w-[18px]" /></IconButton>
                <IconButton onClick={previous} aria-label="Previous" size="lg" className="text-ink"><SkipBack className="h-6 w-6 fill-current" /></IconButton>
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={isPlaying ? "Pause" : "Play"}
                  className={cn(
                    "focus-ring flex h-16 w-16 items-center justify-center rounded-full ab-primary shadow-xl transition-all duration-200 hover:scale-105 active:scale-95",
                    isPlaying && "bg-accent text-white shadow-[0_0_40px_-6px_var(--glow)]",
                  )}
                >
                  {isBuffering ? <Loader2 className="h-7 w-7 animate-spin" /> : <span key={isPlaying ? "pause" : "play"} className="ab-icon-swap flex">{isPlaying ? <Pause className="h-7 w-7 fill-current" /> : <Play className="h-7 w-7 translate-x-[2px] fill-current" />}</span>}
                </button>
                <IconButton onClick={next} aria-label="Next" size="lg" className="text-ink"><SkipForward className="h-6 w-6 fill-current" /></IconButton>
                <IconButton active={repeat === "one"} onClick={cycleRepeat} aria-label={repeat === "one" ? "Repeat ON" : "Repeat OFF"} className={repeat === "one" ? undefined : "opacity-60 hover:opacity-100"}>
                  {repeat === "one" ? <Repeat1 className="h-[18px] w-[18px]" /> : <Repeat className="h-[18px] w-[18px]" />}
                </IconButton>
              </div>
              <div className="flex items-center justify-center gap-1.5 border-t border-line pt-2.5 sm:gap-3">
                <IconButton aria-label="Favourite" onClick={() => toggleFavorite(current)} className={cn(fav && "text-accent hover:text-accent")}><FavIcon track={current} on={fav} className="h-5 w-5" /></IconButton>
                {(offline || canSaveOffline(current)) && (
                  <IconButton aria-label={offline ? "Remove from offline" : "Save for offline"} onClick={() => offline ? removeOffline(current.id) : saveOffline(current)} className={cn(offline && "text-cyan-500 hover:text-cyan-500")}>{offline ? <Trash2 className="h-5 w-5" /> : <DownloadCloud className="h-5 w-5" />}</IconButton>
                )}
                {current.source !== "local" && (
                  <IconButton aria-label={videoIdOfTrack(current) ? "Download MP3" : "Export file"} onClick={() => downloadTrack(current)}><Download className="h-5 w-5" /></IconButton>
                )}
                {videoIdOfTrack(current) && (
                  <IconButton aria-label="Download video" onClick={() => requestVideoDownload({ id: videoIdOfTrack(current)!, title: current.title, author: current.artist })}><Film className="h-5 w-5" /></IconButton>
                )}
                {showVolumeUi && (
                  <>
                    <IconButton onClick={toggleMute} aria-label="Mute"><VolumeIcon className="h-5 w-5" /></IconButton>
                    <div className="w-24 sm:w-36"><Slider ariaLabel="Volume" value={muted ? 0 : volume * 100} max={100} onChange={(v) => setVolume(v / 100)} height="h-1" /></div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* right: up next */}
          {settings.queueEnabled && (
            <div className="blur-panel surface-raised glass-inset mb-4 w-full shrink-0 self-start p-3 max-md:hidden lg:mt-3 lg:w-[23rem]">
              <p className="mb-2 px-1 text-[10px] font-bold tracking-[0.18em] text-ink3 uppercase">
                Up next · {Math.max(0, queue.length - index - 1)} queued
              </p>
              <div className="scroll-area max-h-[38vh] space-y-0.5 overflow-y-auto pr-1 lg:max-h-[calc(100vh-14rem)]">
                {queue.slice(index + 1, index + 40).map((t, i) => (
                  <button
                    key={`${t.id}-${i}`}
                    type="button"
                    onClick={() => jumpTo(index + 1 + i)}
                    className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition hover:bg-ink/[0.07]"
                  >
                    <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-ink3">{i + 1}</span>
                    <Artwork
                      src={t.artwork || undefined}
                      fallbackSrc={t.artworkFallback}
                      alt={t.title}
                      className="h-9 w-9 shrink-0"
                      rounded="rounded-lg"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-ink">{t.title}</span>
                      <span className="block truncate text-[11px] text-ink3">{t.artist}</span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink3">
                      {t.isLive ? "∞" : formatTime(t.duration)}
                    </span>
                  </button>
                ))}
                {queue.length - index - 1 <= 0 && (
                  <div className="p-4 text-center text-xs text-ink3">
                    Queue is empty — play something else to keep the vibe going.
                  </div>
                )}
              </div>
              {queue.length > 1 && (
                <button
                  type="button"
                  onClick={() => playNow(queue[(index + 1) % queue.length], queue)}
                  className="mt-2 w-full rounded-xl border border-line py-2 text-xs font-bold text-ink2 transition hover:border-accent hover:text-accent"
                >
                  Jump to next track
                </button>
              )}
            </div>
          )}
        </div>

        {/* phones: pull-up "Up next" drawer (queue + songs like this one) */}
        <UpNextDrawer />
      </div>
    </div>
  );
}

export function QueuePanel() {
  const { queue, index, queueOpen, setQueueOpen, removeFromQueue, clearQueue, playAll, current } = usePlayer();
  useBackHandler(queueOpen, () => setQueueOpen(false));
  return (
    <>
      {queueOpen && <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setQueueOpen(false)} />}
      <aside
        className={cn(
          "blur-panel surface-raised fixed top-0 right-0 z-[61] flex h-full w-[min(92vw,22rem)] flex-col rounded-none! border-y-0! border-r-0! pt-[var(--sa-top)] pr-[var(--sa-right)] pb-[var(--sa-bottom)] shadow-2xl transition-transform duration-300",
          queueOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <div>
            <p className="text-sm font-bold text-ink">Playback queue</p>
            <p className="text-[11px] text-ink3">{queue.length} tracks loaded</p>
          </div>
          <div className="flex gap-1">
            {queue.length > 0 && (
              <button
                type="button"
                onClick={clearQueue}
                className="rounded-full border border-line px-2.5 py-1 text-[10px] font-bold text-ink3 transition hover:border-accent hover:text-accent"
              >
                Clear
              </button>
            )}
            <IconButton size="sm" onClick={() => setQueueOpen(false)} aria-label="Close queue">
              <ChevronDown className="h-4 w-4 -rotate-90" />
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-2">
          {queue.length === 0 && (
            <p className="p-6 text-center text-xs text-ink3">
              Nothing queued. Add tracks from any list using the ••• menu.
            </p>
          )}
          {queue[index] && (
            <>
              <p className="px-2 pt-1 pb-1 text-[10px] font-bold tracking-[0.16em] text-accent uppercase">Playing now</p>
              <div className="mb-2 rounded-xl bg-accent/10 p-1.5">
                <TrackRow track={queue[index]} context={queue} showArtwork />
              </div>
            </>
          )}
          {queue.length > index + 1 && (
            <>
              <p className="px-2 pt-2 pb-1 text-[10px] font-bold tracking-[0.16em] text-ink3 uppercase">Next up</p>
              <div className="space-y-0.5">
                {queue.slice(index + 1).map((t, i) => (
                  <div key={`${t.id}-${i}`} className="group/row">
                    <TrackRow
                      track={t}
                      context={queue}
                      index={i}
                      onRemove={() => removeFromQueue(index + 1 + i)}
                      removeLabel="Remove from queue"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {queue.length > 1 && (
          <div className="border-t border-line p-3">
            <button
              type="button"
              onClick={() => playAll(queue, index)}
              className="w-full rounded-xl bg-accent py-2 text-xs font-bold text-white transition hover:brightness-110"
            >
              Restart queue from {current?.title.slice(0, 18) ?? "start"}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

function useMinWidth(px: number) {
  const q = `(min-width: ${px}px)`;
  const [ok, setOk] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setOk(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return ok;
}

/**
 * Phones: a glass handle under the controls; tap it or swipe it up for the
 * "Up next" sheet — the queue, then songs like the one playing (YouTube Music
 * style). Tap a song to play it now (it goes right after the current one, the
 * rest of the queue stays); + keeps it for later.
 */
function UpNextDrawer() {
  const { current, queue, index, jumpTo, playNextNow, addToQueue, settings, updateSettings } = usePlayer();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Track | null>(null);
  const [songs, setSongs] = useState<Track[] | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pull = useRef<{ y0: number; dy: number; lock: boolean; fromList: boolean; lastY: number; lastT: number; v: number } | null>(null);
  const handleY = useRef<number | null>(null);

  const hide = useCallback(() => setOpen(false), []);
  useBackHandler(open, hide);
  useEscape(open, hide);

  const show = () => {
    if (current && anchor?.id !== current.id) setAnchor(current);
    listRef.current?.scrollTo({ top: 0 });
    setOpen(true);
  };

  // Fetch ahead so the sheet opens with songs ready.
  useEffect(() => {
    if (!current) return;
    const t = window.setTimeout(() => {
      if (window.matchMedia("(max-width: 767px)").matches) songsLike(current).catch(() => {});
    }, 1500);
    return () => window.clearTimeout(t);
  }, [current]);

  useEffect(() => {
    if (!anchor) return;
    let alive = true;
    setSongs(null);
    songsLike(anchor).then(
      (r) => alive && setSongs(r),
      () => alive && setSongs([]),
    );
    return () => {
      alive = false;
    };
  }, [anchor]);

  const setY = (y: number, animate: boolean) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = animate ? "translate 280ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    el.style.translate = y > 0 ? `0 ${y}px` : "";
  };

  const onSheetTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const fromList = !!(e.target as HTMLElement).closest(".scroll-area");
    pull.current = { y0: t.clientY, dy: 0, lock: false, fromList, lastY: t.clientY, lastT: performance.now(), v: 0 };
  };
  const onSheetTouchMove = (e: React.TouchEvent) => {
    const p = pull.current;
    if (!p) return;
    const t = e.touches[0];
    const dy = t.clientY - p.y0;
    if (!p.lock) {
      if (Math.abs(dy) < 8) return;
      // the list scrolls first; at its top a pull down drags the sheet
      if (dy > 0 && (!p.fromList || (listRef.current?.scrollTop ?? 0) <= 0)) p.lock = true;
      else {
        pull.current = null;
        return;
      }
    }
    const now = performance.now();
    p.v = 0.7 * ((t.clientY - p.lastY) / Math.max(1, now - p.lastT)) + 0.3 * p.v;
    p.lastY = t.clientY;
    p.lastT = now;
    p.dy = Math.max(0, dy);
    setY(p.dy, false);
  };
  const onSheetTouchEnd = () => {
    const p = pull.current;
    pull.current = null;
    if (!p || !p.lock) return;
    const h = sheetRef.current?.clientHeight || 400;
    if (p.dy > h * 0.25 || (p.v > 0.5 && p.dy > 30)) {
      setY(h, true);
      window.setTimeout(() => {
        setOpen(false);
        const el = sheetRef.current;
        if (el) {
          el.style.transition = "none";
          el.style.translate = "";
          void el.offsetHeight;
          el.style.transition = "";
        }
      }, 280);
    } else setY(0, true);
  };

  if (!current) return null;

  const upcoming = queue.slice(index + 1, index + 51);
  const inQueue = new Set(queue.map((t) => t.id));
  const suggested = (songs ?? []).filter((t) => !inQueue.has(t.id) && t.id !== current.id);

  return (
    <div className="md:hidden" data-upnext>
      {/* handle */}
      <button
        type="button"
        onClick={show}
        onTouchStart={(e) => (handleY.current = e.touches[0].clientY)}
        onTouchMove={(e) => {
          if (handleY.current !== null && handleY.current - e.touches[0].clientY > 24) {
            handleY.current = null;
            show();
          }
        }}
        onTouchEnd={() => (handleY.current = null)}
        aria-label="Up next"
        aria-expanded={open}
        className="blur-panel surface-raised glass-inset mx-4 flex w-[calc(100%-2rem)] items-center justify-center gap-1.5 rounded-b-none! rounded-t-[1.75rem]! border-b-0! pt-2.5 pb-3 text-[11px] font-bold tracking-[0.2em] text-ink2 uppercase transition active:scale-[0.98]"
      >
        <ChevronUp className="h-4 w-4" />
        Up next
      </button>

      {/* sheet */}
      {open && <div className="animate-fade-in absolute inset-0 z-30 bg-black/45" onClick={hide} />}
      <div
        ref={sheetRef}
        aria-label="Up next"
        aria-hidden={!open}
        inert={!open}
        onTouchStart={onSheetTouchStart}
        onTouchMove={onSheetTouchMove}
        onTouchEnd={onSheetTouchEnd}
        onTouchCancel={onSheetTouchEnd}
        className={cn(
          "blur-panel surface-raised absolute inset-x-0 bottom-0 z-[31] flex h-[min(80%,42rem)] flex-col rounded-b-none! border-b-0! pb-[var(--sa-bottom)] shadow-2xl transition-[translate,visibility] duration-300 ease-out",
          open ? "translate-y-0" : "pointer-events-none invisible translate-y-full",
        )}
      >
        <div className="shrink-0 px-4 pt-2.5 pb-1">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-ink/25" />
          <div className="mt-2 flex items-center justify-between">
            <p className="px-1 text-[11px] font-bold tracking-[0.2em] text-ink2 uppercase">Up next</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                role="switch"
                aria-checked={!!settings.autoplay}
                onClick={() => updateSettings({ autoplay: !settings.autoplay })}
                className="flex items-center gap-2 rounded-full px-2 py-1.5 text-[12px] font-semibold text-ink2"
              >
                Autoplay
                <span className={cn("relative h-5 w-9 rounded-full transition-colors duration-200", settings.autoplay ? "bg-accent" : "bg-ink/20")}>
                  <span className={cn("absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200", settings.autoplay && "translate-x-4")} />
                </span>
              </button>
              <IconButton onClick={hide} aria-label="Close up next">
                <ChevronDown className="h-5 w-5" />
              </IconButton>
            </div>
          </div>
        </div>
        <div ref={listRef} className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
          {open && (
            <>
              {upcoming.length > 0 && (
                <>
                  <p className="px-2 pt-1 pb-1.5 text-[10px] font-bold tracking-[0.18em] text-ink3 uppercase">Queue</p>
                  <div className="ab-stagger">
                    {upcoming.map((t, i) => (
                      <UpNextRow key={`${t.id}-${i}`} track={t} onPlay={() => jumpTo(index + 1 + i)} />
                    ))}
                  </div>
                </>
              )}
              <p className="px-2 pt-3 pb-1.5 text-[10px] font-bold tracking-[0.18em] text-ink3 uppercase">Suggested</p>
              {songs === null ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-ink3" />
                </div>
              ) : suggested.length ? (
                <div className="ab-stagger">
                  {suggested.map((t) => (
                    <UpNextRow key={t.id} track={t} onPlay={() => playNextNow(t)} onAdd={() => addToQueue(t)} />
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-xs text-ink3">No suggestions right now</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UpNextRow({ track: t, onPlay, onAdd }: { track: Track; onPlay: () => void; onAdd?: () => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl pr-1 transition active:bg-ink/[0.07]">
      <button type="button" onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 p-1.5 text-left">
        <Artwork src={t.artwork || undefined} fallbackSrc={t.artworkFallback} alt={t.title} className="h-11 w-11 shrink-0" rounded="rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{t.title}</span>
          <span className="block truncate text-[11px] text-ink3">{t.artist}</span>
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-ink3">{t.isLive ? "∞" : formatTime(t.duration)}</span>
      </button>
      {onAdd && (
        <button type="button" onClick={onAdd} aria-label="Add to queue" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink2 transition active:bg-ink/10">
          <ListPlus className="h-[18px] w-[18px]" />
        </button>
      )}
    </div>
  );
}
