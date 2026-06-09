# Demo guide

Everything you need to show the system end-to-end on a demo call.

- **Frontend**: `http://localhost:3100`
- **Backend**: `http://localhost:3000` (proxied by the frontend at `/api/*`)
- **Database**: Postgres in the `enviable-postgres` docker container

All demo users below share the password **`Password123!`**. They are real
seeded or fixture users with real role assignments; the password is shared
for demo convenience, not because credentials are weak by design.

## Pre-call checklist

1. Backend is running: `cd ~/WebstormProjects/enviable-op/enviable-system && npm run start:dev`
2. Frontend is running: `cd ~/WebstormProjects/enviable-op/enviable-web && npm run dev`
3. Postgres container is up: `docker ps | grep enviable-postgres`
4. Fixtures are applied: `psql ... -f scripts/dev-fixtures/setup-fixtures.sql` (idempotent)
5. Demo passwords are active (this guide just confirmed):
   `npm run set-password -- <email> Password123!` for each user if needed

## Demo users by role

The system has 11 roles; every role has at least one demo-ready user. Use the
left column to log in; the right two columns tell you what to show.

| Email                                | Password         | Role                            | Best screens to show                                                                                                  |
| ------------------------------------ | ---------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `md-demo@enviable.example`           | `Password123!`   | Managing Director               | Cross-domain read + PO approval; reports (stocks, revenue, customers); admin placeholders                             |
| `theresa@enviable.example`           | `Password123!`   | Executive Director              | Same as MD plus `approval.manage` and `pi.review`; the screen demo person should land here for "the CEO view"        |
| `ikenna@enviable.example`            | `Password123!`   | General Manager                 | The broadest operational hands-on role: counterparty/shipment/pricelist manage, delivery/return manage, unit.adjust  |
| `daniel@enviable.example`            | `Password123!`   | Executive Assistant + Procurement Officer | Procurement workflow: PO create/submit, PI review, shipment receive, landed cost allocate, counterparty manage |
| `kelechi@enviable.example`           | `Password123!`   | Warehouse Manager               | Warehouse operations: assembly.perform, unit.adjust, unit.transfer, sparepart.manage, conflict.resolve                |
| `confirmer-test@enviable.example`    | `Password123!`   | Sales Manager                   | Sales side: salesorder.create + discount, pricelist.manage, payment.confirm, customer.manage                          |
| `sales@enviable.example`             | `Password123!`   | Sales Officer (Warehouse)       | The minimum-permission sales-creating role: salesorder.create, customer.manage, payment.record (no costdata.view)     |
| `costblind-test@enviable.example`    | `Password123!`   | Stock Auditor                   | Cost-blind inventory + stocks report (no `costdata.view`): showcases the absence-on-mirror cost-gating pattern        |
| `auditor-test@enviable.example`      | `Password123!`   | Internal Auditor / Compliance   | `/reports/audit-log` (only audit.read holder), `/reports/revenue` and `/reports/customers` (cost-blind reports)       |
| `itadmin@enviable.example`           | `Password123!`   | IT Admin                        | The only user with `historicalload.run`: shows `/admin/historical-load` (shipment + units + spare-parts bulk import)  |
| `salesofficer-test@enviable.example` | `Password123!`   | Sales Officer (Warehouse)       | Duplicate of `sales@` for adversarial-permission demonstration; same screens                                          |
| `procurement-test@enviable.example`  | `Password123!`   | Procurement Officer             | Same scope as Daniel's procurement side (without the EA-to-ED overlay)                                                |

## Suggested demo flow

A natural 30-45 minute walkthrough touching every domain:

1. **Login + the topbar** — log in as `theresa@`. Show the nav (Procurement,
   Inventory, Sales, Reports, Admin). Point out the role-aware UI: switching
   users below will show how items appear / disappear based on permission.

2. **Procurement** — log in as `daniel@` (Procurement Officer). Show:
   - `/procurement/counterparties` (managed catalogue, can create new supplier)
   - `/procurement/purchase-orders` (5 POs in various states; click one)
   - `/procurement/proforma-invoices` (the I-5 supersede pattern — multi-revision PIs)
   - `/procurement/shipments` (5 shipments; click one to show manifest + units)

