import type { ProductType } from "@/lib/products/product-type";
import { productTypeLabel, productTypeShort } from "@/lib/products/product-type";

/**
 * Wheeler-type indicator (prompt 45). A neutral navy-tinted pill (the type is a
 * classification, not a status), with a fixed mobile shorthand (2W / 3W) and the
 * full label at sm+, matching the status-pill shorthand convention. Renders a
 * muted dash placeholder when the type is unknown (e.g. a units row whose type
 * has not reconstructed yet).
 */
export default function ProductTypePill({
  type,
  className = "",
}: {
  type: ProductType | null | undefined;
  className?: string;
}) {
  if (!type) {
    return <span className={`text-[var(--color-ink-400)] ${className}`}>--</span>;
  }
  return (
    <span
      title={productTypeLabel(type)}
      data-testid={`product-type-pill-${type}`}
      className={`inline-flex items-center h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap bg-[var(--color-navy-100)] text-[var(--color-navy-800)] ${className}`}
    >
      <span className="sm:hidden">{productTypeShort(type)}</span>
      <span className="hidden sm:inline">{productTypeLabel(type)}</span>
    </span>
  );
}
