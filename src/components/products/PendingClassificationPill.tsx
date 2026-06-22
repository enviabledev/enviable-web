/**
 * "Pending" pill for auto-created variants still on the sentinel product. Sits
 * alongside the VariantStatusPill so an auto-created variant reads as distinct
 * at a glance in lists and on the detail header. Amber-toned (a worklist needs
 * attention, not an error), matching the bulk-admin / needs-review register used
 * elsewhere. Short by design so it pairs cleanly with the status pill on mobile.
 */
export default function PendingClassificationPill() {
  return (
    <span
      title="Auto-created; pending classification. Needs a product and a price before it can be sold."
      data-testid="pending-classification-pill"
      className="inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap bg-[var(--color-warning-100)] text-[var(--color-warning-700)]"
    >
      Pending
    </span>
  );
}
