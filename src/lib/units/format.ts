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
      if (part === "ckd" || part === "cbu" || part === "skd") return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

/**
 * Consistent mobile shorthand for unit statuses, so a units table's Tier 1
 * (identity + status + primary metric) fits at 375px. Same input always maps
 * to the same output; the detail page shows the full status. Fixed map, not
 * computed. Mirrors the status-pill shorthand rule in RESPONSIVE.md.
 */
const SHORT_UNIT_STATUS: Record<UnitStatus, string> = {
  IN_TRANSIT: "Transit",
  IN_WAREHOUSE_CKD: "WH CKD",
  IN_ASSEMBLY: "Assembly",
  IN_WAREHOUSE_SKD: "WH SKD",
  IN_WAREHOUSE_CBU: "WH CBU",
  SOLD_AS_CKD: "Sold CKD",
  SOLD_AS_CBU: "Sold CBU",
  DAMAGED: "Damaged",
  IN_REPAIR: "Repair",
  DEMO: "Demo",
  INTERNAL_USE: "Internal",
  TRANSFERRED: "Transfer",
  RETURNED: "Returned",
  WRITTEN_OFF: "Written",
};

/**
 * Shorthand for a UnitStatus; tolerant of arbitrary strings (StockMovement
 * from/to states are typed String). Unknown values fall back to the compact
 * full label so nothing renders blank.
 */
export function shortUnitStatus(status: string): string {
  return SHORT_UNIT_STATUS[status as UnitStatus] ?? formatUnitStatus(status);
}

export type PillTone = "navy" | "amber" | "success" | "danger" | "grey" | "teal";

export function toneOfUnitStatus(status: UnitStatus): PillTone {
  switch (status) {
    case "IN_WAREHOUSE_CKD":
    case "IN_WAREHOUSE_CBU":
    case "DEMO":
    case "INTERNAL_USE":
      return "navy";
    // SKD gets a distinct cool teal so a semi-knocked-down 3-wheeler reads
    // clearly apart from a fully-built CBU (navy) at a glance.
    case "IN_WAREHOUSE_SKD":
      return "teal";
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
  if (status === "IN_WAREHOUSE_SKD") return "teal";
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

/**
 * Consistent mobile shorthand for movement types so a movements table's Tier 1
 * fits at 375px. Movement types are event categories, not a state machine, but
 * the same fixed-map shorthand pattern applies (RESPONSIVE.md). Unknown values
 * fall back to the full label.
 */
const SHORT_MOVEMENT_TYPE: Record<string, string> = {
  RECEIPT: "Receipt",
  ASSEMBLY_START: "Start",
  ASSEMBLY_COMPLETE: "Complete",
  SALE: "Sale",
  RETURN: "Return",
  DAMAGE: "Damage",
  WRITE_OFF: "Write-off",
  DEMO: "Demo",
  INTERNAL_USE: "Internal",
  TRANSFER: "Transfer",
  REPAIR_IN: "Repair In",
  REPAIR_OUT: "Repair Out",
  RESTOCK_FROM_REPAIR: "Restock",
  ADJUSTMENT: "Adjust",
};

export function shortMovementType(t: string): string {
  return SHORT_MOVEMENT_TYPE[t] ?? formatMovementType(t);
}
