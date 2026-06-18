/**
 * Generic API fetcher. Routes everything through the same-origin /api/* proxy
 * so the httpOnly enviable.sid cookie rides along (see next.config.ts). Never
 * reference BACKEND_API_URL from client code; it is server-only.
 *
 * Returns a typed Result. Callers branch on `kind` rather than throwing for
 * expected outcomes (unauthorized, forbidden, not-found) so screens can render
 * the right empty/permission state without a try/catch dance.
 */

/**
 * Window event dispatched when a protected request is rejected by the
 * forced-password-reset gate (403 with body code PASSWORD_RESET_REQUIRED).
 * AuthProvider listens and re-fetches the principal so the (app) layout
 * redirects to the reset screen. Defence in depth behind the SPA's
 * principal-based boot/login branch.
 */
export const PASSWORD_RESET_REQUIRED_EVENT = "enviable:password-reset-required";

export type ApiResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; code?: string }
  | { kind: "not_found" }
  | { kind: "conflict"; message: string; body?: Record<string, unknown> }
  | { kind: "validation"; status: number; message: string | string[] }
  | { kind: "server_error"; status: number; message: string }
  | { kind: "network_error"; message: string };

type Primitive = string | number | boolean;

export function buildQuery(params: Record<string, Primitive | readonly Primitive[] | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v === undefined || v === null || v === "") continue;
        usp.append(key, String(v));
      }
    } else {
      usp.set(key, String(value));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

type ApiRequestInit = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

export async function apiFetch<T>(path: string, init?: ApiRequestInit): Promise<ApiResult<T>> {
  if (!path.startsWith("/api/")) {
    throw new Error(`apiFetch path must start with /api/, got ${path}`);
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
    });
  } catch (err) {
    return {
      kind: "network_error",
      message: err instanceof Error ? err.message : "Network error",
    };
  }

  if (res.status === 401) return { kind: "unauthorized" };
  if (res.status === 403) {
    // Parse the body for a code. The forced-reset gate returns
    // { error: "PASSWORD_RESET_REQUIRED", message }; generic permission denials
    // return { error: "Forbidden" }. Only the reset code drives the global
    // redirect event; generic 403s render the screen's access-denied state.
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body?.error === "string") code = body.error;
    } catch {
      // no/!json body: leave code undefined
    }
    if (code === "PASSWORD_RESET_REQUIRED" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(PASSWORD_RESET_REQUIRED_EVENT));
    }
    return { kind: "forbidden", code };
  }
  if (res.status === 404) return { kind: "not_found" };

  if (res.status === 409) {
    // Conflict (state-machine violation, edit-after-submit, exhaustive
    // duplicate report on receipt, etc.). The backend returns at minimum
    // { statusCode: 409, error: "Conflict", message: string } and may carry
    // additional structured fields (e.g. receipt's `violations` array).
    // Surface the message verbatim and pass the full parsed body through so
    // callers that recognise the structured fields can use them.
    let msg = "Conflict";
    let body: Record<string, unknown> | undefined;
    try {
      const parsed = (await res.json()) as Record<string, unknown>;
      body = parsed;
      if (typeof parsed.message === "string") msg = parsed.message;
    } catch {
      msg = await res.text().catch(() => "Conflict");
    }
    return { kind: "conflict", message: msg, body };
  }

  if (res.status >= 200 && res.status < 300) {
    // 204 No Content has no body.
    if (res.status === 204) return { kind: "ok", data: undefined as T };
    const data = (await res.json()) as T;
    return { kind: "ok", data };
  }

  // 4xx (other) and 5xx.
  let bodyText: string;
  try {
    const body = await res.json();
    bodyText = typeof body === "object" && body !== null && "message" in body
      ? (body as { message: string | string[] }).message as string
      : JSON.stringify(body);
  } catch {
    bodyText = await res.text().catch(() => "");
  }

  if (res.status >= 400 && res.status < 500) {
    return {
      kind: "validation",
      status: res.status,
      message: bodyText,
    };
  }

  return {
    kind: "server_error",
    status: res.status,
    message: bodyText,
  };
}

/**
 * "Transient" failures: the request didn't reach a responsive backend. Used by
 * offline-capable screens to decide whether to show the calm "You're offline"
 * card vs. a red error banner. network_error is a fetch throw (no backend at
 * all); server_error covers 5xx (backend present but unreachable from the
 * proxy's perspective, or genuinely broken). In an offline-capable flow these
 * are EXPECTED conditions, not errors to alarm about; the topbar indicator is
 * the canonical surface for connectivity state.
 */
export function isTransientFailure(r: ApiResult<unknown>): boolean {
  return r.kind === "network_error" || r.kind === "server_error";
}
