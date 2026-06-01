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
 *   when fetch fails (offline) the cached copy for THAT request is served,
 *   and if there's no cached copy the request fails. There is intentionally
 *   no "fall back to cached root" rule: serving the dashboard at an
 *   uncached detail URL was silently misleading (the URL bar said one
 *   thing, the content was another). Honest failure is better; the
 *   app-level error boundary at (app)/error.tsx handles graceful
 *   degradation during render, and the browser handles outright load
 *   failures with its native offline page.
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

const CACHE_VERSION = "v10";
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

    // Sibling-URL fallback for uncached dynamic detail pages. The detail
    // pages in this app are "use client" components that read useParams
    // from the URL at render time, so the HTML and RSC payloads for any
    // /a/b/<id> URL are interchangeable: the client renders based on the
    // runtime URL, not on the SSR-time URL. If THIS request misses but
    // we have a SIBLING URL cached under the same parent path (and the
    // same RSC vs HTML type), return that one's response. The browser
    // mounts the page, useParams returns the actual id from the URL bar,
    // and the page reads the right data from the mirror. This is what
    // makes "navigate offline to any detail URL of a known dynamic route"
    // actually work; SyncBoot pre-warms one representative per dynamic
    // route from the mirror's known ids so the fallback always has a
    // sibling to serve.
    const sibling = await findSiblingFallback(cache, req, key);
    if (sibling) return sibling;

    // Last-resort offline shell for navigation requests: an honest "this
    // page is not cached yet, complete an online sync first" HTML page,
    // served at the requested URL so the URL bar remains correct. This
    // covers the cold-mirror edge case (a brand-new install that went
    // offline before warmRepresentativeDetails could pick a representative
    // for this route). For RSC (cors) requests and static assets, no
    // shell makes sense; we let the fetch fail and the page-level error
    // boundary / browser's own error handle it.
    if (req.mode === "navigate") {
      return new Response(OFFLINE_SHELL_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    throw err;
  }
}

const OFFLINE_SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sync required</title>
<style>
  body { font: 14px/1.5 system-ui, -apple-system, sans-serif; color: #111; background: #f6f7f8; margin: 0; padding: 0; }
  .card { max-width: 520px; margin: 80px auto; padding: 24px; background: #fff; border: 1px solid #e2e5e8; border-radius: 4px; }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #111; }
  p { margin: 0 0 16px; color: #444; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #d18900; margin-right: 8px; vertical-align: middle; }
  a { display: inline-block; padding: 6px 12px; background: #1F4E79; color: #fff; text-decoration: none; font-size: 12.5px; font-weight: 500; border-radius: 3px; }
</style>
</head>
<body>
<div class="card">
  <h1><span class="dot"></span>This page is not cached yet</h1>
  <p>You are offline, and this URL has not been visited or pre-warmed during an online session yet. Connect to the internet and reload to fetch it, and the offline cache will include it for next time.</p>
  <a href="/">Back to dashboard</a>
</div>
</body>
</html>`;

async function findSiblingFallback(cache, req, key) {
  const targetUrlStr = typeof key === "string" ? key : req.url;
  const target = new URL(targetUrlStr);
  let targetPath = target.pathname;
  const targetIsRsc = targetPath.endsWith("__rsc__");
  if (targetIsRsc) targetPath = targetPath.slice(0, -"__rsc__".length);
  if (targetPath.startsWith("/_next/")) return null; // static assets are unique by URL
  const segs = targetPath.split("/").filter(Boolean);
  if (segs.length < 3) return null; // only fall back for 3+ segment dynamic routes
  const parentPath = "/" + segs.slice(0, -1).join("/") + "/";

  const allKeys = await cache.keys();
  for (const k of allKeys) {
    const cand = new URL(k.url);
    let candPath = cand.pathname;
    const candIsRsc = candPath.endsWith("__rsc__");
    if (candIsRsc) candPath = candPath.slice(0, -"__rsc__".length);
    if (candIsRsc !== targetIsRsc) continue;
    if (candPath === targetPath) continue;
    if (!candPath.startsWith(parentPath)) continue;
    if (candPath.split("/").filter(Boolean).length !== segs.length) continue;
    const fallback = await cache.match(k);
    if (fallback) return fallback;
  }
  return null;
}
