/**
 * Android app: the watch page as a layer over the app, with the YouTube-app
 * miniplayer.
 *
 *   full ──drag the video down──▶ mini      (the page follows the finger)
 *   mini ──tap / drag it up──────▶ full
 *   mini ──push it firmly off the bottom──▶ closed
 *
 * Every change is animated: the video shrinks into the bar / grows back to
 * the top of the page, the page slides down / up behind it. The player is
 * one element the whole time (portalled into `host`), so it never reloads.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from "react";
import { Pause, Play, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { useBackHandler } from "@/utils/backStack";
import { layerControls, layerRefs, useWatchLayer, watchLayer } from "./watchLayer";

const EASE = "cubic-bezier(.2,.8,.2,1)";
const MS = 320;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function WatchLayer({ children, musicBar, onMinimize }: { children: ReactNode; musicBar: boolean; onMinimize: () => void }) {
  const layer = useWatchLayer();
  const open = layer.mode !== "none" && layer.id !== null;

  // 0 = full page, 1 = miniplayer. Animated unless a finger is moving it.
  const [p, setP] = useState(1);
  const [dragging, setDragging] = useState(false);
  // miniplayer pushed down (px), and the close animation
  const [down, setDown] = useState(0);
  const [closing, setClosing] = useState(false);
  const [entering, setEntering] = useState(true);
  const [, setTick] = useState(0);

  const sheetRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const full = useRef<Rect>({ left: 0, top: 0, width: innerWidth, height: (innerWidth * 9) / 16 });
  const bar = useRef<Rect>({ left: 8, top: innerHeight - 160, width: innerWidth - 16, height: 64 });

  const setHost = useCallback((el: HTMLDivElement | null) => {
    hostRef.current = el;
    watchLayer.setHost(el);
  }, []);

  /* ---------------------------- geometry ------------------------------- */
  // The page's player spot, without the sheet's current slide offset.
  const measure = useCallback(() => {
    const slot = layerRefs.slot;
    const sheet = sheetRef.current;
    let changed = false;
    if (slot && sheet) {
      const r = slot.getBoundingClientRect();
      const tf = getComputedStyle(sheet).transform;
      const m = new DOMMatrixReadOnly(tf === "none" ? undefined : tf);
      const next = { left: r.left, top: r.top - m.m42, width: r.width, height: r.height };
      const f = full.current;
      if (r.width && (f.left !== next.left || f.top !== next.top || f.width !== next.width || f.height !== next.height)) {
        full.current = next;
        changed = true;
      }
    }
    const a = anchorRef.current?.getBoundingClientRect();
    if (a && a.height) {
      const b = bar.current;
      if (b.left !== a.left || b.top !== a.top || b.width !== a.width || b.height !== a.height) {
        bar.current = { left: a.left, top: a.top, width: a.width, height: a.height };
        changed = true;
      }
    }
    if (changed) setTick((t) => t + 1);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const loop = () => {
      measure();
      raf = requestAnimationFrame(loop);
    };
    // Cheap: a few rect reads per frame, only while the layer exists.
    loop();
    return () => cancelAnimationFrame(raf);
  }, [open, measure, layer.id]);

  /* ------------------------------ modes -------------------------------- */
  useEffect(() => {
    if (!open) {
      setEntering(true);
      setP(1);
      setDown(0);
      setClosing(false);
      return;
    }
    if (dragging) return;
    if (entering) {
      // opens by sliding up from the bottom
      const r = requestAnimationFrame(() => {
        setEntering(false);
        setP(layer.mode === "full" ? 0 : 1);
      });
      return () => cancelAnimationFrame(r);
    }
    setP(layer.mode === "full" ? 0 : 1);
    setDown(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, layer.mode, layer.id]);

  // Android back on the full page = miniplayer (like YouTube).
  useBackHandler(open && layer.mode === "full", onMinimize);

  const travel = () => Math.max(120, bar.current.top - full.current.top);

  // Drag from the video itself (VideoPlayer reports it).
  useEffect(() => {
    layerRefs.drag = (phase, dy, v) => {
      if (phase === "move") {
        setDragging(true);
        setP(Math.min(1, Math.max(0, dy / travel())));
        return;
      }
      setDragging(false);
      const prog = dy / travel();
      if (prog > 0.28 || (v > 0.55 && dy > 24)) {
        setP(1);
        onMinimize();
      } else setP(0);
    };
    return () => {
      layerRefs.drag = null;
    };
  }, [onMinimize]);

  /* --------------------------- miniplayer ------------------------------ */
  const g = useRef({ id: -1, y: 0, x: 0, lastY: 0, lastT: 0, vy: 0, dir: "" as "" | "up" | "down" });
  const close = useCallback(() => {
    setClosing(true);
    setDown(Math.max(innerHeight - bar.current.top, 120));
    window.setTimeout(() => {
      watchLayer.close();
    }, 260);
  }, []);
  const onBarDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (layer.mode !== "mini" || closing) return;
    const s = g.current;
    s.id = e.pointerId;
    s.y = s.lastY = e.clientY;
    s.x = e.clientX;
    s.lastT = e.timeStamp;
    s.vy = 0;
    s.dir = "";
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onBarMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (s.id !== e.pointerId) return;
    const dy = e.clientY - s.y;
    if (e.timeStamp > s.lastT) {
      s.vy = s.vy * 0.4 + ((e.clientY - s.lastY) / (e.timeStamp - s.lastT)) * 0.6;
      s.lastY = e.clientY;
      s.lastT = e.timeStamp;
    }
    if (!s.dir && Math.abs(dy) > 8) {
      s.dir = dy < 0 ? "up" : "down";
      setDragging(true);
    }
    if (s.dir === "up") setP(1 - Math.min(1, Math.max(0, -dy / travel())));
    else if (s.dir === "down") setDown(Math.max(0, dy));
  };
  const onBarUp = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (s.id !== e.pointerId) return;
    s.id = -1;
    const dy = e.clientY - s.y;
    setDragging(false);
    if (!s.dir) {
      watchLayer.expand(); // tap
      return;
    }
    if (s.dir === "up") {
      if (-dy / travel() > 0.2 || s.vy < -0.5) watchLayer.expand();
      else setP(1);
      return;
    }
    // Down: closes only when clearly pushed off the screen, not when it
    // merely reaches the edge — otherwise it springs back.
    const room = innerHeight - bar.current.top;
    if (dy > room * 0.6 || (s.vy > 1.1 && dy > 40)) close();
    else setDown(0);
  };
  const onBarCancel = () => {
    g.current.id = -1;
    setDragging(false);
    setDown(0);
    if (layer.mode === "mini") setP(1);
  };

  /* ------------------------------ styles ------------------------------- */
  const F = full.current;
  const B = bar.current;
  const M = { left: B.left, top: B.top, width: (B.height * 16) / 9, height: B.height };
  const lerp = (a: number, b: number) => a + (b - a) * p;
  const R = { left: lerp(F.left, M.left), top: lerp(F.top, M.top), width: lerp(F.width, M.width) };
  const scale = F.width ? R.width / F.width : 1;
  const anim = dragging ? "none" : `transform ${MS}ms ${EASE}, opacity ${MS}ms ${EASE}`;
  const still = p === 0 && down === 0 && !dragging;
  const hostStyle: React.CSSProperties = {
    left: F.left,
    top: F.top,
    width: F.width,
    height: F.height,
    // no transform at rest: full screen inside the player needs a plain box
    transform: still ? "none" : `translate(${R.left - F.left}px, ${R.top - F.top + down}px) scale(${scale})`,
    transformOrigin: "0 0",
    transition: anim,
    borderRadius: p > 0.02 ? `${12 / Math.max(scale, 0.05)}px` : undefined,
    opacity: closing ? 0 : 1,
  };
  const sheetStyle: React.CSSProperties = {
    transform: p === 0 ? "none" : `translateY(${p * innerHeight}px)`,
    transition: anim,
    opacity: entering ? 1 : 1 - p * 0.35,
    visibility: p >= 1 && !dragging ? "hidden" : "visible",
  };
  const barShow = entering ? 0 : Math.min(1, Math.max(0, (p - 0.55) / 0.45));
  const barStyle: React.CSSProperties = {
    transform: down ? `translateY(${down}px)` : undefined,
    transition: anim,
    opacity: closing ? 0 : barShow * (1 - Math.min(0.5, down / 400)),
    pointerEvents: layer.mode === "mini" && !closing ? "auto" : "none",
  };
  const barPos = musicBar
    ? "bottom-[calc(10.4rem+var(--sa-bottom))] md:bottom-[calc(7.25rem+var(--sa-bottom))]"
    : "bottom-[calc(5.6rem+var(--sa-bottom))] md:bottom-[calc(1.25rem+var(--sa-bottom))]";
  const barBox = cn("fixed right-2 left-2 h-16 md:right-4 md:left-auto md:w-[26rem]", barPos);

  if (!open) return null;
  return (
    <>
      {/* the page */}
      <div
        ref={sheetRef}
        style={sheetStyle}
        className={cn(
          "fixed inset-0 z-[55] flex flex-col bg-base pt-(--sa-top) [background-image:var(--app-bg-image)]",
          layer.mode === "mini" && "pointer-events-none",
        )}
      >
        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[calc(var(--sa-bottom)+2rem)] sm:px-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </div>
      </div>

      {/* where the bar will be (measured, never moves) */}
      <div ref={anchorRef} aria-hidden className={cn(barBox, "pointer-events-none invisible")} />

      {/* miniplayer bar */}
      <div
        style={barStyle}
        className={cn(barBox, "blur-panel surface-raised z-[56] flex touch-none items-center rounded-2xl shadow-xl select-none")}
        onPointerDown={onBarDown}
        onPointerMove={onBarMove}
        onPointerUp={onBarUp}
        onPointerCancel={onBarCancel}
      >
        <div className="shrink-0" style={{ width: (B.height * 16) / 9 }} />
        <div className="min-w-0 flex-1 px-3">
          <p className="truncate text-[13px] font-bold text-ink">{layer.title || "Loading…"}</p>
          <p className="truncate text-[11px] text-ink3">{layer.author}</p>
        </div>
        <button
          type="button"
          aria-label={layer.playing ? "Pause" : "Play"}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={() => layerControls.toggle?.()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink active:scale-95"
        >
          {layer.playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
        </button>
        <button
          type="button"
          aria-label="Close"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={close}
          className="mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink2 active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* the player itself (moves between the page and the bar) */}
      <div ref={setHost} style={hostStyle} className={cn("fixed z-[57] overflow-hidden bg-black", layer.mode === "mini" && "pointer-events-none")} />
      {/* touches on the small video belong to the bar (tap = open, drag) */}
      {layer.mode === "mini" && !closing && (
        <div
          className="fixed z-[58] touch-none"
          style={{ left: M.left, top: M.top + down, width: M.width, height: M.height }}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerCancel={onBarCancel}
        />
      )}
    </>
  );
}
