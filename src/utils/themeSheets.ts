/**
 * Material UI and Liquid Glass each live in their own stylesheet. Only the
 * active look is switched on; the other is prepared once the app is idle
 * and then sleeps (media="not all": parsed and ready, but never matched or
 * painted). Switching is instant, yet a slow phone never runs both at once.
 */
import materialCss from "@/themes/material.css?inline";
import liquidCss from "@/themes/liquid.css?inline";
import type { ThemeName } from "@/types";

const CSS: Record<ThemeName, string> = { material: materialCss, liquid: liquidCss };
const sheets: Partial<Record<ThemeName, HTMLStyleElement>> = {};
let active: ThemeName | null = null;
let idleQueued = false;

function sheet(name: ThemeName): HTMLStyleElement {
  let el = sheets[name];
  if (!el) {
    el = document.createElement("style");
    el.dataset.theme = name;
    el.media = "not all";
    el.textContent = CSS[name];
    document.head.appendChild(el);
    sheets[name] = el;
  }
  return el;
}

export function applyThemeSheet(name: ThemeName): void {
  if (active === name) return;
  sheet(name).media = "all";
  if (active) sheet(active).media = "not all"; // the previous look sleeps
  active = name;
  glassLight(name === "liquid");
  if (idleQueued) return;
  idleQueued = true;
  const prepare = () => (Object.keys(CSS) as ThemeName[]).forEach(sheet);
  if ("requestIdleCallback" in window) window.requestIdleCallback(prepare, { timeout: 8000 });
  else setTimeout(prepare, 3000);
}

/* Liquid Glass, mouse only: the glass under the pointer catches the light
   where the pointer is (a soft highlight that follows it). One element at a
   time, at most once per frame; nothing runs in Material or on touch. */
let lit: HTMLElement | null = null;
let frame = 0;
let last: PointerEvent | null = null;
const unlight = () => {
  lit?.removeAttribute("data-lg-lit");
  lit = null;
};
const paint = () => {
  frame = 0;
  const e = last;
  if (!e) return;
  const el = (e.target as Element | null)?.closest?.<HTMLElement>(".blur-panel") ?? null;
  if (el !== lit) {
    unlight();
    lit = el;
  }
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--lg-x", `${Math.round(e.clientX - r.left)}px`);
  el.style.setProperty("--lg-y", `${Math.round(e.clientY - r.top)}px`);
  el.setAttribute("data-lg-lit", "");
};
const onMove = (e: PointerEvent) => {
  if (e.pointerType !== "mouse") return;
  last = e;
  if (!frame) frame = requestAnimationFrame(paint);
};
const onLeave = () => {
  last = null;
  unlight();
};
let lightOn = false;
function glassLight(on: boolean) {
  if (on === lightOn || typeof window === "undefined") return;
  if (on && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  lightOn = on;
  if (on) {
    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
  } else {
    document.removeEventListener("pointermove", onMove);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    onLeave();
  }
}
