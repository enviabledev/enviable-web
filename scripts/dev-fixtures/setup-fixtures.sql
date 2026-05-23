-- Dev fixtures: operational rows for visual verification of the frontend list
-- and detail screens. Direct SQL into the dev database; bypasses the audited
-- service endpoints by design (see README.md). Idempotent; safe to re-run.

BEGIN;

-- =============================================================================
-- 1. PURCHASE ORDER (parent of the fixture shipment)
-- =============================================================================
INSERT INTO purchase_orders (
  id, "poNumber", "supplierId", status, currency, "totalValue",
  "createdAt", "updatedAt"
) VALUES (
  'fixt-po-test', 'PO-FIXTURE-TEST', 'seed-cp-tvs',
  'FULLY_RECEIVED', 'USD', 156000000.00,
  NOW() - INTERVAL '21 days', NOW() - INTERVAL '7 days'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2. SHIPMENT (one obviously-named fixture shipment, owns all 60 units)
-- =============================================================================
INSERT INTO shipments (
  id, "purchaseOrderId", "shipmentReference", status,
  "isHistoricalImport", "receivedAt",
  "createdAt", "updatedAt"
) VALUES (
  'fixt-ship-test', 'fixt-po-test', 'SHIP-FIXTURE-TEST', 'RECEIVED',
  false, NOW() - INTERVAL '7 days',
  NOW() - INTERVAL '14 days', NOW() - INTERVAL '7 days'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 3. UNITS (60 across 11 statuses, 3 variants, with plausible landed costs)
-- =============================================================================
-- Variant abbreviations:
--   GSY = seed-var-gs-gyellow (GS+ G Yellow, CKD)
--   GNB = seed-var-gs-nepblue (GS+ NEP Blue, CKD)
--   ZSG = seed-var-zs-gyellow (ZS+ G Yellow, CBU)
-- Landed costs: 2_400_000 NGN for CKD variants, 2_800_000 NGN for CBU.
INSERT INTO units (
  id, "shipmentId", "productVariantId", "engineNumber", "chassisNumber",
  status, "currentWarehouseId", "landedCost",
  "createdAt", "updatedAt"
) VALUES
  -- IN_REPAIR x 2 (fixt-u-001 is the 6-movement lifecycle unit; final state = IN_REPAIR)
  ('fixt-u-001', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0001', 'FIXT-GSC-0001', 'IN_REPAIR',         'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '14 days', NOW() - INTERVAL '1 day'),
  ('fixt-u-002', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0002', 'FIXT-GSC-0002', 'IN_REPAIR',         'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '12 days', NOW() - INTERVAL '2 days'),

  -- IN_WAREHOUSE_CKD x 22 (the typical resting state)
  ('fixt-u-003', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0003', 'FIXT-GSC-0003', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '7 days',  NOW() - INTERVAL '7 days'),
  ('fixt-u-004', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0004', 'FIXT-GSC-0004', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '7 days',  NOW() - INTERVAL '7 days'),
  ('fixt-u-005', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0005', 'FIXT-GSC-0005', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '7 days',  NOW() - INTERVAL '7 days'),
  ('fixt-u-006', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0006', 'FIXT-GSC-0006', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '7 days',  NOW() - INTERVAL '7 days'),
  ('fixt-u-007', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0007', 'FIXT-GSC-0007', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '7 days',  NOW() - INTERVAL '7 days'),
  ('fixt-u-008', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0008', 'FIXT-GSC-0008', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '6 days'),
  ('fixt-u-009', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0009', 'FIXT-GSC-0009', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '6 days'),
  ('fixt-u-010', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0010', 'FIXT-GSC-0010', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '6 days'),
  ('fixt-u-011', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0011', 'FIXT-GSC-0011', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '6 days'),
  ('fixt-u-012', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0012', 'FIXT-GSC-0012', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '6 days'),
  ('fixt-u-013', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0013', 'FIXT-GSC-0013', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '5 days',  NOW() - INTERVAL '5 days'),
  ('fixt-u-014', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0014', 'FIXT-GSC-0014', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '5 days',  NOW() - INTERVAL '5 days'),
  ('fixt-u-015', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0015', 'FIXT-GSC-0015', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '5 days',  NOW() - INTERVAL '5 days'),
  ('fixt-u-016', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0016', 'FIXT-GSC-0016', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '5 days',  NOW() - INTERVAL '5 days'),
  ('fixt-u-017', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0017', 'FIXT-GSC-0017', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '4 days',  NOW() - INTERVAL '4 days'),
  ('fixt-u-018', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0018', 'FIXT-GSC-0018', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '4 days',  NOW() - INTERVAL '4 days'),
  ('fixt-u-019', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0019', 'FIXT-GSC-0019', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '4 days',  NOW() - INTERVAL '4 days'),
  ('fixt-u-020', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0020', 'FIXT-GSC-0020', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '3 days',  NOW() - INTERVAL '3 days'),
  ('fixt-u-021', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0021', 'FIXT-GSC-0021', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '3 days',  NOW() - INTERVAL '3 days'),
  ('fixt-u-022', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0022', 'FIXT-GSC-0022', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '3 days',  NOW() - INTERVAL '3 days'),
  ('fixt-u-023', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0023', 'FIXT-GSC-0023', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '2 days',  NOW() - INTERVAL '2 days'),
  ('fixt-u-024', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0024', 'FIXT-GSC-0024', 'IN_WAREHOUSE_CKD',  'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '2 days',  NOW() - INTERVAL '2 days'),

  -- IN_WAREHOUSE_CBU x 10 (assembled, sitting in warehouse for sale)
  ('fixt-u-025', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0001', 'FIXT-ZSC-0001', 'IN_WAREHOUSE_CBU',  'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '12 days', NOW() - INTERVAL '5 days'),
  ('fixt-u-026', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0002', 'FIXT-ZSC-0002', 'IN_WAREHOUSE_CBU',  'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '12 days', NOW() - INTERVAL '5 days'),
  ('fixt-u-027', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0003', 'FIXT-ZSC-0003', 'IN_WAREHOUSE_CBU',  'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '12 days', NOW() - INTERVAL '5 days'),
  ('fixt-u-028', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0004', 'FIXT-ZSC-0004', 'IN_WAREHOUSE_CBU',  'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '11 days', NOW() - INTERVAL '4 days'),
  ('fixt-u-029', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0005', 'FIXT-ZSC-0005', 'IN_WAREHOUSE_CBU',  'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '11 days', NOW() - INTERVAL '4 days'),
  ('fixt-u-030', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0006', 'FIXT-ZSC-0006', 'IN_WAREHOUSE_CBU',  'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '10 days', NOW() - INTERVAL '3 days'),
  ('fixt-u-031', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0007', 'FIXT-ZSC-0007', 'IN_WAREHOUSE_CBU',  'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '10 days', NOW() - INTERVAL '3 days'),
  ('fixt-u-032', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0008', 'FIXT-ZSC-0008', 'IN_WAREHOUSE_CBU',  'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '9 days',  NOW() - INTERVAL '2 days'),
  ('fixt-u-033', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0009', 'FIXT-ZSC-0009', 'IN_WAREHOUSE_CBU',  'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '9 days',  NOW() - INTERVAL '2 days'),
  ('fixt-u-034', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0010', 'FIXT-ZSC-0010', 'IN_WAREHOUSE_CBU',  'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '8 days',  NOW() - INTERVAL '1 day'),

  -- IN_ASSEMBLY x 6 (currently being assembled)
  ('fixt-u-035', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0011', 'FIXT-ZSC-0011', 'IN_ASSEMBLY',       'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '8 days',  NOW() - INTERVAL '1 day'),
  ('fixt-u-036', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0012', 'FIXT-ZSC-0012', 'IN_ASSEMBLY',       'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '8 days',  NOW() - INTERVAL '1 day'),
  ('fixt-u-037', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0013', 'FIXT-ZSC-0013', 'IN_ASSEMBLY',       'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '7 days',  NOW() - INTERVAL '1 day'),
  ('fixt-u-038', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0014', 'FIXT-ZSC-0014', 'IN_ASSEMBLY',       'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '7 days',  NOW() - INTERVAL '1 day'),
  ('fixt-u-039', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0015', 'FIXT-ZSC-0015', 'IN_ASSEMBLY',       'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '1 day'),
  ('fixt-u-040', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0016', 'FIXT-ZSC-0016', 'IN_ASSEMBLY',       'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '1 day'),

  -- SOLD_AS_CKD x 5 (sold as kit, not assembled)
  ('fixt-u-041', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0041', 'FIXT-GSC-0041', 'SOLD_AS_CKD',       NULL,            2400000.00, NOW() - INTERVAL '7 days',  NOW() - INTERVAL '2 days'),
  ('fixt-u-042', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0042', 'FIXT-GSC-0042', 'SOLD_AS_CKD',       NULL,            2400000.00, NOW() - INTERVAL '7 days',  NOW() - INTERVAL '2 days'),
  ('fixt-u-043', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0043', 'FIXT-GSC-0043', 'SOLD_AS_CKD',       NULL,            2400000.00, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '2 days'),
  ('fixt-u-044', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0044', 'FIXT-GSC-0044', 'SOLD_AS_CKD',       NULL,            2400000.00, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '1 day'),
  ('fixt-u-045', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0045', 'FIXT-GSC-0045', 'SOLD_AS_CKD',       NULL,            2400000.00, NOW() - INTERVAL '5 days',  NOW() - INTERVAL '1 day'),

  -- SOLD_AS_CBU x 5 (assembled + sold)
  ('fixt-u-046', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0017', 'FIXT-ZSC-0017', 'SOLD_AS_CBU',       NULL,            2800000.00, NOW() - INTERVAL '12 days', NOW() - INTERVAL '2 days'),
  ('fixt-u-047', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0018', 'FIXT-ZSC-0018', 'SOLD_AS_CBU',       NULL,            2800000.00, NOW() - INTERVAL '11 days', NOW() - INTERVAL '2 days'),
  ('fixt-u-048', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0019', 'FIXT-ZSC-0019', 'SOLD_AS_CBU',       NULL,            2800000.00, NOW() - INTERVAL '10 days', NOW() - INTERVAL '1 day'),
  ('fixt-u-049', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0020', 'FIXT-ZSC-0020', 'SOLD_AS_CBU',       NULL,            2800000.00, NOW() - INTERVAL '9 days',  NOW() - INTERVAL '1 day'),
  ('fixt-u-050', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0021', 'FIXT-ZSC-0021', 'SOLD_AS_CBU',       NULL,            2800000.00, NOW() - INTERVAL '8 days',  NOW() - INTERVAL '1 day'),

  -- DAMAGED x 3
  ('fixt-u-051', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0051', 'FIXT-GSC-0051', 'DAMAGED',           'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '9 days',  NOW() - INTERVAL '3 days'),
  ('fixt-u-052', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0052', 'FIXT-GSC-0052', 'DAMAGED',           'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '8 days',  NOW() - INTERVAL '2 days'),
  ('fixt-u-053', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0022', 'FIXT-ZSC-0022', 'DAMAGED',           'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '7 days',  NOW() - INTERVAL '1 day'),

  -- DEMO x 2 (allocated to demo / display)
  ('fixt-u-054', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0023', 'FIXT-ZSC-0023', 'DEMO',              'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '15 days', NOW() - INTERVAL '5 days'),
  ('fixt-u-055', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0024', 'FIXT-ZSC-0024', 'DEMO',              'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '15 days', NOW() - INTERVAL '5 days'),

  -- RETURNED x 2
  ('fixt-u-056', 'fixt-ship-test', 'seed-var-gs-gyellow', 'FIXT-GS-0056', 'FIXT-GSC-0056', 'RETURNED',          'seed-wh-lagos', 2400000.00, NOW() - INTERVAL '13 days', NOW() - INTERVAL '2 days'),
  ('fixt-u-057', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0025', 'FIXT-ZSC-0025', 'RETURNED',          'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '12 days', NOW() - INTERVAL '1 day'),

  -- TRANSFERRED x 2 (moved out to another warehouse, currentWarehouseId NULL)
  ('fixt-u-058', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0058', 'FIXT-GSC-0058', 'TRANSFERRED',       NULL,            2400000.00, NOW() - INTERVAL '10 days', NOW() - INTERVAL '4 days'),
  ('fixt-u-059', 'fixt-ship-test', 'seed-var-gs-nepblue', 'FIXT-GS-0059', 'FIXT-GSC-0059', 'TRANSFERRED',       NULL,            2400000.00, NOW() - INTERVAL '10 days', NOW() - INTERVAL '4 days'),

  -- INTERNAL_USE x 1
  ('fixt-u-060', 'fixt-ship-test', 'seed-var-zs-gyellow', 'FIXT-ZS-0060', 'FIXT-ZSC-0060', 'INTERNAL_USE',      'seed-wh-lagos', 2800000.00, NOW() - INTERVAL '18 days', NOW() - INTERVAL '6 days')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 4. STOCK MOVEMENTS
-- =============================================================================
-- 4a. One RECEIPT movement per unit (so every unit has a non-empty timeline).
INSERT INTO stock_movements (
  id, "unitId", "movementType", "fromState", "toState",
  "fromWarehouseId", "toWarehouseId",
  "referenceType", "referenceId",
  "actorId", "occurredAt", notes
)
SELECT
  'fixt-mv-recv-' || u.id,
  u.id, 'RECEIPT', NULL, 'IN_WAREHOUSE_CKD',
  NULL, 'seed-wh-lagos',
  'SHIPMENT', 'fixt-ship-test',
  (SELECT id FROM users WHERE email = 'itadmin@enviable.example'),
  u."createdAt",
  'Received via SHIP-FIXTURE-TEST'
FROM units u
WHERE u."shipmentId" = 'fixt-ship-test'
ON CONFLICT (id) DO NOTHING;

-- 4b. 6-movement lifecycle on fixt-u-001 (engine FIXT-GS-0001).
--   RECEIPT (already inserted above as fixt-mv-recv-fixt-u-001)
--   ASSEMBLY_START -> ASSEMBLY_COMPLETE -> SALE -> RETURN -> REPAIR_IN
INSERT INTO stock_movements (
  id, "unitId", "movementType", "fromState", "toState",
  "fromWarehouseId", "toWarehouseId",
  "referenceType", "referenceId",
  "actorId", "occurredAt", notes
) VALUES
  ('fixt-mv-001b', 'fixt-u-001', 'ASSEMBLY_START',    'IN_WAREHOUSE_CKD', 'IN_ASSEMBLY',
   'seed-wh-lagos', 'seed-wh-lagos', 'ASSEMBLY_JOB',  'fixt-aj-test-001',
   (SELECT id FROM users WHERE email = 'kelechi@enviable.example'),
   NOW() - INTERVAL '12 days', 'Started assembly under job fixt-aj-test-001'),

  ('fixt-mv-001c', 'fixt-u-001', 'ASSEMBLY_COMPLETE', 'IN_ASSEMBLY',      'IN_WAREHOUSE_CBU',
   'seed-wh-lagos', 'seed-wh-lagos', 'ASSEMBLY_JOB',  'fixt-aj-test-001',
   (SELECT id FROM users WHERE email = 'kelechi@enviable.example'),
   NOW() - INTERVAL '10 days', 'Assembled CKD -> CBU; final inspection passed'),

  ('fixt-mv-001d', 'fixt-u-001', 'SALE',              'IN_WAREHOUSE_CBU', 'SOLD_AS_CBU',
   'seed-wh-lagos', NULL,            'SALES_ORDER',   'fixt-so-test-001',
   (SELECT id FROM users WHERE email = 'kelechi@enviable.example'),
   NOW() - INTERVAL '7 days', 'Sold as CBU on SO fixt-so-test-001'),

  ('fixt-mv-001e', 'fixt-u-001', 'RETURN',            'SOLD_AS_CBU',      'RETURNED',
   NULL,            'seed-wh-lagos', 'RETURN',        'fixt-ret-test-001',
   (SELECT id FROM users WHERE email = 'kelechi@enviable.example'),
   NOW() - INTERVAL '4 days', 'Customer return; cosmetic damage reported'),

  ('fixt-mv-001f', 'fixt-u-001', 'REPAIR_IN',         'RETURNED',         'IN_REPAIR',
   'seed-wh-lagos', 'seed-wh-lagos', NULL,            NULL,
   (SELECT id FROM users WHERE email = 'kelechi@enviable.example'),
   NOW() - INTERVAL '1 day', 'Moved to repair bay for cosmetic rework')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 5. COST-BLIND THROWAWAY USER (Sales Officer role lacks costdata.view)
-- =============================================================================
-- Created with the non-authenticating placeholder hash; set a real password
-- after via the backend's set-password script (see README).
INSERT INTO users (id, "fullName", email, "passwordHash", status, "createdAt", "updatedAt")
VALUES (
  'fixt-user-costblind', 'Cost Blind Test', 'costblind-test@enviable.example',
  '$argon2id$PLACEHOLDER_RESET_REQUIRED', 'ACTIVE',
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (id, "userId", "roleId", "assignedAt")
SELECT
  'fixt-userrole-costblind',
  'fixt-user-costblind',
  r.id,
  NOW()
FROM roles r
WHERE r.name = 'Sales Officer (Warehouse)'
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Summary (visible after running):
SELECT
  (SELECT COUNT(*) FROM units WHERE "shipmentId" = 'fixt-ship-test')          AS units,
  (SELECT COUNT(*) FROM stock_movements WHERE "unitId" IN
     (SELECT id FROM units WHERE "shipmentId" = 'fixt-ship-test'))            AS movements,
  (SELECT COUNT(*) FROM users WHERE id = 'fixt-user-costblind')               AS costblind_user;
