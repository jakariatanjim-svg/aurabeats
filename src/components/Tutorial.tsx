/**
 * App tour. On the very first launch a small card asks "New to AuraBeats?":
 * yes → an animated step-by-step tour, no → never asked again. The tour can
 * be replayed from Settings (openTour()). Phones/the app and PCs get their
 * own version (touch gestures vs. sidebar + keyboard shortcuts).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Clapperboard,
  Download,
  Heart,
  Library,
  Music2,
  Pause,
  Play,
  Rss,
  Search,
  Settings,
  SkipForward,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { Button, WaveformLogo } from "@/components/ui";
import { storage } from "@/utils/storage";
import { useBackHandler } from "@/utils/backStack";
import { isNative } from "@/services/video/net";
import { cn } from "@/utils/cn";

const SEEN_KEY = "tour:seen";
const EVENT = "ab:tour";

/** Replay the tour (Settings). */
export function openTour() {
  window.dispatchEvent(new Event(EVENT));
}

const isMobileLayout = () => isNative || window.innerWidth < 768 || !window.matchMedia("(pointer: fine)").matches;

/* ------------------------------ building blocks ------------------------- */

const anim = (name: string, dur: number, extra = "") => ({ animation: `${name} ${dur}s ${extra || "ease-in-out infinite"}` });

/** Phone mock (dark screen whatever the theme, like a real device). */
function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-[196px] w-[112px] overflow-hidden rounded-[20px] border-[3px] border-black/80 bg-[#0c1018] shadow-[0_18px_40px_-14px_rgba(0,0,0,0.7)]">
      <div className="absolute top-1 left-1/2 z-20 h-1.5 w-8 -translate-x-1/2 rounded-full bg-black/80" />
      {children}
    </div>
  );
}

