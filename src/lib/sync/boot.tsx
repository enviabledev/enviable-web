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
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";

import { loadAllConflictPlugins } from "./conflicts-registry";
import { connectivity } from "./connectivity";
import { syncEngine } from "./engine";
import { downloadHistory } from "./mirror/downloader";
import { reconcile } from "./mirror/reconciler";

export default function SyncBoot() {
  const { refresh: refreshAuth } = useAuth();

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
      const state = await connectivity.heartbeat();
      if (state === "online") {
        void syncEngine.drain();
        // Drive the read mirror. Both are single-flight + idempotent: the
        // downloader bails when history is complete; the reconciler bails
        // when history is incomplete. Calling both on every online tick is
        // the simplest correct trigger.
        void downloadHistory();
        void reconcile();
      }
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

  return null;
}
