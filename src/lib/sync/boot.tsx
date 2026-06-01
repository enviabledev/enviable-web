"use client";

/**
 * Sync boot: side-effect-only component mounted inside the auth-gated app shell.
 *
 * Responsibilities:
 *   1. Register the service worker (so the app shell loads offline).
 *   2. Wire window online/offline listeners. On online: heartbeat then drain.
 *      On offline: flip the connectivity manager immediately so the indicator
 *      reflects it without waiting for the next heartbeat.
 *   3. Run an initial heartbeat + drain on mount, so a tab opened with queued
 *      actions from a prior session drains as soon as the user is back.
 *
 * Renders null. Lives in src/app/(app)/layout.tsx where it is loaded only for
 * authenticated routes (the login screen does not need the engine).
 */
import { useEffect, useRef } from "react";

import { useAuth, usePermissions } from "@/lib/auth";
import { NAV } from "@/lib/nav/config";

import { loadAllConflictPlugins } from "./conflicts-registry";
import { connectivity } from "./connectivity";
import { syncEngine } from "./engine";
import { downloadHistory } from "./mirror/downloader";
import { reconcile } from "./mirror/reconciler";
import { listByType } from "./mirror/store";

/**
 * Warm one route through the SW cache: fetch the HTML and every same-origin
 * script + stylesheet + preload it references, mimicking what a real browser
 * navigation does. A plain fetch() of the URL would cache the HTML only;
 * the page's JS chunks would still be uncached and the offline hard-reload
 * would fail at chunk load. Parsing the HTML for <script src> / <link href>
 * and fetching each through the SW closes that gap.
 */
async function warmRoute(href: string): Promise<void> {
  try {
    const res = await fetch(href, { credentials: "include" });
    if (!res.ok) return;
    const html = await res.text();
    const urls = new Set<string>();
    for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) urls.add(m[1]);
    for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)) urls.add(m[1]);
    const sameOrigin = [...urls].filter(
      (u) => u.startsWith("/") || u.startsWith(window.location.origin),
    );
    await Promise.allSettled(
      sameOrigin.map((u) =>
        fetch(u, { credentials: "include" }).catch(() => {
          // Per-asset failure is silently dropped; best-effort warming.
        }),
      ),
    );
  } catch {
    // Best-effort warming. The user-facing nav still works without this;
    // only the offline cache is affected.
  }
}

/**
 * Single registry of dynamic routes whose HTML/RSC the offline cache needs
 * a representative for. Adding a new dynamic route means adding one entry
 * here, that's the one-place change. The SW's findSiblingFallback (in
 * public/sw.js) generalises automatically over URL shape (same parent path
 * + same depth) so it does not need its own pattern list; this registry is
 * authoritative for the warming side, the SW reads cache state alone.
 *
 * Each entry names the mirror entity bucket whose first row provides the
 * representative id, and how to build the href from that row. Cold-mirror
 * (no rows yet) safely skips the entry; the SW serves an "offline shell"
 * for such routes until the first online sync populates the bucket.
 */
type DynamicRouteWarmEntry = {
  entity: Parameters<typeof listByType>[0];
  hrefFor: (body: Record<string, unknown>) => string | null;
};
const DYNAMIC_ROUTES_TO_WARM: DynamicRouteWarmEntry[] = [
  {
    entity: "unit",
    hrefFor: (u) => {
      const en = u.engineNumber;
      const id = u.id;
      const key = typeof en === "string" ? en : typeof id === "string" ? id : null;
      return key ? `/inventory/units/${encodeURIComponent(key)}` : null;
    },
  },
  {
    entity: "assemblyJob",
    hrefFor: (j) => (typeof j.id === "string" ? `/inventory/assembly-jobs/${j.id}` : null),
  },
  {
    entity: "purchaseOrder",
    hrefFor: (p) => (typeof p.id === "string" ? `/procurement/purchase-orders/${p.id}` : null),
  },
  {
    entity: "shipment",
    hrefFor: (s) => (typeof s.id === "string" ? `/procurement/shipments/${s.id}` : null),
  },
  {
    entity: "salesOrder",
    hrefFor: (s) => (typeof s.id === "string" ? `/sales/sales-orders/${s.id}` : null),
  },
  {
    entity: "customer",
    hrefFor: (c) => (typeof c.id === "string" ? `/sales/customers/${c.id}` : null),
  },
];

/**
 * Pre-warm one representative detail URL per dynamic route, picking the id
 * from the mirror's already-downloaded entities. The SW caches the HTML +
 * dependent chunks of that one URL, and its sibling-URL fallback then
 * serves that same response for ANY other id under the same dynamic route.
 * Cold-mirror entries (no rows yet) are skipped, no error.
 */
async function warmRepresentativeDetails(): Promise<void> {
  for (const { entity, hrefFor } of DYNAMIC_ROUTES_TO_WARM) {
    try {
      const rows = await listByType(entity);
      if (rows.length === 0) continue;
      const href = hrefFor(rows[0].body);
      if (href) void warmRoute(href);
    } catch {
      // Per-entity failure is best-effort; skip.
    }
  }
}

