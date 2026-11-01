import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { installRipple } from "./utils/ripple";

// Hide splash immediately before first React paint
const splash = document.getElementById("app-loading");
if (splash) {
  splash.style.opacity = "0";
  splash.style.pointerEvents = "none";
  setTimeout(() => splash.remove(), 400);
}

// Material UI theme core: touch ripple (no-op while another core is active).
installRipple();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Register the service worker. It exists only so the site stays installable as
// a PWA. Online it always loads the live site; it only keeps the last app
// page and its code files so a reload without internet still opens the app
// (see public/sw.js).
//
// Web only: inside the Android build the bundle is served locally by
// Capacitor, where a worker adds nothing and would only sit between the
// WebView and its own asset server.
const isNativeApp = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());

// The website is split into a few files. A tab left open across a new deploy
// may ask for a file that no longer exists: reload once to get the new build.
window.addEventListener("vite:preloadError", (e) => {
  try {
    const last = Number(sessionStorage.getItem("ab:chunk-reload") || 0);
    if (Date.now() - last < 30_000) return; // already tried: let the error show
    sessionStorage.setItem("ab:chunk-reload", String(Date.now()));
    e.preventDefault();
    window.location.reload();
  } catch {
    /* storage blocked */
  }
});

// Pictures marked "ab-fade" fade in (from a soft blur) once they've loaded —
// or failed, so a broken one never stays invisible.
const markLoaded = (e: Event) => {
  const t = e.target;
  if (t instanceof HTMLImageElement && t.classList.contains("ab-fade")) t.dataset.loaded = "1";
};
document.addEventListener("load", markLoaded, true);
document.addEventListener("error", markLoaded, true);
// already-complete pictures (from the cache, before React attached listeners)
new MutationObserver((list) => {
  for (const m of list)
    for (const n of Array.from(m.addedNodes)) {
      if (!(n instanceof HTMLElement)) continue;
      const imgs = n instanceof HTMLImageElement ? [n] : Array.from(n.querySelectorAll("img.ab-fade"));
      for (const img of imgs as HTMLImageElement[]) if (img.complete && img.naturalWidth) img.dataset.loaded = "1";
    }
}).observe(document.documentElement, { childList: true, subtree: true });

if (!isNativeApp && "serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
