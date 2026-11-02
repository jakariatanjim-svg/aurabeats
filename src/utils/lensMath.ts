/**
 * The optics behind Liquid Glass lensing (utils/liquidRefraction): pure maths
 * with no page access, so it runs in a background worker (lensWorker.ts) and
 * the page never stalls while a new glass size is prepared. The main thread
 * uses the same code as a fallback, so both give identical pictures.
 */

/** Height of the curved rim, 0 at the outer edge → 1 where it turns flat. */
const rimShape = (x: number) => Math.pow(Math.max(0, 1 - (1 - Math.min(1, Math.max(0, x))) ** 4), 0.25);

/** Sideways shift (px) of light passing the rim, sampled outer → inner. */
function bendProfile(bezel: number, thickness: number, ior = 1.5, n = 96): { p: Float32Array; max: number } {
  const p = new Float32Array(n);
  const eta = 1 / ior;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const a = Math.max(0, x - 1e-4);
    const b = Math.min(1, x + 1e-4);
    const slope = (rimShape(b) - rimShape(a)) / (b - a);
    const len = Math.hypot(slope, 1);
    const nx = -slope / len;
    const ny = -1 / len;
    const k = 1 - eta * eta * (1 - ny * ny);
    if (k < 0) continue;
    const c = eta * ny + Math.sqrt(k);
    const tx = -c * nx;
    const ty = eta - c * ny;
    if (ty <= 1e-6) continue;
    const v = tx * ((rimShape(x) * bezel + thickness) / ty);
    p[i] = v;
    if (Math.abs(v) > max) max = Math.abs(v);
  }
  return { p, max };
}

// light comes from the top-left, a little more from above
const LX = -0.55;
const LY = -0.835;

export interface LensJob {
  /** surface size in css px */
  w: number;
  h: number;
  radius: number;
  dpr: number;
}

export interface LensPixels {
  W: number;
  H: number;
  /** bend map (red = sideways, green = up/down, 128 = none), RGBA */
  bend: Uint8ClampedArray<ArrayBuffer>;
  /** edge light (white, strength in alpha), RGBA */
  lit: Uint8ClampedArray<ArrayBuffer>;
  /** strongest shift in px (the displacement scale) */
  max: number;
}

/** Rim width for a surface (also used for the filter's scale). */
export const bezelFor = (w: number, h: number, radius: number) => Math.max(6, Math.min(radius, 24, Math.min(w, h) * 0.34));

/** The bend map and the matching edge-light picture for one surface size. */
export function lensPixels({ w, h, radius: rad, dpr }: LensJob): LensPixels {
  const bezel = bezelFor(w, h, rad);
  const { p: prof, max } = bendProfile(bezel, Math.min(52, bezel * 2.6));
  const radius = Math.max(rad, bezel);
  const W = Math.max(1, Math.round(w * dpr));
  const H = Math.max(1, Math.round(h * dpr));
  const d = new Uint8ClampedArray(W * H * 4);
  new Uint32Array(d.buffer).fill(0xff008080); // little-endian RGBA (128,128,0,255): no bend
  const ld = new Uint8ClampedArray(W * H * 4);
  // rim steepness along the bezel, outer → inner (where light reflects most)
  const steep = new Float32Array(prof.length);
  for (let i = 0; i < prof.length; i++) {
    const x = i / prof.length;
    const a = Math.max(0, x - 0.01);
    const b = Math.min(1, x + 0.01);
    steep[i] = Math.min(1, ((rimShape(b) - rimShape(a)) / (b - a)) * 0.35);
  }
  const r = Math.min(Math.round(radius * dpr), W >> 1, H >> 1);
  const bz = Math.min(Math.max(1, Math.round(bezel * dpr)), r);
  if (r > 0 && max > 0) {
    const outer2 = (r + 1) ** 2;
    const inner2 = (r - bz) ** 2;
    const spanX = W - 2 * r;
    const spanY = H - 2 * r;
    const n = prof.length;
    for (let y = 0; y < H; y++) {
      const py = y + 0.5;
      const cy = py < r ? py - r : py >= H - r ? py - r - spanY : 0;
      // rows in the flat middle band only touch the left/right rims
      for (let x = 0; x < W; x++) {
        const pxx = x + 0.5;
        const cx = pxx < r ? pxx - r : pxx >= W - r ? pxx - r - spanX : 0;
        if (cx === 0 && cy === 0) {
          // flat centre: jump to the right rim
          if (x < W - r - 1) x = W - r - 1;
          continue;
        }
        const d2 = cx * cx + cy * cy;
        if (d2 > outer2 || d2 < inner2) continue;
        const dist = Math.sqrt(d2);
        const idx = Math.min(n - 1, Math.max(0, (((r - dist) / bz) * n) | 0));
        const v = prof[idx];
        const fade = dist <= r ? 1 : Math.max(0, 1 - (dist - r));
        const i = (y * W + x) * 4;
        // edge light: facing the light → bright, the far side → a softer
        // glint (light leaving the glass), both hugging the outer rim
        const nx = cx / dist;
        const ny = cy / dist;
        const facing = nx * LX + ny * LY;
        const depth = (r - dist) / dpr; // css px in from the edge
        const hug = Math.exp(-Math.max(0, depth) / 2.2) * 0.85 + steep[idx] * 0.35;
        const glint = (facing > 0 ? facing ** 1.6 : 0.5 * (-facing) ** 2.2) * hug + 0.12 * Math.exp(-Math.max(0, depth) / 0.9);
        ld[i] = ld[i + 1] = ld[i + 2] = 255;
        ld[i + 3] = Math.min(255, glint * 255 * fade);
        if (!v) continue;
        d[i] = 128 + ((-cx / dist) * v * 127 * fade) / max;
        d[i + 1] = 128 + ((-cy / dist) * v * 127 * fade) / max;
      }
    }
  }
  return { W, H, bend: d, lit: ld, max };
}
