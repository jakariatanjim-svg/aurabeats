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
 * Speed: the bend maps are drawn in a background worker (no page hitch when
 * a new size appears), finished filters are kept for reuse when a surface
 * comes back (menus reopening, cards scrolling back in), and every pass
 * measures all surfaces first and writes after (no layout thrash).
 *
 * Browsers: only Chromium draws SVG filters behind an element (Chrome, Edge,
 * Android app). Elsewhere, with Blur off or "reduce transparency", nothing
 * runs and the normal frosted glass stays.
 */

import { lensPixels, type LensJob } from "./lensMath";

const SVG_NS = "http://www.w3.org/2000/svg";
const TARGETS = ".surface-raised, .ab-topbar :is(button.border, .ab-seg), .ab-glass-lens";
/** strong computers: the content cards too */
const CARDS = ".blur-panel";
const MAX_LENSED = 48; // never more lensed surfaces than this at once
const MAX_AREA = 900_000; // px² — bigger surfaces keep the plain frost
const MAX_CARD_AREA = 260_000; // content cards: smaller ones only (many on screen)
const MAX_DPR = 2;
const MAX_SPARE = 32; // finished filters kept for surfaces that come back

interface Entry {
  id: string;
  refs: number;
  node: SVGFilterElement;
}
interface Applied {
  key: string;
}
interface Spec {
  w: number;
  h: number;
  radius: number;
  blur: number;
  spec: number;
  sat: number;
}
interface Maps {
  bend: string;
  spec: string;
  max: number;
}

let running = false;
let host: SVGSVGElement | null = null;
let uid = 0;
let fringe = false;
let rich = false;
let io: IntersectionObserver | null = null;
const onScreen = new Set<HTMLElement>();
const watched = new Set<HTMLElement>();
const targets = () => (rich ? `${TARGETS}, ${CARDS}` : TARGETS);
/** filters by look; refs 0 = spare (kept for reuse, oldest first) */
const cache = new Map<string, Entry>();
const building = new Map<string, Promise<Entry | null>>();
const applied = new Map<HTMLElement, Applied>();
/** the look each surface should have now (async builds check it) */
const wanted = new Map<HTMLElement, string>();
let ro: ResizeObserver | null = null;
let mo: MutationObserver | null = null;
const queue = new Set<HTMLElement>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/* --------------------------- drawing the maps ---------------------------- */

