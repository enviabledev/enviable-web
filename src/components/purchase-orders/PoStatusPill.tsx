import type { PoStatus } from "@/lib/api";

const TONE_MAP: Record<PoStatus, "navy" | "amber" | "success" | "danger" | "grey"> = {
  DRAFT: "grey",
  PENDING_APPROVAL: "amber",
  APPROVED: "success",
  SENT_TO_SUPPLIER: "navy",
  PI_RECEIVED: "navy",
  AWAITING_SHIPMENT: "navy",
  PARTIALLY_RECEIVED: "amber",
  FULLY_RECEIVED: "success",
  CLOSED: "grey",
  CANCELLED: "danger",
};

const TONE_CLASSES: Record<
  "navy" | "amber" | "success" | "danger" | "grey",
  { bg: string; fg: string; dot: string }
> = {
  navy: {
    bg: "bg-[var(--color-navy-100)]",
    fg: "text-[var(--color-navy-800)]",
    dot: "bg-[var(--color-navy-700)]",
  },
  amber: {
    bg: "bg-[var(--color-warning-50)]",
    fg: "text-[var(--color-warning-700)]",
    dot: "bg-[var(--color-warning-700)]",
  },
  success: {
    bg: "bg-[var(--color-success-50)]",
    fg: "text-[var(--color-success-700)]",
    dot: "bg-[var(--color-success-700)]",
  },
  danger: {
    bg: "bg-[var(--color-danger-50)]",
    fg: "text-[var(--color-danger-700)]",
    dot: "bg-[var(--color-danger-700)]",
  },
  grey: {
    bg: "bg-[var(--color-ink-100)]",
    fg: "text-[var(--color-ink-700)]",
    dot: "bg-[var(--color-ink-500)]",
  },
};

/**
 * Compact label: PENDING_APPROVAL -> PendingApproval, FULLY_RECEIVED -> FullyReceived
 * (matches the handoff's enum-PascalCase convention).
 */
export function formatPoStatus(status: PoStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

// Fixed mobile shorthand (RESPONSIVE.md status-pill rule): same input -> same
// output, full label at sm+. PO statuses are long, so shorthand keeps the
// primary metric (Total) in view at 375.
const SHORT_LABEL: Record<PoStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending",
  APPROVED: "Approved",
  SENT_TO_SUPPLIER: "Sent",
  PI_RECEIVED: "PI Recd",
  AWAITING_SHIPMENT: "Awaiting",
  PARTIALLY_RECEIVED: "Partial",
  FULLY_RECEIVED: "Received",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export function shortPoStatus(status: PoStatus): string {
  return SHORT_LABEL[status];
}

export default function PoStatusPill({ status }: { status: PoStatus }) {
  const tone = TONE_MAP[status];
  const c = TONE_CLASSES[tone];
  return (
    <span
      title={formatPoStatus(status)}
      className={`inline-flex items-center gap-1 h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap ${c.bg} ${c.fg}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${c.dot}`} aria-hidden />
      <span className="sm:hidden">{shortPoStatus(status)}</span>
      <span className="hidden sm:inline">{formatPoStatus(status)}</span>
    </span>
  );
}
