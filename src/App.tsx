import { flushSync } from "react-dom";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { PlayerProvider, usePlayer } from "@/hooks/usePlayer";
import { useSavedSongs } from "@/hooks/useSavedSongs";
import { ThemeProvider } from "@/hooks/useTheme";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";
import { Tutorial } from "@/components/Tutorial";
import { ConfirmHost } from "@/components/Confirm";
import { OfflineScreen } from "@/components/OfflineScreen";
import { useOnline } from "@/hooks/useOnline";
import { TopBar } from "@/components/TopBar";
import { PlayerBar } from "@/components/PlayerBar";
import { Toaster } from "@/components/ui";
import { TooltipLayer } from "@/components/Tooltips";
import { DownloadTray, VideoDownloadSheet } from "@/components/VideoDownloads";
import { storage } from "@/utils/storage";
import { YouTubeDock } from "@/components/video/YouTubeDock";
import { WatchLayer } from "@/components/video/WatchLayer";
import { useWatchLayer, watchLayer } from "@/components/video/watchLayer";
import { isNative } from "@/services/video/net";
import { isVideoRoute, pathToRoute, routeToPath, type RouteKey } from "@/routes";
import { navMemory } from "@/utils/navMemory";
import { ProgressHold, TopProgress, topProgress } from "@/components/TopProgress";
import { lastMode, rememberRoute } from "@/components/video/AppModeSwitch";
import { cn } from "@/utils/cn";
import { App as CapApp } from "@capacitor/app";
import { runBackHandler } from "@/utils/backStack";
import { listenForShares } from "@/utils/shareTarget";
import { baseOrientation } from "@/utils/orientation";
import { dropOldAccountData } from "@/services/yt/accounts";
import { subscribeVideoSettings } from "@/services/video/settings";

const HomeView = lazy(() => import("@/views/HomeView").then((m) => ({ default: m.HomeView })));
const SearchView = lazy(() => import("@/views/SearchView").then((m) => ({ default: m.SearchView })));
const SettingsView = lazy(() => import("@/views/SettingsView").then((m) => ({ default: m.SettingsView })));
const AboutView = lazy(() => import("@/views/AboutView").then((m) => ({ default: m.AboutView })));
const PrivacyView = lazy(() => import("@/views/PrivacyView").then((m) => ({ default: m.PrivacyView })));
const FavoritesView = lazy(() => import("@/views/LibraryViews").then((m) => ({ default: m.FavoritesView })));
const HistoryView = lazy(() => import("@/views/LibraryViews").then((m) => ({ default: m.HistoryView })));
const DownloadsView = lazy(() => import("@/views/LibraryViews").then((m) => ({ default: m.DownloadsView })));
const DeviceMusicView = lazy(() => import("@/views/DeviceMusicView").then((m) => ({ default: m.DeviceMusicView })));
const LibraryView = lazy(() => import("@/views/LibraryViews").then((m) => ({ default: m.LibraryView })));
const PlaylistDetailView = lazy(() => import("@/views/LibraryViews").then((m) => ({ default: m.PlaylistDetailView })));
const VideoHomeView = lazy(() => import("@/views/video/VideoViews").then((m) => ({ default: m.VideoHomeView })));
const VideoSubsView = lazy(() => import("@/views/video/VideoViews").then((m) => ({ default: m.VideoSubsView })));
const VideoLibraryView = lazy(() => import("@/views/video/VideoViews").then((m) => ({ default: m.VideoLibraryView })));
const VideoSearchView = lazy(() => import("@/views/video/VideoSearchView").then((m) => ({ default: m.VideoSearchView })));
const ShortsView = lazy(() => import("@/views/video/ShortsView").then((m) => ({ default: m.ShortsView })));
const WatchView = lazy(() => import("@/views/video/WatchView").then((m) => ({ default: m.WatchView })));
const ChannelView = lazy(() => import("@/views/video/ChannelView").then((m) => ({ default: m.ChannelView })));
const FullScreenPlayer = lazy(() => import("@/components/FullScreenPlayer").then((m) => ({ default: m.FullScreenPlayer })));
const QueuePanel = lazy(() => import("@/components/FullScreenPlayer").then((m) => ({ default: m.QueuePanel })));

