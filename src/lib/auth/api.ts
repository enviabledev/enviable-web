/**
 * Auth API wrappers. All fetches hit the same-origin /api/* proxy with
 * credentials: "include" so the backend's httpOnly session cookie flows
 * through. Never reference BACKEND_API_URL from client code; it is a
 * server-only env var consumed by next.config.ts rewrites.
 */

import type { LoginInput, Principal } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

/**
 * Three outcomes:
 *  - ok      200; we have a principal.
 *  - logged_out      401 only; the user is definitely not authenticated.
 *  - unreachable     network throw or any 5xx; we DON'T KNOW the auth state
 *                    (the backend isn't answering). Callers should NOT treat
 *                    this as "logged out", otherwise a transient outage would
 *                    forcibly log the user out and lose their offline queue.
 */
export type MeResult =
  | { kind: "ok"; principal: Principal }
  | { kind: "logged_out" }
  | { kind: "unreachable"; status?: number };

export async function fetchMe(): Promise<MeResult> {
  let res: Response;
  try {
    res = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { kind: "unreachable" };
  }
  if (res.status === 200) {
    const principal = (await res.json()) as Principal;
    return { kind: "ok", principal };
  }
  if (res.status === 401) {
    return { kind: "logged_out" };
  }
  return { kind: "unreachable", status: res.status };
}

export type LoginResult =
  | { ok: true; principal: Principal }
  | { ok: false; status: number; unreachable?: boolean };

export async function postLogin(input: LoginInput): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, status: 0, unreachable: true };
  }
  if (res.status === 200 || res.status === 201) {
    const principal = (await res.json()) as Principal;
    return { ok: true, principal };
  }
  return {
    ok: false,
    status: res.status,
    unreachable: res.status >= 500,
  };
}

export async function postLogout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
}
