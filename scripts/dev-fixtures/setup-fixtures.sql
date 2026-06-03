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
-- 5. SPARE PARTS (for the stocks report's spare-parts section)
-- =============================================================================
-- 3 parts with plausible quantities and landed-cost-per-unit values. Total
-- landed-cost valuation: ₦2,850,000 (12*150_000 + 25*25_000 + 50*8_500).
INSERT INTO spare_parts (
  id, sku, name, description, "quantityOnHand", "landedCostPerUnit",
  status, "createdAt", "updatedAt"
) VALUES
  ('fixt-sp-001', 'SPP-EBA-001', 'Engine Block Assembly',
   'Replacement engine block, fits GS+ and ZS+ chassis.',
   12, 150000.00, 'ACTIVE', NOW() - INTERVAL '20 days', NOW() - INTERVAL '5 days'),
  ('fixt-sp-002', 'SPP-FWH-002', 'Front Wheel Hub',
   'Front wheel hub assembly with bearings.',
   25, 25000.00, 'ACTIVE', NOW() - INTERVAL '20 days', NOW() - INTERVAL '5 days'),
  ('fixt-sp-003', 'SPP-BPS-003', 'Brake Pad Set',
   'Standard brake pad set (4 pieces).',
   50, 8500.00, 'ACTIVE', NOW() - INTERVAL '20 days', NOW() - INTERVAL '5 days')
ON CONFLICT (id) DO NOTHING;

-- One SparePartMovement per seeded part so the spare-part detail page's
-- movement-history surface is exercised by fixtures rather than relying on
-- a real historical-load run. RECEIPT initialization with positive quantity;
-- the quantity column on each movement matches the parent's quantityOnHand
-- so the audit trail tells a coherent story. Idempotent (ON CONFLICT id).
INSERT INTO spare_part_movements (
  id, "sparePartId", "movementType", quantity, "occurredAt",
  notes, "actorId", "referenceType", "referenceId"
) VALUES
  ('fixt-spm-eba-init', 'fixt-sp-001', 'RECEIPT', 12,
   NOW() - INTERVAL '20 days', 'Initial stock load',
   (SELECT id FROM users WHERE email = 'kelechi@enviable.example' LIMIT 1),
   NULL, NULL),
  ('fixt-spm-fwh-init', 'fixt-sp-002', 'RECEIPT', 25,
   NOW() - INTERVAL '20 days', 'Initial stock load',
   (SELECT id FROM users WHERE email = 'kelechi@enviable.example' LIMIT 1),
   NULL, NULL),
  ('fixt-spm-bps-init', 'fixt-sp-003', 'RECEIPT', 50,
   NOW() - INTERVAL '20 days', 'Initial stock load',
   (SELECT id FROM users WHERE email = 'kelechi@enviable.example' LIMIT 1),
   NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 6. RECEIVE-TEST SHIPMENT (CLEARED, awaiting unit serialisation)
-- =============================================================================
-- A second PO + shipment so the receive-units flow has something to receive
-- against. This shipment is in CLEARED state with three manifest lines
-- declaring 10 + 5 + 3 = 18 units across two variants. No units exist yet for
-- this shipment; the clerk enters them via the serialisation UI, which
-- exercises both the happy path (atomic unit-plus-RECEIPT creation, I-3) and
-- the duplicate-rejection path (in-batch and against-DB collisions on
-- engineNumber or chassisNumber).
INSERT INTO purchase_orders (
  id, "poNumber", "supplierId", status, currency, "totalValue",
  "expectedShipDate", "paymentTerms",
  "createdAt", "updatedAt"
) VALUES (
  'fixt-po-receive-test', 'PO-FIXTURE-RECV', 'seed-cp-tvs',
  'AWAITING_SHIPMENT', 'USD', 45200000.00,
  NOW() + INTERVAL '14 days', '30% advance, 70% on shipment',
  NOW() - INTERVAL '30 days', NOW() - INTERVAL '8 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO shipments (
  id, "purchaseOrderId", "shipmentReference", status,
  "billOfLadingNumber", "vesselName",
  "etd", "eta", "arrivalDate", "clearingStartedAt", "clearedAt",
  "isHistoricalImport",
  "createdAt", "updatedAt"
) VALUES (
  'fixt-ship-receive-test', 'fixt-po-receive-test', 'SHIP-FIXTURE-RECV',
  'CLEARED',
  'MAEU-FIXT-739281', 'MV Atlantic Carrier',
  NOW() - INTERVAL '21 days', NOW() - INTERVAL '7 days',
  NOW() - INTERVAL '6 days', NOW() - INTERVAL '5 days', NOW() - INTERVAL '1 day',
  false,
  NOW() - INTERVAL '25 days', NOW() - INTERVAL '1 day'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO manifest_lines (
  id, "shipmentId", "productVariantId", "quantityDeclared",
  "quantityReceived", variance
) VALUES
  ('fixt-ml-receive-1', 'fixt-ship-receive-test', 'seed-var-gs-gyellow', 10, 0, 0),
  ('fixt-ml-receive-2', 'fixt-ship-receive-test', 'seed-var-zs-gyellow',  5, 0, 0),
  ('fixt-ml-receive-3', 'fixt-ship-receive-test', 'seed-var-gs-nepblue',  3, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 7. SALES-SIDE FIXTURE (customer + sales-officer throwaway user)
-- =============================================================================
-- The seed has no customers; the SO create flow needs one. We use the
-- ResellerStandard tier (priced 1.00x of currentMarketPrice; see seed.ts).
INSERT INTO customers (id, name, type, "tierId", phone, email, status, "createdAt", "updatedAt")
SELECT
  'fixt-customer-test',
  'ABC Tricycle Dealers Ltd',
  'RESELLER',
  ct.id,
  '+234-901-FIXT-CUST',
  'abc-tricycle@example.test',
  'ACTIVE',
  NOW(), NOW()
FROM customer_tiers ct
WHERE ct.name = 'ResellerStandard'
ON CONFLICT (id) DO NOTHING;

-- Throwaway Sales Officer (Warehouse) user. Has salesorder.create and
-- customer.read but NOT salesorder.discount, so it's the principal that
-- exercises the discount-permission 403 verbatim. Same fail-loud naming
-- and cleanup discipline as costblind-test.
INSERT INTO users (id, "fullName", email, "passwordHash", status, "createdAt", "updatedAt")
VALUES (
  'fixt-user-salesofficer', 'Sales Officer Test', 'salesofficer-test@enviable.example',
  '$argon2id$PLACEHOLDER_RESET_REQUIRED', 'ACTIVE',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE
  SET "deletedAt" = NULL,
      "passwordHash" = EXCLUDED."passwordHash",
      "updatedAt" = NOW();

INSERT INTO user_roles (id, "userId", "roleId", "assignedAt")
SELECT
  'fixt-userrole-salesofficer',
  'fixt-user-salesofficer',
  r.id,
  NOW()
FROM roles r
WHERE r.name = 'Sales Officer (Warehouse)'
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 8. CONFIRMER THROWAWAY USER (Sales Manager: payment.confirm + delivery.manage,
--    no payment.record). Paired with fixt-user-salesofficer (Sales Officer:
--    payment.record, no payment.confirm) above to exercise the separation-of-
--    duties gate in both directions: the recorder can record but not confirm,
--    the confirmer can confirm but not record. The Sales Manager role also
--    holds delivery.manage so the confirmer drives the back half of the
--    lifecycle once release authorises.
-- =============================================================================
INSERT INTO users (id, "fullName", email, "passwordHash", status, "createdAt", "updatedAt")
VALUES (
  'fixt-user-confirmer', 'Confirmer Test', 'confirmer-test@enviable.example',
  '$argon2id$PLACEHOLDER_RESET_REQUIRED', 'ACTIVE',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE
  SET "deletedAt" = NULL,
      "passwordHash" = EXCLUDED."passwordHash",
      "updatedAt" = NOW();

INSERT INTO user_roles (id, "userId", "roleId", "assignedAt")
SELECT
  'fixt-userrole-confirmer',
  'fixt-user-confirmer',
  r.id,
  NOW()
FROM roles r
WHERE r.name = 'Sales Manager'
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 9. AWAITING_PAYMENT SO (the back-half lifecycle starts here)
-- =============================================================================
-- Soft-reserves one CKD and one CBU unit from the prompt-2 fixture so the
-- units have a real warehouse status to transition out of on release. Created
-- directly in SQL (audit-quiet); test interactions (record/confirm/release)
-- will write their own audit entries as the API path does.
-- Totals: 2,800,000 CKD + 3,500,000 CBU = 6,300,000 subtotal; VAT 7.5% =
-- 472,500; total 6,772,500. Matches ResellerStandard tier pricing.
INSERT INTO sales_orders (
  id, "soNumber", "customerId", channel, status,
  subtotal, "discountTotal", "vatAmount", total, "paymentReceivedTotal",
  "createdAt", "updatedAt"
) VALUES (
  'fixt-so-await-payment', 'SO-FIXTURE-AWAIT', 'fixt-customer-test',
  'WAREHOUSE_PICKUP', 'AWAITING_PAYMENT',
  6300000.00, 0.00, 472500.00, 6772500.00, 0.00,
  NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sales_order_lines (
  id, "salesOrderId", "productVariantId", "unitId", "saleForm",
  "unitPrice", "discountAmount", "lineTotal"
) VALUES
  ('fixt-sol-await-1', 'fixt-so-await-payment', 'seed-var-gs-gyellow',
   'fixt-u-024', 'CKD', 2800000.00, 0.00, 2800000.00),
  ('fixt-sol-await-2', 'fixt-so-await-payment', 'seed-var-zs-gyellow',
   'fixt-u-034', 'CBU', 3500000.00, 0.00, 3500000.00)
ON CONFLICT (id) DO NOTHING;

-- Three SOs across the in-flight delivery states so the deliveries screen's
-- visible-outcome verification has rows to render and the status filter
-- has a non-trivial set to narrow. Created directly in SQL (audit-quiet);
-- the delivery workflow actions are exercised on the SO detail page rather
-- than via these rows. Idempotent on id (status / dispatchedAt /
-- deliveredAt update on re-run, no compound shape changes needed).
-- IMPORTANT: the spine column `updatedAt` is NOW() so the mirror's
-- since-mode delta picks the rows up on the next reconcile tick after
-- the fixtures are seeded. Domain timestamps (createdAt, dispatchedAt,
-- deliveredAt) remain backdated for realistic data. This is the rule
-- for any future fixture using a mirror-synced entity: backdate domain
-- fields freely, but updatedAt MUST be NOW() so the mirror sees them.
INSERT INTO sales_orders (
  id, "soNumber", "customerId", channel, status,
  subtotal, "discountTotal", "vatAmount", total, "paymentReceivedTotal",
  "createdAt", "updatedAt", "dispatchedAt", "deliveredAt"
) VALUES
  ('fixt-so-deliv-ready', 'SO-FIXT-DELIV-READY', 'fixt-customer-test',
   'WAREHOUSE_PICKUP', 'READY_FOR_DISPATCH',
   3000000.00, 0.00, 0.00, 3000000.00, 3000000.00,
   NOW() - INTERVAL '3 days', NOW(), NULL, NULL),
  ('fixt-so-deliv-dispatched', 'SO-FIXT-DELIV-DISP', 'fixt-customer-test',
   'WAREHOUSE_PICKUP', 'DISPATCHED',
   3500000.00, 0.00, 0.00, 3500000.00, 3500000.00,
   NOW() - INTERVAL '5 days', NOW(),
   NOW() - INTERVAL '6 hours', NULL),
  ('fixt-so-deliv-delivered', 'SO-FIXT-DELIV-DONE', 'fixt-customer-test',
   'WAREHOUSE_PICKUP', 'DELIVERED',
   2800000.00, 0.00, 0.00, 2800000.00, 2800000.00,
   NOW() - INTERVAL '7 days', NOW(),
   NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 hours')
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status,
      "updatedAt" = NOW(),
      "dispatchedAt" = EXCLUDED."dispatchedAt",
      "deliveredAt" = EXCLUDED."deliveredAt";

-- Four invoices + six payments across PENDING / CONFIRMED / REJECTED so the
-- /sales/invoices-payments cross-SO view (built mirror-only per outcome B of
-- prompt 19's backend audit; no /api/invoices or /api/payments aggregation
-- endpoints exist) has a non-trivial set to filter and tab through. Each
-- invoice is 1:1 to an SO via the unique salesOrderId; payments are many
-- per SO. Idempotent on id; CONFLICT NOTHING on the inserts because the
-- shape is fixed once seeded (no per-run-update fields).
-- updatedAt = NOW() on every row so the mirror's since-mode delta picks
-- them up on the next reconcile tick after seeding. Domain timestamps
-- (issueDate, receivedAt, createdAt) remain backdated for realistic data.
INSERT INTO invoices (
  id, "salesOrderId", "invoiceNumber",
  "issueDate", "vatRate", "vatAmount", total,
  "pdfDocumentId", "createdAt", "updatedAt"
) VALUES
  ('fixt-inv-await',      'fixt-so-await-payment',    'INV-FIXT-AWAIT',
   NOW() - INTERVAL '1 day',  0.0750, 472500.00, 6772500.00,
   NULL, NOW() - INTERVAL '1 day',  NOW()),
  ('fixt-inv-deliv-r',    'fixt-so-deliv-ready',      'INV-FIXT-DELIV-R',
   NOW() - INTERVAL '3 days', 0.0000, 0.00,      3000000.00,
   NULL, NOW() - INTERVAL '3 days', NOW()),
  ('fixt-inv-deliv-d',    'fixt-so-deliv-dispatched', 'INV-FIXT-DELIV-D',
   NOW() - INTERVAL '5 days', 0.0000, 0.00,      3500000.00,
   NULL, NOW() - INTERVAL '5 days', NOW()),
  ('fixt-inv-deliv-done', 'fixt-so-deliv-delivered',  'INV-FIXT-DELIV-X',
   NOW() - INTERVAL '7 days', 0.0000, 0.00,      2800000.00,
   NULL, NOW() - INTERVAL '7 days', NOW())
ON CONFLICT (id) DO UPDATE SET "updatedAt" = NOW();

INSERT INTO payments (
  id, "salesOrderId", "paymentMethodId", amount, "receivedAt",
  "referenceNumber", "confirmationSource", "confirmedById",
  "receiptDocumentId", status, "clientId",
  "createdAt", "updatedAt"
) VALUES
  ('fixt-pmt-await-1', 'fixt-so-await-payment',    'seed-pm-bank', 2000000.00,
   NOW() - INTERVAL '6 hours', 'TXN-PEND-001', 'MANUAL_UPLOAD',
   NULL, NULL, 'PENDING',   NULL,
   NOW() - INTERVAL '6 hours', NOW()),
  ('fixt-pmt-ready-1', 'fixt-so-deliv-ready',      'seed-pm-pos',  3000000.00,
   NOW() - INTERVAL '2 days', 'POS-CFM-002',  'MANUAL_UPLOAD',
   (SELECT id FROM users WHERE email='confirmer-test@enviable.example' LIMIT 1),
   NULL, 'CONFIRMED', NULL,
   NOW() - INTERVAL '2 days', NOW()),
  ('fixt-pmt-disp-1',  'fixt-so-deliv-dispatched', 'seed-pm-bank', 2000000.00,
   NOW() - INTERVAL '4 days', 'TXN-CFM-003a', 'MANUAL_UPLOAD',
   (SELECT id FROM users WHERE email='confirmer-test@enviable.example' LIMIT 1),
   NULL, 'CONFIRMED', NULL,
   NOW() - INTERVAL '4 days', NOW()),
  ('fixt-pmt-disp-2',  'fixt-so-deliv-dispatched', 'seed-pm-bank', 1500000.00,
   NOW() - INTERVAL '3 days', 'TXN-CFM-003b', 'MANUAL_UPLOAD',
   (SELECT id FROM users WHERE email='confirmer-test@enviable.example' LIMIT 1),
   NULL, 'CONFIRMED', NULL,
   NOW() - INTERVAL '3 days', NOW()),
  ('fixt-pmt-done-1',  'fixt-so-deliv-delivered',  'seed-pm-pos',  2800000.00,
   NOW() - INTERVAL '6 days', 'POS-CFM-004',  'MANUAL_UPLOAD',
   (SELECT id FROM users WHERE email='confirmer-test@enviable.example' LIMIT 1),
   NULL, 'CONFIRMED', NULL,
   NOW() - INTERVAL '6 days', NOW()),
  ('fixt-pmt-done-2',  'fixt-so-deliv-delivered',  'seed-pm-bank',  500000.00,
   NOW() - INTERVAL '5 days', 'TXN-REJ-005',  'MANUAL_UPLOAD',
   NULL, NULL, 'REJECTED', NULL,
   NOW() - INTERVAL '5 days', NOW())
ON CONFLICT (id) DO UPDATE SET "updatedAt" = NOW();

-- =============================================================================
-- 10. COST-BLIND THROWAWAY USER (Stock Auditor: report.stocks + unit.read,
--    no costdata.view, so they see both the units list and the stocks report
--    but with all landed-cost fields stripped server-side. Satisfies the I-8
--    verification across the units, units-detail, and stocks-report endpoints
--    with a single throwaway principal.)
-- =============================================================================
-- Created with the non-authenticating placeholder hash; set a real password
-- after via the backend's set-password script (see README).
INSERT INTO users (id, "fullName", email, "passwordHash", status, "createdAt", "updatedAt")
VALUES (
  'fixt-user-costblind', 'Cost Blind Test', 'costblind-test@enviable.example',
  '$argon2id$PLACEHOLDER_RESET_REQUIRED', 'ACTIVE',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE
  SET "deletedAt" = NULL,
      "passwordHash" = EXCLUDED."passwordHash",
      "updatedAt" = NOW();

INSERT INTO user_roles (id, "userId", "roleId", "assignedAt")
SELECT
  'fixt-userrole-costblind',
  'fixt-user-costblind',
  r.id,
  NOW()
FROM roles r
WHERE r.name = 'Stock Auditor'
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 11. PROCUREMENT-TEST THROWAWAY USER (Procurement Officer: pi.read + pi.review)
--     Throwaway audit-attribution subject for the proforma-invoices approve /
--     reject flow on /procurement/proforma-invoices/[id]. Same activation
--     pattern as costblind-test / confirmer-test (placeholder hash, set via
--     `npm run set-password` from enviable-system, tracked in BACKLOG.md
--     under the verification-fixture cluster).
-- =============================================================================
INSERT INTO users (id, "fullName", email, "passwordHash", status, "createdAt", "updatedAt")
VALUES (
  'fixt-user-procurement', 'Procurement Test', 'procurement-test@enviable.example',
  '$argon2id$PLACEHOLDER_RESET_REQUIRED', 'ACTIVE',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE
  SET "deletedAt" = NULL,
      "updatedAt" = NOW();

INSERT INTO user_roles (id, "userId", "roleId", "assignedAt")
SELECT 'fixt-userrole-procurement', 'fixt-user-procurement', r.id, NOW()
FROM roles r WHERE r.name = 'Procurement Officer'
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 12. PROFORMA INVOICE FIXTURES across all four statuses for the cross-supplier
--     /procurement/proforma-invoices verification. Two existing fixture POs,
--     two PI revisions each, statuses {SUPERSEDED, ACTIVE} on po-test (the
--     supersede pattern) and {REJECTED, PENDING_REVIEW} on po-receive-test.
--     updatedAt = NOW() on every row + on ON CONFLICT UPDATE so the mirror's
--     since-delta picks them up; issueDate / approvedAt remain backdated.
-- =============================================================================
INSERT INTO proforma_invoices (
  id, "piNumber", "purchaseOrderId", "revisionNumber", status,
  "approvedById", "approvedAt",
  "totalValue", "freightAmount", "insuranceAmount",
  "issueDate", "validityUntil", "paymentTerms",
  "portOfLoading", "portOfDischarge", "rawDocumentId",
  "createdAt", "updatedAt"
) VALUES
  ('fixt-pi-test-r1', 'PI-FIXT-TEST-R1', 'fixt-po-test', 1, 'SUPERSEDED',
   (SELECT id FROM users WHERE email='daniel@enviable.example' LIMIT 1),
   NOW() - INTERVAL '8 days',
   45000000.00, 1500000.00, 500000.00,
   NOW() - INTERVAL '15 days', NOW() - INTERVAL '5 days',
   '30% advance, 70% on shipment', 'Mumbai', 'Lagos', NULL,
   NOW() - INTERVAL '15 days', NOW()),
  ('fixt-pi-test-r2', 'PI-FIXT-TEST-R2', 'fixt-po-test', 2, 'ACTIVE',
   (SELECT id FROM users WHERE email='daniel@enviable.example' LIMIT 1),
   NOW() - INTERVAL '4 days',
   46000000.00, 1600000.00, 500000.00,
   NOW() - INTERVAL '10 days', NOW() + INTERVAL '20 days',
   '30% advance, 70% on shipment', 'Mumbai', 'Lagos', NULL,
   NOW() - INTERVAL '10 days', NOW()),
  ('fixt-pi-recv-r1', 'PI-FIXT-RECV-R1', 'fixt-po-receive-test', 1, 'REJECTED',
   NULL, NULL,
   42000000.00, 1200000.00, 400000.00,
   NOW() - INTERVAL '12 days', NOW() - INTERVAL '6 days',
   'Net 30', 'Mumbai', 'Lagos', NULL,
   NOW() - INTERVAL '12 days', NOW()),
  ('fixt-pi-recv-r2', 'PI-FIXT-RECV-R2', 'fixt-po-receive-test', 2, 'PENDING_REVIEW',
   NULL, NULL,
   43500000.00, 1300000.00, 400000.00,
   NOW() - INTERVAL '5 days', NOW() + INTERVAL '25 days',
   '30% advance, 70% on shipment', 'Mumbai', 'Lagos', NULL,
   NOW() - INTERVAL '5 days', NOW())
ON CONFLICT (id) DO UPDATE
  SET "updatedAt" = NOW(),
      status = EXCLUDED.status,
      "approvedById" = EXCLUDED."approvedById",
      "approvedAt" = EXCLUDED."approvedAt";

-- =============================================================================
-- 13. COUNTERPARTY FIXTURES across the 6 type values + an INACTIVE supplier
--     for the /procurement/counterparties filter verification. The seed
--     ships only MANUFACTURER + SUPPLIER; the build needs all types so the
--     type filter narrows non-trivially. updatedAt = NOW() per the fixture
--     rule. contact stored as JSON (the schema column is Json); banking
--     details only on the BANK row to exercise that path.
-- =============================================================================
INSERT INTO counterparties (id, name, type, contact, "bankDetails", status, "createdAt", "updatedAt", "deletedAt")
VALUES
  ('fixt-cp-forwarder',  'Lagos Freight Logistics Ltd',  'FREIGHT_FORWARDER',
   '{"contact_email":"ops@lagosfreight.example","phone":"+234-1-555-0100"}'::jsonb, NULL,
   'ACTIVE', NOW() - INTERVAL '30 days', NOW(), NULL),
  ('fixt-cp-clearing',   'Apapa Clearing Agents Co',     'CLEARING_AGENT',
   '{"contact_email":"docs@apapaclearing.example","phone":"+234-1-555-0200"}'::jsonb, NULL,
   'ACTIVE', NOW() - INTERVAL '30 days', NOW(), NULL),
  ('fixt-cp-insurance',  'NICON Insurance plc',          'INSURANCE_COMPANY',
   '{"contact_email":"marine@nicon.example","phone":"+234-1-555-0300"}'::jsonb, NULL,
   'ACTIVE', NOW() - INTERVAL '30 days', NOW(), NULL),
  ('fixt-cp-bank',       'First Bank of Nigeria',        'BANK',
   '{"contact_email":"trade@firstbank.example","phone":"+234-1-555-0400"}'::jsonb,
   '{"swift_bic":"FBNINGLA","sample_account":"xxxxx-redacted"}'::jsonb,
   'ACTIVE', NOW() - INTERVAL '30 days', NOW(), NULL),
  ('fixt-cp-inactive',   'Decommissioned Supplier Co',   'SUPPLIER',
   NULL, NULL, 'INACTIVE', NOW() - INTERVAL '60 days', NOW(), NULL)
ON CONFLICT (id) DO UPDATE
  SET "updatedAt" = NOW(),
      status = EXCLUDED.status,
      "deletedAt" = NULL;

INSERT INTO proforma_invoice_lines (id, "proformaInvoiceId", "productVariantId", quantity, "unitPrice", "lineTotal", "updatedAt")
VALUES
  ('fixt-pil-test-r1', 'fixt-pi-test-r1', 'seed-var-gs-ecogreen', 100, 430000.00, 43000000.00, NOW()),
  ('fixt-pil-test-r2', 'fixt-pi-test-r2', 'seed-var-gs-ecogreen', 100, 439000.00, 43900000.00, NOW()),
  ('fixt-pil-recv-r1', 'fixt-pi-recv-r1', 'seed-var-gs-nepblue',  100, 404000.00, 40400000.00, NOW()),
  ('fixt-pil-recv-r2', 'fixt-pi-recv-r2', 'seed-var-gs-nepblue',  100, 418000.00, 41800000.00, NOW())
ON CONFLICT (id) DO UPDATE SET "updatedAt" = NOW();

COMMIT;

-- Summary (visible after running):
SELECT
  (SELECT COUNT(*) FROM units WHERE "shipmentId" = 'fixt-ship-test')                    AS units,
  (SELECT COUNT(*) FROM stock_movements WHERE "unitId" IN
     (SELECT id FROM units WHERE "shipmentId" = 'fixt-ship-test'))                      AS movements,
  (SELECT COUNT(*) FROM spare_parts WHERE id LIKE 'fixt-sp-%')                          AS spare_parts,
  (SELECT COUNT(*) FROM shipments WHERE id = 'fixt-ship-receive-test')                  AS recv_shipment,
  (SELECT COUNT(*) FROM manifest_lines WHERE "shipmentId" = 'fixt-ship-receive-test')   AS recv_manifest_lines,
  (SELECT COUNT(*) FROM customers WHERE id = 'fixt-customer-test')                      AS customer,
  (SELECT COUNT(*) FROM sales_orders WHERE id = 'fixt-so-await-payment')                AS await_so,
  (SELECT COUNT(*) FROM sales_order_lines WHERE "salesOrderId" = 'fixt-so-await-payment') AS await_so_lines,
  (SELECT COUNT(*) FROM users WHERE id IN ('fixt-user-costblind','fixt-user-salesofficer','fixt-user-confirmer')) AS throwaway_users;
