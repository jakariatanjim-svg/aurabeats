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
 * On top of the bent picture the filter paints the glass's own light: a
 * bright specular edge where the curved rim faces the light (top-left) and a
 * fainter one where light leaves it (bottom-right), shaped by the rim's
 * curve — the thick, wet edge that makes it read as Liquid Glass.
 *
 * Strong computers (mouse + 6 cores or more) also lens the content cards
 * (clear glass, little frost), but only those on screen; phones keep it to
 * the floating surfaces.
 *
 * Browsers: only Chromium draws SVG filters behind an element (Chrome, Edge,
 * Android app). Elsewhere, with Blur off or "reduce transparency", nothing
 * runs and the normal frosted glass stays.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const TARGETS = ".surface-raised, .ab-topbar :is(button.border, .ab-seg), .ab-glass-lens";
/** strong computers: the content cards too */
const CARDS = ".blur-panel";
const MAX_LENSED = 48; // never more lensed surfaces than this at once
const MAX_AREA = 900_000; // px² — bigger surfaces keep the plain frost
const MAX_CARD_AREA = 260_000; // content cards: smaller ones only (many on screen)
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
let rich = false;
let io: IntersectionObserver | null = null;
const onScreen = new Set<HTMLElement>();
const targets = () => (rich ? `${TARGETS}, ${CARDS}` : TARGETS);
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

// light comes from the top-left, a little more from above
const LX = -0.55;
const LY = -0.835;

/** The bend map as an image (red = sideways, green = up/down, 128 = none)
 *  and the matching edge-light image (white, strength in alpha). */
function bendMap(w: number, h: number, radius: number, bezel: number, prof: Float32Array, max: number, dpr: number): { bend: string; spec: string } | null {
  const W = Math.max(1, Math.round(w * dpr));
  const H = Math.max(1, Math.round(h * dpr));
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  const px = new Uint32Array(img.data.buffer);
  px.fill(0xff008080); // little-endian RGBA (128,128,0,255): no bend
  const lit = ctx.createImageData(W, H);
  const ld = lit.data;
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
  ctx.putImageData(img, 0, 0);
  const bend = cv.toDataURL("image/png");
  ctx.clearRect(0, 0, W, H);
  ctx.putImageData(lit, 0, 0);
  return { bend, spec: cv.toDataURL("image/png") };
}

const svgEl = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

function buildFilter(w: number, h: number, radius: number, blur: number, spec: number, sat: number): SVGFilterElement | null {
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const bezel = Math.max(6, Math.min(radius, 24, Math.min(w, h) * 0.34));
  const { p, max } = bendProfile(bezel, Math.min(52, bezel * 2.6));
  const maps = bendMap(w, h, Math.max(radius, bezel), bezel, p, max, dpr);
  if (!maps) return null;
  const url = maps.bend;
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
  f.appendChild(svgEl("feColorMatrix", { in: "bent", type: "saturate", values: sat, result: "sat" }));
  const light = svgEl("feComponentTransfer", { in: "sat", result: "lit" });
  for (const fn of ["feFuncR", "feFuncG", "feFuncB"] as const) light.appendChild(svgEl(fn, { type: "linear", slope: 1.05, intercept: 0.01 }));
  f.appendChild(light);
  if (spec > 0) {
    // the glass's own edge light, screened over the bent picture
    f.appendChild(svgEl("feImage", { href: maps.spec, x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none", result: "specRaw" }));
    const amt = svgEl("feComponentTransfer", { in: "specRaw", result: "spec" });
    amt.appendChild(svgEl("feFuncA", { type: "linear", slope: spec, intercept: 0 }));
    f.appendChild(amt);
    f.appendChild(svgEl("feBlend", { in: "spec", in2: "lit", mode: "screen" }));
  }
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
  el.removeAttribute("data-lg-lens");
  const e = cache.get(a.key);
  if (e && --e.refs <= 0) {
    e.node.remove();
    cache.delete(a.key);
  }
}

function apply(el: HTMLElement) {
  if (!running || !el.isConnected || !onScreen.has(el)) return release(el);
  if (!applied.has(el) && applied.size >= MAX_LENSED) return;
  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  const cs = getComputedStyle(el);
  // hidden, tiny, huge or square-cornered surfaces keep the plain frost
  const card = !el.matches(TARGETS);
  if (w < 24 || h < 20 || w * h > (card ? MAX_CARD_AREA : MAX_AREA) || cs.display === "none" || cs.visibility === "hidden") return release(el);
  const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
  if (radius < 6) return release(el);
  // frost strength follows the theme: dense for menus/sheets, lighter for
  // bars, clear for content cards (strong computers only)

  const blur = card
    ? Number(cs.getPropertyValue("--lg-card-blur")) || 4
    : Number(cs.getPropertyValue("--lg-lens-blur")) || (w * h > 60_000 ? 14 : 9);
  const spec = Math.round((Number(cs.getPropertyValue("--lg-spec")) || 0.7) * 100) / 100;
  const sat = card ? 1.6 : 1.9;
  const key = `${w}x${h}r${Math.round(radius)}b${blur}s${spec}${card ? "c" : ""}${fringe ? "f" : ""}`;
  const prev = applied.get(el);
  if (prev?.key === key) return;
  let e = cache.get(key);
  if (!e) {
    const node = buildFilter(w, h, radius, blur, spec, sat);
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
  el.setAttribute("data-lg-lens", "");
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

/** Watch a surface: it is lensed while (nearly) on screen. */
function watch(el: HTMLElement) {
  io?.observe(el);
}
function unwatch(el: HTMLElement) {
  io?.unobserve(el);
  onScreen.delete(el);
  release(el);
}

function scan(root: ParentNode) {
  const sel = targets();
  if (root instanceof HTMLElement && root.matches(sel)) watch(root);
  root.querySelectorAll?.<HTMLElement>(sel).forEach(watch);
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
  rich = fringe && (navigator.hardwareConcurrency || 4) >= 6;
  ro = new ResizeObserver((entries) => entries.forEach((en) => schedule(en.target as HTMLElement)));
  io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const el = en.target as HTMLElement;
        if (en.isIntersecting) {
          onScreen.add(el);
          schedule(el);
        } else {
          onScreen.delete(el);
          release(el);
        }
      }
    },
    { rootMargin: "160px" },
  );
  mo = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === "attributes") {
        const t = r.target as HTMLElement;
        if (t.matches(targets())) {
          watch(t);
          schedule(t);
        } else unwatch(t);
        continue;
      }
      r.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n));
      r.removedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        for (const el of [...onScreen]) if (!el.isConnected) unwatch(el);
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
  io?.disconnect();
  ro = mo = null;
  io = null;
  onScreen.clear();
  clearTimeout(flushTimer);
  queue.clear();
  for (const el of [...applied.keys()]) release(el);
  cache.forEach((e) => e.node.remove());
  cache.clear();
}
