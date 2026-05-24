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

import { connectivity } from "./connectivity";
import { syncEngine } from "./engine";

export default function SyncBoot() {
  const { refresh: refreshAuth } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("Sync SW registration failed:", err);
      });
    }

    const triggerOnline = async () => {
      const state = await connectivity.heartbeat();
      if (state === "online") {
        void syncEngine.drain();
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

    void triggerOnline();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      unsubSession();
      unsubConn();
    };
  }, [refreshAuth]);

  return null;
}
