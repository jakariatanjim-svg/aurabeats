import { useEffect, useRef } from "react";
import { useEngine, usePlayer } from "@/hooks/usePlayer";
import { cn } from "@/utils/cn";

interface VisualizerProps {
  variant?: "bars" | "wave" | "mirror";
  barCount?: number;
  className?: string;
  active: boolean;
}

/** Native sample data when capture is allowed; otherwise a restrained
 * decorative wave, not a fabricated spectrum or a playback-position slider.
 * Sampling never changes the audible output or its cross-origin settings.
 */
export function Visualizer({ variant = "bars", barCount = 44, className, active }: VisualizerProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { readSpectrum } = useEngine();
  const { isBuffering } = usePlayer();
  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let width = 0, height = 0, raf = 0, last = 0, phase = 0;
    const count = Math.max(4, barCount);
    const smooth = new Float32Array(count);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const fit = () => {
      const rect = cv.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(width * dpr));
      cv.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(fit);
    fit(); ro.observe(cv);
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 1000 / 30 || !width || !height || document.hidden) return;
      const dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      const moving = active && !isBuffering && !reduced.matches;
      if (moving) phase += dt;
      const bins = moving ? readSpectrum() : null;
      const style = getComputedStyle(document.documentElement);
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, style.getPropertyValue("--c-accent2").trim() || "#22d3ee");
      gradient.addColorStop(1, style.getPropertyValue("--c-accent").trim() || "#3b82f6");
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = gradient;
      ctx.fillStyle = gradient;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const p = i / (count - 1);
        const bin = bins ? bins[Math.min(bins.length - 1, Math.floor(Math.pow(p, 1.7) * bins.length * 0.75))] / 255 : 0;
        const target = moving ? (bins ? bin : 0.18) : 0;
        smooth[i] += (target - smooth[i]) * (1 - Math.exp(-dt * 12));
        const envelope = Math.pow(Math.sin(p * Math.PI), 0.65);
        const wave = Math.sin(p * Math.PI * 6 - phase * 2.8);
        const amplitude = smooth[i] * envelope * height * 0.43;
        const x = p * width;
        if (variant === "wave") {
          const y = height / 2 + wave * amplitude;
          if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        } else {
          const h = Math.max(1.5, amplitude * 2);
          const bw = Math.max(1, width / count - 2);
          ctx.fillRect(x, variant === "mirror" ? (height - h) / 2 : height - h, bw, h);
        }
      }
      if (variant === "wave") ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [active, isBuffering, barCount, variant, readSpectrum]);
  return <canvas ref={canvas} className={cn("block h-full w-full", className)} aria-hidden="true" />;
}