/** Desktop window mock. */
function Window({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-[168px] w-[262px] overflow-hidden rounded-xl border border-white/10 bg-[#0c1018] shadow-[0_18px_40px_-14px_rgba(0,0,0,0.7)]">
      <div className="flex h-4 items-center gap-1 bg-white/[0.06] px-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[#ff5f57]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#febc2e]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#28c840]" />
      </div>
      <div className="relative h-[calc(100%-1rem)]">{children}</div>
    </div>
  );
}

/** A finger: a dot with a ripple. */
function Finger({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span className={cn("pointer-events-none absolute z-30 h-5 w-5", className)} style={style}>
      <span className="absolute inset-0 rounded-full bg-white/60" style={anim("tut-ring", 1.4, "ease-out infinite")} />
      <span className="absolute inset-0.5 rounded-full border-2 border-white bg-white/85 shadow-lg" style={anim("tut-tap", 1.4)} />
    </span>
  );
}

const Bar = ({ w, className }: { w: string; className?: string }) => (
  <span className={cn("block h-1.5 rounded-full bg-white/15", className)} style={{ width: w }} />
);

/** Video card skeleton. */
const VCard = () => (
  <div className="space-y-1">
    <div className="aspect-video rounded-md bg-gradient-to-br from-white/20 to-white/5" />
    <Bar w="80%" />
    <Bar w="50%" className="bg-white/10" />
  </div>
);

/** Song row skeleton. */
const SRow = ({ hue }: { hue: number }) => (
  <div className="flex items-center gap-1.5">
    <span className="h-5 w-5 shrink-0 rounded" style={{ background: `hsl(${hue} 70% 55% / .8)` }} />
    <span className="flex-1 space-y-1">
      <Bar w="75%" />
      <Bar w="45%" className="bg-white/10" />
    </span>
  </div>
);

/** Music | Video pill with an animated thumb. */
function ModePill({ small }: { small?: boolean }) {
  return (
    <div className={cn("relative flex rounded-full bg-white/10 p-0.5 font-bold text-white", small ? "text-[7px]" : "text-[8px]")}>
      <span
        className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full"
        style={{ background: "var(--c-accent)", ...anim("tut-toggle", 4.8) }}
      />
      <span className="relative z-10 flex flex-1 items-center justify-center gap-0.5 px-1.5 py-0.5">
        <Music2 className="h-2 w-2" /> Music
      </span>
      <span className="relative z-10 flex flex-1 items-center justify-center gap-0.5 px-1.5 py-0.5">
        <Clapperboard className="h-2 w-2" /> Video
      </span>
    </div>
  );
}

/** Music/video content cross-fade in sync with the pill. */
function ModeContent({ cols }: { cols: 1 | 2 }) {
  return (
    <div className="relative flex-1">
      <div className="absolute inset-0 space-y-2" style={anim("tut-swap-a", 4.8)}>
        <SRow hue={210} />
        <SRow hue={330} />
        <SRow hue={150} />
        <SRow hue={40} />
      </div>
      <div className={cn("absolute inset-0 grid gap-2", cols === 2 ? "grid-cols-2" : "grid-cols-1")} style={anim("tut-swap-b", 4.8)}>
        <VCard />
        <VCard />
        {cols === 2 && (
          <>
            <VCard />
            <VCard />
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- scenes ------------------------------- */

function WelcomeScene() {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="absolute h-36 w-36 rounded-full border border-dashed border-white/25 animate-spin-slow">
        <span className="absolute -top-3 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg">
          <Music2 className="h-3.5 w-3.5" />
        </span>
        <span className="absolute top-1/2 -right-3 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-white shadow-lg">
          <Play className="h-3 w-3 fill-current" />
        </span>
        <span className="absolute -bottom-3 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg">
          <Heart className="h-3 w-3 fill-current" />
        </span>
        <span className="absolute top-1/2 -left-3 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
          <Download className="h-3 w-3" />
        </span>
      </div>
      <span className="flex h-20 w-20 items-center justify-center rounded-[26px] bg-gradient-to-br from-[#3b82f6] to-[#22d3ee] text-white animate-pulse-glow animate-float">
        <WaveformLogo className="h-10 w-10" />
      </span>
    </div>
  );
}

function ModesScene({ mobile }: { mobile: boolean }) {
  if (mobile)
    return (
      <Phone>
        <div className="flex h-full flex-col gap-2 px-2 pt-4 pb-2">
          <div className="relative flex items-center justify-between">
            <span className="h-4 w-4 rounded-md bg-gradient-to-br from-[#3b82f6] to-[#22d3ee]" />
            <ModePill small />
            <Finger className="top-1 right-3" />
          </div>
          <ModeContent cols={1} />
          <div className="flex justify-around border-t border-white/10 pt-1.5 text-white/50">
            <Music2 className="h-2.5 w-2.5" />
            <Rss className="h-2.5 w-2.5" />
            <Library className="h-2.5 w-2.5" />
          </div>
        </div>
      </Phone>
    );
  return (
    <Window>
      <div className="flex h-full">
        <div className="relative w-[78px] space-y-2 border-r border-white/10 p-2">
          <span className="block h-3 w-10 rounded bg-gradient-to-r from-[#3b82f6] to-[#22d3ee]" />
          <ModePill small />
          <Finger className="top-6 left-3" />
          <Bar w="80%" />
          <Bar w="65%" />
          <Bar w="70%" />
        </div>
        <div className="flex flex-1 flex-col p-2">
          <ModeContent cols={2} />
        </div>
      </div>
    </Window>
  );
}

function SearchScene({ mobile }: { mobile: boolean }) {
  const bar = (
    <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-2 py-1 text-[9px] text-white">
      <Search className="h-2.5 w-2.5 shrink-0 text-white/60" />
      <span className="overflow-hidden whitespace-nowrap" style={{ width: 0, ...anim("tut-type", 4, "steps(10) infinite") }}>
        lofi beats
      </span>
      <span className="-ml-1 h-2.5 w-px bg-white" style={anim("tut-caret", 0.8, "step-end infinite")} />
      <span
        className="ml-auto rounded border border-white/30 bg-white/15 px-1 text-[7px] font-bold"
        style={anim("tut-key", 4)}
      >
        {mobile ? "🔍" : "Enter ↵"}
      </span>
    </div>
  );
  const rows = (
    <div className="space-y-2" style={anim("tut-rows", 4)}>
      <SRow hue={260} />
      <SRow hue={190} />
      <SRow hue={20} />
    </div>
  );
  if (mobile)
    return (
      <Phone>
        <div className="flex h-full flex-col gap-3 bg-black px-2 pt-5">
          {bar}
          {rows}
        </div>
      </Phone>
    );
  return (
    <Window>
      <div className="flex h-full">
        <div className="w-[56px] space-y-2 border-r border-white/10 p-2">
          <Bar w="90%" />
          <Bar w="70%" />
          <Bar w="80%" />
        </div>
        <div className="flex-1 space-y-3 p-2">
          <div className="mx-auto w-[150px]">{bar}</div>
          <div className="mx-auto w-[150px]">{rows}</div>
        </div>
      </div>
    </Window>
  );
}

const MOBILE_GESTURES = [
  { id: "dtap", label: "Double-tap a side · ±10 s" },
  { id: "hold", label: "Press & hold · 2× speed" },
  { id: "up", label: "Swipe up · full screen" },
  { id: "down", label: "Swipe down · mini player" },
  { id: "pinch", label: "Pinch · zoom to fill" },
] as const;

const PC_KEYS = [
  { k: "Space", label: "Play / pause", fx: "play" },
  { k: "← →", label: "Back / forward 5 s", fx: "+5" },
  { k: "J  L", label: "Back / forward 10 s", fx: "+10" },
  { k: "↑ ↓", label: "Volume (or mouse wheel)", fx: "vol" },
  { k: "F", label: "Full screen", fx: "fs" },
  { k: "T", label: "Theater mode", fx: "fs" },
  { k: "I", label: "Mini player", fx: "mini" },
] as const;

/** Cycles 0..n-1 every `ms`. */
function useCycle(n: number, ms: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms]);
  return i;
}

function VideoFrame({ children, zoom }: { children?: ReactNode; zoom?: boolean }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 30% 40%, #f97316 0, transparent 45%), radial-gradient(circle at 70% 65%, #6366f1 0, transparent 50%), #111827",
          ...(zoom ? anim("tut-zoom", 2.4, "ease-in-out forwards") : {}),
        }}
      />
      {children}
    </div>
  );
}

