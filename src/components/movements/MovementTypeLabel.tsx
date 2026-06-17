import { formatMovementType, shortMovementType } from "@/lib/units/format";

/**
 * Movement type rendered as a plain text label (the existing movements design
 * shows the type as text, not a coloured pill, so this stays a label rather
 * than introducing colour as part of the responsive pass). Applies the same
 * mobile-shorthand pattern as the status pills: a fixed shorthand at < sm so a
 * movements table's Tier 1 fits at 375px, the full label at sm+, full value on
 * title. Mirrors the status-pill shorthand rule in RESPONSIVE.md.
 *
 * Used for both unit movements (MovementType) and spare-part movements
 * (SparePartMovementType); shortMovementType covers the union and falls back to
 * the full label for any unmapped value.
 */
export default function MovementTypeLabel({ type }: { type: string }) {
  return (
    <span title={formatMovementType(type)} className="whitespace-nowrap">
      <span className="sm:hidden">{shortMovementType(type)}</span>
      <span className="hidden sm:inline">{formatMovementType(type)}</span>
    </span>
  );
}
