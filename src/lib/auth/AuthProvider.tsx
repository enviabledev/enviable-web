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
import type { AuthState, LoginInput, Principal } from "./types";

type AuthContextValue = {
  state: AuthState;
  login: (input: LoginInput) =>
    Promise<{ ok: true; principal: Principal } | { ok: false; status: number }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", principal: null });
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inflight.current) {
      await inflight.current;
      return;
    }
    const p = (async () => {
      const result = await fetchMe();
      if (result.ok) {
        setState({ status: "authenticated", principal: result.principal });
      } else {
        setState({ status: "anonymous", principal: null });
      }
    })();
    inflight.current = p;
    try {
      await p;
    } finally {
      inflight.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (input: LoginInput) => {
    const result = await postLogin(input);
    if (result.ok) {
      setState({ status: "authenticated", principal: result.principal });
    }
    return result;
  }, []);

  const logout = useCallback(async () => {
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
