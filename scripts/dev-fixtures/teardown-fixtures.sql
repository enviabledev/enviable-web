-- Dev fixtures teardown. FK-safe order: movements, units, shipment, PO,
-- user-role, user. Idempotent; missing rows are no-ops.
--
-- Audit log entries written by the application layer are intentionally NOT
-- touched. The audit_log_entries table is DB-level append-only. Since this
-- fixture writes directly to the operational tables (not via the audited
-- service endpoints), there should be no audit entries to leave behind, but
-- if any exist, they correctly stay.

BEGIN;

-- 1. Movements on the fixture's units.
DELETE FROM stock_movements
WHERE "unitId" IN (SELECT id FROM units WHERE "shipmentId" = 'fixt-ship-test');

-- 2. Units on the fixture shipment.
DELETE FROM units WHERE "shipmentId" = 'fixt-ship-test';

-- 3. Shipment.
DELETE FROM shipments WHERE id = 'fixt-ship-test';

-- 4. Purchase order.
DELETE FROM purchase_orders WHERE id = 'fixt-po-test';

-- 5. Spare parts (no FK dependents since spare_part_movements would cascade
--    via referential delete; teardown also covers any movements written
--    against fixture parts, though direct fixture inserts produce none).
DELETE FROM spare_part_movements
WHERE "sparePartId" IN ('fixt-sp-001', 'fixt-sp-002', 'fixt-sp-003');
DELETE FROM spare_parts
WHERE id IN ('fixt-sp-001', 'fixt-sp-002', 'fixt-sp-003');

-- 6. Receive-test shipment teardown. The clerk's verification of the
--    receive flow may have created real units (with their RECEIPT movements)
--    on this shipment; remove them first, then the manifest lines, then
--    the shipment, then its PO. The fixture's own manifest_lines are
--    deleted by the cascade from the shipment delete.
DELETE FROM stock_movements
WHERE "unitId" IN (SELECT id FROM units WHERE "shipmentId" = 'fixt-ship-receive-test');
DELETE FROM units WHERE "shipmentId" = 'fixt-ship-receive-test';
DELETE FROM manifest_lines WHERE "shipmentId" = 'fixt-ship-receive-test';
DELETE FROM shipments WHERE id = 'fixt-ship-receive-test';
DELETE FROM purchase_orders WHERE id = 'fixt-po-receive-test';

-- 7. Cost-blind user (user_roles cascades via onDelete: Cascade on userId).
DELETE FROM users WHERE id = 'fixt-user-costblind';

COMMIT;

-- Confirmation (should all be 0 after teardown).
SELECT
  (SELECT COUNT(*) FROM units WHERE "shipmentId" IN ('fixt-ship-test','fixt-ship-receive-test'))  AS leftover_units,
  (SELECT COUNT(*) FROM shipments WHERE id IN ('fixt-ship-test','fixt-ship-receive-test'))        AS leftover_shipments,
  (SELECT COUNT(*) FROM purchase_orders WHERE id IN ('fixt-po-test','fixt-po-receive-test'))     AS leftover_pos,
  (SELECT COUNT(*) FROM manifest_lines WHERE "shipmentId" = 'fixt-ship-receive-test')             AS leftover_manifest,
  (SELECT COUNT(*) FROM spare_parts WHERE id LIKE 'fixt-sp-%')                                    AS leftover_sp,
  (SELECT COUNT(*) FROM users WHERE id = 'fixt-user-costblind')                                   AS leftover_user;