let worker: Worker | null | undefined; // undefined = not tried yet
let jobId = 0;
const jobs = new Map<number, (m: Maps | null) => void>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined") throw new Error("no worker");
    const w = new Worker(new URL("./lensWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; fail?: boolean } & Maps>) => {
      const done = jobs.get(e.data.id);
      jobs.delete(e.data.id);
      done?.(e.data.fail ? null : e.data);
    };
    w.onerror = () => {
      // worker unavailable: draw on the page from now on
      w.terminate();
      worker = null;
      jobs.forEach((done) => done(null));
      jobs.clear();
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

function drawHere(job: LensJob): Maps | null {
  const px = lensPixels(job);
  const cv = document.createElement("canvas");
  cv.width = px.W;
  cv.height = px.H;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(px.bend, px.W, px.H), 0, 0);
  const bend = cv.toDataURL("image/png");
  ctx.clearRect(0, 0, px.W, px.H);
  ctx.putImageData(new ImageData(px.lit, px.W, px.H), 0, 0);
  return { bend, spec: cv.toDataURL("image/png"), max: px.max };
}

async function drawMaps(job: LensJob): Promise<Maps | null> {
  const w = getWorker();
  if (w) {
    const m = await new Promise<Maps | null>((resolve) => {
      const id = ++jobId;
      jobs.set(id, resolve);
      w.postMessage({ id, job });
    });
    if (m) return m;
  }
  return drawHere(job);
}

const svgEl = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

async function buildFilter({ w, h, radius, blur, spec, sat }: Spec): Promise<SVGFilterElement | null> {
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const maps = await drawMaps({ w, h, radius, dpr });
  if (!maps) return null;
  const f = svgEl("filter", {
    id: `ab-lens-${++uid}`,
    "color-interpolation-filters": "sRGB",
  });
  f.appendChild(svgEl("feGaussianBlur", { in: "SourceGraphic", stdDeviation: blur, result: "frost" }));
  f.appendChild(svgEl("feImage", { href: maps.bend, x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none", result: "map" }));
  const scale = maps.max * 1.1;
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

/** Drop the oldest unused filters beyond the spare allowance. */
function pruneSpare() {
  let spare = 0;
  cache.forEach((e) => e.refs <= 0 && spare++);
  if (spare <= MAX_SPARE) return;
  for (const [key, e] of cache) {
    if (spare <= MAX_SPARE) break;
    if (e.refs > 0) continue;
    e.node.remove();
    cache.delete(key);
    spare--;
  }
}

function release(el: HTMLElement) {
  wanted.delete(el);
  const a = applied.get(el);
  if (!a) return;
  applied.delete(el);
  ro?.unobserve(el);
  el.style.removeProperty("backdrop-filter");
  el.style.removeProperty("-webkit-backdrop-filter");
  el.removeAttribute("data-lg-lens");
  const e = cache.get(a.key);
  if (e && --e.refs <= 0) {
    // keep it (newest last) for when this look comes back
    cache.delete(a.key);
    cache.set(a.key, e);
    pruneSpare();
  }
}

function attach(el: HTMLElement, key: string, e: Entry) {
  e.refs++;
  if (applied.has(el)) {
    const keepWanted = wanted.get(el);
    release(el);
    if (keepWanted) wanted.set(el, keepWanted);
  }
  applied.set(el, { key });
  ro?.observe(el);
  el.style.setProperty("backdrop-filter", `url("#${e.id}")`);
  el.setAttribute("data-lg-lens", "");
}

function build(key: string, spec: Spec): Promise<Entry | null> {
  let p = building.get(key);
  if (!p) {
    p = buildFilter(spec)
      .then((node) => {
        if (!node || !running) return null;
        svgHost().appendChild(node);
        const e: Entry = { id: node.id, refs: 0, node };
        cache.set(key, e);
        pruneSpare();
        return e;
      })
      .catch(() => null)
      .finally(() => building.delete(key));
    building.set(key, p);
  }
  return p;
}

/** Read one surface (no writes): the look it needs, or null for plain frost. */
function measure(el: HTMLElement): { key: string; spec: Spec } | null {
  if (!running || !el.isConnected || !onScreen.has(el)) return null;
  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  const card = !el.matches(TARGETS);
  // hidden, tiny, huge or square-cornered surfaces keep the plain frost
  if (w < 24 || h < 20 || w * h > (card ? MAX_CARD_AREA : MAX_AREA)) return null;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return null;
  const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
  if (radius < 6) return null;
  // frost strength follows the theme: dense for menus/sheets, lighter for
  // bars, clear for content cards (strong computers only)
  const blur = card
    ? Number(cs.getPropertyValue("--lg-card-blur")) || 4
    : Number(cs.getPropertyValue("--lg-lens-blur")) || (w * h > 60_000 ? 14 : 9);
  const spec = Math.round((Number(cs.getPropertyValue("--lg-spec")) || 0.7) * 100) / 100;
  const sat = card ? 1.6 : 1.9;
  const key = `${w}x${h}r${Math.round(radius)}b${blur}s${spec}${card ? "c" : ""}${fringe ? "f" : ""}`;
  return { key, spec: { w, h, radius, blur, spec, sat } };
}

function flush(els: HTMLElement[]) {
  // all reads first, then all writes: no forced layout per surface
  const plans = els.map((el) => [el, measure(el)] as const);
  for (const [el, plan] of plans) {
    if (!plan) {
      release(el);
      continue;
    }
    const { key, spec } = plan;
    if (applied.get(el)?.key === key) {
      wanted.set(el, key);
      continue;
    }
    if (!applied.has(el) && applied.size >= MAX_LENSED) continue;
    wanted.set(el, key);
    const ready = cache.get(key);
    if (ready) {
      attach(el, key, ready);
      continue;
    }
    void build(key, spec).then((e) => {
      // still on screen and still this size?
      if (!e || !running || wanted.get(el) !== key || !el.isConnected || !onScreen.has(el)) return;
      if (applied.get(el)?.key === key) return;
      if (!applied.has(el) && applied.size >= MAX_LENSED) return;
      attach(el, key, e);
    });
  }
}

function schedule(el: HTMLElement) {
  queue.add(el);
  clearTimeout(flushTimer);
  // after the surface settles (opening animations, resizes)
  flushTimer = setTimeout(() => {
    const els = [...queue];
    queue.clear();
    requestAnimationFrame(() => flush(els));
  }, 120);
}

/** Watch a surface: it is lensed while (nearly) on screen. */
function watch(el: HTMLElement) {
  if (watched.has(el)) return;
  watched.add(el);
  io?.observe(el);
}
function unwatch(el: HTMLElement) {
  if (!watched.delete(el)) return;
  io?.unobserve(el);
  onScreen.delete(el);
  queue.delete(el);
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
          queue.delete(el);
          release(el);
        }
      }
    },
    { rootMargin: "160px" },
  );
  mo = new MutationObserver((recs) => {
    const sel = targets();
    let removed = false;
    for (const r of recs) {
      if (r.type === "attributes") {
        const t = r.target as HTMLElement;
        if (t.matches(sel)) {
          if (watched.has(t)) schedule(t);
          else watch(t);
        } else if (watched.has(t)) unwatch(t);
        continue;
      }
      r.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n));
      if (r.removedNodes.length) removed = true;
    }
    // one sweep per batch, not one per removed node
    if (removed) {
      for (const el of [...watched]) if (!el.isConnected) unwatch(el);
      for (const el of [...applied.keys()]) if (!el.isConnected) release(el);
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
  watched.clear();
  clearTimeout(flushTimer);
  queue.clear();
  for (const el of [...applied.keys()]) release(el);
  wanted.clear();
  cache.forEach((e) => e.node.remove());
  cache.clear();
}
