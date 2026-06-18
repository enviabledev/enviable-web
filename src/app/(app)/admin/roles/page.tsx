"use client";

/**
 * Roles catalogue at /admin/roles. Gated 'role.read'. READ-ONLY at MVP:
 * runtime role editing is a pending stakeholder decision, so there are NO
 * create / edit / delete affordances here, and no "coming soon" placeholder;
 * this is an honest read-only catalogue of the roles and their permissions.
 *
 * Mirror-first paint from listByType("role") + network revalidate via
 * listRoles. Explicit freshness signal (visibilitychange + focus + online +
 * 15s tick) like the counterparties reference, so a clerk who opens the tab
 * before the first reconcile completes (or who keeps it open while a later
 * reconcile lands) sees the fresh data.
 *
 * Mirror divergence handled honestly: the mirror `role` bucket carries
 * permission KEYS only (rolePermissions[].permission.key), no descriptions
 * or categories. The list only needs name / description / permission COUNT,
 * all of which the mirror row carries, so the mirror paint is complete for
 * this screen; the count is identical mirror-vs-network. The grouped
 * {key,description,category} view is the detail page's concern.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { RolesIcon } from "@/components/icons";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import { listRoles, type Role } from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { COL } from "@/lib/responsive";
import { useMirrorFreshness } from "@/lib/sync/mirror/freshness";
import { listByType } from "@/lib/sync/mirror/store";

// Mirror `role` bucket row: permission KEYS only (no description/category).
type MirroredRole = {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  deletedAt?: string | null;
  rolePermissions?: { permission?: { key?: string } | null }[] | null;
};

type Row = {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissionCount: number;
};

function rowFromNetwork(r: Role): Row {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isSystemRole: r.isSystemRole,
    permissionCount: r.permissions.length,
  };
}

function rowFromMirror(r: MirroredRole): Row {
  // Permission count from the mirror's rolePermissions; missing/null is 0,
  // never a crash (mirror shape divergence handled honestly).
  const count = Array.isArray(r.rolePermissions) ? r.rolePermissions.length : 0;
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    isSystemRole: r.isSystemRole,
    permissionCount: count,
  };
}

export default function AdminRolesPage() {
  const { has } = usePermissions();
  const canRead = has("role.read");

  const [rows, setRows] = useState<Row[] | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const watermark = useMirrorFreshness();
  const bootstrapping = watermark ? !watermark.historyComplete : true;

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    const ctrl = new AbortController();

    // Tracks whether the authoritative network data has landed in THIS run,
    // so a slow mirror read (a later tick) never clobbers a fresh paint.
    let networkLanded = false;

    const read = async () => {
      // Phase 1: mirror-first paint (permission keys only, but the count is
      // all this screen needs from the mirror).
      try {
        const recs = await listByType<MirroredRole>("role");
        if (cancelled || networkLanded) return;
        const built = recs
          .map((r) => r.body)
          .filter((r) => r.deletedAt == null)
          .map(rowFromMirror)
          .sort((a, b) => a.name.localeCompare(b.name));
        // networkLanded already guards against clobbering fresh network data;
        // here we paint the mirror snapshot and mark the badge.
        setRows(built);
        if (built.length > 0) setFromMirror(true);
      } catch {
        // Let the network drive.
      }

      // Phase 2: network revalidate (authoritative count + fresh names). On a
      // network/server failure with no mirror paint, rows stays null and the
      // page keeps its "Loading roles..." state; the bootstrap branch below
      // distinguishes "still syncing" from "no roles" once a paint lands.
      const res = await listRoles(ctrl.signal);
      if (cancelled || ctrl.signal.aborted) return;
      if (res.kind === "ok") {
        networkLanded = true;
        const built = res.data
          .filter((r) => r.deletedAt == null)
          .map(rowFromNetwork)
          .sort((a, b) => a.name.localeCompare(b.name));
        setRows(built);
        setFromMirror(false);
      }
    };
    void read();

    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", read);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, 15000);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", read);
      window.clearInterval(interval);
    };
  }, [canRead]);

  const sorted = useMemo(() => rows ?? [], [rows]);

  if (!canRead) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">
            Access denied
          </h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0">
            You do not have access to the role catalogue. This screen requires the
            <span className="font-mono mx-1">role.read</span> permission, which is held by
            senior administrative roles (Managing Director, Executive Director, General
            Manager).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Administration / Roles</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <RolesIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Roles
          </h1>
          <div
            data-testid="roles-readonly-caption"
            className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[920px]"
          >
            Roles and their permissions are managed at the system level and are read-only here.
          </div>
        </div>
      </header>

      {rows == null ? (
        <div className="py-10 text-center text-[var(--color-ink-500)]">Loading roles...</div>
      ) : (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
          <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
            <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
              Role catalogue
              <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-1">
                {sorted.length}
              </span>
              {fromMirror && <FreshnessBadge />}
            </h2>
          </header>
          {sorted.length === 0 ? (
            bootstrapping ? (
              <div className="px-4 py-10 text-center text-[12.5px] text-[var(--color-ink-500)]">
                <div className="inline-flex items-center gap-2.5 mb-2">
                  <span className="inline-block w-[10px] h-[10px] rounded-full bg-[var(--color-navy-700)] animate-pulse" />
                  <span className="font-medium text-[var(--color-ink-700)]">Syncing your data...</span>
                </div>
                <div className="max-w-[480px] mx-auto">
                  The local mirror is downloading from the server. Roles will appear here as soon as
                  the initial sync finishes.
                </div>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
                No roles are defined.
              </div>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <Th>Role</Th>
                    <Th className={COL.sm}>Description</Th>
                    <Th>Permissions</Th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr
                      key={r.id}
                      className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
                    >
                      <Td>
                        <div className="flex items-center gap-2 max-w-[180px] sm:max-w-none">
                          <Link
                            href={`/admin/roles/${r.id}`}
                            data-testid="role-row-link"
                            title={r.name}
                            className="text-[var(--color-navy-700)] hover:underline font-medium block truncate"
                          >
                            {r.name}
                          </Link>
                          {r.isSystemRole && <SystemBadge />}
                        </div>
                      </Td>
                      <Td className={COL.sm}>
                        {r.description ? (
                          <span className="text-[12.5px] text-[var(--color-ink-700)] block max-w-[520px] truncate" title={r.description}>
                            {r.description}
                          </span>
                        ) : (
                          <span className="text-[11.5px] text-[var(--color-ink-400)]">--</span>
                        )}
                      </Td>
                      <Td>
                        <span className="text-[12.5px] text-[var(--color-ink-900)] tabular-nums whitespace-nowrap">
                          {r.permissionCount}{" "}
                          <span className="text-[var(--color-ink-500)]">
                            {r.permissionCount === 1 ? "permission" : "permissions"}
                          </span>
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SystemBadge() {
  return (
    <span
      title="Built-in system role"
      className="inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap bg-[var(--color-navy-50)] text-[var(--color-navy-700)] flex-shrink-0"
    >
      System
    </span>
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
    <td className={`px-2 sm:px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] align-top ${className}`}>
      {children}
    </td>
  );
}
