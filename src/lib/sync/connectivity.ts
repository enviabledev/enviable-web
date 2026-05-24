"use client";

/**
 * Connectivity manager. navigator.onLine alone lies: it reports the network
 * interface, not whether our backend is actually reachable. We pair it with a
 * heartbeat against GET /api/auth/me (cheap, session-aware) to give an honest
 * reading.
 *
 * Outcomes:
 *   200            -> online (backend reachable and the session is valid)
 *   network error  -> offline (no route to backend at all)
 *   5xx            -> offline (backend present but broken; engine should not drain
 *                     into a broken server)
 *   401            -> ONLINE; the connection is fine but the session expired.
 *                     This is the auth provider's concern, NOT a connectivity
 *                     problem. Treating 401 as offline would let actions pile up
 *                     queued while the backend is happily rejecting auth, and
 *                     would never sync. The AuthProvider's existing 401 handling
 *                     surfaces the re-auth path.
 *   other 4xx      -> online (the backend responded; the per-request error is
 *                     not a connectivity issue).
 */
import { useEffect, useState } from "react";

import type { ConnectivityState } from "./types";

type Listener = (state: ConnectivityState) => void;

class ConnectivityManager {
  private state: ConnectivityState = "unknown";
  private listeners = new Set<Listener>();
  private heartbeatAbort: AbortController | null = null;

  getState(): ConnectivityState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(next: ConnectivityState) {
    if (this.state === next) return;
    this.state = next;
    this.listeners.forEach((l) => l(next));
  }

  /**
   * Run a heartbeat. Cancels any in-flight heartbeat so only one is live.
   * Returns the resolved state. Treats 401 as online per the rule above.
   */
  async heartbeat(): Promise<ConnectivityState> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.setState("offline");
      return "offline";
    }

    if (this.heartbeatAbort) this.heartbeatAbort.abort();
    const controller = new AbortController();
    this.heartbeatAbort = controller;

    try {
      const res = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.status >= 500) {
        this.setState("offline");
        return "offline";
      }
      this.setState("online");
      return "online";
    } catch {
      if (controller.signal.aborted) return this.state;
      this.setState("offline");
      return "offline";
    } finally {
      if (this.heartbeatAbort === controller) this.heartbeatAbort = null;
    }
  }

  /**
   * Engine hook: called when an in-flight drain throws a network error. Flips
   * the manager to offline immediately so the indicator reflects it without
   * waiting for the next heartbeat.
   */
  markOfflineFromNetworkError() {
    this.setState("offline");
  }
}

export const connectivity = new ConnectivityManager();

export function useConnectivity(): {
  state: ConnectivityState;
  recheck: () => Promise<ConnectivityState>;
} {
  const [state, setState] = useState<ConnectivityState>(() =>
    connectivity.getState(),
  );

  useEffect(() => connectivity.subscribe(setState), []);

  return {
    state,
    recheck: () => connectivity.heartbeat(),
  };
}
