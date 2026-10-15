// AuraBeats Service Worker — installability only, no offline cache.
//
// The site is served live from Cloudflare Pages like any standard website:
// every request goes to the network, nothing is stored, and nothing is served
// when offline. This worker exists purely so the app stays installable as a PWA
// (browsers require a registered service worker with a fetch handler).
//
// It also cleans up behind the previous offline-first worker: every cache left
// over from older builds is deleted on activation, so nobody keeps a stale app
// shell after this change ships.

self.addEventListener("install", () => {
  // Take over from any older worker without waiting for tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Drop all caches created by the old offline-first worker.
      (async () => {
        if (!self.caches) return;
        const keys = await self.caches.keys();
        await Promise.all(keys.map((key) => self.caches.delete(key)));
      })(),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only our own site is handled at all. Music streams, artwork and the catalog
  // APIs (YouTube, JioSaavn, Audius, ...) are left completely untouched so
  // playback behaves exactly as it would with no worker registered.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  // Pure passthrough: the network answers, or the browser shows its own offline
  // page. Never a cached copy — the newest build is always what you get.
  event.respondWith(fetch(event.request));
});
