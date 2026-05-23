# Dev fixtures (frontend-side throwaway data)

The dev database is intentionally empty of operational rows: the backend seed
populates only reference data (products, variants, warehouse, counterparties,
payment methods, users). Every list screen we build needs realistic rows to
look at, and synthesizing them per prompt is wasteful, so this folder holds a
small reusable fixture that stands up a representative operational dataset and
tears it down again.

The fixture writes directly to the Postgres dev container (`enviable-postgres`,
port 5433) via raw SQL. This deliberately bypasses the backend's audited
service endpoints so:

1. The rows are cleanly deletable in FK order (no audit entries pointing at
   them); and
2. The append-only `audit_log_entries` table stays quiet, which is correct
   because the audit log is for real operational activity, not test fixtures.

**Convention.** Every fixture row uses a `fixt-` id prefix and obvious test
identifiers (`SHIP-FIXTURE-TEST`, `FIXT-GS-0001`, `costblind-test@enviable.example`).
If a teardown fails, the leftover is loudly named and trivially spotted; never
silently corrupts a seeded user or shipment.

## What's in `setup-fixtures.sql`

- One purchase order `fixt-po-test` (status FULLY_RECEIVED) and one shipment
  `fixt-ship-test` (`shipmentReference = SHIP-FIXTURE-TEST`, status RECEIVED).
- 60 units across 11 of the 13 UnitStatus values for pill-colour variety,
  spread across 3 product variants (GS+ G Yellow, GS+ NEP Blue, ZS+ G Yellow)
  so the variant filter narrows visibly. Each has a plausible `landedCost`
  (2.4M NGN for CKD, 2.8M NGN for CBU) so the cost column shows real numbers
  for users who can see them, and is genuinely absent for users who cannot.
- 60 receipt movements (one per unit) so every unit has a non-empty timeline.
- A 6-movement lifecycle on `fixt-u-001` (engine `FIXT-GS-0001`): RECEIPT,
  ASSEMBLY_START, ASSEMBLY_COMPLETE, SALE, RETURN, REPAIR_IN — telling a
  realistic story for the unit-detail timeline.
- One throwaway cost-blind user `costblind-test@enviable.example`, assigned
  the Sales Officer (Warehouse) role (the cost-blind role the seed already
  defines but doesn't have a user against). Used for the I-8 verification.

## Usage

The Postgres container is `enviable-postgres`. Run the SQL via `docker exec`
(no client install needed):

```bash
# Set up
docker exec -i enviable-postgres psql -U user -d enviable < scripts/dev-fixtures/setup-fixtures.sql

# Tear down (FK-safe order: movements, units, shipment, PO, user-role, user)
docker exec -i enviable-postgres psql -U user -d enviable < scripts/dev-fixtures/teardown-fixtures.sql
```

`setup-fixtures.sql` is idempotent (`ON CONFLICT DO NOTHING`); re-running is
safe. Teardown is also safe to re-run; missing rows are no-ops.

The fixture leaves the cost-blind user with the non-authenticating placeholder
password. To actually log in as the user, set a temporary password via the
backend's existing `set-password` script, then run the I-8 check:

```bash
cd ../enviable-system && npm run set-password -- costblind-test@enviable.example 'TempPassword!2026'
```

The backend's `reset-test-passwords` script does NOT cover this user (it's
scoped to the seeded five), so the password lives until you tear down the
fixture (`DELETE` cascades the password hash with the user row).
