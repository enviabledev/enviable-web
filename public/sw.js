/**
 * Enviable Sync, app shell service worker.
 *
 * Scope:
 *   - Cache the app shell (route HTML + Next static assets + fonts + images) so
 *     a clerk who has visited the app while online can still load the UI when
 *     the backend is unreachable. The action queue and sync engine are
 *     app-level (IndexedDB), not service-worker-level: this worker exists only
 *     to make the app LOAD offline. Writes pass through the engine.
 *
 *   - Bypass /api/* entirely. Mutations go via the queue (which knows whether
 *     to enqueue or POST based on connectivity); GETs go to the network and
 *     fail naturally if offline (graceful degradation, scope of subsequent
 *     prompts to make per-flow offline-capable).
 *
 *   - Bypass non-GET requests. The engine owns writes.
 *
 * Cache versioning:
 *   Bump CACHE_VERSION on every deploy so the activate handler can clean up
 *   stale caches. Without versioning a deploy strands users on a cached shell
 *   forever; with it, install creates a new versioned cache and activate
 *   deletes the old ones (the cleanup-on-activate pattern).
 *
 * Strategies:
 *   /_next/static/*    cache-first   (Next emits content-hashed filenames; safe
 *                                     to treat as immutable)
 *   navigate, fonts,   network-first with cache fallback   (so an online user
 *   images, other GETs                                      gets fresh content;
 *                                                           an offline user
 *                                                           gets the last seen)
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `enviable-shell-${CACHE_VERSION}`;
const CACHE_PREFIX = "enviable-shell-";

self.addEventListener("install", (event) => {
  // No precache: we cache-on-first-visit. Skipping waiting means a new worker
  // takes over without requiring all open tabs to close first.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/sw.js") return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(networkFirstWithCacheFallback(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh.ok) {
    // Clone before caching: a Response body can only be consumed once.
    cache.put(req, fresh.clone());
  }
  return fresh;
}

async function networkFirstWithCacheFallback(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // For top-level navigations with no cache, fall back to whatever shell HTML
    // we may have cached at the root path. Better than a blank "no connection"
    // page for the offline-load demo.
    if (req.mode === "navigate") {
      const rootCached = await cache.match("/");
      if (rootCached) return rootCached;
    }
    throw err;
  }
}
