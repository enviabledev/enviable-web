import type { UnitStatus } from "@/lib/api";
import {
  formatUnitStatus,
  shortUnitStatus,
  toneOfUnitStatus,
  type PillTone,
} from "@/lib/units/format";

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
  // Cool teal for SKD (semi knocked down), distinct from CBU's navy.
  teal: {
    bg: "bg-[#E0F2F4]",
    fg: "text-[#0E6F7A]",
    dot: "bg-[#0E9AAA]",
  },
};

export default function StatusPill({ status }: { status: UnitStatus }) {
  const tone = toneOfUnitStatus(status);
  const c = TONE_CLASSES[tone];
  return (
    <span
      title={formatUnitStatus(status)}
      className={`inline-flex items-center gap-1 h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap ${c.bg} ${c.fg}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${c.dot}`} aria-hidden />
      {/* Shorthand on mobile so the primary metric stays in view; full label at sm+. */}
      <span className="sm:hidden">{shortUnitStatus(status)}</span>
      <span className="hidden sm:inline">{formatUnitStatus(status)}</span>
    </span>
  );
}
