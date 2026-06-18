import Link from "next/link";

/**
 * Forgot-password (informational). Pre-email-infrastructure, the honest path
 * back in is an admin reset: the user contacts their administrator, who resets
 * the password to the configured default and communicates it; the user then
 * logs in and is forced to set a new password. When email infrastructure lands,
 * this page upgrades to an email-entry form that sends a one-time reset link
 * (self-service); the route stays the same.
 */
export default function ForgotPasswordPage() {
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
          <h1 className="text-[14px] font-semibold text-[var(--color-ink-900)] mb-2">
            Forgot your password?
          </h1>
          <p className="text-[12.5px] text-[var(--color-ink-700)] leading-[1.55] m-0 mb-3">
            Please contact your administrator to reset your password. They will
            reset it to a temporary password and pass it on to you. When you next
            sign in with that temporary password, you will be asked to set a new
            password of your own.
          </p>
          <p className="text-[11.5px] text-[var(--color-ink-500)] leading-[1.5] m-0 mb-4">
            Self-service email reset is not enabled on this deployment yet.
          </p>
          <Link
            href="/login"
            data-testid="forgot-back-to-login"
            className="inline-flex items-center justify-center w-full h-7 px-2.5 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to sign in
          </Link>
        </div>

        <p className="mt-3 text-center text-[10.5px] text-[var(--color-ink-500)]">
          Enviable Tricycle Auto Parts Ltd. &middot; Internal system
        </p>
      </div>
    </div>
  );
}
