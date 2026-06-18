import type { ProductStatus } from "@/lib/api";

/**
 * Product-variant status pill (prompt 33-B). Matches the UserStatusPill visual
 * conventions (h-[18px] px-2 rounded-full text-[10.5px] uppercase):
 * success-tinted for ACTIVE, grey for DISCONTINUED (the deactivated state).
 *
 * "Discontinued" is long, so it carries a mobile shorthand ("Disc.") that the
 * full label restores at sm+, mirroring the truncation rule in RESPONSIVE.md.
 * The title is always the full word so the shorthand is never ambiguous.
 */
const FULL_LABEL: Record<ProductStatus, string> = {
  ACTIVE: "Active",
  DISCONTINUED: "Discontinued",
};

const SHORT_LABEL: Record<ProductStatus, string> = {
  ACTIVE: "Active",
  DISCONTINUED: "Disc.",
};

export default function VariantStatusPill({ status }: { status: ProductStatus }) {
  const tone =
    status === "ACTIVE"
      ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
      : "bg-[var(--color-ink-100)] text-[var(--color-ink-700)]";
  return (
    <span
      title={FULL_LABEL[status]}
      data-testid="variant-status-pill"
      className={`inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap ${tone}`}
    >
      <span className="sm:hidden">{SHORT_LABEL[status]}</span>
      <span className="hidden sm:inline">{FULL_LABEL[status]}</span>
    </span>
  );
}
