import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Hide splash immediately before first React paint
const splash = document.getElementById("app-loading");
if (splash) {
  splash.style.opacity = "0";
  splash.style.pointerEvents = "none";
  setTimeout(() => splash.remove(), 400);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Register the service worker. It exists only so the site stays installable as
// a PWA — it caches nothing (see public/sw.js), so the site behaves like any
// standard website served live from Cloudflare Pages and a reload always gets
// the newest build. No update polling, no cache invalidation, no auto-reload.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
