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
  if (idleQueued) return;
  idleQueued = true;
  const prepare = () => (Object.keys(CSS) as ThemeName[]).forEach(sheet);
  if ("requestIdleCallback" in window) window.requestIdleCallback(prepare, { timeout: 8000 });
  else setTimeout(prepare, 3000);
}
