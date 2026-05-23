"use client";

import type { ReactNode } from "react";

import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <div className="flex-1 bg-[var(--color-surface-muted)] p-6">{children}</div>
      </main>
    </div>
  );
}