3. **Inventory** — stay as `daniel@` or switch to `kelechi@` (Warehouse Manager). Show:
   - `/inventory/units` (79 units in various statuses; CKD, CBU, ASSEMBLY, SOLD, etc.)
   - `/inventory/units/[id]` (full unit detail with lifecycle history)
   - `/inventory/assembly-jobs` (15 jobs; click one)
   - `/inventory/movements` (109 stock movements; the append-only event log)
   - `/inventory/spare-parts` (3 spare parts with stock)

4. **Sales** — switch to `confirmer-test@` (Sales Manager). Show:
   - `/sales/customers` (3 customers, click one)
   - `/sales/sales-orders` (5 SOs across states: AWAITING_PAYMENT, PAYMENT_RECEIVED, RELEASE_AUTHORISED, DISPATCHED, DELIVERED)
   - `/sales/sales-orders/[id]` (full lifecycle: order → invoice → payment → release → delivery)
   - `/sales/price-lists` (13 tier-priced entries; the pricelist.manage flow)

5. **Reports cluster** — switch to `theresa@` for full reports access. Show:
   - `/reports/stocks` (current stock holdings with cost basis)
   - `/reports/revenue` (released-order revenue with the cost margin block)
   - `/reports/customers` (per-customer sales + outstanding receivables)

6. **Cost-gating demo** — switch to `auditor-test@` (audit.read + cost-blind):
   - Same `/reports/revenue` and `/reports/customers` — point out that cost
     columns and the Margin KPI are **absent from the DOM** (not zeroed, the
     absence-on-mirror pattern).
   - `/reports/audit-log` — the comprehensive trail. Filter by `action=counterparty.update`
     and expand a row to show the `Before` / `After` JSON diff (the Before
     column populates from `aaf7003` onward; earlier entries show the
     "Prior state not captured" explanation).

7. **Offline demo** — stay logged in, open DevTools, set Network to Offline:
   - Navigate to `/inventory/units`, `/sales/sales-orders`, `/reports/revenue`.
     Pages still render from the IndexedDB mirror.
   - Reports show the `Computed from cached data` disclosure; audit-log shows
     the red `Showing cached audit entries from ... onward` disclosure.

8. **Admin** — switch to `itadmin@`. Show:
   - `/admin/users` and `/admin/roles`: the not-yet-built placeholders that
     explain deferred capability honestly.
   - `/admin/historical-load`: bulk CSV import for units + spare parts. Use
     the samples in `/sample` (`historical-units.csv` and
     `historical-spare-parts.csv`). Show the dry-run-then-commit safety
     pattern: commit stays locked until a clean dry-run lands.

9. **Permission-denied demo** — switch to `sales@` (minimum-permission Sales
   Officer). Navigate to `/reports/audit-log`: clean access-denied card with
   the role hint. Same for `/reports/revenue` (no `report.revenue`).

## Current data volumes

For reference, the demo environment currently has:

- 7 counterparties (1 supplier + 4 logistics service partners + 2 fixtures)
- 3 customers (1 active reseller, 1 volume buyer, 1 dormant)
- 2 products with 5 variants
- 5 purchase orders + 7 proforma invoices (multi-revision)
- 5 shipments + 79 units (across 11 statuses)
- 15 assembly jobs
- 5 sales orders + 3 lines + 4 invoices + 6 payments + 4 release authorisations
- 3 spare parts + 1 movement (low; live demo can add via historical-load)
- 109 stock movements
- 240+ audit log entries (grows with every demo action)
- 13 price-list entries

Most screens have real data. Two screens that look empty by design:

- `/sales/deliveries` (0 delivery notes + 0 waybills): the post-release
  delivery flow hasn't been exercised; the demo can perform a fresh delivery
  live from a `RELEASE_AUTHORISED` SO if you want to populate this.
- `/inventory/spare-parts/[id]` movements tab will be sparse (1 movement
  total); use `/admin/historical-load` to bulk-load more if desired.

