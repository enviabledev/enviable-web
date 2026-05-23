/**
 * Shared formatting utility. Single source of truth for currency, counts,
 * and dates so every screen renders consistently. Add new formatters here,
 * never inline toLocaleString or new Intl.* in pages.
 */

const NGN_CURRENCY = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

const NGN_HEADLINE_BILLIONS = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const INTEGER = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });

const DATE_SHORT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATETIME_FULL = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const REL_TIME = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

/**
 * Format an NGN amount. Accepts a string (Prisma Decimal serialization),
 * number, null, or undefined; returns an empty string for null/undefined/
 * non-finite so callers can render `--` themselves when nothing should show.
 */
export function formatNGN(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "";
  return NGN_CURRENCY.format(n);
}

/**
 * Same as formatNGN but expresses very large numbers with up to 2 decimal
 * places (for headline KPI values where a tail of digits is informative,
 * e.g. ₦5.96B reads better than ₦5,960,000,000 when squeezed into a card).
 * Falls back to whole-Naira formatting under 100M.
 */
export function formatNGNCompact(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "";
  if (n >= 1_000_000_000) {
    return `${NGN_HEADLINE_BILLIONS.format(n / 1_000_000_000).replace("NGN", "₦")}B`;
  }
  if (n >= 1_000_000) {
    return `${NGN_HEADLINE_BILLIONS.format(n / 1_000_000).replace("NGN", "₦")}M`;
  }
  return NGN_CURRENCY.format(n);
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return INTEGER.format(n);
}

export function formatDateShort(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return DATE_SHORT.format(d);
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return DATETIME_FULL.format(d);
}

export function relativeTime(iso: string | Date | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = d.getTime() - nowMs;
  const absH = Math.abs(diffMs) / (1000 * 60 * 60);
  if (absH < 1) return REL_TIME.format(Math.round(diffMs / (1000 * 60)), "minute");
  if (absH < 24) return REL_TIME.format(Math.round(diffMs / (1000 * 60 * 60)), "hour");
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (Math.abs(days) < 7) return REL_TIME.format(days, "day");
  return REL_TIME.format(Math.round(days / 7), "week");
}
