"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/lib/auth";

/**
 * Forced password reset. A newly-created user logs in with the admin-set
 * default password and is gated here (principal.mustResetPassword === true)
 * until they set their own. Lives in the (public) group so the (app) layout's
 * must-reset redirect never loops. The user still holds a valid session cookie,
 * so POST /api/auth/reset-password is authenticated; on success the backend
 * returns a refreshed principal with the flag cleared and normal app routing
 * resumes.
 */
const MIN_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const { state, resetPassword } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Route guards. Anonymous users have no session to reset; users who are not
  // (or no longer) flagged must-reset should not sit on this screen.
  useEffect(() => {
    if (state.status === "anonymous") {
      router.replace("/login");
    } else if (state.status === "authenticated" && state.principal.mustResetPassword !== true) {
      router.replace("/");
    }
  }, [state, router]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (newPassword.length < MIN_LENGTH) {
      setError(`Your new password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirm) {
      setError("The new password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Your new password must be different from the current one.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await resetPassword({ currentPassword, newPassword });
      if (result.ok) {
        // Principal refreshed with mustResetPassword cleared; resume the app.
        router.replace("/");
      } else if (result.status === 400 || result.status === 401) {
        setError(result.message || "Could not reset the password. Check the current password and try again.");
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

  // While auth resolves or a guard redirect is in flight, render nothing
  // substantive (avoids flashing the form to an anonymous or already-reset user).
  const showForm = state.status === "authenticated" && state.principal.mustResetPassword === true;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-muted)] px-4">
      <div className="w-full max-w-[360px]">
        <div className="flex items-center gap-2.5 mb-6">
          <div
            aria-hidden
            className="w-7 h-7 rounded-[3px] grid place-items-center text-[12px] font-bold tracking-wider text-white"
            style={{ background: "linear-gradient(135deg, #2c5e8e, #5a82a8)" }}
          >
            EI
          </div>
          <div>
            <div className="text-[14px] font-semibold text-[var(--color-ink-900)] leading-tight">
              Enviable I&amp;O
            </div>
            <div className="text-[11px] text-[var(--color-ink-500)] leading-tight">
              Inventory &amp; Operations
            </div>
          </div>
        </div>

        <div className="bg-white border border-[var(--color-border-default)] rounded-[3px] p-5">
          <h1 className="text-[14px] font-semibold text-[var(--color-ink-900)] mb-1">
            Set a new password
          </h1>
          <p className="text-[11.5px] text-[var(--color-ink-500)] mb-5 leading-[1.5]">
            {showForm && state.principal.fullName ? (
              <>
                Welcome, {state.principal.fullName}. Before you continue, please replace the
                temporary password you were given with one only you know.
              </>
            ) : (
              <>Loading...</>
            )}
          </p>

          {showForm && (
            <form onSubmit={onSubmit} noValidate>
              <label className="block mb-3">
                <span className="block text-[11px] font-medium text-[var(--color-ink-700)] mb-1">
                  Current password
                </span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  data-testid="reset-current-password"
                  className="w-full h-7 px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)]"
                />
                <span className="block text-[10.5px] text-[var(--color-ink-500)] mt-1">
                  The temporary password your administrator gave you.
                </span>
              </label>

              <label className="block mb-3">
                <span className="block text-[11px] font-medium text-[var(--color-ink-700)] mb-1">
                  New password
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  data-testid="reset-new-password"
                  className="w-full h-7 px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)]"
                />
                <span className="block text-[10.5px] text-[var(--color-ink-500)] mt-1">
                  At least {MIN_LENGTH} characters, different from the temporary one.
                </span>
              </label>

              <label className="block mb-4">
                <span className="block text-[11px] font-medium text-[var(--color-ink-700)] mb-1">
                  Confirm new password
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  data-testid="reset-confirm-password"
                  className="w-full h-7 px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)]"
                />
              </label>

              {error && (
                <div
                  role="alert"
                  data-testid="reset-error"
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

              <button
                type="submit"
                disabled={submitting}
                data-testid="reset-submit"
                className="w-full h-7 px-2.5 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50"
                style={{ background: "var(--color-navy-700)" }}
              >
                {submitting ? "Setting password..." : "Set password and continue"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-3 text-center text-[10.5px] text-[var(--color-ink-500)]">
          Enviable Tricycle Auto Parts Ltd. &middot; Internal system
        </p>
      </div>
    </div>
  );
}
