/**
 * Generic API fetcher. Routes everything through the same-origin /api/* proxy
 * so the httpOnly enviable.sid cookie rides along (see next.config.ts). Never
 * reference BACKEND_API_URL from client code; it is server-only.
 *
 * Returns a typed Result. Callers branch on `kind` rather than throwing for
 * expected outcomes (unauthorized, forbidden, not-found) so screens can render
 * the right empty/permission state without a try/catch dance.
 */

export type ApiResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "conflict"; message: string }
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
  if (res.status === 403) return { kind: "forbidden" };
  if (res.status === 404) return { kind: "not_found" };

  if (res.status === 409) {
    // Conflict (state-machine violation, edit-after-submit, etc.). The backend
    // returns { statusCode: 409, message: string, error: "Conflict" } with the
    // human-readable message; surface it verbatim.
    let msg = "Conflict";
    try {
      const body = (await res.json()) as { message?: string };
      if (typeof body.message === "string") msg = body.message;
    } catch {
      msg = await res.text().catch(() => "Conflict");
    }
    return { kind: "conflict", message: msg };
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
