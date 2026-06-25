import type { UnitStatus } from "@/lib/api";

/**
 * Client mirror of the backend IT-admin adjustment map
 * (enviable-system src/units/adjustment-map.ts). Convenience only: it drives
 * which target statuses the Adjust modal offers from a given current status, the
 * same role-aware-UI pattern as permission gating. The backend remains the
 * enforcer: it re-checks the transition is legal per the state machine (409) and
 * is an adjustment rather than a workflow edge (400), so a stale entry here can
 * at worst offer an action the API then rejects, never bypass a rule.
 *
 * Deliberately NOT included (not adjustments; they belong to other flows, and
 * the backend 400s them): assembly (-> IN_ASSEMBLY / IN_WAREHOUSE_CBU), sale
 * (-> SOLD_*), customer return (SOLD_* -> RETURNED -> *), and transfer
 * (-> TRANSFERRED, a deferred multi-warehouse feature with no adjustment entry
 * yet). Keep this table identical to the backend map; if the backend gains a
 * transfer or other edge, mirror it here in the same change.
 */
export const UNIT_ADJUSTMENT_TARGETS: Partial<Record<UnitStatus, UnitStatus[]>> = {
  IN_TRANSIT: ["DAMAGED"],
  IN_WAREHOUSE_CKD: ["DAMAGED", "DEMO", "INTERNAL_USE", "WRITTEN_OFF"],
  // SKD (46a) mirrors CBU's adjustment edges exactly (a semi-knocked-down
  // 3-wheeler diverts as a CBU unit does). Sale and the SKD -> CBU upgrade are
  // workflow paths, not adjustments, so they are deliberately absent here.
  IN_WAREHOUSE_SKD: ["DAMAGED", "DEMO", "INTERNAL_USE", "IN_REPAIR", "WRITTEN_OFF"],
  IN_WAREHOUSE_CBU: ["DAMAGED", "DEMO", "INTERNAL_USE", "IN_REPAIR", "WRITTEN_OFF"],
  DAMAGED: ["IN_REPAIR", "WRITTEN_OFF"],
  IN_REPAIR: ["IN_WAREHOUSE_CKD", "IN_WAREHOUSE_SKD", "IN_WAREHOUSE_CBU", "WRITTEN_OFF"],
  DEMO: ["IN_WAREHOUSE_CKD", "IN_WAREHOUSE_SKD", "IN_WAREHOUSE_CBU", "INTERNAL_USE", "WRITTEN_OFF"],
  INTERNAL_USE: ["IN_WAREHOUSE_CKD", "IN_WAREHOUSE_SKD", "IN_WAREHOUSE_CBU", "WRITTEN_OFF"],
};

export function adjustmentTargets(status: UnitStatus): UnitStatus[] {
  return UNIT_ADJUSTMENT_TARGETS[status] ?? [];
}

export function canAdjustFrom(status: UnitStatus): boolean {
  return adjustmentTargets(status).length > 0;
}

/**
 * Plain-language consequence of moving a unit into a target status, shown in the
 * Adjust modal so the operator commits with eyes open. Keyed on the TARGET, not
 * the pair, because the consequence is a property of the destination state.
 */
export function adjustmentConsequence(toStatus: UnitStatus): string {
  switch (toStatus) {
    case "WRITTEN_OFF":
      return "The unit is written off. This is terminal: it cannot be sold, repaired, or adjusted again.";
    case "DAMAGED":
      return "The unit is marked damaged and removed from sellable stock. It can later be sent to repair or written off.";
    case "IN_REPAIR":
      return "The unit goes into repair and is unavailable for sale until it is restocked.";
    case "DEMO":
      return "The unit is moved to demo use and is unavailable for sale until it is returned to stock.";
    case "INTERNAL_USE":
      return "The unit is moved to internal use and is unavailable for sale until it is returned to stock.";
    case "IN_WAREHOUSE_CKD":
      return "The unit returns to sellable warehouse stock as a CKD kit.";
    case "IN_WAREHOUSE_SKD":
      return "The unit returns to sellable warehouse stock as a semi-knocked-down (SKD) 3-wheeler.";
    case "IN_WAREHOUSE_CBU":
      return "The unit returns to sellable warehouse stock as an assembled (CBU) unit.";
    default:
      return "The unit's lifecycle state will change.";
  }
}
