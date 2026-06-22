/**
 * Variant auto-create classification helpers (frontend mirror of the backend's
 * variant-auto-create contract, confirmed live 2026-06-22).
 *
 * Auto-created variants enter the catalogue through supply-side activity
 * (historical-load units upload, PO line creation). They point at a SENTINEL
 * product until an admin reclassifies them onto a real product. The sentinel
 * is seeded as `seed-product-pending-classification` ("Pending Classification")
 * with currentMarketPrice 0 and empty variantAttributes.
 *
 * CRITICAL: an auto-created ProductVariant row has NO createdById column. The
 * "who/when/how" of an auto-create lives ONLY in the audit log under action
 * `productvariant.autocreate`, context fields { triggeredBy, source,
 * sourceEntityId, sku, similarityChecked }. Any "created by" / source / date
 * display MUST read from the audit log, never from a column on the variant row.
 * See loadVariantAutoCreate() in lib/api/product-variants.ts.
 *
 * The sentinel id is hardcoded here intentionally: it is a stable seeded id
 * (not user data), and there is no config endpoint exposing it. If the backend
 * ever ships such an endpoint, swap this constant for a fetch in one place.
 */
export const SENTINEL_PRODUCT_ID = "seed-product-pending-classification";

/** Human label the sentinel product carries (matches the seeded name). */
export const PENDING_CLASSIFICATION_LABEL = "Pending Classification";

/** The supply-side flow that triggered an auto-create (audit `source`). */
export type AutoCreateSource =
  | "historical-load"
  | "po-line-create"
  | "shipment-receive";

/** A variant is pending classification when it still sits on the sentinel. */
export function isPendingClassification(productId: string | null | undefined): boolean {
  return productId === SENTINEL_PRODUCT_ID;
}

/** Readable label for an auto-create source, for callouts and the audit log. */
export function autoCreateSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "historical-load":
      return "a historical-data load";
    case "po-line-create":
      return "a purchase-order line";
    case "shipment-receive":
      return "a shipment receipt";
    default:
      return "a supply-side operation";
  }
}
