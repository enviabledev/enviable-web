"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

/**
 * App shell. At lg+ the sidebar is a persistent 212px rail (unchanged desktop
 * layout). Below lg it collapses to an off-canvas drawer toggled by the
 * topbar hamburger, so mobile and tablet reclaim the full content width
 * (without this, content is squeezed to viewport - 212px). The drawer closes
 * on navigate, on scrim tap, and on Escape.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever the route changes (covers nav-link taps and any
  // programmatic navigation).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape to close + lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen">
      {/* Persistent rail at lg+ */}
      <Sidebar className="hidden lg:flex sticky top-0 self-start" />

      {/* Off-canvas drawer below lg. Kept mounted and slid off-screen so the
          transition runs both ways; pointer events disabled while closed. */}
      <div
        className={`fixed inset-0 z-40 lg:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!drawerOpen}
      >
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          role="dialog"
          aria-modal={drawerOpen}
          aria-label="Navigation"
          data-testid="nav-drawer"
          className={`absolute inset-y-0 left-0 transition-transform duration-200 ease-out ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar className="flex" onNavigate={() => setDrawerOpen(false)} />
        </div>
      </div>

      <main className="flex-1 flex flex-col min-w-0">
        <Topbar onMenuClick={() => setDrawerOpen(true)} />
        <div className="flex-1 bg-[var(--color-surface-muted)] p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
