import type { SparePartStatus } from "@/lib/api";

/**
 * Spare-part status pill. Matches the inline styling the spare-parts list/detail
 * used before this was extracted (success-tinted ACTIVE, grey DISCONTINUED) and
 * adds the mobile-shorthand pattern from RESPONSIVE.md: short label at < sm so
 * the row's Tier 1 (SKU + quantity + status) fits at 375px, full label at sm+,
 * full value on title. Fixed map, not computed.
 */
const FULL_LABEL: Record<SparePartStatus, string> = {
  ACTIVE: "Active",
  DISCONTINUED: "Discontinued",
};

const SHORT_LABEL: Record<SparePartStatus, string> = {
  ACTIVE: "Active",
  DISCONTINUED: "Disc.",
};

export default function SparePartStatusPill({ status }: { status: SparePartStatus }) {
  const tone =
    status === "ACTIVE"
      ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
      : "bg-[var(--color-ink-100)] text-[var(--color-ink-700)]";
  return (
    <span
      title={FULL_LABEL[status]}
      className={`inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap ${tone}`}
    >
      <span className="sm:hidden">{SHORT_LABEL[status]}</span>
      <span className="hidden sm:inline">{FULL_LABEL[status]}</span>
    </span>
  );
}
