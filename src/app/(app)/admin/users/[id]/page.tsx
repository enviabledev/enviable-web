"use client";

/**
 * User detail at /admin/users/[id]. Gated 'user.read'; management actions
 * gated 'user.manage'.
 *
 * Mirror-first paint via getById<MirrorUser>("user", id), joining roleId ->
 * name from the "role" bucket (mirror user rows carry userRoles[].roleId only).
 * Network revalidate via getUser, which carries the nested userRoles[].role.
 * Field-access + relation-read audit: every role name is sourced from a
 * reconstructed-or-guarded lookup; a missing role row resolves to the raw id,
 * never a crash, never a silent empty string. Actor ids (createdById,
 * deactivatedById) resolve to names from the user bucket where present, else
 * the raw id is shown honestly.
 *
 * Seventh meta-discipline: useUrlLastSegment + empty-id guard (`if (!id)`)
 * in the fetch effect.
 *
 * Management actions are each behind an inline confirmation panel with
 * consequence-explaining copy and are ONLINE-ONLY (disabled offline with an
 * OfflineNotice treatment). Self-modification footguns are enforced UI-side
 * (the backend also enforces): when the logged-in principal is viewing their
 * own record, Deactivate / Delete / Reset-password are not rendered; Edit is.
 * In the Edit role multiselect, de-selecting any role the principal relies on
 * for user.manage is blocked so a user cannot strip their own last
 * user.manage-granting role and lock themselves (and possibly everyone) out.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import UserStatusPill from "@/components/users/UserStatusPill";
import {
  deleteUser,
  getUser,
  listRoles,
  resetPasswordRequired,
  updateUser,
  type Role,
  type UserStatus,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions, usePrincipal } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { DETAIL_GRID } from "@/lib/responsive";
import { useConnectivity } from "@/lib/sync/connectivity";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

type MirrorUser = {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  mustResetPassword?: boolean;
  lastLoginAt: string | null;
  createdById: string | null;
  deactivatedAt: string | null;
  deactivatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  userRoles?: { roleId: string }[];
};
type MirrorRole = {
  id: string;
  name: string;
  rolePermissions?: { permission?: { key?: string } | null }[] | null;
};

type RoleOption = { id: string; name: string; grantsUserManage: boolean };

/** A normalized view the renderer consumes (network OR mirror sourced). */
type View = {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  mustResetPassword: boolean;
  lastLoginAt: string | null;
  createdById: string | null;
  deactivatedAt: string | null;
  deactivatedById: string | null;
  createdAt: string;
  updatedAt: string;
  roleIds: string[];
  roleNames: string[];
};

type EditDraft = { fullName: string; email: string; status: UserStatus; roleIds: string[] };

type Action =
  | { status: "idle" }
  | { status: "editing"; draft: EditDraft }
  | { status: "submitting"; draft: EditDraft }
  | { status: "confirmDeactivate" }
  | { status: "confirmReactivate" }
  | { status: "confirmReset" }
  | { status: "confirmDelete" }
  | { status: "busy" }
  | { status: "error"; message: string };

