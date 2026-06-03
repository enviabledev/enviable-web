"use client";

/**
 * Card explaining that a surface is intentionally not yet built (distinct
 * from access-denied: the user MAY have the permission, but the underlying
 * backend endpoints don't exist yet). Used for /admin/users and /admin/roles
 * until the backend round implements the user/role management module.
 *
 * Shape mirrors the access-denied card so the rendering feels consistent
 * with the rest of the app's gating treatment, but the copy distinguishes
 * the cause (deferred capability vs missing permission). The framing is
 * specific about why ("backend endpoints not yet implemented; current
 * workflow uses seed + set-password script") rather than generic ("coming
 * soon"), so a stakeholder reading the page understands what they're
 * looking at when they reach the decision point on whether to fund the
 * backend work.
 *
 * Tone: amber (warning), not red (danger). The screen is not erroring out;
 * the capability is acknowledged-but-deferred. Amber signals "this is
 * known and intentional" rather than "this is broken."
 */
import type { ReactNode } from "react";

export default function NotYetBuiltCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="max-w-[720px] mx-auto py-12" data-testid="not-yet-built">
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8">
        <header className="flex items-center gap-2 mb-3">
          {icon}
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
            {title}
          </h1>
        </header>
        <div
          className="px-3.5 py-2.5 rounded-[3px] border mb-4 text-[12px] text-[var(--color-ink-900)] leading-[1.5]"
          style={{
            background: "var(--color-warning-100)",
            borderColor: "var(--color-warning-700)",
          }}
        >
          <span className="font-semibold" style={{ color: "var(--color-warning-700)" }}>
            Not yet available in the app.
          </span>{" "}
          The backend endpoints for this area have not been implemented. This is a known
          deferred capability tracked for stakeholder decision.
        </div>
        <div className="text-[13px] text-[var(--color-ink-700)] leading-[1.55] [&_p]:m-0 [&_p+p]:mt-3 [&_code]:font-mono [&_code]:text-[12px] [&_code]:px-1 [&_code]:py-[1px] [&_code]:rounded-[2px] [&_code]:bg-[var(--color-ink-100)]">
          {children}
        </div>
      </div>
    </div>
  );
}