function Shell() {
  // URL is the source of truth — real clean paths: /home /search …
  const [route, setRoute] = useState<RouteKey>(() => {
    let r = pathToRoute(window.location.pathname);
    // opening the bare address: back to the tab (Music / Video) used last
    if ((window.location.pathname === "/" || window.location.pathname === "") && lastMode() === "video") {
      r = "video";
      window.history.replaceState(null, "", routeToPath(r));
    }
    // a YouTube-style address (/watch?v=…, /shorts/…, youtu.be-style) → our own
    if (r.startsWith("watch:") && window.location.pathname !== routeToPath(r)) window.history.replaceState(null, "", routeToPath(r));
    return r;
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => storage.get("sidebarCollapsed", false));

  const scrollTop = useCallback(() => {
    const main = document.getElementById("ab-scroll");
    if (main) main.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Address last followed; synthetic / sheet popstates for the same address
  // (closing the phone search, repeating a search) must not jump to the top.
  const lastLoc = useRef(window.location.pathname + window.location.search);

  // Leaving a page: remember its scroll. New page → top; Back/Forward → where it was.
  const saveScroll = useCallback(() => {
    const main = document.getElementById("ab-scroll");
    if (main) navMemory.save(lastLoc.current, main.scrollTop);
  }, []);
  const jumpTop = useCallback(() => {
    document.getElementById("ab-scroll")?.scrollTo({ top: 0 });
  }, []);

  // Website: the tapped thumbnail grows into the player (View Transitions).
  const showRoute = useCallback((next: RouteKey, after?: () => void) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const id = next.startsWith("watch:") ? next.slice("watch:".length) : null;
    const thumb = id ? (document.querySelector(`[data-vt-thumb="${CSS.escape(id)}"]`) as HTMLElement | null) : null;
    if (isNative || !thumb || !doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRoute(next);
      after?.();
      return;
    }
    thumb.style.viewTransitionName = "ab-player";
    doc.startViewTransition(() => {
      thumb.style.viewTransitionName = "";
      flushSync(() => setRoute(next));
      after?.();
    });
  }, []);

  const navigate = useCallback((next: RouteKey) => {
    const path = routeToPath(next);
    if (window.location.pathname === path) {
      // app: the same video again (e.g. from its miniplayer) → open it
      if (isNative && next.startsWith("watch:")) watchLayer.open(next.slice("watch:".length));
      else scrollTop();
      return;
    }
    // Replace the bare "/" entry with "/home" so back-navigation stays inside the app.
    if (window.location.pathname === "/") window.history.replaceState(null, "", "/home");
    saveScroll();
    window.history.pushState(null, "", path);
    lastLoc.current = path;
    // app: the video opens over the page, which keeps its place
    showRoute(next, isNative && next.startsWith("watch:") ? undefined : jumpTop);
  }, [scrollTop, saveScroll, jumpTop, showRoute]);

  // keep state in sync with the address bar (back / forward / pasted links)
  useEffect(() => {
    const onPop = () => {
      const loc = window.location.pathname + window.location.search;
      const pushed = navMemory.pushing;
      navMemory.pushing = false;
      if (loc === lastLoc.current) return;
      const from = pathToRoute(lastLoc.current.split("?")[0]);
      const to = pathToRoute(window.location.pathname);
      saveScroll();
      lastLoc.current = loc;
      setRoute(to);
      // app: opening / closing the video layer leaves the page underneath alone
      if (isNative && (from.startsWith("watch:") || to.startsWith("watch:"))) return;
      if (pushed) jumpTop();
      else navMemory.restore(loc, document.getElementById("ab-scroll"));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [saveScroll, jumpTop]);

  // Intercept plain app links (href="/search" with data-nav) for SPA navigation.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[data-nav='true']") as HTMLAnchorElement | null;
      if (!anchor) return;
      e.preventDefault();
      // the page you are on: back to its top, no duplicate history step
      if (anchor.pathname + anchor.search === lastLoc.current) {
        jumpTop();
        return;
      }
      saveScroll();
      window.history.pushState(null, "", anchor.pathname + anchor.search);
      lastLoc.current = anchor.pathname + anchor.search;
      showRoute(pathToRoute(window.location.pathname), jumpTop);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [saveScroll, jumpTop, showRoute]);

  // Android back button / gesture: close the top overlay, else the previous
  // page, else this mode's start page; only from there leave the app (to the
  // background, so music keeps playing). Without this Capacitor quits at once.
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => {
    if (!isNative) return;
    let dead = false;
    let remove: (() => void) | undefined;
    void CapApp.addListener("backButton", ({ canGoBack }) => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
        return;
      }
      if (runBackHandler()) return;
      if (canGoBack) {
        window.history.back();
        return;
      }
      const root: RouteKey = isVideoRoute(routeRef.current) ? "video" : "home";
      if (routeRef.current !== root) {
        // Replace, not push: the next back from the start page must exit.
        const path = routeToPath(root);
        window.history.replaceState(null, "", path);
        lastLoc.current = path;
        setRoute(root);
        scrollTop();
        return;
      }
      void CapApp.minimizeApp();
    }).then((h) => {
      if (dead) void h.remove();
      else remove = () => void h.remove();
    });
    return () => {
      dead = true;
      remove?.();
    };
  }, [scrollTop]);

  // App: "Share → AuraBeats" from YouTube (or a YouTube link opened with
  // the app) plays the video here, with listen / download / offline.
  const navRef = useRef(navigate);
  navRef.current = navigate;
  useEffect(() => {
    if (!isNative) return;
    return listenForShares((r) => navRef.current(r));
  }, []);

  // The old TV sign-in is gone: wipe what it left behind (once, harmless).
  useEffect(() => {
    dropOldAccountData();
  }, []);

  // App: upright on phones unless "Rotate for full screen" is on.
  useEffect(() => {
    if (!isNative) return;
    void baseOrientation();
    const off = subscribeVideoSettings(() => void baseOrientation());
    return () => {
      off();
    };
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      storage.set("sidebarCollapsed", !c);
      return !c;
    });
  }, []);

  // Each mode (Music / Video) reopens where you left it.
  useEffect(() => {
    rememberRoute(route);
  }, [route]);
  // thin progress line on every page change (not on the first load)
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    topProgress.start();
  }, [route]);
  // App: the watch page is a layer (with a miniplayer) over the page you came
  // from, which stays on screen underneath.
  const layer = useWatchLayer();
  const baseRoute = useRef<RouteKey>(route.startsWith("watch:") ? "video" : route);
  const cameFromPage = useRef(false);
  const prevRoute = useRef<RouteKey | null>(null);
  if (!route.startsWith("watch:")) baseRoute.current = route;
  navMemory.lastPage = baseRoute.current;
  const online = useOnline();
  const shownRoute: RouteKey = isNative && route.startsWith("watch:") ? baseRoute.current : route;
  useEffect(() => {
    if (route.startsWith("watch:")) {
      navMemory.cameFromPage = prevRoute.current !== null && !prevRoute.current.startsWith("watch:");
    } else navMemory.cameFromPage = false;
    if (!isNative) {
      prevRoute.current = route;
      return;
    }
    if (route.startsWith("watch:")) {
      cameFromPage.current = prevRoute.current !== null && !prevRoute.current.startsWith("watch:");
      watchLayer.open(route.slice("watch:".length));
    } else {
      cameFromPage.current = false;
      watchLayer.minimize(); // left the video for another page → keep it small
    }
    prevRoute.current = route;
  }, [route]);
  const minimizeVideo = useCallback(() => {
    watchLayer.minimize();
    // Opened from a page: that page is the one under the miniplayer, so take
    // its place in history too (one back press less, like YouTube).
    if (cameFromPage.current && routeRef.current.startsWith("watch:")) {
      cameFromPage.current = false;
      window.history.back();
    }
  }, []);

  const videoMode = isVideoRoute(isNative ? (layer.mode === "full" ? route : shownRoute) : route);
  const watching = isNative ? layer.mode === "full" : route.startsWith("watch:");

  const { setExpanded, setQueueOpen, queueOpen, next, previous, toggle, current, volume, setVolume, settings, expanded } = usePlayer();
  const saved = useSavedSongs();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      // browser shortcuts (Ctrl+F, Ctrl+Space…) stay the browser's
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // The video player owns the keyboard while a video is open.
      if (watching && !expanded) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight" && e.shiftKey) {
        next();
      } else if (e.key === "ArrowLeft" && e.shiftKey) {
        previous();
      } else if (e.key === "Escape") {
        setQueueOpen(false);
      } else if (e.key.toLowerCase() === "f" && current) {
        setExpanded(true);
      } else if (e.key.toLowerCase() === "q" && settings.queueEnabled) {
        setQueueOpen(!queueOpen);
      }
    };
    // Mouse wheel volume control
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      // Is the full screen player currently mounted and visible?
      const isFullScreen = expanded;
      
      // If NOT in full screen, disable volume wheel over scrollable areas (so page can scroll normally)
      if (!isFullScreen && target?.closest(".scroll-area, main, aside, [role=dialog], [data-video-player]")) return;
      
      // If IN full screen, ONLY disable volume wheel if hovering over the "Up Next" queue area
      if (isFullScreen && target?.closest(".scroll-area")) return;

      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      setVolume(Math.min(1, Math.max(0, volume + delta)));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [toggle, next, previous, setExpanded, setQueueOpen, queueOpen, current, volume, setVolume, expanded, watching]);

  return (
    <div data-app-mode={videoMode ? "video" : "music"} className="app-shell flex w-full overflow-hidden gap-4 relative z-0">
      <Sidebar route={shownRoute} onNavigate={navigate} collapsed={collapsed} onToggleCollapse={toggleCollapse} />

      <div className="shell-panel flex min-w-0 flex-1 flex-col relative z-10 h-full overflow-hidden">
        <TopBar route={shownRoute} onNavigate={navigate} />
        <main
          id="ab-scroll"
          className={cn(
            "scroll-area min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-8 transition-[padding] duration-300",
            // reserve room for the floating player bar only once it actually exists
            current && !watching
              ? "pb-[calc(var(--sa-bottom)+12rem)] md:pb-[calc(var(--sa-bottom)+9rem)]"
              : "pb-[calc(var(--sa-bottom)+6.5rem)] md:pb-10",
            // room for the video miniplayer bar too
            isNative && layer.mode === "mini" && (current ? "pb-[calc(var(--sa-bottom)+17.5rem)]" : "pb-[calc(var(--sa-bottom)+12rem)]"),
          )}
        >
          <Suspense
            fallback={
              <div className="blur-panel p-6 animate-fade-in">
                <ProgressHold />
                <div className="skeleton h-4 w-32 rounded-full" />
                <div className="mt-4 space-y-3">
                  <div className="skeleton h-10 w-full rounded-2xl" />
                  <div className="skeleton h-10 w-full rounded-2xl" />
                  <div className="skeleton h-10 w-full rounded-2xl" />
                </div>
              </div>
            }
          >
            <div key={shownRoute} className="animate-fade-up mx-auto w-full max-w-[1600px] pb-8">
              {!online && needsInternet(shownRoute) ? (
                <OfflineScreen onNavigate={navigate} />
              ) : (
                <>
                {shownRoute === "home" && <HomeView onNavigate={navigate} />}
                {shownRoute === "search" && <SearchView />}
                {shownRoute === "library" && <LibraryView onNavigate={navigate} />}
                {shownRoute === "favorites" && <FavoritesView />}
                {shownRoute === "history" && <HistoryView />}
                {shownRoute === "settings" && <SettingsView />}
                {shownRoute === "about" && <AboutView />}
                {shownRoute === "privacy" && <PrivacyView />}
                {shownRoute === "downloads" && <DownloadsView />}
                {shownRoute === "device" && <DeviceMusicView />}
                {shownRoute.startsWith("playlist:") && (
                  <PlaylistDetailView playlistId={shownRoute.slice("playlist:".length)} onBack={() => navigate("library")} />
                )}
                {shownRoute === "video" && <VideoHomeView onNavigate={navigate} />}
                {shownRoute === "video-search" && <VideoSearchView />}
                {shownRoute === "video-subs" && <VideoSubsView onNavigate={navigate} />}
                {shownRoute === "video-library" && <VideoLibraryView />}
                {shownRoute === "video-shorts" && <ShortsView />}
                {!isNative && shownRoute.startsWith("watch:") && <WatchView key={route} id={shownRoute.slice("watch:".length)} onNavigate={navigate} />}
                {shownRoute.startsWith("channel:") && <ChannelView id={shownRoute.slice("channel:".length)} />}
                </>
              )}
            </div>
          </Suspense>
        </main>
      </div>

      {!watching && shownRoute !== "video-shorts" && <PlayerBar onOpenQueue={() => setQueueOpen(!queueOpen)} />}
      <MobileNav route={shownRoute} onNavigate={navigate} favoritesCount={saved.tracks.length} likeMode={saved.signedIn} />
      <Tutorial route={shownRoute} onNavigate={navigate} />
      <ConfirmHost />
      <TopProgress />
      {/* Website video player: one YouTube iframe for watch page + miniplayer */}
      {!isNative && <YouTubeDock navigate={navigate} musicBar={Boolean(current)} />}
      {isNative && (
        <WatchLayer musicBar={Boolean(current)} onMinimize={minimizeVideo}>
          {layer.id && (
            <Suspense fallback={null}>
              <WatchView key={layer.id} id={layer.id} onNavigate={navigate} />
            </Suspense>
          )}
        </WatchLayer>
      )}
      <Suspense fallback={null}>
        {settings.queueEnabled && <QueuePanel />}
        <FullScreenPlayer />
      </Suspense>
      <Toaster />
      <TooltipLayer />
      <VideoDownloadSheet />
      <DownloadTray />
    </div>
  );
}


/** Pages that can't show anything without the internet (the offline page replaces them). */
const needsInternet = (r: RouteKey) =>
  r === "home" || r === "search" || r === "video" || r === "video-search" || r === "video-subs" || r === "video-shorts" || r.startsWith("watch:") || r.startsWith("channel:");

export default function App() {
  return (
    <ThemeProvider>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </ThemeProvider>
  );
}