## Known deferred features (don't show as broken)

Surface these as "deliberate scope cuts" rather than gaps if asked:

- **In-app user / role management** (`/admin/users`, `/admin/roles`): backend
  endpoints not yet built; the placeholder pages explain this. Current
  workflow is the seed + `set-password` script.
- **In-app product / variant management**: same shape; catalogue is seed-only.
- **Document generation (PDFs)**: not built; invoice + waybill records exist
  as data but render in-app only, no print/PDF.
- **Email notifications**: no email infrastructure wired up.
- **Returns workflow UI**: backend endpoints exist (`return.manage`); no
  dedicated screen yet.

All tracked in `BACKLOG.md` with the precise shape and recommended next steps.

## Resetting the demo

If the demo environment gets messy mid-call:

```bash
# From enviable-web:
psql ... -f scripts/dev-fixtures/teardown-fixtures.sql
psql ... -f scripts/dev-fixtures/setup-fixtures.sql

# Then re-activate demo passwords from enviable-system:
for u in md-demo theresa ikenna daniel kelechi itadmin sales \
         confirmer-test salesofficer-test costblind-test auditor-test procurement-test; do
  npm run set-password -- "${u}@enviable.example" "Password123!"
done
```

## Per-user permission detail

The role-permission lists below were captured from `GET /api/auth/me` at
demo prep time. Use them to predict what each user can or can't do in the UI.

### Managing Director (`md-demo@`)

23 permissions: read across procurement, inventory, sales; PO approval;
payment confirmation; all reports including cost; user.read + role.read.
Approval flows are read-only at this level (`approval.read` without
`approval.manage`).

### Executive Director (`theresa@`)

25 permissions: same as MD plus `approval.manage` and `pi.review`. The
"final say" role.

### General Manager (`ikenna@`)

32 permissions: the broadest operational role. Manages counterparties,
shipments, pricelists, deliveries, returns; can adjust units and resolve
conflicts. Everything except IT-side capabilities (no
`historicalload.run`, no `audit.read`, no `user.manage`).

### Executive Assistant + Procurement Officer (`daniel@`)

21 permissions: procurement-side write access (PO create/submit, PI review,
shipment receive, landed cost manage, counterparty manage) plus
`costdata.view`. Does NOT confirm payments (sales-side).

### Warehouse Manager (`kelechi@`)

18 permissions: warehouse operations (assembly.perform, unit.adjust,
unit.transfer, shipment.receive, sparepart.manage) plus delivery and
return management. Holds `costdata.view`.

### Sales Manager (`confirmer-test@`)

16 permissions: salesorder.create + discount, customer.manage,
pricelist.manage, payment.confirm. The full sales-side write surface.
Holds `costdata.view` so revenue/customers reports show cost columns.

### Sales Officer Warehouse (`sales@`, `salesofficer-test@`)

9 permissions: minimum sales-creating role. salesorder.create (NO
discount), customer.manage, payment.record (NOT confirm). NO
`costdata.view`. Used to demonstrate the separation-of-duties around
payment confirmation.

### Stock Auditor (`costblind-test@`)

6 permissions: read-only inventory + movements + spare parts + stocks
report. Explicitly no `costdata.view`; the canonical cost-blind viewer.

### Internal Auditor / Compliance (`auditor-test@`)

10 permissions: the ONLY non-IT role with `audit.read`. Plus the three
report permissions (stocks, revenue, customers) WITHOUT `costdata.view`,
which is the canonical cost-blind reporting view used to demonstrate the
absence-on-mirror pattern.

### IT Admin (`itadmin@`)

49 permissions: the most-permitted role. The ONLY role with
`historicalload.run`, `role.manage`, `user.manage`, `toggle.manage`.
Also the only non-auditor role with `audit.read`. Use this user to
demonstrate the historical-load surface; switch to another role when
demoing role-aware UI gating.

### Procurement Officer (`procurement-test@`)

18 permissions: procurement-side write access without the EA-to-ED
overlay Daniel has. Same procurement screens; cleaner for adversarial
permission demonstration.
