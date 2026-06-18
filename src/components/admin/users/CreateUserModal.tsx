"use client";

/**
 * Create-user overlay. The first true use of the Modal overlay primitive.
 *
 * Fields: fullName, email, role multiselect. There is intentionally NO
 * password field anywhere: the backend assigns the configured default
 * password and sets mustResetPassword=true, so the password value is never
 * known to (or shown by) this UI.
 *
 * Submit is online-only (disabled offline) because createUser is a write.
 * On success the parent is told via onSuccess (it closes the modal and
 * refreshes the list) and is handed the created user so it can raise the
 * post-creation notification with the user's name.
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import { createUser, listRoles, type Role, type UserDetail } from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";
import { listByType } from "@/lib/sync/mirror/store";

type RoleOption = { id: string; name: string };

/** Mirror "role" bucket body shape (id + name; permissions carried as keys). */
type MirrorRole = { id: string; name: string; deletedAt?: string | null };

export default function CreateUserModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (created: UserDetail) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";

  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Reset the form each time the modal opens so a re-open is always clean.
  useEffect(() => {
    if (!open) return;
    setFullName("");
    setEmail("");
    setRoleIds([]);
    setSubmitting(false);
    setError("");
  }, [open]);

  // Role options: paint from the mirror role bucket, then revalidate from the
  // network so descriptions/freshness land. The multiselect only needs id+name.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listByType<MirrorRole>("role");
        if (cancelled) return;
        const opts = rows
          .map((r) => r.body)
          .filter((r) => r.deletedAt == null)
          .map<RoleOption>((r) => ({ id: r.id, name: r.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (opts.length > 0) setRoleOptions(opts);
      } catch {
        // network revalidate drives
      }
      const r = await listRoles();
      if (cancelled) return;
      if (r.kind === "ok") {
        setRoleOptions(
          [...r.data]
            .filter((role: Role) => role.deletedAt == null)
            .map((role) => ({ id: role.id, name: role.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const canSubmit = useMemo(
    () => fullName.trim().length > 0 && email.trim().length > 0 && !offline && !submitting,
    [fullName, email, offline, submitting],
  );

  const toggleRole = (id: string) => {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const r = await createUser({
      fullName: fullName.trim(),
      email: email.trim(),
      roleIds,
    });
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    setSubmitting(false);
    if (r.kind === "forbidden") {
      setError("You do not have permission to create users (requires user.manage).");
    } else if (r.kind === "conflict") {
      setError(r.message || "A user with that email already exists.");
    } else if (r.kind === "validation") {
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "network_error") {
      setError("Network error. Creating a user requires a live connection.");
    } else {
      setError("Unexpected response from the server.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create user"
      testId="create-user-modal"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="create-user-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            {submitting ? "Creating..." : "Create user"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] w-full sm:w-auto order-2 sm:order-1"
          >
            Cancel
          </button>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Creating a user requires a live connection. Reconnect to continue.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="create-user-error"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
          >
            {error}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Full name
          </span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={submitting}
            data-testid="create-user-fullname"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Email
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            data-testid="create-user-email"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Roles
          </span>
          {roleOptions.length === 0 ? (
            <span className="text-[12px] text-[var(--color-ink-500)]">Loading roles...</span>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-[180px] overflow-y-auto border border-[var(--color-border-default)] rounded-[3px] px-2 py-2">
              {roleOptions.map((role) => (
                <label
                  key={role.id}
                  className="flex items-center gap-2 text-[12.5px] text-[var(--color-ink-900)]"
                >
                  <input
                    type="checkbox"
                    checked={roleIds.includes(role.id)}
                    onChange={() => toggleRole(role.id)}
                    disabled={submitting}
                    data-testid={`create-user-role-${role.id}`}
                  />
                  {role.name}
                </label>
              ))}
            </div>
          )}
          <span className="text-[11.5px] text-[var(--color-ink-500)]">
            The new user receives the configured default password and must set their own on
            first login. No password is set here.
          </span>
        </div>
      </form>
    </Modal>
  );
}
