/**
 * Users admin API client. Mirrors the live contract verified against the
 * running backend (prompt 30 module):
 *
 *   GET    /api/users            -> { data: UserListRow[], page, pageSize, total }
 *                                   (pageSize must be one of 25|50|100|250)
 *   GET    /api/users/:id        -> UserDetail
 *   POST   /api/users            -> UserDetail   (no password field; default
 *                                   password assigned server-side, the created
 *                                   user is mustResetPassword=true)
 *   PATCH  /api/users/:id        -> UserDetail   (atomic role swap via roleIds)
 *   DELETE /api/users/:id        -> soft-delete
 *   POST   /api/users/:id/reset-password-required -> forces target must-reset
 *
 * IMPORTANT shape note (live API, source of truth): a user row carries its
 * roles as nested `userRoles[].role.{id,name}`, NOT a flat `roles[]`. The
 * mirror bucket carries `userRoles[].roleId` only (join to the role bucket for
 * names offline). passwordHash is never present (redacted server-side).
 */
import { apiFetch, buildQuery, type ApiResult } from "./client";

export const USER_STATUS = ["ACTIVE", "INACTIVE"] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const USER_PAGE_SIZES = [25, 50, 100, 250] as const;
export type UserPageSize = (typeof USER_PAGE_SIZES)[number];

/** A role reference as the API embeds it on a user row. */
export type UserRoleRef = {
  id: string;
  userId: string;
  roleId: string;
  assignedAt: string;
  assignedBy: string | null;
  role: { id: string; name: string };
};

export type UserListRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: UserStatus;
  mustResetPassword: boolean;
  reportsToUserId: string | null;
  lastLoginAt: string | null;
  createdById: string | null;
  deactivatedAt: string | null;
  deactivatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  userRoles: UserRoleRef[];
};

/** Detail shape is the same row the list returns (no extra nesting today). */
export type UserDetail = UserListRow;

export type UserListResponse = {
  data: UserListRow[];
  page: number;
  pageSize: number;
  total: number;
};

export type CreateUserBody = {
  fullName: string;
  email: string;
  roleIds: string[];
};

export type UpdateUserBody = {
  fullName?: string;
  email?: string;
  status?: UserStatus;
  roleIds?: string[];
};

export type ListUsersQuery = {
  status?: UserStatus;
  roleId?: string;
  search?: string;
  page?: number;
  pageSize?: UserPageSize;
};

export async function listUsers(
  query: ListUsersQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<UserListResponse>> {
  const qs = buildQuery({
    status: query.status,
    roleId: query.roleId,
    search: query.search,
    page: query.page,
    pageSize: query.pageSize,
  });
  return apiFetch<UserListResponse>(`/api/users${qs}`, { signal });
}

export async function getUser(id: string, signal?: AbortSignal): Promise<ApiResult<UserDetail>> {
  return apiFetch<UserDetail>(`/api/users/${encodeURIComponent(id)}`, { signal });
}

export async function createUser(
  body: CreateUserBody,
  signal?: AbortSignal,
): Promise<ApiResult<UserDetail>> {
  return apiFetch<UserDetail>("/api/users", { method: "POST", body, signal });
}

export async function updateUser(
  id: string,
  body: UpdateUserBody,
  signal?: AbortSignal,
): Promise<ApiResult<UserDetail>> {
  return apiFetch<UserDetail>(`/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    signal,
  });
}

export async function deleteUser(id: string, signal?: AbortSignal): Promise<ApiResult<UserDetail>> {
  return apiFetch<UserDetail>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE", signal });
}

/** Force the target user to must-reset on next login (admin action). */
export async function resetPasswordRequired(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<UserDetail>> {
  return apiFetch<UserDetail>(`/api/users/${encodeURIComponent(id)}/reset-password-required`, {
    method: "POST",
    signal,
  });
}
