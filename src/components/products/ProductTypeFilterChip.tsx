"use client";

import { PRODUCT_TYPE, productTypeLabel, type ProductType } from "@/lib/api";

/**
 * Small "All / 2-wheeler / 3-wheeler" segmented filter chip (prompt 45) for the
 * variant pickers that are NOT type-constrained (PO lines, price-list entries):
 * Enviable can order or price both types, so the chip is a convenience filter,
 * not an enforcement. Controlled: the parent holds the value and filters its
 * option list.
 */
export default function ProductTypeFilterChip({
  value,
  onChange,
  testId = "product-type-filter-chip",
}: {
  value: ProductType | "ALL";
  onChange: (next: ProductType | "ALL") => void;
  testId?: string;
}) {
  const opts: { v: ProductType | "ALL"; label: string }[] = [
    { v: "ALL", label: "All types" },
    ...PRODUCT_TYPE.map((t) => ({ v: t, label: productTypeLabel(t) })),
  ];
  return (
    <div
      className="inline-flex border border-[var(--color-border-strong)] rounded-[3px] h-[26px] overflow-hidden"
      data-testid={testId}
      role="group"
      aria-label="Filter by product type"
    >
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          data-testid={`${testId}-${o.v}`}
          className={`px-2.5 text-[11.5px] font-medium border-l first:border-l-0 border-[var(--color-border-default)] ${
            value === o.v
              ? "bg-[var(--color-navy-700)] text-white"
              : "bg-white text-[var(--color-ink-700)] hover:bg-[var(--color-ink-100)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
