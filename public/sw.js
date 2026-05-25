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
 * Strategy:
 *   Network-first for EVERYTHING (navigations, /_next/static/*, fonts,
 *   images, other GETs). The cache exists purely as an offline fallback:
 *   when fetch succeeds, the fresh response is returned and also stored;
 *   when fetch fails (offline), the cached copy is served, falling back to
 *   the cached root for navigations.
 *
 *   Cache-first sounds tempting for /_next/static/* since Next emits
 *   content-hashed filenames in production. But in dev with Turbopack,
 *   bundle filenames can change as the code changes, and a cache-first SW
 *   keeps serving stale JS after a code update (masking new code; the user
 *   has to hard-reload to bypass the SW). The trade-off (one extra network
 *   roundtrip per asset on online loads) is worth it for predictability: no
 *   staleness, no surprises during iteration, and the offline-load
 *   verification still works because the cache populates on every online
 *   navigation.
 */

const CACHE_VERSION = "v4";
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

  event.respondWith(networkFirstWithCacheFallback(req));
});

/**
 * Normalize the cache key for Next's RSC client-side-navigation requests.
 *
 * Next App Router doesn't full-reload on client navigation. It fetches a
 * binary RSC payload from /<path>?_rsc=<hash>. The _rsc value varies per
 * request, so caching under the literal URL means later offline navigations
 * miss even when the same route was visited online before. We strip _rsc
 * and suffix the path with __rsc__ so:
 *
 *   /<path>          stays the cache key for full-HTML navigations
 *   /<path>__rsc__   becomes the stable key for RSC payloads at that path
 *
 * The suffix prevents collisions: an RSC payload and a full HTML page at
 * the same path have different content-types and serving one as the other
 * would break the navigation. Each gets its own stable key.
 */
function cacheKeyFor(req) {
  const url = new URL(req.url);
  if (!url.searchParams.has("_rsc")) return req;
  url.searchParams.delete("_rsc");
  url.pathname = url.pathname + "__rsc__";
  return url.toString();
}

async function networkFirstWithCacheFallback(req) {
  const cache = await caches.open(CACHE_NAME);
  const key = cacheKeyFor(req);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(key, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(key);
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
