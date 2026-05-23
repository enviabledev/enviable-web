/**
 * Auth API wrappers. All fetches hit the same-origin /api/* proxy with
 * credentials: "include" so the backend's httpOnly session cookie flows
 * through. Never reference BACKEND_API_URL from client code; it is a
 * server-only env var consumed by next.config.ts rewrites.
 */

import type { LoginInput, Principal } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

export type MeResult =
  | { ok: true; principal: Principal }
  | { ok: false; status: number };

export async function fetchMe(): Promise<MeResult> {
  const res = await fetch("/api/auth/me", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (res.status === 200) {
    const principal = (await res.json()) as Principal;
    return { ok: true, principal };
  }
  return { ok: false, status: res.status };
}

export type LoginResult =
  | { ok: true; principal: Principal }
  | { ok: false; status: number };

export async function postLogin(input: LoginInput): Promise<LoginResult> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });
  if (res.status === 200 || res.status === 201) {
    const principal = (await res.json()) as Principal;
    return { ok: true, principal };
  }
  return { ok: false, status: res.status };
}

export async function postLogout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
}
