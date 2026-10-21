// AuraBeats Service Worker — live site, with an offline fallback.
// (code files under /assets/ are content-hashed, so they are kept and reused)
//
// Online, every request goes to the network exactly like a normal website:
// the newest build is always what you get. The one thing kept is the last
// copy of the app page itself, used ONLY when the network fails, so reloading
// without internet opens AuraBeats (which then shows its "You're offline"
// page, your library and offline songs) instead of the browser's error page,
// the way YouTube does. Music, video and API requests are never touched.

const SHELL = "aurabeats-shell-v1";
const ASSETS = "aurabeats-assets-v1";
const SHELL_URL = "/";
const MAX_ASSETS = 40;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL);
        await cache.add(new Request(SHELL_URL, { cache: "reload" }));
      } catch {
        /* offline while installing: filled on the next visit */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older workers (the old offline-first one included).
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · AuraBeats</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#07080c;color:#e8eaf0;font:15px system-ui,sans-serif;text-align:center}
.b{padding:24px}.i{font-size:44px;opacity:.6}h1{font-size:20px;margin:12px 0 4px}p{margin:0 0 18px;color:#8b90a0;font-size:13px}
button{background:#3b82f6;color:#fff;border:0;border-radius:999px;padding:10px 22px;font-weight:700;font-size:14px;cursor:pointer}
</style></head><body><div class="b"><div class="i">&#x1F4F6;</div><h1>You're offline</h1><p>Check your connection and try again.</p>
<button onclick="location.reload()">Retry</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only our own pages. Streams, artwork and catalog APIs pass straight through.
  if (url.origin !== self.location.origin || req.method !== "GET") return;

  // The site's code files (/assets/name-HASH.js|css) never change once
  // published, so a kept copy is always right: served from the copy, fetched
  // once otherwise. This is what lets an offline reload start the app.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(
            (async () => {
              await cache.put(req, copy);
              const keys = await cache.keys(); // oldest first: drop old builds' files
              await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)));
            })().catch(() => {}),
          );
        }
        return res;
      })(),
    );
    return;
  }
  if (req.mode !== "navigate") return; // icons, manifest…: plain network

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        // Keep the newest app page for offline reloads (same page for every route).
        if (res.ok && res.headers.get("content-type")?.includes("text/html")) {
          const copy = res.clone();
          event.waitUntil(caches.open(SHELL).then((c) => c.put(SHELL_URL, copy)).catch(() => {}));
        }
        return res;
      } catch {
        const cached = await caches.match(SHELL_URL, { cacheName: SHELL });
        return cached || new Response(OFFLINE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
    })(),
  );
});
