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

-- 7. Sales-side fixture cleanup. Sales orders created during the SO flow
--    verification carry lines that reference the test customer and units;
--    remove the lines first (FK to SO + unit), then the SOs, then the
--    customer. The customer's tier reference doesn't need touching (tiers
--    are seed data, not fixture data).
--
--    Prompt 7 adds downstream artifacts that hang off the SOs: invoices,
--    payments, release authorisations, delivery notes, waybills, and proofs
--    of delivery. Remove each in FK-safe order before deleting the SOs.
--    StockMovements with referenceType=SALES_ORDER (the SALE movements
--    written by authorise-release) are deletable via the units chain since
--    they're not audit_log_entries (which are append-only).
WITH test_sos AS (
  SELECT id FROM sales_orders WHERE "customerId" = 'fixt-customer-test'
),
test_delivery_notes AS (
  SELECT id FROM delivery_notes WHERE "salesOrderId" IN (SELECT id FROM test_sos)
)
DELETE FROM proofs_of_delivery
WHERE "deliveryNoteId" IN (SELECT id FROM test_delivery_notes);

DELETE FROM waybills
WHERE "deliveryNoteId" IN
  (SELECT id FROM delivery_notes WHERE "salesOrderId" IN
    (SELECT id FROM sales_orders WHERE "customerId" = 'fixt-customer-test'));

DELETE FROM delivery_notes
WHERE "salesOrderId" IN
  (SELECT id FROM sales_orders WHERE "customerId" = 'fixt-customer-test');

DELETE FROM release_authorisations
WHERE "salesOrderId" IN
  (SELECT id FROM sales_orders WHERE "customerId" = 'fixt-customer-test');

DELETE FROM payments
WHERE "salesOrderId" IN
  (SELECT id FROM sales_orders WHERE "customerId" = 'fixt-customer-test');

DELETE FROM invoices
WHERE "salesOrderId" IN
  (SELECT id FROM sales_orders WHERE "customerId" = 'fixt-customer-test');

-- The SALE stock movements written by authorise-release. The units chain
-- via shipmentId still works for the unit-and-movement cleanup further down,
-- but the test SO's units may carry SALE movements that survive that chain
-- if the unit was somehow detached; defensive cleanup by SO reference.
DELETE FROM stock_movements
WHERE "referenceType" = 'SALES_ORDER'
  AND "referenceId" IN (SELECT id FROM sales_orders WHERE "customerId" = 'fixt-customer-test');

DELETE FROM sales_order_lines
WHERE "salesOrderId" IN (SELECT id FROM sales_orders WHERE "customerId" = 'fixt-customer-test');
DELETE FROM sales_orders WHERE "customerId" = 'fixt-customer-test';
DELETE FROM customers WHERE id = 'fixt-customer-test';

-- 8. Throwaway users: SOFT-DELETE only. We cannot hard-delete a user that
--    has acted (audit_log_entries reference them as actor; the append-only
--    trigger on audit_log_entries blocks the cascade UPDATE that would
--    null those references on DELETE). Soft-delete sets deletedAt; the
--    auth flow filters those out so the user can't log in, and re-applying
--    setup-fixtures.sql clears deletedAt back to NULL on the same id. Also
--    detach the user_roles so re-applying setup creates a fresh role link.
DELETE FROM user_roles
WHERE "userId" IN ('fixt-user-costblind', 'fixt-user-salesofficer', 'fixt-user-confirmer');
UPDATE users
SET "deletedAt" = NOW(), "updatedAt" = NOW()
WHERE id IN ('fixt-user-costblind', 'fixt-user-salesofficer', 'fixt-user-confirmer')
  AND "deletedAt" IS NULL;

COMMIT;

-- Confirmation (should all be 0 after teardown).
SELECT
  (SELECT COUNT(*) FROM units WHERE "shipmentId" IN ('fixt-ship-test','fixt-ship-receive-test'))  AS leftover_units,
  (SELECT COUNT(*) FROM shipments WHERE id IN ('fixt-ship-test','fixt-ship-receive-test'))        AS leftover_shipments,
  (SELECT COUNT(*) FROM purchase_orders WHERE id IN ('fixt-po-test','fixt-po-receive-test'))     AS leftover_pos,
  (SELECT COUNT(*) FROM manifest_lines WHERE "shipmentId" = 'fixt-ship-receive-test')             AS leftover_manifest,
  (SELECT COUNT(*) FROM spare_parts WHERE id LIKE 'fixt-sp-%')                                    AS leftover_sp,
  (SELECT COUNT(*) FROM customers WHERE id = 'fixt-customer-test')                                AS leftover_customer,
  (SELECT COUNT(*) FROM sales_orders WHERE "customerId" = 'fixt-customer-test')                   AS leftover_sos,
  -- Throwaway users are soft-deleted (audit references block hard delete);
  -- count only active ones. The soft-deleted rows are intentional carcasses.
  (SELECT COUNT(*) FROM users
   WHERE id IN ('fixt-user-costblind','fixt-user-salesofficer','fixt-user-confirmer')
   AND "deletedAt" IS NULL)                                                                       AS leftover_active_throwaway_users;