export default function SyncBoot() {
  const { state, refresh: refreshAuth } = useAuth();
  const { hasAll } = usePermissions();

  // Live auth status the triggerOnline closure reads at call time. Without
  // this, the closure captures the auth state from the effect-mount moment,
  // which is stale by the time the periodic tick or connectivity event fires
  // it. A ref keeps the read live without re-running the effect (which would
  // churn the interval and listeners on every auth state change).
  const authStatusRef = useRef(state.status);
  useEffect(() => {
    authStatusRef.current = state.status;
  }, [state.status]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("Sync SW registration failed:", err);
      });
    }

    // Pull every conflict plugin into the bundle so the /sync/conflicts pages
    // can render them. Each plugin registers itself on import; this just
    // touches them. Per-flow plugins live under lib/sync/conflicts/.
    void loadAllConflictPlugins();

    const triggerOnline = async () => {
      const connState = await connectivity.heartbeat();
      if (connState !== "online") return;
      // Gate heavy backend pulls on confirmed auth. The hydrate-then-revalidate
      // pattern means a stale cached principal can put auth state at
      // "authenticated" while the actual session cookie has expired. Firing
      // downloads / drains / reconciles before AuthProvider's background
      // revalidation completes leads to 401s that the downloader correctly
      // bails on, but it pollutes the log and wastes a download attempt.
      // Reading the ref lets us check the LATEST auth state at call time,
      // not the captured-at-mount state. After re-auth, the next tick (60s
      // periodic, online event, or connectivity transition) picks up cleanly.
      if (authStatusRef.current !== "authenticated") return;
      void syncEngine.drain();
      // Drive the read mirror. Both are single-flight + idempotent: the
      // downloader bails when history is complete; the reconciler bails
      // when history is incomplete. Calling both on every online tick is
      // the simplest correct trigger.
      void downloadHistory();
      void reconcile();
    };

    const onOnline = () => {
      void triggerOnline();
    };
    const onOffline = () => {
      connectivity.markOfflineFromNetworkError();
    };

    // 401 detected anywhere (heartbeat, drain): re-run the auth provider's
    // me-fetch. It will see the 401 and flip status to anonymous, which the
    // (app) layout's effect uses to redirect to /login. Connectivity stays
    // online; only auth changes.
    const onSessionExpired = () => {
      void refreshAuth();
    };

    // Connectivity transitions: when offline -> online, also revalidate auth.
    // This rescues the "reload while backend was down" case: AuthProvider's
    // mount-time refresh fired once, got "unreachable", and kept state at
    // loading; without this hook the loading shell sticks until a manual
    // reload. When connectivity comes back we re-fetchMe, flip to
    // authenticated, and the real chrome renders.
    let prevConn = connectivity.getState();
    const unsubConn = connectivity.subscribe((next) => {
      if (prevConn !== "online" && next === "online") {
        void refreshAuth();
      }
      prevConn = next;
    });

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const unsubSession = connectivity.onSessionExpired(onSessionExpired);

    // Periodic-while-online tick. Without this, downloader and reconciler
    // only fire on mount + on offline->online transitions; a user who sits
    // online for an hour without a state change would get no ongoing pull.
    // Every 60s we re-trigger; downloader bails fast if history is complete
    // (single-flight + watermark check), reconciler bails fast if history is
    // incomplete. The cost is one heartbeat-plus-maybe-pull per minute,
    // which is negligible.
    const PERIODIC_MS = 60_000;
    const interval = window.setInterval(() => {
      void triggerOnline();
    }, PERIODIC_MS);

    void triggerOnline();

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      unsubSession();
      unsubConn();
    };
  }, [refreshAuth]);

  // When auth transitions to authenticated (whether via fresh login or via
  // a successful revalidation), kick the trigger immediately rather than
  // waiting for the next 60s tick. Avoids a minute-long blank window where
  // the user is logged in but the mirror hasn't started downloading.
  //
  // Also warm the route assets here so an offline hard-reload of any NAV
  // target works without the user having to open each page online first.
  // Verified via a Playwright probe on 2026-06: a bare fetch() of a route
  // URL caches the HTML response only; the page's JS chunks (24 script
  // src refs in /inventory/units, the dynamic-segment chunk among them)
  // are NOT auto-fetched by a JS fetch. To make the route offline-loadable
  // the SW must also have its chunks cached, so we parse the HTML response
  // and fetch each <script src> and <link href> through the SW, mimicking
  // what a real browser navigation does.
  //
  // router.prefetch is intentionally NOT used here: it is a no-op in Next 15
  // dev mode (Next disables prefetch in dev to avoid recompilation
  // overhead), which silently left the cache empty before this fix.
  //
  // Limitation: dynamic detail URLs (e.g. /inventory/units/<id>) are NOT in
  // NAV and therefore NOT pre-warmed. They become offline-readable only
  // after an online visit caches their specific URL. The shared route
  // chunks (the [idOrEngineNumber] segment's chunk) ARE cached because
  // their static parent (e.g. /inventory/units) is warmed.
  useEffect(() => {
    if (state.status !== "authenticated") return;
    void (async () => {
      const connState = await connectivity.heartbeat();
      if (connState !== "online") return;
      void syncEngine.drain();
      void downloadHistory();
      void reconcile();
      for (const group of NAV) {
        for (const item of group.items) {
          if (!hasAll(item.permissions)) continue;
          void warmRoute(item.href);
        }
      }
      // Also warm one representative detail URL per dynamic route from the
      // mirror's known entities. The SW's sibling-fallback (sw.js:
      // findSiblingFallback) then serves that representative's response
      // for any other id under the same dynamic route, so an offline hard-
      // load (or soft-nav) of an arbitrary detail URL renders correctly
      // via useParams + mirror-first paint. Without this, the SW has no
      // sibling to fall back to and the navigation fails.
      void warmRepresentativeDetails();
    })();
  }, [state.status, hasAll]);

  return null;
}
