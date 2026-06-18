"use client";

/**
 * Role detail at /admin/roles/[id]. Gated 'role.read'. READ-ONLY: NO edit /
 * create / delete affordances anywhere; runtime role editing is a pending
 * stakeholder decision.
 *
 * Mirror-first getById("role", id) + network revalidate getRole. The id comes
 * from useUrlLastSegment (not useParams; see use-url-segment.ts), with the
 * mandatory empty-id guard so the first render's "" never hits the LIST route.
 *
 * Mirror divergence handled honestly: the mirror `role` bucket carries
 * permission KEYS only (rolePermissions[].permission.key), no description or
 * category. So when painting from the mirror we render the keys in a single
 * UNGROUPED list with a note that full detail loads when online; once the
 * network getRole resolves with the full {key,description,category} form we
 * switch to the category-GROUPED view. No crash when category/description is
 * absent (the mirror branch never touches them).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import { getRole, type Role, type RolePermission } from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { DETAIL_GRID } from "@/lib/responsive";
import { getById } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

// Mirror `role` bucket row: permission KEYS only.
type MirroredRole = {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  deletedAt?: string | null;
  rolePermissions?: { permission?: { key?: string } | null }[] | null;
};

type View =
  // Network: full permissions with category + description (grouped view).
  | { source: "network"; id: string; name: string; description: string | null; isSystemRole: boolean; permissions: RolePermission[] }
  // Mirror: keys only, ungrouped list with a "full detail loads online" note.
  | { source: "mirror"; id: string; name: string; description: string | null; isSystemRole: boolean; permissionKeys: string[] };

type LoadState =
  | { status: "loading" }
  | { status: "ok"; view: View }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "offline" }
  | { status: "error"; message: string };

function viewFromMirror(r: MirroredRole): View {
  const keys = Array.isArray(r.rolePermissions)
    ? r.rolePermissions
        .map((rp) => rp?.permission?.key)
        .filter((k): k is string => typeof k === "string")
        .sort((a, b) => a.localeCompare(b))
    : [];
  return {
    source: "mirror",
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    isSystemRole: r.isSystemRole,
    permissionKeys: keys,
  };
}

function viewFromNetwork(r: Role): View {
  return {
    source: "network",
    id: r.id,
    name: r.name,
    description: r.description,
    isSystemRole: r.isSystemRole,
    permissions: r.permissions,
  };
}

export default function RoleDetailPage() {
  const router = useRouter();
  const { has } = usePermissions();
  const canRead = has("role.read");
  const id = useUrlLastSegment();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const mirrorPaintedRef = useRef(false);

  useEffect(() => {
    if (!canRead) return;
    // Empty-id guard (mandatory for useUrlLastSegment detail pages): the first
    // render has id === "", which would hit /api/roles/ (LIST route) and crash
    // the renderer on the array. Skip until the mount-time effect fills id.
    if (!id) return;
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;

    // Phase 1: mirror-first paint (keys only).
    (async () => {
      try {
        const rec = await getById<MirroredRole>("role", id);
        if (ctrl.signal.aborted) return;
        if (!rec || rec.body.deletedAt != null) return;
        mirrorPaintedRef.current = true;
        setState((prev) =>
          prev.status === "ok" && prev.view.source === "network"
            ? prev
            : { status: "ok", view: viewFromMirror(rec.body) },
        );
      } catch {
        // Let the network drive.
      }
    })();

    // Phase 2: network revalidate (full grouped view).
    getRole(id, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setState({ status: "ok", view: viewFromNetwork(r.data) });
      else if (r.kind === "not_found") setState({ status: "not_found" });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else if (r.kind === "network_error" || r.kind === "server_error") {
        if (!mirrorPaintedRef.current) setState({ status: "offline" });
      } else setState({ status: "error", message: "message" in r ? String(r.message) : "Error" });
    });

    return () => ctrl.abort();
  }, [id, canRead, router]);

  if (!canRead) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">Access denied</h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0">
            You do not have access to the role catalogue. This screen requires the
            <span className="font-mono mx-1">role.read</span> permission.
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="max-w-[1120px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading role...</div>
    );
  }
  if (state.status === "not_found") {
    return <NotFoundCard id={id} />;
  }
  if (state.status === "forbidden") {
    return (
      <div className="max-w-[1120px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to view this role.
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="max-w-[1120px] mx-auto py-10 text-center text-[var(--color-danger-700)]">{state.message}</div>
    );
  }
  if (state.status === "offline") {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This role's full permission catalogue will load when the connection returns. If this role was visited online before, it should be in the local mirror; otherwise come back online to load it." />
        <div className="text-center mt-3">
          <Link href="/admin/roles" className="text-[12px] text-[var(--color-navy-700)] hover:underline">
            Back to Roles
          </Link>
        </div>
      </div>
    );
  }

  const view = state.view;
  const isFromMirror = view.source === "mirror";
  const permissionCount = view.source === "network" ? view.permissions.length : view.permissionKeys.length;

  return (
    <div className="max-w-[1120px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Link href="/admin/roles" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Administration
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <Link href="/admin/roles" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Roles
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">{view.name}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">{view.name}</h1>
            {view.isSystemRole && <SystemBadge />}
            {isFromMirror && <FreshnessBadge />}
          </div>
          <div className="text-[13px] text-[var(--color-ink-500)] max-w-[820px]">
            {view.description ? view.description : <span className="text-[var(--color-ink-400)]">No description.</span>}
          </div>
        </div>
      </header>

      {/* Role metadata: detail-grid collapses to a single column below sm. */}
      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-6">
        <header className="px-4 sm:px-5 py-3.5 border-b border-[var(--color-border-default)] flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)]">Role</h2>
          <span className="text-mono-id text-[11px] text-[var(--color-ink-500)] break-all">{view.id}</span>
        </header>
        <div className="px-4 sm:px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-1">
          <Kv label="Name" value={view.name} />
          <Kv
            label="Type"
            value={view.isSystemRole ? "Built-in system role" : "Custom role"}
          />
          <Kv label="Permissions" value={`${permissionCount}`} />
        </div>
      </section>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
        <header className="px-4 sm:px-5 py-3.5 border-b border-[var(--color-border-default)] flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2.5">
            Permissions
            <span className="text-[11px] text-[var(--color-ink-500)] font-medium bg-[var(--color-ink-100)] px-2 py-0.5 rounded-full">
              {permissionCount}
            </span>
          </h2>
        </header>
        {permissionCount === 0 ? (
          <div className="px-4 sm:px-6 py-10 text-center text-[13px] text-[var(--color-ink-500)]">
            This role grants no permissions.
          </div>
        ) : view.source === "network" ? (
          <GroupedPermissions permissions={view.permissions} />
        ) : (
          <MirrorKeyList keys={view.permissionKeys} />
        )}
      </section>
    </div>
  );
}

