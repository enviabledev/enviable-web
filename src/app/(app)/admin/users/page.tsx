"use client";

/**
 * Users admin at /admin/users. Gated 'user.read'; mutations gated
 * 'user.manage'. Replaces the prior NotYetBuiltCard placeholder now that the
 * backend users module is live.
 *
 * Mirror-first paint: read the "user" bucket and join roleId -> name from the
 * "role" bucket (mirror user rows carry userRoles[].roleId only, no nested
 * role object). Then revalidate against listUsers, which returns the richer
 * userRoles[].role.name directly. Relation-read audit: a role id with no
 * matching role bucket row resolves to the raw id (never a crash, never a
 * silent empty string).
 *
 * Mirror-only-with-revalidate, so it still wires the explicit freshness signal
 * (visibilitychange + focus + online + 15s tick) like counterparties, and
 * shows the FreshnessBadge while painting from the mirror.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SearchIcon, UsersIcon } from "@/components/icons";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import CreateUserModal from "@/components/admin/users/CreateUserModal";
import UserStatusPill from "@/components/users/UserStatusPill";
import {
  USER_PAGE_SIZES,
  USER_STATUS,
  listUsers,
  type UserDetail,
  type UserListRow,
  type UserPageSize,
  type UserStatus,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatDateShort } from "@/lib/format";
import { COL, FILTER_CONTROL, FILTER_FORM } from "@/lib/responsive";
import { useMirrorFreshness } from "@/lib/sync/mirror/freshness";
import { listByType } from "@/lib/sync/mirror/store";

type MirrorUser = {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  deletedAt: string | null;
  userRoles?: { roleId: string }[];
};
type MirrorRole = { id: string; name: string };

type Row = {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  roleNames: string[];
};

const DEFAULT_PAGE_SIZE: UserPageSize = 25;

function rowFromList(u: UserListRow): Row {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    // Network shape carries the nested role object; relation-read safe via ?? .
    roleNames: (u.userRoles ?? []).map((r) => r.role?.name ?? r.roleId),
  };
}

export default function AdminUsersPage() {
  const { has } = usePermissions();
  const canRead = has("user.read");
  const canManage = has("user.manage");

  const [rows, setRows] = useState<Row[] | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [allRoleNames, setAllRoleNames] = useState<string[]>([]);
  const [roleNameById, setRoleNameById] = useState<Record<string, string>>({});

  const [statusFilter, setStatusFilter] = useState<UserStatus | "">("");
  const [roleFilter, setRoleFilter] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState<UserPageSize>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [createdNotice, setCreatedNotice] = useState<UserDetail | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const watermark = useMirrorFreshness();
  const bootstrapping = watermark ? !watermark.historyComplete : true;

  const read = useCallback(async () => {
    // Mirror-first: join user rows to role names from the role bucket.
    try {
      const [userRows, roleRows] = await Promise.all([
        listByType<MirrorUser>("user"),
        listByType<MirrorRole>("role"),
      ]);
      const nameById: Record<string, string> = {};
      for (const r of roleRows) nameById[r.body.id] = r.body.name;
      setRoleNameById(nameById);
      setAllRoleNames(
        Array.from(new Set(roleRows.map((r) => r.body.name))).sort((a, b) =>
          a.localeCompare(b),
        ),
      );
      const built: Row[] = userRows
        .map((r) => r.body)
        .filter((u) => u.deletedAt == null)
        .map<Row>((u) => ({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          status: u.status,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
          // Relation-read audit: missing role bucket row -> raw roleId, never crash.
          roleNames: (u.userRoles ?? []).map((ur) => nameById[ur.roleId] ?? ur.roleId),
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      if (built.length > 0 || rows == null) {
        setRows(built);
        setFromMirror(true);
      }
    } catch {
      // network revalidate drives
    }

    // Network revalidate: authoritative + carries nested role names.
    const r = await listUsers({ pageSize: 250 });
    if (r.kind === "ok") {
      const built = r.data.data
        .filter((u) => u.deletedAt == null)
        .map(rowFromList)
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      setRows(built);
      setFromMirror(false);
      const names = Array.from(
        new Set(built.flatMap((b) => b.roleNames)),
      ).sort((a, b) => a.localeCompare(b));
      if (names.length > 0) setAllRoleNames(names);
    }
  }, [rows]);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) void read();
    };
    run();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, 15000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
      window.clearInterval(interval);
    };
    // read closes over rows for the first-paint guard only; reloadTick forces a
    // refresh after create.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, reloadTick]);

  const visible = useMemo(() => {
    return (rows ?? []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (roleFilter && !r.roleNames.includes(roleFilter)) return false;
      if (search) {
        const q = search.toUpperCase();
        if (!r.fullName.toUpperCase().includes(q) && !r.email.toUpperCase().includes(q))
          return false;
      }
      return true;
    });
  }, [rows, statusFilter, roleFilter, search]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = visible.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  // Reset to page 1 when filters or page size change.
  useEffect(() => setPage(1), [statusFilter, roleFilter, search, pageSize]);

  if (!canRead) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">
            Access denied
          </h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0">
            You do not have access to user administration. This screen requires the
            <span className="font-mono mx-1">user.read</span> permission, which is held by
            senior administrative roles (Managing Director, Executive Director, General
            Manager).
          </p>
        </div>
      </div>
    );
  }

  const roleFilterOptions = allRoleNames.length > 0 ? allRoleNames : Object.values(roleNameById);

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Admin / Users</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <UsersIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Users
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[920px]">
            People with access to Enviable. Create users, assign roles, and manage access.
            New users receive the configured default password and must set their own on first
            login.
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            data-testid="create-user-button"
            className="h-[32px] px-4 inline-flex items-center rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium self-start"
          >
            Create user
          </button>
        )}
      </header>

      {createdNotice && (
        <div
          role="status"
          data-testid="create-user-notification"
          className="mb-3 px-3.5 py-3 rounded-[4px] bg-[var(--color-success-100)] border border-[var(--color-success-700)]/30 text-[12.5px] text-[var(--color-ink-900)] flex items-start justify-between gap-3"
        >
          <div>
            <span className="font-semibold">User {createdNotice.fullName} created.</span>{" "}
            Their initial password is the configured default; communicate it to them through
            your normal onboarding process. They will be required to set their own password on
            first login.
          </div>
          <button
            type="button"
            onClick={() => setCreatedNotice(null)}
            data-testid="create-user-notification-dismiss"
            className="shrink-0 h-[24px] px-2 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-700)] text-[11.5px] font-medium hover:bg-white/60"
          >
            Dismiss
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchDraft);
        }}
        className={`bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 ${FILTER_FORM}`}
      >
        <Field label="Status">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as UserStatus | "")}
            data-testid="filter-status"
            className={`h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] ${FILTER_CONTROL}`}
          >
            <option value="">All statuses</option>
            {USER_STATUS.map((s) => (
              <option key={s} value={s}>
                {s === "ACTIVE" ? "Active" : "Inactive"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            data-testid="filter-role"
            className={`h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] ${FILTER_CONTROL}`}
          >
            <option value="">All roles</option>
            {roleFilterOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search name or email">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-[12px] h-[12px] text-[var(--color-ink-500)]" />
            <input
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="e.g. Ada or ada@enviable"
              data-testid="filter-search"
              className="h-[28px] w-full sm:w-[260px] pl-6 pr-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
            />
          </div>
        </Field>
        <button
          type="submit"
          className="h-[28px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium"
        >
          Search
        </button>
        {(statusFilter || roleFilter || search) && (
          <button
            type="button"
            onClick={() => {
              setSearchDraft("");
              setSearch("");
              setStatusFilter("");
              setRoleFilter("");
            }}
            className="h-[28px] px-3 rounded-[3px] bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] text-[12px] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)]"
          >
            Clear
          </button>
        )}
      </form>

      {!rows ? (
        <div className="py-10 text-center text-[var(--color-ink-500)]">Loading users...</div>
      ) : (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
          <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between gap-2 flex-wrap">
            <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
              Directory
              <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-1">
                {visible.length} of {rows.length}
              </span>
              {fromMirror && <FreshnessBadge />}
            </h2>
            <label className="flex items-center gap-2 text-[11.5px] text-[var(--color-ink-500)]">
              Rows
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as UserPageSize)}
                data-testid="page-size"
                className="h-[26px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12px] text-[var(--color-ink-900)]"
              >
                {USER_PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </header>

          {visible.length === 0 ? (
            bootstrapping && rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12.5px] text-[var(--color-ink-500)]">
                <div className="inline-flex items-center gap-2.5 mb-2">
                  <span className="inline-block w-[10px] h-[10px] rounded-full bg-[var(--color-navy-700)] animate-pulse" />
                  <span className="font-medium text-[var(--color-ink-700)]">
                    Syncing your data...
                  </span>
                </div>
                <div className="max-w-[480px] mx-auto">
                  The local mirror is downloading from the server. Users will appear here as
                  soon as the initial sync finishes.
                </div>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
                No users match the current filters.
              </div>
            )
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Status</Th>
                      <Th className={COL.sm}>Roles</Th>
                      <Th className={COL.sm}>Email</Th>
                      <Th className={COL.md}>Created</Th>
                      <Th className={COL.lg}>Last login</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, i) => (
                      <tr
                        key={r.id}
                        className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
                      >
                        <Td>
                          <Link
                            href={`/admin/users/${r.id}`}
                            title={r.fullName}
                            className="text-[var(--color-navy-700)] hover:underline font-medium block max-w-[160px] sm:max-w-none truncate"
                          >
                            {r.fullName}
                          </Link>
                        </Td>
                        <Td>
                          <UserStatusPill status={r.status} />
                        </Td>
                        <Td className={COL.sm}>
                          <RolesSummary names={r.roleNames} />
                        </Td>
                        <Td className={COL.sm}>
                          <span
                            title={r.email}
                            className="block max-w-[200px] truncate text-[12px] text-[var(--color-ink-700)]"
                          >
                            {r.email}
                          </span>
                        </Td>
                        <Td className={COL.md}>{formatDateShort(r.createdAt)}</Td>
                        <Td className={COL.lg}>
                          {r.lastLoginAt ? (
                            formatDateShort(r.lastLoginAt)
                          ) : (
                            <span className="text-[var(--color-ink-400)]">--</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="px-4 py-2.5 border-t border-[var(--color-border-default)] flex items-center justify-between gap-2 text-[12px] text-[var(--color-ink-700)]">
                  <span>
                    Page {pageClamped} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={pageClamped <= 1}
                      className="h-[26px] px-3 rounded-[3px] border border-[var(--color-border-default)] bg-white disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={pageClamped >= totalPages}
                      className="h-[26px] px-3 rounded-[3px] border border-[var(--color-border-default)] bg-white disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <CreateUserModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={(created) => {
          setModalOpen(false);
          setCreatedNotice(created);
          setReloadTick((n) => n + 1);
        }}
      />
    </div>
  );
}

function RolesSummary({ names }: { names: string[] }) {
  if (names.length === 0) {
    return <span className="text-[11.5px] text-[var(--color-ink-400)]">--</span>;
  }
  const first = names[0];
  const extra = names.length - 1;
  return (
    <span
      title={names.join(", ")}
      data-testid="role-chip"
      className="inline-flex items-center gap-1 text-[11.5px] text-[var(--color-ink-700)]"
    >
      <span className="inline-flex items-center h-[18px] px-2 rounded-full bg-[var(--color-ink-100)] text-[var(--color-ink-700)] max-w-[140px] truncate">
        {first}
      </span>
      {extra > 0 && <span className="text-[var(--color-ink-500)]">+{extra}</span>}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 w-full sm:w-auto">
      <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left font-medium text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-2 sm:px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-2 sm:px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap ${className}`}>
      {children}
    </td>
  );
}
