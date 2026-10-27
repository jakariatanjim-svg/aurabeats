/**
 * App guide. On the very first launch a small card asks "New to AuraBeats?":
 * yes → a guided walk through the real app (the screen dims, the part being
 * explained is spotlighted, and a little assistant bubble moves next to it),
 * no → never asked again. Replay from Settings (openTour()).
 *
 * Targets are real elements marked with data-tour="…". Phones/the app and
 * PCs get their own steps (bottom bar + touch gestures vs. sidebar + keys).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { Button, WaveformLogo } from "@/components/ui";
import { storage } from "@/utils/storage";
import { useBackHandler } from "@/utils/backStack";
import { isNative } from "@/services/video/net";
import { cn } from "@/utils/cn";
import type { RouteKey } from "@/routes";

const SEEN_KEY = "tour:seen";
const EVENT = "ab:tour";

/** Replay the guide (Settings). */
export function openTour() {
  window.dispatchEvent(new Event(EVENT));
}

const isMobileLayout = () => window.innerWidth < 768;

/* ---------------------------------- steps -------------------------------- */

interface Step {
  /** data-tour value(s) to spotlight; none = centred bubble */
  target?: string[];
  /** open this page first */
  route?: RouteKey;
  /** skip the step when the target isn't on screen (e.g. no song loaded) */
  optional?: boolean;
  title: string;
  body: ReactNode;
}

const Keys = ({ rows }: { rows: [string, string][] }) => (
  <span className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1.5">
    {rows.map(([k, label]) => (
      <span key={k} className="contents">
        <kbd className="justify-self-start rounded-md border border-line bg-ink/[0.06] px-1.5 py-0.5 font-sans text-[11px] font-bold whitespace-nowrap text-ink">
          {k}
        </kbd>
        <span className="text-[12.5px] text-ink2">{label}</span>
      </span>
    ))}
  </span>
);

function mobileSteps(): Step[] {
  return [
    {
      route: "home",
      title: "Hi, I'm your guide 👋",
      body: "I'll quickly show you where everything is in AuraBeats. Tap Next to start.",
    },
    {
      target: ["mode"],
      title: "Music or Video",
      body: "Switch between songs and YouTube videos here. Each side has its own pages, library and search.",
    },
    {
      target: ["search"],
      title: "Search",
      body: "Tap to search, then press the search key on your keyboard. Your recent searches and what's trending show up first.",
    },
    {
      target: ["nav-main"],
      title: "Music pages",
      body: "Home is your music feed, Library has your playlists and downloads, and Saved keeps the songs you've hearted.",
    },
    {
      route: "video",
      target: ["nav-main"],
      title: "Video pages",
      body: isNative
        ? "Home shows what you watched and your channels, Following has their new videos, and Library has history and Watch later. Signed in to YouTube (Settings), they show your recommendations, subscriptions, likes and playlists."
        : "Home shows what you watched and your channels, Following has their new videos, and Library has your history and Watch later.",
    },
    {
      title: "While watching",
      body: (
        <Keys
          rows={[
            ["Double-tap", "a side to skip 10 s"],
            ["Hold", "to play at 2×"],
            ["Swipe up", "for full screen"],
            ["Swipe down", "to keep watching in the mini player"],
            ["Pinch", "to zoom and fill the screen"],
          ]}
        />
      ),
    },
    {
      target: ["player"],
      optional: true,
      title: "Music player",
      body: "The song that's playing lives here. Tap it to open the full player with lyrics, and swipe down to close it.",
    },
    {
      target: ["settings"],
      title: "Settings",
      body: isNative
        ? "Theme, colours, playback, video quality, your data and YouTube sign-in. You can replay this guide from here too."
        : "Theme, colours, playback, video quality and your data. You can replay this guide from here too.",
    },
    {
      title: "You're all set ✨",
      body: "Enjoy the music and videos. If you ever get lost, Settings → Watch the tour.",
    },
  ];
}

