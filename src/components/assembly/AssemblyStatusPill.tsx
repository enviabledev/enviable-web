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
};

const STATUS_TONE: Record<AssemblyJobStatus, PillTone> = {
  IN_PROGRESS: "amber",
  COMPLETED: "success",
  FAILED: "danger",
};

const STATUS_LABEL: Record<AssemblyJobStatus, string> = {
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export default function AssemblyStatusPill({ status }: { status: AssemblyJobStatus }) {
  const c = TONE_CLASSES[STATUS_TONE[status]];
  return (
    <span
      className={`inline-flex items-center gap-1 h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap ${c.bg} ${c.fg}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${c.dot}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
