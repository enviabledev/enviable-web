/**
 * Roles admin API client. Read-only at MVP (the management UI renders a
 * read-only catalogue; runtime role editing is a pending stakeholder decision).
 * Mirrors the live contract:
 *
 *   GET /api/roles       -> Role[]   (array, not paginated)
 *   GET /api/roles/:id   -> Role
 *
 * Role.permissions is the FLAT, fully-described form the management UI groups
 * by category: { id, key, description, category }. (The mirror `role` bucket
 * carries permission KEYS only via rolePermissions[].permission.key, so the
 * mirror-first paint shows keys and the network revalidate fills descriptions
 * and categories.)
 */
import { apiFetch, type ApiResult } from "./client";

export type RolePermission = {
  id: string;
  key: string;
  description: string;
  category: string;
};

export type Role = {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissions: RolePermission[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export async function listRoles(signal?: AbortSignal): Promise<ApiResult<Role[]>> {
  return apiFetch<Role[]>("/api/roles", { signal });
}

export async function getRole(id: string, signal?: AbortSignal): Promise<ApiResult<Role>> {
  return apiFetch<Role>(`/api/roles/${encodeURIComponent(id)}`, { signal });
}
