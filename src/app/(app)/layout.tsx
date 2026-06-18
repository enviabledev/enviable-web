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
    } else if (mustReset) {
      // Forced-password-reset gate: a must-reset user cannot reach any (app)
      // route. The reset screen lives in the (public) group so this redirect
      // never loops. Backend independently 403s protected requests.
      router.replace("/auth/reset-password");
    }
  }, [state.status, mustReset, router]);

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

  if (state.status === "authenticated" && !mustReset) {
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
