import type { UserStatus } from "@/lib/api";

/**
 * User status pill. Matches the SparePartStatusPill visual conventions
 * (h-[18px] px-2 rounded-full text-[10.5px] uppercase): success-tinted for
 * ACTIVE, grey for INACTIVE. The labels ("Active" / "Inactive") are short
 * enough that no mobile shorthand is needed, but the pill carries
 * whitespace-nowrap + a title so it never wraps or truncates ambiguously.
 */
const FULL_LABEL: Record<UserStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

export default function UserStatusPill({ status }: { status: UserStatus }) {
  const tone =
    status === "ACTIVE"
      ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
      : "bg-[var(--color-ink-100)] text-[var(--color-ink-700)]";
  return (
    <span
      title={FULL_LABEL[status]}
      data-testid="user-status-pill"
      className={`inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap ${tone}`}
    >
      {FULL_LABEL[status]}
    </span>
  );
}
