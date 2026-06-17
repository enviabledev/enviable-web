"use client";

/**
 * Shared overlay modal primitive. Responsive and design-system-correct:
 * centered card, full-width minus a 16px gutter on mobile (`w-full` inside a
 * `p-4` overlay), capped at 520px on larger screens, `max-h-[90vh]` with
 * internal scroll so a tall body never pushes off-screen. Radius stays 4px per
 * the density rules (no consumer-SaaS sheet radii).
 *
 * Closes on scrim click and Escape; locks body scroll while open. Use this for
 * any true overlay modal (the app otherwise prefers inline confirmation panels
 * that flow with the page). Compose with `title` / `footer` for the standard
 * header + action-row shape, or pass arbitrary children.
 */
import { useEffect, type ReactNode } from "react";

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidthClass = "max-w-[520px]",
  testId,
  closeOnScrim = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClass?: string;
  testId?: string;
  closeOnScrim?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      data-testid={testId}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={closeOnScrim ? onClose : undefined}
        aria-hidden
      />
      <div
        className={`relative bg-white border border-[var(--color-border-default)] rounded-[4px] w-full ${maxWidthClass} max-h-[90vh] overflow-y-auto shadow-[0_8px_28px_rgba(15,42,68,0.18)]`}
      >
        {title !== undefined && (
          <div className="px-5 pt-4 pb-2">
            <h3 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)]">
              {title}
            </h3>
          </div>
        )}
        <div className={title !== undefined ? "px-5 pb-4" : "p-5"}>{children}</div>
        {footer !== undefined && (
          <div className="px-5 py-3 border-t border-[var(--color-border-default)] flex items-center justify-end gap-2 flex-wrap">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
