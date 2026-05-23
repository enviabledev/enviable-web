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

-- 5. Cost-blind user (user_roles cascades via onDelete: Cascade on userId).
DELETE FROM users WHERE id = 'fixt-user-costblind';

COMMIT;

-- Confirmation (should all be 0 after teardown).
SELECT
  (SELECT COUNT(*) FROM units WHERE "shipmentId" = 'fixt-ship-test')          AS leftover_units,
  (SELECT COUNT(*) FROM shipments WHERE id = 'fixt-ship-test')                AS leftover_shipment,
  (SELECT COUNT(*) FROM purchase_orders WHERE id = 'fixt-po-test')            AS leftover_po,
  (SELECT COUNT(*) FROM users WHERE id = 'fixt-user-costblind')               AS leftover_user;
