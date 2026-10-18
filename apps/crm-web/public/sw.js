// Minimal offline-shell service worker.
//
// Cache-first for GET requests to same-origin static assets (/_next/*,
// images). Network-first for everything else — the ERP is a live app,
// stale API data is worse than an offline error. On fresh install we
// warm-cache the app shell (root URL + manifest).
//
// Cache is versioned by APP_VERSION — bump on release to invalidate.

const APP_VERSION = "v1";
const CACHE = `lumaara-shell-${APP_VERSION}`;
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /\.(png|jpg|jpeg|svg|ico|webp|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    // Cache-first for static assets — long-lived, immutable-ish.
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        });
      }),
    );
    return;
  }
  // Network-first for HTML + everything else.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && req.headers.get("accept")?.includes("text/html")) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put("/", clone));
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c ?? caches.match("/"))),
  );
});
