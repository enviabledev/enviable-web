import type { UnitListVariant, UnitStatus } from "@/lib/api";

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

const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

export function formatNGN(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "";
  return NGN.format(n);
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const REL_FMT = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

export function relativeTime(iso: string, nowMs = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = d.getTime() - nowMs;
  const absH = Math.abs(diffMs) / (1000 * 60 * 60);
  if (absH < 1) {
    const minutes = Math.round(diffMs / (1000 * 60));
    return REL_FMT.format(minutes, "minute");
  }
  if (absH < 24) {
    return REL_FMT.format(Math.round(diffMs / (1000 * 60 * 60)), "hour");
  }
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (Math.abs(days) < 7) return REL_FMT.format(days, "day");
  return REL_FMT.format(Math.round(days / 7), "week");
}

/**
 * Formats a movement type enum into a short, human-readable label.
 * e.g. ASSEMBLY_START -> "Assembly start"
 */
export function formatMovementType(t: string): string {
  return t
    .toLowerCase()
    .split("_")
    .map((part, idx) => (idx === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}