export default function UserDetailPage() {
  const router = useRouter();
  const principal = usePrincipal();
  const { has } = usePermissions();
  const { state: connState } = useConnectivity();
  const canRead = has("user.read");
  const canManage = has("user.manage");
  const offline = connState === "offline";
  const id = useUrlLastSegment();

  const [view, setView] = useState<View | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [notFound, setNotFound] = useState(false);
  const [offlineEmpty, setOfflineEmpty] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [action, setAction] = useState<Action>({ status: "idle" });

  const isSelf = principal != null && view != null && principal.id === view.id;

  useEffect(() => {
    if (!canRead || !id) return;
    const ctrl = new AbortController();
    setNotFound(false);
    setOfflineEmpty(false);
    let mirrorPainted = false;

    (async () => {
      try {
        const [roleRows, userRows] = await Promise.all([
          listByType<MirrorRole>("role"),
          listByType<MirrorUser>("user"),
        ]);
        if (ctrl.signal.aborted) return;
        const nameById: Record<string, string> = {};
        const opts: RoleOption[] = [];
        for (const r of roleRows) {
          nameById[r.body.id] = r.body.name;
          const keys = Array.isArray(r.body.rolePermissions)
            ? r.body.rolePermissions.map((rp) => rp.permission?.key).filter(Boolean)
            : [];
          opts.push({
            id: r.body.id,
            name: r.body.name,
            grantsUserManage: keys.includes("user.manage"),
          });
        }
        if (opts.length > 0) {
          setRoleOptions(opts.sort((a, b) => a.name.localeCompare(b.name)));
        }
        // Actor-name lookup from the user bucket (relation-read: missing -> id).
        const actorMap: Record<string, string> = {};
        for (const u of userRows) actorMap[u.body.id] = u.body.fullName;
        setActorNames(actorMap);

        const row = await getById<MirrorUser>("user", id);
        if (ctrl.signal.aborted || !row) return;
        mirrorPainted = true;
        const u = row.body;
        const roleIds = (u.userRoles ?? []).map((ur) => ur.roleId);
        setView({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          status: u.status,
          mustResetPassword: u.mustResetPassword ?? false,
          lastLoginAt: u.lastLoginAt,
          createdById: u.createdById,
          deactivatedAt: u.deactivatedAt,
          deactivatedById: u.deactivatedById,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
          roleIds,
          roleNames: roleIds.map((rid) => nameById[rid] ?? rid),
        });
        setFromMirror(true);
      } catch {
        // network drives
      }
    })();

    // Network revalidate for the user (authoritative + nested role names).
    getUser(id, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        const u = r.data;
        const roleIds = (u.userRoles ?? []).map((ur) => ur.roleId);
        setView({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          status: u.status,
          mustResetPassword: u.mustResetPassword,
          lastLoginAt: u.lastLoginAt,
          createdById: u.createdById,
          deactivatedAt: u.deactivatedAt,
          deactivatedById: u.deactivatedById,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
          roleIds,
          roleNames: (u.userRoles ?? []).map((ur) => ur.role?.name ?? ur.roleId),
        });
        setFromMirror(false);
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to view this user.");
      } else if (r.kind === "not_found") {
        if (!mirrorPainted) setNotFound(true);
      } else if (isTransientFailure(r)) {
        if (!mirrorPainted) setOfflineEmpty(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    // Role permission revalidate (authoritative grantsUserManage from keys).
    listRoles(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted || r.kind !== "ok") return;
      setRoleOptions(
        [...r.data]
          .filter((role: Role) => role.deletedAt == null)
          .map((role) => ({
            id: role.id,
            name: role.name,
            grantsUserManage: role.permissions.some((p) => p.key === "user.manage"),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    });

    return () => ctrl.abort();
  }, [canRead, id, router, reloadTick]);

  // The principal's own user.manage-granting roleIds (intersection of the roles
  // they hold with the roles that grant user.manage). Used to block a self-edit
  // from removing their last user.manage-bearing role.
  const principalManageRoleIds = useMemo(() => {
    if (!principal || !isSelf || !view) return new Set<string>();
    const granting = new Set(
      roleOptions.filter((o) => o.grantsUserManage).map((o) => o.id),
    );
    // The principal's assigned roles ARE this user's roles (self-view), so the
    // user.manage-granting subset is view.roleIds intersected with granting.
    return new Set(view.roleIds.filter((rid) => granting.has(rid)));
  }, [principal, isSelf, view, roleOptions]);

  const beginEdit = () => {
    if (!view) return;
    setAction({
      status: "editing",
      draft: {
        fullName: view.fullName,
        email: view.email,
        status: view.status,
        roleIds: [...view.roleIds],
      },
    });
  };

  const saveEdit = async () => {
    if (action.status !== "editing" || !view) return;
    const draft = action.draft;
    // Self-guard: block submit if it would strip the principal's last
    // user.manage-granting role from themselves.
    if (isSelf && principalManageRoleIds.size > 0) {
      const keptManage = draft.roleIds.filter((rid) => principalManageRoleIds.has(rid));
      if (keptManage.length === 0) {
        setAction({
          status: "error",
          message:
            "You cannot remove your own last role that grants user.manage. Keep at least one such role, or have another administrator make this change.",
        });
        return;
      }
    }
    setAction({ status: "submitting", draft });
    const r = await updateUser(view.id, {
      fullName: draft.fullName.trim(),
      email: draft.email.trim(),
      status: draft.status,
      roleIds: draft.roleIds,
    });
    handleMutationResult(r, "edit");
  };

  const doDeactivate = () => runStatusChange("INACTIVE");
  const doReactivate = () => runStatusChange("ACTIVE");

  const runStatusChange = async (status: UserStatus) => {
    if (!view) return;
    setAction({ status: "busy" });
    const r = await updateUser(view.id, { status });
    handleMutationResult(r, "status");
  };

  const doReset = async () => {
    if (!view) return;
    setAction({ status: "busy" });
    const r = await resetPasswordRequired(view.id);
    handleMutationResult(r, "reset");
  };

  const doDelete = async () => {
    if (!view) return;
    setAction({ status: "busy" });
    const r = await deleteUser(view.id);
    if (r.kind === "ok") {
      router.replace("/admin/users");
      return;
    }
    handleMutationResult(r, "delete");
  };

  function handleMutationResult(
    r: { kind: string; message?: string | string[] },
    op: "edit" | "status" | "reset" | "delete",
  ) {
    if (r.kind === "ok") {
      setAction({ status: "idle" });
      setReloadTick((n) => n + 1);
      return;
    }
    if (r.kind === "forbidden") {
      setAction({ status: "error", message: "You do not have permission to manage users." });
    } else if (r.kind === "not_found") {
      setAction({
        status: "error",
        message: "This user no longer exists (may have been deleted by another administrator).",
      });
    } else if (r.kind === "conflict") {
      setAction({
        status: "error",
        message: typeof r.message === "string" ? r.message : "That change conflicts with an existing user.",
      });
    } else if (r.kind === "validation") {
      setAction({
        status: "error",
        message: typeof r.message === "string" ? r.message : (r.message ?? []).join("; "),
      });
    } else if (r.kind === "network_error") {
      const verb =
        op === "edit" ? "Editing" : op === "delete" ? "Deletion" : op === "reset" ? "Resetting the password" : "Status changes";
      setAction({ status: "error", message: `Network error. ${verb} requires a live connection.` });
    } else {
      setAction({ status: "error", message: "Unexpected response from the server." });
    }
  }

  const resolveActor = (actorId: string | null): React.ReactNode => {
    if (!actorId) return <span className="text-[var(--color-ink-400)]">--</span>;
    const name = actorNames[actorId];
    return name ? (
      <span>{name}</span>
    ) : (
      <span className="font-mono text-[11.5px] break-all" title={actorId}>
        {actorId}
      </span>
    );
  };

  if (!canRead) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to user administration (requires user.read).
      </div>
    );
  }
  if (errMsg) {
    return (
      <div className="max-w-[820px] mx-auto py-10">
        <div className="px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">User not found</h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-3">
            No user matches <span className="font-mono text-[var(--color-navy-700)]">{id}</span>.
          </p>
          <Link
            href="/admin/users"
            className="inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to users
          </Link>
        </div>
      </div>
    );
  }
  if (!view && offlineEmpty) {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This user will load once you are back online. Users already cached appear from the local mirror." />
      </div>
    );
  }
  if (!view) {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading user...</div>;
  }

  const showStatusActions = canManage && !isSelf;
  const editing = action.status === "editing" || action.status === "submitting";

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
          <Link href="/admin/users" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Admin
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <Link href="/admin/users" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Users
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <span className="text-[var(--color-ink-900)] font-medium">{view.fullName}</span>
        </div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
                {view.fullName}
              </h1>
              <UserStatusPill status={view.status} />
              {view.mustResetPassword && (
                <span
                  title="The user must set a new password on next login."
                  className="inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] whitespace-nowrap"
                >
                  Reset pending
                </span>
              )}
              {isSelf && (
                <span className="inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] bg-[var(--color-navy-100)] text-[var(--color-navy-700)] whitespace-nowrap">
                  You
                </span>
              )}
              {fromMirror && <FreshnessBadge />}
            </div>
            <div className="text-[12px] text-[var(--color-ink-500)] mt-1 font-mono break-all">{view.id}</div>
          </div>

          {canManage && action.status === "idle" && (
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={beginEdit}
                disabled={offline}
                data-testid="edit-button"
                className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium disabled:opacity-50"
              >
                Edit
              </button>
              {showStatusActions && view.status === "ACTIVE" && (
                <button
                  type="button"
                  onClick={() => setAction({ status: "confirmDeactivate" })}
                  disabled={offline}
                  data-testid="deactivate-button"
                  className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium disabled:opacity-50"
                >
                  Deactivate
                </button>
              )}
              {showStatusActions && view.status === "INACTIVE" && (
                <button
                  type="button"
                  onClick={() => setAction({ status: "confirmReactivate" })}
                  disabled={offline}
                  data-testid="reactivate-button"
                  className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium disabled:opacity-50"
                >
                  Reactivate
                </button>
              )}
              {showStatusActions && (
                <button
                  type="button"
                  onClick={() => setAction({ status: "confirmReset" })}
                  disabled={offline}
                  data-testid="reset-password-button"
                  className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium disabled:opacity-50"
                >
                  Reset password
                </button>
              )}
              {showStatusActions && (
                <button
                  type="button"
                  onClick={() => setAction({ status: "confirmDelete" })}
                  disabled={offline}
                  data-testid="delete-button"
                  className="h-[32px] px-3 rounded-[3px] border border-[var(--color-danger-700)] bg-white text-[var(--color-danger-700)] text-[12.5px] font-medium disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
        {offline && canManage && (
          <div className="mt-2 text-[11.5px] text-[var(--color-warning-700)]">
            Management actions require a live connection. They are disabled while you are offline.
          </div>
        )}
        {isSelf && canManage && (
          <div className="mt-2 text-[11.5px] text-[var(--color-ink-500)]">
            This is your own account. Deactivate, reset-password, and delete are hidden to prevent
            you from locking yourself out; you can still edit your profile.
          </div>
        )}
      </header>

      {action.status === "error" && (
        <div
          role="alert"
          data-testid="action-error"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)] flex items-start justify-between gap-3"
        >
          <span>{action.message}</span>
          <button
            type="button"
            onClick={() => setAction({ status: "idle" })}
            className="shrink-0 text-[11.5px] underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {action.status === "confirmDeactivate" && (
        <ConfirmPanel
          testId="confirm-deactivate"
          title="Deactivate this user?"
          body="This user will no longer be able to sign in. Their historical actions in the audit log remain attributable."
          confirmLabel="Deactivate"
          confirmTestId="deactivate-confirm"
          tone="default"
          onConfirm={doDeactivate}
          onCancel={() => setAction({ status: "idle" })}
        />
      )}
      {action.status === "confirmReactivate" && (
        <ConfirmPanel
          testId="confirm-reactivate"
          title="Reactivate this user?"
          body="This user will be able to sign in again with their existing credentials."
          confirmLabel="Reactivate"
          confirmTestId="reactivate-confirm"
          tone="default"
          onConfirm={doReactivate}
          onCancel={() => setAction({ status: "idle" })}
        />
      )}
      {action.status === "confirmReset" && (
        <ConfirmPanel
          testId="confirm-reset"
          title="Require a password reset?"
          body="The user will be required to log in with the default password and set a new one. Use this if they forgot their credentials or the credentials may be compromised."
          confirmLabel="Require reset"
          confirmTestId="reset-confirm"
          tone="default"
          onConfirm={doReset}
          onCancel={() => setAction({ status: "idle" })}
        />
      )}
      {action.status === "confirmDelete" && (
        <ConfirmPanel
          testId="confirm-delete"
          title="Delete this user?"
          body="The user is soft-deleted: their record is marked deleted and they can no longer sign in or appear in the directory. Their historical actions in the audit log remain attributable, and nothing they touched is removed. This is not reversible from the UI."
          confirmLabel="Confirm delete"
          confirmTestId="delete-confirm"
          tone="danger"
          onConfirm={doDelete}
          onCancel={() => setAction({ status: "idle" })}
        />
      )}

      {editing && (
        <EditForm
          state={action as { status: "editing"; draft: EditDraft } | { status: "submitting"; draft: EditDraft }}
          roleOptions={roleOptions}
          lockedManageRoleIds={isSelf ? principalManageRoleIds : new Set()}
          onChange={(draft) =>
            action.status === "editing" ? setAction({ status: "editing", draft }) : null
          }
          onSave={saveEdit}
          onCancel={() => setAction({ status: "idle" })}
        />
      )}

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
        <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Profile</h2>
        </header>
        <dl className="text-[12.5px] grid grid-cols-1 sm:grid-cols-2 gap-x-12 px-4 sm:px-5 py-3">
          <Row label="Full name">{view.fullName}</Row>
          <Row label="Email">
            <a href={`mailto:${view.email}`} className="text-[var(--color-navy-700)] hover:underline break-all">
              {view.email}
            </a>
          </Row>
          <Row label="Status">
            <UserStatusPill status={view.status} />
          </Row>
          <Row label="Roles">
            {view.roleNames.length === 0 ? (
              <span className="text-[var(--color-ink-400)]">No roles assigned</span>
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {view.roleNames.map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    data-testid="role-chip"
                    className="inline-flex items-center h-[20px] px-2 rounded-full bg-[var(--color-ink-100)] text-[var(--color-ink-700)] text-[11.5px]"
                  >
                    {name}
                  </span>
                ))}
              </span>
            )}
          </Row>
          <Row label="Created">{formatDateTime(view.createdAt)}</Row>
          <Row label="Created by">{resolveActor(view.createdById)}</Row>
          <Row label="Last login">
            {view.lastLoginAt ? (
              formatDateTime(view.lastLoginAt)
            ) : (
              <span className="text-[var(--color-ink-400)]">Never signed in</span>
            )}
          </Row>
          {view.status === "INACTIVE" && (
            <>
              <Row label="Deactivated">
                {view.deactivatedAt ? (
                  formatDateTime(view.deactivatedAt)
                ) : (
                  <span className="text-[var(--color-ink-400)]">--</span>
                )}
              </Row>
              <Row label="Deactivated by">{resolveActor(view.deactivatedById)}</Row>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}

function EditForm({
  state,
  roleOptions,
  lockedManageRoleIds,
  onChange,
  onSave,
  onCancel,
}: {
  state: { status: "editing"; draft: EditDraft } | { status: "submitting"; draft: EditDraft };
  roleOptions: RoleOption[];
  lockedManageRoleIds: Set<string>;
  onChange: (draft: EditDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const draft = state.draft;
  const submitting = state.status === "submitting";

  const toggleRole = (rid: string) => {
    const has = draft.roleIds.includes(rid);
    // Self-guard at the control level: block de-selecting a role the principal
    // relies on for user.manage when it would be their last such role.
    if (has && lockedManageRoleIds.has(rid)) {
      const otherManageKept = draft.roleIds.filter(
        (x) => x !== rid && lockedManageRoleIds.has(x),
      );
      if (otherManageKept.length === 0) return; // refuse to remove the last one
    }
    onChange({
      ...draft,
      roleIds: has ? draft.roleIds.filter((x) => x !== rid) : [...draft.roleIds, rid],
    });
  };

  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5 px-4 sm:px-5 py-4">
      <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] mb-3">Edit user</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <Field label="Full name">
          <input
            type="text"
            value={draft.fullName}
            onChange={(e) => onChange({ ...draft, fullName: e.target.value })}
            disabled={submitting}
            data-testid="edit-fullname"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={draft.email}
            onChange={(e) => onChange({ ...draft, email: e.target.value })}
            disabled={submitting}
            data-testid="edit-email"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </Field>
        <Field label="Status">
          <select
            value={draft.status}
            onChange={(e) => onChange({ ...draft, status: e.target.value as UserStatus })}
            disabled={submitting}
            data-testid="edit-status"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-col gap-1.5 mb-3">
        <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
          Roles
        </span>
        {roleOptions.length === 0 ? (
          <span className="text-[12px] text-[var(--color-ink-500)]">Loading roles...</span>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto border border-[var(--color-border-default)] rounded-[3px] px-2 py-2">
            {roleOptions.map((role) => {
              const checked = draft.roleIds.includes(role.id);
              const otherManageKept = draft.roleIds.filter(
                (x) => x !== role.id && lockedManageRoleIds.has(x),
              );
              const locked =
                checked && lockedManageRoleIds.has(role.id) && otherManageKept.length === 0;
              return (
                <label
                  key={role.id}
                  className="flex items-center gap-2 text-[12.5px] text-[var(--color-ink-900)]"
                  title={locked ? "You cannot remove your own last role that grants user.manage." : undefined}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRole(role.id)}
                    disabled={submitting || locked}
                    data-testid={`edit-role-${role.id}`}
                  />
                  <span className={locked ? "text-[var(--color-ink-500)]" : ""}>{role.name}</span>
                  {role.grantsUserManage && (
                    <span className="text-[10px] uppercase tracking-[0.04em] text-[var(--color-navy-700)]">
                      manages users
                    </span>
                  )}
                  {locked && (
                    <span className="text-[10px] uppercase tracking-[0.04em] text-[var(--color-warning-700)]">
                      required
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={submitting || !draft.fullName.trim() || !draft.email.trim()}
          data-testid="edit-save"
          className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)]"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function ConfirmPanel({
  testId,
  title,
  body,
  confirmLabel,
  confirmTestId,
  tone,
  onConfirm,
  onCancel,
}: {
  testId: string;
  title: string;
  body: string;
  confirmLabel: string;
  confirmTestId: string;
  tone: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const danger = tone === "danger";
  return (
    <div
      role="dialog"
      data-testid={testId}
      className={`mb-4 px-4 py-3 rounded-[4px] border-2 ${danger ? "border-[var(--color-danger-700)] bg-[var(--color-danger-50)]" : "border-[var(--color-navy-700)] bg-[var(--color-navy-50)]"}`}
    >
      <div className={`text-[13px] font-semibold mb-1 ${danger ? "text-[var(--color-danger-700)]" : "text-[var(--color-navy-700)]"}`}>
        {title}
      </div>
      <div className="text-[12.5px] text-[var(--color-ink-900)] mb-3">{body}</div>
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={onConfirm}
          data-testid={confirmTestId}
          className={`h-[32px] px-4 rounded-[3px] text-white text-[12.5px] font-medium ${danger ? "bg-[var(--color-danger-700)]" : "bg-[var(--color-navy-700)]"}`}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={`${DETAIL_GRID} gap-1 sm:gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0`}>
      <dt className="text-[12px] font-medium text-[var(--color-ink-500)]">{label}</dt>
      <dd className="m-0 text-[var(--color-ink-900)] break-words min-w-0">{children}</dd>
    </div>
  );
}
