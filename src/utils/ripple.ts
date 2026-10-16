/**
 * Material ripple — the touch feedback of Material Design, active only while
 * the Material UI theme core is selected (<html data-theme="material">).
 *
 * One delegated pointerdown listener for the whole app: no per-component
 * wiring, nothing rendered by React. The wave is drawn inside a clipping host
 * span so the element itself never needs overflow:hidden (badges and
 * tooltips that stick out stay visible).
 */

const TARGETS = 'button, a[href], [role="button"], [role="tab"], label[for]';

function spawn(el: HTMLElement, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  // The host is positioned against the element; a static element would let
  // it escape to some ancestor, so make it relative for the ripple's lifetime.
  const madeRelative = getComputedStyle(el).position === "static";
  if (madeRelative) el.style.position = "relative";

  const host = document.createElement("span");
  host.className = "ab-ripple-host";
  host.setAttribute("aria-hidden", "true");

  const x = clientX - rect.left;
  const y = clientY - rect.top;
  // radius = distance to the farthest corner, so the wave covers the element
  const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));

  const wave = document.createElement("span");
  wave.className = "ab-ripple";
  wave.style.width = wave.style.height = `${radius * 2}px`;
  wave.style.left = `${x - radius}px`;
  wave.style.top = `${y - radius}px`;

  host.appendChild(wave);
  el.appendChild(host);

  const cleanup = () => {
    host.remove();
    if (madeRelative && !el.querySelector(".ab-ripple-host")) el.style.position = "";
  };
  wave.addEventListener("animationend", cleanup, { once: true });
  // safety net if the animation never runs (display:none, reduced motion…)
  window.setTimeout(cleanup, 900);
}

export function installRipple() {
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      if (document.documentElement.dataset.theme !== "material") return;
      const target = e.target as Element | null;
      const el = target?.closest?.(TARGETS) as HTMLElement | null;
      if (!el || el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return;
      if (el.closest("[data-no-ripple]")) return;
      spawn(el, e.clientX, e.clientY);
    },
    { passive: true },
  );
}
