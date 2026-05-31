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
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useAuth, usePermissions } from "@/lib/auth";
import { NAV } from "@/lib/nav/config";

import { loadAllConflictPlugins } from "./conflicts-registry";
import { connectivity } from "./connectivity";
import { syncEngine } from "./engine";
import { downloadHistory } from "./mirror/downloader";
import { reconcile } from "./mirror/reconciler";

export default function SyncBoot() {
  const { state, refresh: refreshAuth } = useAuth();
  const { hasAll } = usePermissions();
  const router = useRouter();

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
  // Also warm the route assets here: fire router.prefetch for every NAV
  // target the principal can access, so the JS chunks and RSC payloads land
  // in the SW cache without the user having to open each page online first.
  // This is the route-asset analog of the proactive mirror download for
  // data, both fix the same "you have to open it first" half-PWA hole, one
  // at the data layer, one at the route-asset layer. Prefetch failures are
  // silently ignored by Next; the SW caches whatever responses do come back
  // via its existing network-first behavior.
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
          if (hasAll(item.permissions)) router.prefetch(item.href);
        }
      }
    })();
  }, [state.status, hasAll, router]);

  return null;
}
