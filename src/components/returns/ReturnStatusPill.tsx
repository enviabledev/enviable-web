import type { ReturnStatus } from "@/lib/api";

const TONE_MAP: Record<ReturnStatus, "navy" | "amber" | "success"> = {
  INITIATED: "amber",
  INSPECTING: "navy",
  RESOLVED: "success",
};

const TONE_CLASSES: Record<
  "navy" | "amber" | "success",
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
};

export function formatReturnStatus(status: ReturnStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

// Mobile shorthand so Tier 1 fits at 375px; same input always maps to the same
// output. The full label shows at sm+.
const SHORT_LABEL: Record<ReturnStatus, string> = {
  INITIATED: "New",
  INSPECTING: "Inspect",
  RESOLVED: "Resolved",
};

export function shortReturnStatus(status: ReturnStatus): string {
  return SHORT_LABEL[status];
}

export default function ReturnStatusPill({ status }: { status: ReturnStatus }) {
  const c = TONE_CLASSES[TONE_MAP[status]];
  return (
    <span
      title={formatReturnStatus(status)}
      data-testid="return-status-pill"
      className={`inline-flex items-center gap-1 h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap ${c.bg} ${c.fg}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${c.dot}`} aria-hidden />
      <span className="sm:hidden">{shortReturnStatus(status)}</span>
      <span className="hidden sm:inline">{formatReturnStatus(status)}</span>
    </span>
  );
}