function PlayerScene({ mobile }: { mobile: boolean }) {
  const gi = useCycle(mobile ? MOBILE_GESTURES.length : PC_KEYS.length, 2400);
  if (mobile) {
    const g = MOBILE_GESTURES[gi];
    return (
      <div className="flex flex-col items-center gap-2">
        <Phone>
          <div className="flex h-full flex-col gap-2 px-1.5 pt-4">
            <VideoFrame key={g.id} zoom={g.id === "pinch"}>
              {g.id === "dtap" && (
                <>
                  <Finger className="top-1/2 right-3 -translate-y-1/2" />
                  <span className="absolute top-1/2 right-9 -translate-y-1/2 text-[8px] font-black text-white animate-fade-in">+10</span>
                </>
              )}
              {g.id === "hold" && (
                <>
                  <Finger className="top-1/2 left-1/2 -translate-1/2" />
                  <span className="absolute top-1 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-1.5 text-[7px] font-bold text-white animate-fade-in">
                    2× ▸▸
                  </span>
                </>
              )}
              {g.id === "up" && <Finger className="top-1/2 left-1/2 -mt-2.5 -ml-2.5" style={anim("tut-swipe-up", 2.4, "ease-out infinite")} />}
              {g.id === "down" && <Finger className="top-1/2 left-1/2 -mt-2.5 -ml-2.5" style={anim("tut-swipe-down", 2.4, "ease-out infinite")} />}
              {g.id === "pinch" && (
                <>
                  <Finger className="top-1/2 left-1/2 -mt-2.5 -ml-2.5" style={anim("tut-pinch-a", 2.4, "ease-in-out forwards")} />
                  <Finger className="top-1/2 left-1/2 -mt-2.5 -ml-2.5" style={anim("tut-pinch-b", 2.4, "ease-in-out forwards")} />
                </>
              )}
            </VideoFrame>
            <Bar w="85%" />
            <Bar w="55%" className="bg-white/10" />
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              <VCard />
              <VCard />
            </div>
          </div>
        </Phone>
        <span key={g.id} className="rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-white animate-fade-in">
          {g.label}
        </span>
      </div>
    );
  }
  const k = PC_KEYS[gi];
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-[220px]">
        <VideoFrame>
          <span key={gi} className="absolute top-[14%] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-bold text-white animate-scale-in">
            {k.fx === "play" && <Pause className="h-2.5 w-2.5 fill-current" />}
            {k.fx === "vol" && (
              <>
                <Volume2 className="h-2.5 w-2.5" /> 65%
              </>
            )}
            {(k.fx === "+5" || k.fx === "+10") && (
              <>
                <SkipForward className="h-2.5 w-2.5" /> {k.fx} s
              </>
            )}
            {k.fx === "fs" && k.label}
            {k.fx === "mini" && k.label}
          </span>
          <div className="absolute inset-x-1.5 bottom-1.5 h-0.5 rounded-full bg-white/25">
            <div className="h-full w-2/5 rounded-full" style={{ background: "var(--c-accent)" }} />
          </div>
        </VideoFrame>
      </div>
      <div className="flex flex-wrap justify-center gap-1">
        {PC_KEYS.map((x, i) => (
          <span
            key={x.k}
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[10px] font-bold transition-all duration-300",
              i === gi ? "-translate-y-0.5 border-white bg-white text-black shadow-lg" : "border-white/25 bg-white/10 text-white/70",
            )}
          >
            {x.k}
          </span>
        ))}
      </div>
      <span key={k.k} className="text-[11px] font-bold text-white animate-fade-in">
        {k.label}
      </span>
    </div>
  );
}