function pcSteps(): Step[] {
  return [
    {
      route: "home",
      title: "Hi, I'm your guide 👋",
      body: "I'll quickly show you where everything is in AuraBeats. Press Next (or →) to start.",
    },
    {
      target: ["mode"],
      title: "Music or Video",
      body: "Switch between songs and YouTube videos here. Each side has its own pages, library and search.",
    },
    {
      target: ["nav-main"],
      title: "Music pages",
      body: "Discover is your music feed and Your Library holds your playlists. Favourites, downloads and history are listed below.",
    },
    {
      target: ["search"],
      title: "Search",
      body: "Type here and press Enter. Pick a suggestion with ↑ ↓ and Enter. Results keep loading as you scroll.",
    },
    {
      target: ["look"],
      title: "Your look",
      body: "Change the design, switch light or dark, and pick an accent colour.",
    },
    {
      route: "video",
      target: ["nav-main"],
      title: "Video pages",
      body: "Home shows what you watched and your channels, Following has their new videos, and Library has history and Watch later.",
    },
    {
      title: "Watching videos",
      body: (
        <Keys
          rows={[
            ["Space / K", "play or pause"],
            ["← →", "back or forward 5 s (J / L: 10 s)"],
            ["↑ ↓ / wheel", "volume"],
            ["F", "full screen"],
            ["T", "theater mode"],
            ["I", "mini player (drag it anywhere)"],
          ]}
        />
      ),
    },
    {
      target: ["player"],
      optional: true,
      title: "Music player",
      body: "The song that's playing lives here. Open it big for lyrics and the queue.",
    },
    {
      target: ["nav-settings"],
      title: "Settings",
      body: "Playback, video quality, history and your data. You can replay this guide from here too.",
    },
    {
      title: "You're all set ✨",
      body: "Enjoy the music and videos. If you ever get lost, Settings → Watch the tour.",
    },
  ];
}

/* --------------------------------- helpers -------------------------------- */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** First visible element for the step's targets. */
function findTarget(names: string[]): HTMLElement | null {
  for (const n of names) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${n}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== "hidden") return el;
    }
  }
  return null;
}

const PAD = 8;
const GAP = 14;
const MARGIN = 12;
const ARROW = "var(--c-elev-strong, var(--c-elev))";

/* ---------------------------------- guide --------------------------------- */

