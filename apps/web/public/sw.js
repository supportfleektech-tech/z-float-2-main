/* Z-float service worker — offline shell + asset caching.
 *
 * Strategy (intentionally conservative for a financial app):
 *  - NEVER cache or intercept /api/* (mutations must never replay offline;
 *    reads get the browser default). Also skip cross-origin and non-GET.
 *  - Navigation requests: network-first; on failure serve the cached app
 *    shell (last visited page HTML) so the UI opens offline.
 *  - Same-origin static assets (/_next/static, /icons): stale-while-revalidate.
 *
 * Version bump invalidates old caches (activate cleanup).
 */
const SW_VERSION = "v1.0.0";
const SHELL_CACHE = `zfloat-shell-${SW_VERSION}`;
const ASSET_CACHE = `zfloat-assets-${SW_VERSION}`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("zfloat-") && !keep.has(k)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigation: network first, shell fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const copy = res.clone();
          const cache = await caches.open(SHELL_CACHE);
          await cache.put("/", copy);
          return res;
        } catch {
          const cached = await caches.match("/");
          if (cached) return cached;
          return new Response("Offline — reconnect to continue.", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          });
        }
      })(),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            cache.put(req, copy).catch(() => undefined);
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