function MusicScene({ mobile }: { mobile: boolean }) {
  const miniBar = (
    <div className="flex items-center gap-1.5 rounded-lg bg-white/10 p-1">
      <span className="h-5 w-5 rounded" style={{ background: "linear-gradient(135deg,#f43f5e,#8b5cf6)" }} />
      <span className="flex-1 space-y-1">
        <Bar w="70%" />
        <Bar w="40%" className="bg-white/10" />
      </span>
      <Heart className="h-2.5 w-2.5 fill-rose-500 text-rose-500" style={anim("tut-pop", 4)} />
      <Play className="h-2.5 w-2.5 fill-white text-white" />
    </div>
  );
  const full = (
    <div className="absolute inset-0 z-10 flex flex-col items-center gap-2 bg-gradient-to-b from-[#3b1d4a] to-[#0c1018] px-3 pt-5" style={anim("tut-rise", 4)}>
      <span className="h-14 w-14 rounded-lg shadow-lg" style={{ background: "linear-gradient(135deg,#f43f5e,#8b5cf6)" }} />
      <div className="w-full space-y-1.5 text-center text-[7px] leading-tight font-bold">
        <p className="text-white/40">And the stars align</p>
        <p className="text-white">we sing the night away ♪</p>
        <p className="text-white/40">under city lights</p>
      </div>
    </div>
  );
  if (mobile)
    return (
      <Phone>
        <div className="relative flex h-full flex-col justify-between px-2 pt-5 pb-2">
          <div className="space-y-2">
            <SRow hue={210} />
            <SRow hue={300} />
            <SRow hue={120} />
          </div>
          <div className="relative">
            {miniBar}
            <Finger className="top-1 left-10" />
          </div>
          {full}
        </div>
      </Phone>
    );
  return (
    <Window>
      <div className="relative flex h-full flex-col justify-between p-2">
        <div className="grid grid-cols-3 gap-2">
          {[200, 280, 20, 160, 330, 90].map((h) => (
            <span key={h} className="aspect-square rounded-md" style={{ background: `hsl(${h} 65% 50% / .7)` }} />
          ))}
        </div>
        <div className="relative">{miniBar}<Finger className="top-1 left-12" /></div>
        {full}
      </div>
    </Window>
  );
}

function LibraryScene() {
  return (
    <div className="flex items-end gap-3">
      {[
        { icon: Heart, label: "Liked", c: "bg-rose-500", d: 0 },
        { icon: Rss, label: "Following", c: "bg-red-600", d: 0.3 },
        { icon: Library, label: "Playlists", c: "bg-sky-500", d: 0.6 },
      ].map(({ icon: Icon, label, c, d }) => (
        <div key={label} className="flex flex-col items-center gap-1.5">
          <span
            className={cn("flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg", c)}
            style={{ animation: `ab-float 3s ease-in-out ${d}s infinite` }}
          >
            <Icon className="h-6 w-6" />
          </span>
          <span className="text-[10px] font-bold text-white/85">{label}</span>
        </div>
      ))}
    </div>
  );
}

