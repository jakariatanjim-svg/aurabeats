/**
 * The moving light behind the full-screen music player. Every song gets its
 * own: the colours come from its artwork, and the kind of motion (flowing
 * ribbons, orbiting lights, turning rays or drifting blobs), its speed and
 * size are picked from the song itself, so no two songs look the same. It
 * flows while the song plays, slows to a stop on pause, and its strength
 * rises and falls through the song.
 *
 * Drawn small and scaled up (soft light needs no detail), at most ~30 frames
 * a second, only while the player is open; reduced-motion users get a still
 * frame.
 */
import { useEffect, useRef } from "react";
import { songPalette, type Rgb } from "@/utils/songPalette";

const SCALE = 0.4; // canvas pixels per CSS pixel

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

interface Look {
  kind: 0 | 1 | 2 | 3;
  speed: number;
  count: number;
  size: number;
  phases: number[];
  /** slow rise and fall of strength through the song */
  swell: [number, number, number];
}

function lookFor(id: string): Look {
  const r = rng(hash(id));
  return {
    kind: Math.floor(r() * 4) as Look["kind"],
    speed: 0.55 + r() * 0.9,
    count: 3 + Math.floor(r() * 4),
    size: 0.8 + r() * 0.6,
    phases: Array.from({ length: 12 }, () => r() * Math.PI * 2),
    swell: [0.05 + r() * 0.08, 0.13 + r() * 0.1, r() * 6],
  };
}

export function SongAura({ id, art, playing, className }: { id: string; art?: string; playing: boolean; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const look = lookFor(id);
    let colors: Rgb[] = songPalette.fallback(id);
    let alive = true;
    void songPalette.of(art, id).then((c) => alive && (colors = c));

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let redraw: (() => void) | undefined;
    const fit = () => {
      const r = cv.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width * SCALE));
      h = Math.max(1, Math.round(r.height * SCALE));
      const changed = cv.width !== w || cv.height !== h;
      if (cv.width !== w) cv.width = w;
      if (cv.height !== h) cv.height = h;
      // Resizing clears a canvas, including when paused or motion is reduced.
      if (changed) redraw?.();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    let t = 0; // song-time of the animation (seconds, scaled)
    let vel = playingRef.current ? 1 : 0;
    let last = performance.now();
    let raf = 0;
    let fade = 0; // eases in on a new song

    const draw = () => {
      const m = Math.min(w, h);
      const cx = w / 2;
      const cy = h * 0.42;
      const [s1, s2, s3] = look.swell;
      const energy = 0.75 + 0.25 * Math.sin(t * s1 + s3) * Math.sin(t * s2);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const a = 0.55 * energy * fade;
      const col = (i: number) => colors[i % colors.length];

      if (look.kind === 0) {
        // flowing ribbons across the screen
        for (let i = 0; i < look.count; i++) {
          const p = look.phases[i];
          const yBase = h * (0.25 + (0.55 * (i + 0.5)) / look.count);
          const amp = h * 0.09 * look.size * (0.6 + 0.4 * Math.sin(t * 0.3 + p));
          ctx.beginPath();
          for (let x = -10; x <= w + 10; x += 6) {
            const y = yBase + Math.sin(x / (w * 0.22) + t * 0.6 + p) * amp + Math.sin(x / (w * 0.09) - t * 0.9 + p * 2) * amp * 0.35;
            if (x === -10) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = rgba(col(i), a * 0.5);
          ctx.lineWidth = m * 0.07 * look.size;
          ctx.lineCap = "round";
          ctx.stroke();
          ctx.strokeStyle = rgba(col(i + 1), a * 0.8);
          ctx.lineWidth = m * 0.012;
          ctx.stroke();
        }
      } else if (look.kind === 1) {
        // lights orbiting the artwork
        for (let i = 0; i < look.count + 2; i++) {
          const p = look.phases[i];
          const rx = m * (0.32 + 0.12 * Math.sin(p)) * look.size;
          const ry = rx * (0.45 + 0.3 * Math.cos(p * 1.7));
          const ang = t * 0.35 * (i % 2 ? 1 : -1) + p;
          const x = cx + Math.cos(ang) * rx;
          const y = cy + Math.sin(ang) * ry;
          const r = m * (0.16 + 0.06 * Math.sin(t * 0.8 + p));
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, rgba(col(i), a));
          g.addColorStop(1, rgba(col(i), 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
      } else if (look.kind === 2) {
        // slowly turning rays from behind the artwork
        const rays = look.count * 2 + 2;
        const len = Math.hypot(w, h);
        for (let i = 0; i < rays; i++) {
          const ang = (i / rays) * Math.PI * 2 + t * 0.12 + Math.sin(t * 0.2 + look.phases[i % 12]) * 0.15;
          const spread = 0.09 + 0.05 * Math.sin(t * 0.5 + i);
          const g = ctx.createRadialGradient(cx, cy, m * 0.1, cx, cy, len * 0.6);
          g.addColorStop(0, rgba(col(i), a * 0.7));
          g.addColorStop(1, rgba(col(i), 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, len, ang - spread, ang + spread);
          ctx.closePath();
          ctx.fill();
        }
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.45);
        g.addColorStop(0, rgba(col(0), a * 0.8));
        g.addColorStop(1, rgba(col(0), 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      } else {
        // large soft blobs drifting and merging
        for (let i = 0; i < look.count + 1; i++) {
          const p = look.phases[i];
          const x = w * (0.5 + 0.38 * Math.sin(t * 0.17 * look.speed + p) * Math.cos(t * 0.11 + p * 0.5));
          const y = h * (0.45 + 0.32 * Math.cos(t * 0.13 * look.speed + p * 1.3));
          const r = m * (0.35 + 0.12 * Math.sin(t * 0.4 + p)) * look.size;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, rgba(col(i), a * 0.9));
          g.addColorStop(0.6, rgba(col(i + 1), a * 0.25));
          g.addColorStop(1, rgba(col(i + 1), 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
    };

    redraw = draw;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      if (dt < 1 / 32) return; // ~30 frames a second is plenty for soft light
      last = now;
      // plays → flows; paused → glides to a stop
      vel += ((playingRef.current ? 1 : 0) - vel) * Math.min(1, dt * 1.5);
      fade = Math.min(1, fade + dt * 0.8);
      t += dt * vel * look.speed;
      if (vel < 0.003 && fade >= 1) return; // stopped: nothing changes
      draw();
    };
    if (still) {
      fade = 1;
      t = look.phases[0] * 10;
      draw();
      void songPalette.of(art, id).then(() => alive && draw());
    } else raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [id, art]);

  return <canvas ref={canvas} aria-hidden="true" className={className} />;
}
