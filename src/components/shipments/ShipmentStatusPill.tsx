import type { ShipmentStatus } from "@/lib/api";

const TONE_MAP: Record<ShipmentStatus, "navy" | "amber" | "success" | "danger" | "grey"> = {
  IN_TRANSIT: "grey",
  AT_PORT: "navy",
  CLEARING: "amber",
  CLEARED: "navy",
  RECEIVED: "success",
  CLOSED: "grey",
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

export function formatShipmentStatus(status: ShipmentStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

export default function ShipmentStatusPill({ status }: { status: ShipmentStatus }) {
  const tone = TONE_MAP[status];
  const c = TONE_CLASSES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap ${c.bg} ${c.fg}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${c.dot}`} aria-hidden />
      {formatShipmentStatus(status)}
    </span>
  );
}
