"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/lib/auth";
import SyncBoot from "@/lib/sync/boot";
import { useConnectivity } from "@/lib/sync/connectivity";

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  const mustReset =
    state.status === "authenticated" && state.principal.mustResetPassword === true;

  useEffect(() => {
    if (state.status === "anonymous") {
      router.replace("/login");
    }
  }, [state.status, router]);

  // SyncBoot is mounted UNCONDITIONALLY, above the auth gate. Two reasons:
  //   1. The service worker should register as soon as the (app) tree loads,
  //      not wait for auth to resolve.
  //   2. The connectivity heartbeat needs to run before auth resolves so the
  //      loading-shell fallback can show "You're offline" when relevant
  //      instead of an empty navy column. With SyncBoot inside the auth gate
  //      the connectivity state stayed at "unknown" until login finished.
  // SyncBoot is side-effect only (renders null), so it's safe to mount before
  // auth. A drain attempted while anonymous returns 401, resets actions to
  // queued, and emits sessionExpired (which calls auth.refresh, no-ops if
  // already anonymous).

  // Forced-password-reset gate: a must-reset user cannot reach any (app) route.
  // Render a dedicated redirect component (its mount effect fires the
  // navigation once, reliably, without the dep-timing fragility of a shared
  // effect) plus a clear blocking message so the app content is never shown.
  // The reset screen lives in the (public) group so this never loops; the
  // backend independently 403s protected requests (defence in depth).
  if (mustReset) {
    return (
      <>
        <SyncBoot />
        <ForcedResetRedirect />
      </>
    );
  }

  if (state.status === "authenticated") {
    return (
      <>
        <SyncBoot />
        <AppShell>{children}</AppShell>
      </>
    );
  }

  return (
    <>
      <SyncBoot />
      <LoadingShellFallback />
    </>
  );
}

/**
 * Mounted only when the principal is must-reset. Its mount effect fires the
 * redirect to the reset screen once and reliably (a freshly-mounted component's
 * effect always runs, unlike a shared layout effect whose re-run depends on
 * dep-array transitions). Renders a clear blocking message so the app content
 * is never shown even if the navigation is briefly in flight, with a manual
 * link as the ultimate fallback. Satisfies the prompt's "redirect or blocking
 * treatment" requirement; the backend 403 gate is the independent backstop.
 */
function ForcedResetRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/auth/reset-password");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-muted)] px-4">
      <div className="max-w-[420px] text-center">
        <div className="text-[13px] font-semibold text-[var(--color-ink-900)] mb-1">
          Password reset required
        </div>
        <p className="text-[12.5px] text-[var(--color-ink-700)] leading-[1.55] m-0">
          You must set a new password before using the system. Taking you to the
          reset screen...{" "}
          <a href="/auth/reset-password" className="text-[var(--color-navy-700)] underline">
            Continue
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/**
 * Rendered while auth is still resolving (or while we're stuck on "loading"
 * because the backend is unreachable). Shows the chrome plus a
 * connectivity-aware notice so the user understands what's happening: empty
 * column on a fresh load = "Loading"; empty column while offline = "You're
 * offline, the app will load when the connection returns."
 */
function LoadingShellFallback() {
  const { state: connState } = useConnectivity();

  return (
    <div className="flex min-h-screen">
      <aside className="w-sidebar h-screen flex-shrink-0 bg-[var(--color-sidebar-bg)] sticky top-0 self-start" />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-topbar bg-white border-b border-[var(--color-border-default)] sticky top-0 z-30" />
        <div className="flex-1 bg-[var(--color-surface-muted)] p-6">
          {connState === "offline" && (
            <div className="max-w-[520px] mx-auto mt-16 px-3.5 py-3 rounded-[4px] bg-white border border-[var(--color-border-default)] text-[12.5px] text-[var(--color-ink-700)] leading-[1.55]">
              <div className="flex items-center gap-2 mb-1">
                <span
                  aria-hidden
                  className="w-[6px] h-[6px] rounded-full"
                  style={{ background: "var(--color-warning-700)" }}
                />
                <span className="font-semibold text-[var(--color-ink-900)]">
                  You&apos;re offline
                </span>
              </div>
              The app shell loaded from the service worker cache. Customer,
              order, and stock data will load when the connection returns.
              Any offline edits you queue are saved locally and sync
              automatically once reconnected.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
