"use client";

import { usePrincipal } from "@/lib/auth";

export default function DashboardPlaceholder() {
  const principal = usePrincipal();
  if (!principal) return null;

  return (
    <div className="max-w-[920px] mx-auto">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-page font-semibold text-[var(--color-ink-900)]">Dashboard</h1>
        <span className="text-small text-[var(--color-ink-500)]">
          Welcome,&nbsp;
          <span className="text-[var(--color-ink-900)]">{principal.fullName.split(" ")[0]}</span>
        </span>
      </div>

      <div className="rounded-[3px] border border-[var(--color-border-default)] bg-white">
        <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-3.5 py-2.5">
          <h2 className="text-section font-semibold text-[var(--color-ink-900)] m-0">
            Authentication and shell wired
          </h2>
          <span className="text-thead-caps">scaffold</span>
        </div>
        <div className="px-3.5 py-3 text-body">
          <p className="text-[var(--color-ink-700)]">
            You are signed in as{" "}
            <span className="text-mono-id text-[var(--color-navy-700)]">{principal.email}</span>{" "}
            with role&nbsp;
            <span className="font-medium text-[var(--color-ink-900)]">
              {principal.roles.join(", ") || "(none)"}
            </span>
            . The sidebar shows the navigation your permissions allow; real screens replace this
            placeholder in subsequent prompts.
          </p>
          <p className="mt-2 text-small text-[var(--color-ink-500)]">
            Permissions granted to this principal: {principal.permissions.length}
          </p>
        </div>
      </div>
    </div>
  );
}
