"use client";

import { useMemo } from "react";

import { useAuth } from "./AuthProvider";

/**
 * Membership check against the principal's permission set. Mirrors the
 * backend's PermissionsGuard, which is AND-only; hasAll is the standard
 * shape. This is a UI convenience, NOT a security boundary; the backend's
 * guards are the real enforcement and the UI hides what the API would 403
 * anyway (defence in depth).
 *
 * IT Admin's wildcard ("*") is expanded server-side, so the principal's
 * permissions array is just a list of keys and `has(key)` is plain Set.has.
 */
export function usePermissions() {
  const { state } = useAuth();
  const permissionSet = useMemo(
    () => new Set(state.principal?.permissions ?? []),
    [state.principal],
  );

  return useMemo(
    () => ({
      has: (key: string) => permissionSet.has(key),
      hasAll: (keys: readonly string[]) =>
        keys.length === 0 || keys.every((k) => permissionSet.has(k)),
      hasAny: (keys: readonly string[]) =>
        keys.length === 0 || keys.some((k) => permissionSet.has(k)),
    }),
    [permissionSet],
  );
}
