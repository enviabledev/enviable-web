"use client";

import { useState, type FormEvent } from "react";

import PasswordField from "@/components/ui/PasswordField";
import { useAuth, usePrincipal } from "@/lib/auth";
import { DETAIL_GRID } from "@/lib/responsive";

/**
 * Self-service account page. Every authenticated user can view their own
 * identity (name, email, roles) and change their own password here, without
 * admin involvement. Roles are read-only (assignment is an admin action).
 *
 * View data comes from the in-memory principal (always available, no extra
 * permission needed). Change-password uses POST /api/auth/reset-password (the
 * same authenticated endpoint the forced-reset screen uses), which takes the
 * current + new password and works for any logged-in user.
 */
const MIN_LENGTH = 8;

export default function ProfilePage() {
  const principal = usePrincipal();
  const { resetPassword } = useAuth();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!principal) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        Loading your account...
      </div>
    );
  }

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setDone(false);

    if (next.length < MIN_LENGTH) {
      setError(`Your new password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("The new password and confirmation do not match.");
      return;
    }
    if (next === current) {
      setError("Your new password must be different from the current one.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await resetPassword({ currentPassword: current, newPassword: next });
      if (result.ok) {
        setDone(true);
        setCurrent("");
        setNext("");
        setConfirm("");
      } else if (result.status === 400 || result.status === 401) {
        setError(result.message || "Could not change the password. Check your current password and try again.");
      } else if (result.unreachable) {
        setError("Can't reach the server right now. Check your connection and try again.");
      } else {
        setError(result.message || `Unexpected response (${result.status}). Try again.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error contacting the server.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <header className="pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Your account</div>
        <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
          {principal.fullName}
        </h1>
        <div className="text-[13px] text-[var(--color-ink-500)] mt-1">{principal.email}</div>
      </header>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
        <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Profile</h2>
        </header>
        <div className="px-4 sm:px-5 py-3 text-[13px]">
          <Row label="Full name">
            <span className="text-[var(--color-ink-900)] font-medium">{principal.fullName}</span>
          </Row>
          <Row label="Email">
            <span className="text-[var(--color-ink-900)] break-all">{principal.email}</span>
          </Row>
          <Row label="Roles">
            <span className="text-[var(--color-ink-900)]">
              {principal.roles.length > 0 ? principal.roles.join(", ") : "--"}
            </span>
          </Row>
        </div>
        <div className="px-4 sm:px-5 pb-3 text-[11.5px] text-[var(--color-ink-500)]">
          Your roles are managed by an administrator and cannot be changed here.
        </div>
      </section>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
        <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Change password</h2>
        </header>
        <form onSubmit={onSubmit} noValidate className="px-4 sm:px-5 py-4 max-w-[360px]">
          <label className="block mb-3">
            <span className="block text-[11px] font-medium text-[var(--color-ink-700)] mb-1">
              Current password
            </span>
            <PasswordField
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              required
              testId="profile-current-password"
            />
          </label>
          <label className="block mb-3">
            <span className="block text-[11px] font-medium text-[var(--color-ink-700)] mb-1">
              New password
            </span>
            <PasswordField
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              required
              testId="profile-new-password"
            />
            <span className="block text-[10.5px] text-[var(--color-ink-500)] mt-1">
              At least {MIN_LENGTH} characters, different from your current one.
            </span>
          </label>
          <label className="block mb-4">
            <span className="block text-[11px] font-medium text-[var(--color-ink-700)] mb-1">
              Confirm new password
            </span>
            <PasswordField
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              required
              testId="profile-confirm-password"
            />
          </label>

          {error && (
            <div
              role="alert"
              data-testid="profile-password-error"
              className="mb-3 px-2.5 py-1.5 rounded-[3px] text-[12px] border"
              style={{
                background: "var(--color-danger-50)",
                borderColor: "var(--color-danger-100)",
                color: "var(--color-danger-700)",
              }}
            >
              {error}
            </div>
          )}
          {done && (
            <div
              role="status"
              data-testid="profile-password-success"
              className="mb-3 px-2.5 py-1.5 rounded-[3px] text-[12px] border"
              style={{
                background: "var(--color-success-50)",
                borderColor: "var(--color-success-100)",
                color: "var(--color-success-700)",
              }}
            >
              Password updated. Your next sign-in will use the new password.
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            data-testid="profile-password-submit"
            className="h-8 px-4 w-full sm:w-auto rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center justify-center"
            style={{ background: "var(--color-navy-700)" }}
          >
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={`${DETAIL_GRID} gap-1 sm:gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0`}>
      <span className="text-[12px] font-medium text-[var(--color-ink-500)]">{label}</span>
      <span>{children}</span>
    </div>
  );
}