function Guide({ route, onNavigate, onClose }: { route: RouteKey; onNavigate: (r: RouteKey) => void; onClose: () => void }) {
  const [mobile] = useState(isMobileLayout);
  const steps = useRef(mobile ? mobileSteps() : pcSteps()).current;
  const startRoute = useRef(route).current;
  const [i, setI] = useState(0);
  const dir = useRef<1 | -1>(1);
  const [box, setBox] = useState<Box | null>(null);
  const [searching, setSearching] = useState(true);
  const [closing, setClosing] = useState(false);
  const bubble = useRef<HTMLDivElement>(null);
  const [bsize, setBsize] = useState({ w: 340, h: 180 });
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const routeRef = useRef(route);
  routeRef.current = route;
  const step = steps[i];
  const last = i === steps.length - 1;

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      if (routeRef.current !== startRoute) onNavigate(startRoute);
      onClose();
    }, 260);
  }, [onClose, onNavigate, startRoute]);

  const go = useCallback(
    (d: 1 | -1) => {
      dir.current = d;
      setI((v) => {
        const n = v + d;
        if (n >= steps.length) {
          close();
          return v;
        }
        return Math.max(0, n);
      });
    },
    [steps.length, close],
  );

  // Open the step's page, then look for its target (pages render lazily).
  useEffect(() => {
    if (step.route && routeRef.current !== step.route) onNavigate(step.route);
    if (!step.target) {
      setBox(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let el: HTMLElement | null = null;
    let tries = 0;
    let scrolled = false;
    const measure = () => {
      el = el && el.isConnected ? el : findTarget(step.target!);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (!scrolled && (r.top < 0 || r.bottom > window.innerHeight)) {
        scrolled = true;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      setBox({ x: r.left, y: r.top, w: r.width, h: r.height });
      return true;
    };
    const t = setInterval(() => {
      tries++;
      if (measure()) setSearching(false);
      else if (tries > 15) {
        // not on screen (e.g. no song loaded yet)
        clearInterval(t);
        if (step.optional) go(dir.current);
        else {
          setBox(null);
          setSearching(false);
        }
      }
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBsize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useBackHandler(true, close);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, close]);

  // Spotlight rectangle (padded) and bubble placement.
  const hole = box
    ? {
        x: Math.max(4, box.x - PAD),
        y: Math.max(4, box.y - PAD),
        w: Math.min(vp.w - 8, box.w + PAD * 2),
        h: Math.min(vp.h - 8, box.h + PAD * 2),
      }
    : null;
  const bw = Math.min(340, vp.w - MARGIN * 2);
  let left = (vp.w - bw) / 2;
  let top = (vp.h - bsize.h) / 2;
  let arrow: { side: "top" | "bottom" | "left"; at: number } | null = null;
  if (hole) {
    const below = vp.h - (hole.y + hole.h) - GAP - MARGIN;
    const above = hole.y - GAP - MARGIN;
    const right = vp.w - (hole.x + hole.w) - GAP - MARGIN;
    const cx = hole.x + hole.w / 2;
    if (!mobile && hole.h > vp.h * 0.3 && right >= bw) {
      // tall target (sidebar list): bubble on its right
      left = hole.x + hole.w + GAP;
      top = Math.min(Math.max(MARGIN, hole.y + 8), vp.h - bsize.h - MARGIN);
      arrow = { side: "left", at: Math.min(Math.max(20, hole.y + Math.min(hole.h / 2, 40) - top), bsize.h - 20) };
    } else {
      left = Math.min(Math.max(MARGIN, cx - bw / 2), vp.w - bw - MARGIN);
      if (below >= bsize.h || below >= above) {
        top = Math.min(hole.y + hole.h + GAP, vp.h - bsize.h - MARGIN);
        arrow = { side: "top", at: Math.min(Math.max(22, cx - left), bw - 22) };
      } else {
        top = Math.max(MARGIN, hole.y - GAP - bsize.h);
        arrow = { side: "bottom", at: Math.min(Math.max(22, cx - left), bw - 22) };
      }
    }
  }

  const ease = "cubic-bezier(0.22, 1, 0.36, 1)";

  return (
    <div
      className={cn("fixed inset-0 z-[120] transition-opacity duration-300", closing ? "opacity-0" : "animate-fade-in")}
      role="dialog"
      aria-modal="true"
      aria-label="App guide"
    >
      {/* dim layer with a hole: a huge shadow around the spotlight box */}
      <div
        className="pointer-events-none fixed rounded-2xl"
        style={{
          left: hole ? hole.x : vp.w / 2,
          top: hole ? hole.y : vp.h / 2,
          width: hole ? hole.w : 0,
          height: hole ? hole.h : 0,
          boxShadow: "0 0 0 200vmax rgba(2, 6, 23, 0.68)",
          transition: `left .5s ${ease}, top .5s ${ease}, width .5s ${ease}, height .5s ${ease}`,
        }}
      >
        {hole && (
          <>
            <span className="absolute -inset-0.5 rounded-[18px] border-2 border-accent" />
            <span className="guide-pulse absolute -inset-0.5 rounded-[18px] border-2 border-accent" />
          </>
        )}
      </div>
      {/* blocks taps on the app while the guide is open */}
      <div className="fixed inset-0" onClick={() => go(1)} />

      {/* assistant bubble */}
      <div
        ref={bubble}
        className="blur-panel surface-raised fixed p-4 shadow-2xl"
        style={{
          left,
          top,
          width: bw,
          opacity: searching && step.target ? 0 : 1,
          transition: `left .5s ${ease}, top .5s ${ease}, opacity .25s ease`,
        }}
      >
        {arrow && (
          <span
            aria-hidden="true"
            className="absolute h-0 w-0"
            style={
              arrow.side === "top"
                ? { top: -9, left: arrow.at - 9, borderLeft: "9px solid transparent", borderRight: "9px solid transparent", borderBottom: `9px solid ${ARROW}` }
                : arrow.side === "bottom"
                  ? { bottom: -9, left: arrow.at - 9, borderLeft: "9px solid transparent", borderRight: "9px solid transparent", borderTop: `9px solid ${ARROW}` }
                  : { left: -9, top: arrow.at - 9, borderTop: "9px solid transparent", borderBottom: "9px solid transparent", borderRight: `9px solid ${ARROW}` }
            }
          />
        )}
        <div className="relative flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 animate-float items-center justify-center rounded-2xl bg-gradient-to-br from-[#3b82f6] to-[#22d3ee] text-white shadow-[0_8px_20px_-6px_rgba(59,130,246,0.6)]">
            <WaveformLogo className="h-5 w-5" />
          </span>
          <div key={i} className="min-w-0 flex-1 animate-fade-in">
            <p className="pr-6 text-[15px] font-black tracking-tight text-ink">{step.title}</p>
            <div className="mt-1 text-[13px] leading-relaxed text-ink2">{step.body}</div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close guide"
            className="focus-ring absolute -top-1 -right-1 rounded-full p-1.5 text-ink3 transition hover:bg-ink/[0.07] hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative mt-3.5 flex items-center gap-2">
          <span className="mr-auto text-[11px] font-bold tabular-nums text-ink3">
            {i + 1} / {steps.length}
          </span>
          {i === 0 ? (
            <Button variant="ghost" onClick={close} className="px-3 py-1.5 text-xs">
              Skip
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => go(-1)} className="px-3 py-1.5 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          )}
          <Button onClick={() => go(1)} className="px-4 py-1.5 text-xs">
            {last ? (
              <>
                <Sparkles className="h-3.5 w-3.5" /> Done
              </>
            ) : (
              <>
                Next <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- first-launch question ------------------------ */

function Ask({ onAnswer }: { onAnswer: (yes: boolean) => void }) {
  const [closing, setClosing] = useState(false);
  const answer = (yes: boolean) => {
    setClosing(true);
    setTimeout(() => onAnswer(yes), 200);
  };
  useBackHandler(true, () => answer(false));
  return (
    <div
      className={cn(
        "fixed inset-0 z-[120] flex items-end justify-center p-4 pb-[calc(var(--sa-bottom)+1rem)] transition-opacity duration-200 sm:items-center",
        closing && "opacity-0",
      )}
      role="dialog"
      aria-modal="true"
      aria-label="New to AuraBeats?"
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade-in" />
      <div className="blur-panel surface-raised relative z-10 w-[min(100%,24rem)] animate-slide-up p-6 text-center shadow-2xl sm:animate-scale-in">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-[#3b82f6] to-[#22d3ee] text-white animate-float animate-pulse-glow">
          <WaveformLogo className="h-8 w-8" />
        </span>
        <h3 className="mt-4 text-xl font-black tracking-tight text-ink">New to AuraBeats?</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">Let me show you around the app. It takes under a minute.</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={() => answer(true)} className="w-full py-2.5">
            <Sparkles className="h-4 w-4" /> Yes, show me around
          </Button>
          <Button variant="ghost" onClick={() => answer(false)} className="w-full">
            No, I know my way
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Mounted once in App. */
export function Tutorial({ route, onNavigate }: { route: RouteKey; onNavigate: (r: RouteKey) => void }) {
  const [state, setState] = useState<"none" | "ask" | "tour">("none");

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    if (!storage.get<boolean>(SEEN_KEY, false)) t = setTimeout(() => setState((s) => (s === "none" ? "ask" : s)), 1200);
    const open = () => {
      storage.set(SEEN_KEY, true);
      setState("tour");
    };
    window.addEventListener(EVENT, open);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener(EVENT, open);
    };
  }, []);

  if (state === "none") return null;
  return createPortal(
    state === "ask" ? (
      <Ask
        onAnswer={(yes) => {
          storage.set(SEEN_KEY, true);
          setState(yes ? "tour" : "none");
        }}
      />
    ) : (
      <Guide route={route} onNavigate={onNavigate} onClose={() => setState("none")} />
    ),
    document.body,
  );
}
