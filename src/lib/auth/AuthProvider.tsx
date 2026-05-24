"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { fetchMe, postLogin, postLogout } from "./api";
import {
  clearCachedPrincipal,
  loadCachedPrincipal,
  saveCachedPrincipal,
} from "./principal-cache";
import type { AuthState, LoginInput, Principal } from "./types";

type AuthContextValue = {
  state: AuthState;
  login: (input: LoginInput) => Promise<
    | { ok: true; principal: Principal }
    | { ok: false; status: number; unreachable?: boolean }
  >;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    principal: null,
  });
  const inflight = useRef<Promise<void> | null>(null);

  // Hydrate-then-revalidate. On mount, read the cached principal from
  // IndexedDB and flip to authenticated immediately if one exists, so the
  // app shell renders without waiting for the network. Then fire fetchMe to
  // confirm against the backend; the result either confirms (cache stays),
  // refutes (cache cleared, redirect to login), or is unreachable (cache
  // stays, user keeps using the app offline).
  //
  // See principal-cache.ts for the load-bearing distinction: the principal
  // is identity metadata, not the auth token. The httpOnly session cookie
  // remains the sole credential, never in JS.
  const refresh = useCallback(async () => {
    if (inflight.current) {
      await inflight.current;
      return;
    }
    const p = (async () => {
      const result = await fetchMe();
      if (result.kind === "ok") {
        await saveCachedPrincipal(result.principal);
        setState({ status: "authenticated", principal: result.principal });
      } else if (result.kind === "logged_out") {
        // Confirmed 401: the backend is reachable and rejected the cookie.
        // Clear the cached principal (hygiene: a logged-out user's identity
        // must not linger offline) and flip to anonymous.
        await clearCachedPrincipal();
        setState({ status: "anonymous", principal: null });
      }
      // result.kind === "unreachable": keep whatever state we have. If we
      // hydrated from cache we stay authenticated and the user keeps
      // working offline; their queued edits sit in IDB and drain when the
      // backend returns.
    })();
    inflight.current = p;
    try {
      await p;
    } finally {
      inflight.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadCachedPrincipal();
      if (cancelled) return;
      if (cached) {
        // Hydrate optimistically. Background fetchMe will either confirm or
        // clear this; offline, it remains until reconnection.
        setState({ status: "authenticated", principal: cached });
      }
      void refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(async (input: LoginInput) => {
    const result = await postLogin(input);
    if (result.ok) {
      await saveCachedPrincipal(result.principal);
      setState({ status: "authenticated", principal: result.principal });
    }
    return result;
  }, []);

  const logout = useCallback(async () => {
    // Clear the cache FIRST so a race (someone re-reading principal mid-
    // logout) doesn't catch the stale value. Then call the backend logout
    // endpoint to invalidate the session server-side.
    await clearCachedPrincipal();
    await postLogout();
    setState({ status: "anonymous", principal: null });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, logout, refresh }),
    [state, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}

export function usePrincipal(): Principal | null {
  return useAuth().state.principal;
}