/**
 * Network view: permissions grouped by category. Each category is a section;
 * groups stack on mobile (each is a full-width block). Within a group, each
 * permission is a key (mono) + description row.
 */
function GroupedPermissions({ permissions }: { permissions: RolePermission[] }) {
  // Group by category; a missing/empty category falls into "other".
  const groups = new Map<string, RolePermission[]>();
  for (const p of permissions) {
    const cat = p.category && p.category.trim() ? p.category : "other";
    const bucket = groups.get(cat);
    if (bucket) bucket.push(p);
    else groups.set(cat, [p]);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [, perms] of ordered) perms.sort((a, b) => a.key.localeCompare(b.key));

  return (
    <div>
      {ordered.map(([category, perms]) => (
        <div key={category} className="border-b border-[var(--color-border-default)] last:border-b-0">
          <div
            data-testid="role-category-group"
            className="px-4 sm:px-5 py-2 bg-[var(--color-ink-100)] flex items-center gap-2"
          >
            <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-ink-700)]">
              {category}
            </h3>
            <span className="text-[10.5px] text-[var(--color-ink-500)] font-medium">{perms.length}</span>
          </div>
          <ul className="divide-y divide-dashed divide-[var(--color-border-default)]">
            {perms.map((p) => (
              <li
                key={p.id}
                data-testid="role-permission-row"
                className="px-4 sm:px-5 py-2.5 grid grid-cols-1 sm:grid-cols-[240px_1fr] gap-1 sm:gap-4 items-baseline"
              >
                <span className="font-mono text-[12.5px] text-[var(--color-navy-700)] break-all">{p.key}</span>
                <span className="text-[12.5px] text-[var(--color-ink-700)]">
                  {p.description ? p.description : <span className="text-[var(--color-ink-400)]">--</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Mirror view: keys only, ungrouped, with an honest note that the grouped
 * detail (categories + descriptions) loads when online.
 */
function MirrorKeyList({ keys }: { keys: string[] }) {
  return (
    <div>
      <div className="px-4 sm:px-5 py-2 bg-[var(--color-warning-50)] text-[11.5px] text-[var(--color-warning-700)]">
        Showing cached permission keys. Full grouped detail (categories and descriptions) loads when
        you are back online.
      </div>
      <ul className="divide-y divide-dashed divide-[var(--color-border-default)]">
        {keys.map((k) => (
          <li
            key={k}
            data-testid="role-permission-row"
            className="px-4 sm:px-5 py-2.5"
          >
            <span className="font-mono text-[12.5px] text-[var(--color-navy-700)] break-all">{k}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      className={`${DETAIL_GRID} gap-1 sm:gap-4 items-baseline py-2.5 border-b border-dashed border-[var(--color-border-default)] last:border-b-0 text-[13px]`}
    >
      <span className="text-[12px] font-medium text-[var(--color-ink-500)]">{label}</span>
      <span className="text-[var(--color-ink-900)] font-medium">{value}</span>
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

function NotFoundCard({ id }: { id: string }) {
  return (
    <div className="max-w-[640px] mx-auto py-12">
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
        <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">Role not found</h1>
        <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-1">
          No role matches <span className="font-mono text-[var(--color-navy-700)]">{id}</span>.
        </p>
        <p className="text-[12px] text-[var(--color-ink-500)] m-0 mb-5">Browse the catalogue.</p>
        <Link
          href="/admin/roles"
          className="inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
          style={{ background: "var(--color-navy-700)" }}
        >
          Back to Roles
        </Link>
      </div>
    </div>
  );
}
