"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SignOutIcon } from "@/components/icons";
import { useAuth, usePrincipal } from "@/lib/auth";

function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function SidebarUser() {
  const principal = usePrincipal();
  const { logout } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  if (!principal) return null;

  const primaryRole = principal.roles[0] ?? "User";
  const initials = initialsOf(principal.fullName);

  const onSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="border-t border-white/[0.08] px-2.5 py-2 flex items-center gap-2 flex-shrink-0">
      <div
        aria-hidden
        className="w-[26px] h-[26px] rounded-full grid place-items-center text-[10px] font-semibold text-white border border-white/[0.08] flex-shrink-0"
        style={{ background: "var(--color-navy-600)" }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-[12px] font-medium text-white truncate">{principal.fullName}</div>
        <div className="text-[10px] text-[var(--color-sidebar-muted)] truncate">{primaryRole}</div>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[var(--color-sidebar-muted)] hover:text-white disabled:opacity-50"
        >
          <SignOutIcon width={10} height={10} />
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </div>
  );
}
