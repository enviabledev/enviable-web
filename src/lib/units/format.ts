/**
 * Unit-specific formatters. Generic currency/date/count formatters live in
 * src/lib/format; this file is for transformations tied to the unit domain
 * (status labels, variant naming, semantic pill tones, movement labels).
 */

import type { UnitListVariant, UnitStatus } from "@/lib/api";

export {
  formatNGN,
  formatNGNCompact,
  formatCount,
  formatDateShort,
  formatDateTime,
  relativeTime,
} from "@/lib/format";

/**
 * Convert IN_WAREHOUSE_CKD into "InWarehouseCKD" (handoff's compact label).
 * Accepts arbitrary strings since the StockMovement fromState/toState columns
 * are typed as String in the schema (values typically mirror UnitStatus).
 */
export function formatUnitStatus(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => {
      if (part === "ckd" || part === "cbu") return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

export type PillTone = "navy" | "amber" | "success" | "danger" | "grey";

export function toneOfUnitStatus(status: UnitStatus): PillTone {
  switch (status) {
    case "IN_WAREHOUSE_CKD":
    case "IN_WAREHOUSE_CBU":
    case "DEMO":
    case "INTERNAL_USE":
      return "navy";
    case "IN_ASSEMBLY":
    case "IN_REPAIR":
    case "RETURNED":
      return "amber";
    case "SOLD_AS_CKD":
    case "SOLD_AS_CBU":
      return "success";
    case "DAMAGED":
    case "WRITTEN_OFF":
      return "danger";
    case "IN_TRANSIT":
    case "TRANSFERRED":
      return "grey";
  }
}

/**
 * Same as toneOfUnitStatus but tolerant of arbitrary strings (returns "grey"
 * for unknown values).
 */
export function toneOfMaybeStatus(status: string | null | undefined): PillTone {
  if (!status) return "grey";
  if ((["IN_WAREHOUSE_CKD", "IN_WAREHOUSE_CBU", "DEMO", "INTERNAL_USE"] as const).includes(
    status as never,
  )) return "navy";
  if ((["IN_ASSEMBLY", "IN_REPAIR", "RETURNED"] as const).includes(status as never)) return "amber";
  if ((["SOLD_AS_CKD", "SOLD_AS_CBU"] as const).includes(status as never)) return "success";
  if ((["DAMAGED", "WRITTEN_OFF"] as const).includes(status as never)) return "danger";
  return "grey";
}

export function formatVariantName(variant: UnitListVariant, productName?: string): string {
  const attrs = variant.variantAttributes;
  const parts = [productName, attrs.model, attrs.colour].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (parts.length > 0) return parts.join(" ");
  return variant.supplierSkuCode;
}

export function formatVariantAbbreviation(variant: UnitListVariant): string {
  const attrs = variant.variantAttributes;
  const parts: string[] = [];
  if (attrs.model) parts.push(attrs.model);
  if (attrs.colour) parts.push(attrs.colour);
  if (parts.length > 0) return parts.join(" · ");
  return variant.supplierSkuCode;
}

/**
 * Format MovementType enums into short labels, e.g. ASSEMBLY_START -> "Assembly start".
 */
export function formatMovementType(t: string): string {
  return t
    .toLowerCase()
    .split("_")
    .map((part, idx) => (idx === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}
