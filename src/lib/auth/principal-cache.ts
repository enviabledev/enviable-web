"use client";

/**
 * Principal cache for offline app rendering across reloads.
 *
 * CRITICAL DISTINCTION (protect this decision; see CLAUDE.md):
 *   The principal cached here is identity METADATA (id, fullName, email,
 *   roles, permissions) used only for rendering, NOT an authentication
 *   token. The httpOnly session cookie (`enviable.sid`) remains the sole
 *   credential; the cookie is never in JS and is never stored here.
 *
 *   Caching the principal in IndexedDB does NOT violate the
 *   "no auth artifacts in JS-accessible storage" rule, because the rule
 *   is about the TOKEN (the credential that grants access). The principal
 *   doesn't grant access; it describes who the cookie belongs to. The
 *   backend's PermissionsGuard is the real enforcement on every API call;
 *   the cached principal is a UI-rendering aid only. A stale cached
 *   permission only means the UI offers an action the backend then 403s
 *   on, which is the same graceful failure pattern as everywhere else.
 *
 *   Hygiene: the cached principal MUST be cleared on logout AND on
 *   confirmed-401 (a 401 from a reachable backend, meaning the session
 *   really is gone). It MUST NOT be cleared on transient unreachable
 *   (offline / 5xx); that's the whole point. Both clear paths are
 *   exercised by AuthProvider; both must keep working under refactor.
 *
 * Storage: a single key in the shared enviable-sync IndexedDB meta store,
 * coexisting with the deviceId entry used by the sync queue. The queue
 * and the principal are both "device identity" type data, and sharing
 * the DB keeps the offline persistence layer in one place.
 */
import { STORE_META, reqToPromise, withStore } from "@/lib/sync/db";

import type { Principal } from "./types";

const META_PRINCIPAL_KEY = "principal";

type MetaRow = { key: string; value: Principal };

export async function loadCachedPrincipal(): Promise<Principal | null> {
  try {
    const row = await withStore<MetaRow | undefined>(
      STORE_META,
      "readonly",
      (store) => reqToPromise(store.get(META_PRINCIPAL_KEY)),
    );
    console.log("[auth] loadCachedPrincipal: raw row =", row);
    return row?.value ?? null;
  } catch (err) {
    console.error("[auth] loadCachedPrincipal: threw", err);
    return null;
  }
}

export async function saveCachedPrincipal(p: Principal): Promise<void> {
  try {
    await withStore(STORE_META, "readwrite", (store) =>
      reqToPromise(store.put({ key: META_PRINCIPAL_KEY, value: p })),
    );
    console.log("[auth] saveCachedPrincipal: saved principal id =", p.id);
  } catch (err) {
    console.error("[auth] saveCachedPrincipal: threw", err);
  }
}

export async function clearCachedPrincipal(): Promise<void> {
  try {
    await withStore(STORE_META, "readwrite", (store) =>
      reqToPromise(store.delete(META_PRINCIPAL_KEY)),
    );
  } catch {
    // Best-effort; if IDB is unreachable there's nothing to clear.
  }
}
