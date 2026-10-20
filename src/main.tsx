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
// a PWA — it caches nothing (see public/sw.js), so the site behaves like any
// standard website served live from Cloudflare Pages and a reload always gets
// the newest build. No update polling, no cache invalidation, no auto-reload.
//
// Web only: inside the Android build the bundle is served locally by
// Capacitor, where a worker adds nothing and would only sit between the
// WebView and its own asset server.
const isNativeApp = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());

if (!isNativeApp && "serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