function DownloadScene({ mobile }: { mobile: boolean }) {
  return (
    <div className="relative flex items-center justify-center gap-5">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white" style={anim("tut-drop", 1.8, "ease-in infinite")}>
        <Download className="h-7 w-7" />
      </span>
      <div className="relative">
        {mobile ? (
          <div className="relative h-[110px] w-[64px] overflow-hidden rounded-[14px] border-[3px] border-black/80 bg-[#0c1018]">
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-500 to-emerald-400/60" style={anim("tut-fill", 3)} />
            <Music2 className="absolute top-1/2 left-1/2 h-6 w-6 -translate-1/2 text-white" />
          </div>
        ) : (
          <div className="relative h-[84px] w-[120px] overflow-hidden rounded-lg border border-white/15 bg-[#0c1018]">
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-500 to-emerald-400/60" style={anim("tut-fill", 3)} />
            <span className="absolute top-1/2 left-1/2 -translate-1/2 text-[10px] font-black text-white">MP3 · MP4</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsScene() {
  return (
    <div className="flex items-center gap-4">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white">
        <Settings className="h-9 w-9 animate-spin-med" />
      </span>
      <div className="space-y-2">
        {[
          { c: "#3b82f6", w: 72 },
          { c: "#f43f5e", w: 56 },
          { c: "#10b981", w: 64 },
        ].map(({ c, w }, i) => (
          <div key={c} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: c }} />
            <span className="h-1.5 rounded-full bg-white/25" style={{ width: w }} />
            <span
              className="relative h-3 w-6 rounded-full"
              style={{ background: i === 1 ? "rgba(255,255,255,.2)" : c }}
            >
              <span className={cn("absolute top-0.5 h-2 w-2 rounded-full bg-white", i === 1 ? "left-0.5" : "right-0.5")} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- steps ------------------------------- */

interface Step {
  title: string;
  body: string;
  scene: ReactNode;
}

function buildSteps(mobile: boolean): Step[] {
  return [
    {
      title: "Welcome to AuraBeats",
      body: "Music and YouTube videos in one place. Here's a quick look around. It takes under a minute.",
      scene: <WelcomeScene />,
    },
    {
      title: "Music or Video",
      body: mobile
        ? "Tap Music or Video at the top to switch. Each side has its own home, library and search. The bar at the bottom moves between its pages."
        : "Switch between Music and Video at the top of the sidebar. Each side has its own home, library and search.",
      scene: <ModesScene mobile={mobile} />,
    },
    {
      title: "Search",
      body: mobile
        ? "Tap the search icon, type, then press the search key. Your recent searches and what's trending show up first. Keep scrolling for more results."
        : "Type in the bar at the top and press Enter. Pick a suggestion with ↑ ↓ and Enter. Results keep loading as you scroll.",
      scene: <SearchScene mobile={mobile} />,
    },
    {
      title: "Watching videos",
      body: mobile
        ? "Tap to show the controls. Double-tap a side to skip, hold for 2×, swipe up for full screen and swipe down to keep watching in the mini player."
        : "Click to pause, double-click for full screen. Keyboard shortcuts work like YouTube, and the mini player can be dragged anywhere.",
      scene: <PlayerScene mobile={mobile} />,
    },
    {
      title: "Listening to music",
      body: mobile
        ? "Tap a song to play it, then tap the bar at the bottom for the full player with lyrics. Swipe it down to close. Hearts teach For You what you like."
        : "The player sits at the bottom. Open it big for lyrics and the queue. Hearts teach For You what you like.",
      scene: <MusicScene mobile={mobile} />,
    },
    {
      title: "Your library",
      body: isNative
        ? "Liked songs, playlists, followed channels and your history live in Library, saved on this phone. Sign in with Google in Settings to add your YouTube subscriptions, likes and playlists."
        : "Liked songs, playlists, followed channels and your history live in Library. They're saved in this browser only.",
      scene: <LibraryScene />,
    },
    {
      title: "Downloads",
      body: isNative
        ? "Tap download on a song or video. Songs can also be saved inside the app for offline listening, and videos go to your phone's Download folder."
        : "Download opens a converter site in a new tab: MP3 for songs, MP4 for videos. The Android app can save straight to your phone and play offline.",
      scene: <DownloadScene mobile={mobile} />,
    },
    {
      title: "Make it yours",
      body: mobile
        ? "The gear at the top opens Settings: theme, colours, playback, video quality, history and your data. You can replay this tour there too."
        : "Settings is in the sidebar, with theme and colours also in the top bar. You can replay this tour from Settings any time.",
      scene: <SettingsScene />,
    },
  ];
}

/* ---------------------------------- tour -------------------------------- */

function Tour({ onClose }: { onClose: () => void }) {
  const [mobile] = useState(isMobileLayout);
  const steps = useRef(buildSteps(mobile)).current;
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [closing, setClosing] = useState(false);
  const last = i === steps.length - 1;

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 220);
  }, [onClose]);
  const go = useCallback(
    (d: 1 | -1) => {
      setDir(d);
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

  // swipe left / right between steps
  const sx = useRef<{ x: number; y: number } | null>(null);
  const step = steps[i];

  return (
    <div
      className={cn("fixed inset-0 z-[120] flex items-center justify-center p-4 transition-opacity duration-200", closing && "opacity-0")}
      role="dialog"
      aria-modal="true"
      aria-label="App tour"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md animate-fade-in" onClick={close} />
      <div
        className="blur-panel surface-raised relative z-10 flex w-[min(100%,27rem)] animate-scale-in flex-col overflow-hidden p-0! shadow-2xl"
        onPointerDown={(e) => (sx.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const s = sx.current;
          sx.current = null;
          if (!s || e.pointerType === "mouse") return;
          const dx = e.clientX - s.x;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) go(dx < 0 ? 1 : -1);
        }}
      >
        <div
          className="tut-stage relative flex h-[236px] items-center justify-center overflow-hidden"
          style={{
            background:
              "radial-gradient(120% 90% at 20% 10%, color-mix(in oklab, var(--c-accent) 55%, transparent), transparent 60%), radial-gradient(100% 80% at 90% 100%, color-mix(in oklab, var(--c-accent2) 45%, transparent), transparent 60%), #0b1220",
          }}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close tour"
            className="focus-ring absolute top-3 right-3 z-40 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white/90 transition hover:bg-black/60"
          >
            <X className="h-4 w-4" />
          </button>
          <span className="absolute top-3.5 left-4 z-40 text-[10px] font-bold tracking-widest text-white/70 uppercase">
            {i + 1} / {steps.length}
          </span>
          <div key={i} className={dir > 0 ? "tut-in-r" : "tut-in-l"}>
            {step.scene}
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div key={i} className={cn("min-h-[104px]", dir > 0 ? "tut-in-r" : "tut-in-l")}>
            <h3 className="text-xl font-black tracking-tight text-ink">{step.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">{step.body}</p>
          </div>

          <div className="flex items-center justify-center gap-1.5">
            {steps.map((_, n) => (
              <button
                key={n}
                type="button"
                aria-label={`Step ${n + 1}`}
                onClick={() => {
                  setDir(n > i ? 1 : -1);
                  setI(n);
                }}
                className={cn("h-1.5 rounded-full transition-all duration-300", n === i ? "w-6 bg-accent" : "w-1.5 bg-ink/20 hover:bg-ink/40")}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            {i === 0 ? (
              <Button variant="ghost" onClick={close}>
                Skip
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => go(-1)}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            )}
            <Button onClick={() => go(1)} className="px-5">
              {last ? (
                <>
                  <Sparkles className="h-4 w-4" /> Let's go
                </>
              ) : (
                <>
                  Next <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
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
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">Take a quick tour to see where everything is. It takes under a minute.</p>
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
export function Tutorial() {
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
      <Tour onClose={() => setState("none")} />
    ),
    document.body,
  );
}
