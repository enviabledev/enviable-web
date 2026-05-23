"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/lib/auth";

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "anonymous") {
      router.replace("/login");
    }
  }, [state.status, router]);

  if (state.status === "authenticated") {
    return <AppShell>{children}</AppShell>;
  }

  // Loading and anonymous both render the empty shell chrome (sidebar bg +
  // empty topbar slot). No principal means Sidebar has no nav items and
  // SidebarUser renders null, so the user sees the visual frame paint
  // immediately and either content fills in (authenticated) or the effect
  // above redirects to /login (anonymous). This is the no-flash pattern: the
  // chrome appears, never an error message.
  return (
    <div className="flex min-h-screen">
      <aside className="w-sidebar h-screen flex-shrink-0 bg-[var(--color-sidebar-bg)] sticky top-0 self-start" />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-topbar bg-white border-b border-[var(--color-border-default)] sticky top-0 z-30" />
        <div className="flex-1 bg-[var(--color-surface-muted)]" />
      </main>
    </div>
  );
}
