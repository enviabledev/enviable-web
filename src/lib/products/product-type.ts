/**
 * ProductType (prompt 45). The wheeler classification on every ProductVariant,
 * required by the backend. An SO is single-type: its type is lines[0]'s variant
 * type, and a mismatched line is rejected with a 409.
 *
 * Operational language note: the user-facing labels are "2-wheeler" / "3-wheeler"
 * (Theresa's language). The backend enum is TWO_WHEELER / THREE_WHEELER. There is
 * NO SKD-vs-CBU distinction in the system: both wheeler types complete assembly
 * to IN_WAREHOUSE_CBU (45a audit finding), so the assembly UI is type-agnostic.
 */
export const PRODUCT_TYPE = ["TWO_WHEELER", "THREE_WHEELER"] as const;
export type ProductType = (typeof PRODUCT_TYPE)[number];

const LABEL: Record<ProductType, string> = {
  TWO_WHEELER: "2-wheeler",
  THREE_WHEELER: "3-wheeler",
};

const SHORT: Record<ProductType, string> = {
  TWO_WHEELER: "2W",
  THREE_WHEELER: "3W",
};

export function productTypeLabel(t: ProductType | null | undefined): string {
  return t ? LABEL[t] : "--";
}

export function productTypeShort(t: ProductType | null | undefined): string {
  return t ? SHORT[t] : "--";
}

export function isProductType(v: unknown): v is ProductType {
  return v === "TWO_WHEELER" || v === "THREE_WHEELER";
}
