import type { AssemblyJobStatus } from "@/lib/api";
import type { PillTone } from "@/lib/units/format";

const TONE_CLASSES: Record<PillTone, { bg: string; fg: string; dot: string }> = {
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
  // Present for PillTone completeness; assembly job statuses do not use teal.
  teal: {
    bg: "bg-[#E0F2F4]",
    fg: "text-[#0E6F7A]",
    dot: "bg-[#0E9AAA]",
  },
};

// CANCELLED is grey, not danger: a cancel is a clean, intact reversal back to
// CKD, not a failure (FAILED, red, marks the unit Damaged). Keeping the two
// tones distinct lets the pill carry that semantic difference at a glance.
const STATUS_TONE: Record<AssemblyJobStatus, PillTone> = {
  IN_PROGRESS: "amber",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "grey",
};

const STATUS_LABEL: Record<AssemblyJobStatus, string> = {
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

// Fixed mobile shorthand (RESPONSIVE.md): same input -> same output, full label at sm+.
const SHORT_LABEL: Record<AssemblyJobStatus, string> = {
  IN_PROGRESS: "Active",
  COMPLETED: "Done",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export default function AssemblyStatusPill({ status }: { status: AssemblyJobStatus }) {
  const c = TONE_CLASSES[STATUS_TONE[status]];
  return (
    <span
      title={STATUS_LABEL[status]}
      className={`inline-flex items-center gap-1 h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap ${c.bg} ${c.fg}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${c.dot}`} aria-hidden />
      {/* Shorthand on mobile so the primary metric stays in view; full label at sm+. */}
      <span className="sm:hidden">{SHORT_LABEL[status]}</span>
      <span className="hidden sm:inline">{STATUS_LABEL[status]}</span>
    </span>
  );
}
