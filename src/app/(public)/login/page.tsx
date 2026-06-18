"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import PasswordField from "@/components/ui/PasswordField";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { state, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "authenticated") {
      // A must-reset user is sent straight to the reset screen (the primary
      // forced-reset branch; the (app) layout has a catch-all for boot/nav).
      router.replace(
        state.principal.mustResetPassword === true ? "/auth/reset-password" : "/",
      );
    }
  }, [state, router]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await login({ email: email.trim(), password });
      if (result.ok) {
        router.replace(
          result.principal.mustResetPassword === true ? "/auth/reset-password" : "/",
        );
      } else if (result.status === 401) {
        setError("Email or password is incorrect.");
      } else if (result.unreachable) {
        setError(
          "Can't reach the server right now. Check your connection and try again.",
        );
      } else {
        setError(`Unexpected response (${result.status}). Try again.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error contacting the server.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-muted)] px-4">
      <div className="w-full max-w-[360px]">
        <div className="flex flex-col items-center mb-6">
          <Image
            src="/brand/enviable-logo-full.png"
            alt="Enviable Tricycle Auto Parts Ltd"
            width={1500}
            height={496}
            priority
            className="w-[232px] h-auto"
          />
          <div className="mt-2 text-[11px] text-[var(--color-ink-500)] tracking-wide">
            Inventory &amp; Operations
          </div>
        </div>

        <div className="bg-white border border-[var(--color-border-default)] rounded-[3px] p-5">
          <h1 className="text-[14px] font-semibold text-[var(--color-ink-900)] mb-1">
            Sign in
          </h1>
          <p className="text-[11.5px] text-[var(--color-ink-500)] mb-5">
            Use your Enviable account.
          </p>

          <form onSubmit={onSubmit} noValidate>
            <label className="block mb-3">
              <span className="block text-[11px] font-medium text-[var(--color-ink-700)] mb-1">
                Email
              </span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-7 px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)]"
              />
            </label>

            <label className="block mb-1.5">
              <span className="block text-[11px] font-medium text-[var(--color-ink-700)] mb-1">
                Password
              </span>
              <PasswordField
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                required
                testId="login-password"
              />
            </label>

            <div className="mb-4 text-right">
              <Link
                href="/auth/forgot-password"
                data-testid="forgot-password-link"
                className="text-[11.5px] text-[var(--color-navy-700)] hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            {error && (
              <div
                role="alert"
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
              className="w-full h-7 px-2.5 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50"
              style={{ background: "var(--color-navy-700)" }}
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-3 text-center text-[10.5px] text-[var(--color-ink-500)]">
          Enviable Tricycle Auto Parts Ltd. &middot; Internal system
        </p>
      </div>
    </div>
  );
}
