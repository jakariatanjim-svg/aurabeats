/**
 * Liquid Glass lensing: the floating glass surfaces (bars, menus, sheets,
 * toasts, small capsules) bend what is behind them near their edges, like a
 * thick piece of curved glass — the part plain blur can't do.
 *
 * How: for each surface size a "bend map" is drawn once (how far each pixel
 * near the rounded edge is pushed inward, from Snell's law through a curved
 * rim), and the surface's backdrop goes through an SVG filter that blurs,
 * bends (feDisplacementMap) and saturates it. On a mouse device the three
 * colours bend by slightly different amounts — the faint rainbow fringe of
 * real glass.
 *
 * Browsers: only Chromium draws SVG filters behind an element (Chrome, Edge,
 * Android app). Elsewhere, with Blur off or "reduce transparency", nothing
 * runs and the normal frosted glass stays.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const TARGETS = ".surface-raised, .ab-topbar :is(button.border, .ab-seg), .ab-glass-lens";
const MAX_AREA = 900_000; // px² — bigger surfaces keep the plain frost
const MAX_DPR = 2;

interface Entry {
  id: string;
  refs: number;
  node: SVGFilterElement;
}
interface Applied {
  key: string;
}

let running = false;
let host: SVGSVGElement | null = null;
let uid = 0;
let fringe = false;
const cache = new Map<string, Entry>();
const applied = new Map<HTMLElement, Applied>();
let ro: ResizeObserver | null = null;
let mo: MutationObserver | null = null;
const queue = new Set<HTMLElement>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/* ------------------------------ the optics ------------------------------ */

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

