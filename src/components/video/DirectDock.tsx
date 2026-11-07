/**
 * Website "real player": when the AuraBeats extension (1.2+) is connected,
 * the shared player plays the video's own files (any quality, up to 4x, no
 * ads, also videos whose owner blocked embedding) instead of YouTube's
 * embedded player. Same places as the embedded one: over the watch page's
 * slot, or small in a corner while browsing. Anything it can't play falls
 * back to the embedded player.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Maximize2, X } from "lucide-react";
import { usePlayer } from "@/hooks/usePlayer";
import { videoLibrary } from "@/hooks/useVideoLibrary";
import { getVideo } from "@/services/video/api";
import type { VideoDetails } from "@/services/video/types";
import type { RouteKey } from "@/routes";
import { dock, dockRefs, useDock } from "./dock";
import { navMemory } from "@/utils/navMemory";
import { VideoPlayer } from "./VideoPlayer";

type Direct = { status: "off" } | { status: "loading" } | { status: "ok"; details: VideoDetails } | { status: "failed" };

const canHls = () => typeof document !== "undefined" && !!document.createElement("video").canPlayType("application/vnd.apple.mpegurl");

/** The video's own files for `id`, or "failed" (→ embedded player). */
export function useDirect(id: string | null, on: boolean): Direct & { fail: (at: number) => void } {
  const [st, setSt] = useState<{ id: string; details?: VideoDetails; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!id || !on) return;
    let alive = true;
    setSt({ id });
    getVideo(id).then(
      (d) => alive && setSt(d.streams.live && !canHls() ? { id, failed: true } : { id, details: d }),
      () => alive && setSt({ id, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [id, on]);
  const fail = useCallback((at: number) => {
    dock.setStart(at);
    setSt((s) => (s ? { id: s.id, failed: true } : s));
  }, []);
  if (!id || !on) return { status: "off", fail };
  if (!st || st.id !== id) return { status: "loading", fail };
  if (st.failed) return { status: "failed", fail };
  return st.details ? { status: "ok", details: st.details, fail } : { status: "loading", fail };
}

export function DirectDock({
  details,
  navigate,
  musicBar,
  onFail,
}: {
  details: VideoDetails | null;
  navigate: (r: RouteKey) => void;
  musicBar: boolean;
  onFail: (at: number) => void;
}) {
  const d = useDock();
  const { isPlaying: musicPlaying, pause: pauseMusic } = usePlayer();
  const boxRef = useRef<HTMLDivElement>(null);
  const mode = d.mode;
  const mobileNav = typeof window !== "undefined" && innerWidth < 768;
  const miniW = mobileNav ? Math.min(innerWidth * 0.62, 300) : 400;

  // Position: over the watch page's slot, or in the corner (glides between).
  const prevMode = useRef(mode);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const st = box.style;
    const from = prevMode.current;
    prevMode.current = mode;
    const before = from !== mode ? box.getBoundingClientRect() : null;
    const glide = () => {
      if (!before || !before.width) return;
      const after = box.getBoundingClientRect();
      if (!after.width) return;
      st.transition = "none";
      st.transformOrigin = "0 0";
      st.translate = `${before.left - after.left}px ${before.top - after.top}px`;
      st.scale = `${before.width / after.width} ${before.height / after.height}`;
      void box.offsetWidth;
      st.transition = "translate 320ms cubic-bezier(.2,.8,.2,1), scale 320ms cubic-bezier(.2,.8,.2,1)";
      st.translate = "";
      st.scale = "";
      window.setTimeout(() => (st.transition = ""), 340);
    };
    for (const k of ["left", "top", "right", "bottom", "width", "height", "clipPath", "visibility", "borderRadius"] as const) st[k] = "";
    if (mode === "mini") {
      const base = mobileNav ? (musicBar ? 10.4 : 5.6) : musicBar ? 7.25 : 1.25;
      st.width = `${miniW}px`;
      st.height = `${(miniW * 9) / 16}px`;
      st.bottom = `calc(${base}rem + var(--sa-bottom, 0px))`;
      st.right = "max(12px, var(--sa-right, 0px))";
      st.borderRadius = "14px";
      glide();
      return;
    }
    const scroller = document.getElementById("ab-scroll");
    let raf = 0;
    let last = "";
    const tick = () => {
      const slot = dockRefs.slot;
      if (slot && !document.fullscreenElement) {
        const r = slot.getBoundingClientRect();
        const sc = scroller?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
        const top = Math.max(0, sc.top - r.top);
        const bottom = Math.max(0, r.bottom - sc.bottom);
        const radius = getComputedStyle(slot).borderTopLeftRadius || "0px";
        const key = `${r.left}|${r.top}|${r.width}|${r.height}|${top}|${bottom}|${radius}`;
        if (key !== last) {
          last = key;
          st.left = `${r.left}px`;
          st.top = `${r.top}px`;
          st.width = `${r.width}px`;
          st.height = `${r.height}px`;
          st.borderRadius = radius;
          st.clipPath = top || bottom ? `inset(${top}px 0 ${bottom}px 0 round ${radius})` : "";
          st.visibility = r.width && top < r.height && bottom < r.height ? "visible" : "hidden";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    glide();
    return () => cancelAnimationFrame(raf);
  }, [mode, musicBar, miniW, mobileNav]);

  const lastSave = useRef(0);
  const onTime = useCallback((t: number, dur: number) => {
    dockRefs.time = t;
    const meta = dock.get().meta;
    if (meta && meta.id === dock.get().id && t > 1 && Date.now() - lastSave.current > 5000) {
      lastSave.current = Date.now();
      videoLibrary.recordProgress({ ...meta, duration: meta.duration || Math.round(dur) }, t);
    }
  }, []);
  const onEnded = useCallback(() => {
    dockRefs.ended = true;
    const meta = dock.get().meta;
    if (meta) videoLibrary.recordProgress(meta, meta.duration);
    dockRefs.onEnded?.();
  }, []);
  const onPlayStart = useCallback(() => {
    dockRefs.ended = false;
    if (musicPlaying) pauseMusic();
  }, [musicPlaying, pauseMusic]);
  const onAspect = useCallback((r: number) => d.id && dock.setAspect(d.id, r), [d.id]);

  const mini = mode === "mini";
  return (
    <div ref={boxRef} className="fixed z-40 overflow-hidden bg-black shadow-2xl select-none">
      {details ? (
        <VideoPlayer
          key={`${details.id}:${details.streams.source}`}
          details={details}
          startAt={d.startAt}
          musicPlaying={musicPlaying}
          onPlayStart={onPlayStart}
          onTime={onTime}
          onEnded={onEnded}
          onFatal={(_reason, at) => onFail(at || dockRefs.time)}
          next={d.next}
          onNext={() => d.next && navigate(`watch:${d.next.id}`)}
          mini={mini}
          onAspect={onAspect}
          onTheater={() => dock.toggleTheater()}
          onMini={() => {
            if (navMemory.cameFromPage) window.history.back();
            else navigate(navMemory.lastPage as RouteKey);
          }}
        />
      ) : (
        <div className="relative h-full w-full">
          {d.id && <img src={`https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`} alt="" className="h-full w-full object-cover opacity-50" />}
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-white/90" />
          </span>
        </div>
      )}
      {mini && (
        <div className="group absolute inset-0">
          <button type="button" aria-label="Open the video" onClick={() => d.id && navigate(`watch:${d.id}`)} className="absolute inset-0" />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-2 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            <p className="line-clamp-1 text-xs font-bold text-white">{d.meta?.title}</p>
            <span className="pointer-events-auto flex gap-1">
              <button type="button" aria-label="Open" onClick={() => d.id && navigate(`watch:${d.id}`)} className="rounded-full bg-black/50 p-1.5 text-white">
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label="Close" onClick={() => dock.close()} className="rounded-full bg-black/50 p-1.5 text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