/** The bend map as an image: red = sideways, green = up/down, 128 = none. */
function bendMap(w: number, h: number, radius: number, bezel: number, prof: Float32Array, max: number, dpr: number): string {
  const W = Math.max(1, Math.round(w * dpr));
  const H = Math.max(1, Math.round(h * dpr));
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(W, H);
  const px = new Uint32Array(img.data.buffer);
  px.fill(0xff008080); // little-endian RGBA (128,128,0,255): no bend
  const r = Math.min(Math.round(radius * dpr), W >> 1, H >> 1);
  const bz = Math.min(Math.max(1, Math.round(bezel * dpr)), r);
  if (r > 0 && max > 0) {
    const outer2 = (r + 1) ** 2;
    const inner2 = (r - bz) ** 2;
    const spanX = W - 2 * r;
    const spanY = H - 2 * r;
    const n = prof.length;
    const d = img.data;
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
        if (!v) continue;
        const fade = dist <= r ? 1 : Math.max(0, 1 - (dist - r));
        const i = (y * W + x) * 4;
        d[i] = 128 + ((-cx / dist) * v * 127 * fade) / max;
        d[i + 1] = 128 + ((-cy / dist) * v * 127 * fade) / max;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}

const svgEl = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

function buildFilter(w: number, h: number, radius: number, blur: number): SVGFilterElement | null {
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const bezel = Math.max(6, Math.min(radius, 22, Math.min(w, h) * 0.32));
  const { p, max } = bendProfile(bezel, Math.min(48, bezel * 2.4));
  const url = bendMap(w, h, Math.max(radius, bezel), bezel, p, max, dpr);
  if (!url) return null;
  const f = svgEl("filter", {
    id: `ab-lens-${++uid}`,
    "color-interpolation-filters": "sRGB",
  });
  f.appendChild(svgEl("feGaussianBlur", { in: "SourceGraphic", stdDeviation: blur, result: "frost" }));
  f.appendChild(svgEl("feImage", { href: url, x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none", result: "map" }));
  const scale = max * 1.1;
  const bend = (s: number, result: string) =>
    f.appendChild(svgEl("feDisplacementMap", { in: "frost", in2: "map", scale: s, xChannelSelector: "R", yChannelSelector: "G", result }));
  if (fringe) {
    // red bends most, blue least: a faint prism fringe at the very rim
    const only = (src: string, ch: number, result: string) => {
      const m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
      m[ch * 6] = 1;
      f.appendChild(svgEl("feColorMatrix", { in: src, type: "matrix", values: m.join(" "), result }));
    };
    bend(scale, "dr");
    only("dr", 0, "r");
    bend(scale * 0.94, "dg");
    only("dg", 1, "g");
    bend(scale * 0.88, "db");
    only("db", 2, "b");
    f.appendChild(svgEl("feBlend", { in: "r", in2: "g", mode: "screen", result: "rg" }));
    f.appendChild(svgEl("feBlend", { in: "rg", in2: "b", mode: "screen", result: "bent" }));
  } else {
    bend(scale, "bent");
  }
  f.appendChild(svgEl("feColorMatrix", { in: "bent", type: "saturate", values: 1.9, result: "sat" }));
  const light = svgEl("feComponentTransfer", { in: "sat" });
  for (const fn of ["feFuncR", "feFuncG", "feFuncB"] as const) light.appendChild(svgEl(fn, { type: "linear", slope: 1.05, intercept: 0.01 }));
  f.appendChild(light);
  return f;
}

/* ------------------------------ the plumbing ----------------------------- */

function svgHost(): SVGSVGElement {
  if (host?.isConnected) return host;
  host = document.createElementNS(SVG_NS, "svg");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none");
  document.body.appendChild(host);
  return host;
}

function release(el: HTMLElement) {
  const a = applied.get(el);
  if (!a) return;
  applied.delete(el);
  ro?.unobserve(el);
  el.style.removeProperty("backdrop-filter");
  el.style.removeProperty("-webkit-backdrop-filter");
  const e = cache.get(a.key);
  if (e && --e.refs <= 0) {
    e.node.remove();
    cache.delete(a.key);
  }
}

function apply(el: HTMLElement) {
  if (!running || !el.isConnected) return release(el);
  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  const cs = getComputedStyle(el);
  // hidden, tiny, huge or square-cornered surfaces keep the plain frost
  if (w < 24 || h < 20 || w * h > MAX_AREA || cs.display === "none" || cs.visibility === "hidden") return release(el);
  const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
  if (radius < 6) return release(el);
  // frost strength follows the theme: dense for menus/sheets, lighter for bars
  const blur = Number(cs.getPropertyValue("--lg-lens-blur")) || (w * h > 60_000 ? 14 : 9);
  const key = `${w}x${h}r${Math.round(radius)}b${blur}${fringe ? "f" : ""}`;
  const prev = applied.get(el);
  if (prev?.key === key) return;
  let e = cache.get(key);
  if (!e) {
    const node = buildFilter(w, h, radius, blur);
    if (!node) return;
    svgHost().appendChild(node);
    e = { id: node.id, refs: 0, node };
    cache.set(key, e);
  }
  e.refs++;
  if (prev) release(el);
  applied.set(el, { key });
  ro?.observe(el);
  el.style.setProperty("backdrop-filter", `url("#${e.id}")`);
}

function schedule(el: HTMLElement) {
  queue.add(el);
  clearTimeout(flushTimer);
  // after the surface settles (opening animations, resizes)
  flushTimer = setTimeout(() => {
    const els = [...queue];
    queue.clear();
    requestAnimationFrame(() => els.forEach(apply));
  }, 120);
}

function scan(root: ParentNode) {
  if (root instanceof HTMLElement && root.matches(TARGETS)) schedule(root);
  root.querySelectorAll?.<HTMLElement>(TARGETS).forEach(schedule);
}

export function lensSupported(): boolean {
  try {
    return (
      typeof CSS !== "undefined" &&
      CSS.supports("backdrop-filter", 'url("#a")') &&
      // Safari/Firefox accept the syntax but don't draw it
      /Chrome\/|Chromium\//.test(navigator.userAgent) &&
      !matchMedia("(prefers-reduced-transparency: reduce)").matches
    );
  } catch {
    return false;
  }
}

export function startLens() {
  if (running || !lensSupported()) return;
  running = true;
  fringe = matchMedia("(hover: hover) and (pointer: fine)").matches;
  ro = new ResizeObserver((entries) => entries.forEach((en) => schedule(en.target as HTMLElement)));
  mo = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === "attributes") {
        const t = r.target as HTMLElement;
        if (t.matches(TARGETS)) schedule(t);
        else if (applied.has(t)) release(t);
        continue;
      }
      r.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n));
      r.removedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        for (const el of [...applied.keys()]) if (!el.isConnected) release(el);
      });
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  scan(document);
}

export function stopLens() {
  if (!running) return;
  running = false;
  ro?.disconnect();
  mo?.disconnect();
  ro = mo = null;
  clearTimeout(flushTimer);
  queue.clear();
  for (const el of [...applied.keys()]) release(el);
  cache.forEach((e) => e.node.remove());
  cache.clear();
}
