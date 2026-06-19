# Write-flow completeness audit

Investigation only (no implementation). Cross-references every backend write
endpoint in `enviable-system` against the frontend's API wrappers and component
wiring in `enviable-web`, to surface unbuilt write flows before launch. Prompted
by the late discovery that the proforma-invoice create flow had a live backend
endpoint and API wrapper but no UI (now shipped, prompt 35).

Date: 2026-06-19. Method: backend controller enumeration + frontend
import-presence check + permission-key usage sweep.

## Executive summary

- **Backend write endpoints (POST/PATCH/PUT/DELETE): 51** across 18 modules.
- **WIRED (reachable through a component): 37.**
- **UNWIRED (API wrapper exists but no component imports it): 0.** The API layer
  and the component layer are in lockstep; there are no stranded wrappers. Every
  gap is a clean "not built on either layer," not a half-built wrapper.
- **MISSING (backend endpoint exists, no frontend wrapper and no UI): 13.**
- **Unused-by-design (not a gap): 1** (sync conflict resolve; the frontend
  resolves conflicts client-side).
- **Forward-declared permission modules with no backend controller yet: 3**
  (feature toggles, approval rules, documents).

Recommendation counts: **BUILD NOW: 2** (shipment create/update, SO cancel);
**BUILD NOW or DEFER, needs Theresa's operational input: 2** (unit lifecycle
transitions, returns); **DEFER POST-LAUNCH: 2** (landed costs, parent-product
management, the latter backend-first); **DELIBERATELY NOT BUILDING for launch: 2
groups** (roles management, the toggle/approval/document modules).

Headline: the core operating loops are complete end to end. Procurement
(PO -> PI -> receive -> stock), sales (SO -> payment -> release -> delivery ->
close), assembly, pricing, variant management, customers, counterparties, users,
and historical load are all wired. The gaps cluster in lifecycle edges (unit
adjustments, returns, SO cancel), one procurement-chain link (creating a
shipment against a PO), costing (landed costs), and admin/governance modules
that were deliberately deferred.

## Per-module status

Legend: WIRED / MISSING (no frontend path) / DESIGN (unused by design) /
INTENTIONAL (deliberately not built for launch).

| Module | Endpoint | Perm | Status |
|--------|----------|------|--------|
| Auth | POST /api/auth/login, logout, reset-password | public/self | WIRED |
| Users | POST/PATCH/DELETE /api/users, POST :id/reset-password-required | user.manage | WIRED |
| Roles | POST/PATCH/DELETE /api/roles | role.manage | INTENTIONAL (read-only by decision) |
| Customers | POST/PATCH/DELETE /api/customers | customer.manage | WIRED |
| Counterparties | POST/PATCH/DELETE /api/counterparties | counterparty.manage | WIRED |
| Product variants | POST/PATCH /api/product-variants | productvariant.manage | WIRED |
| Products (parent) | (no backend write endpoints) | - | MISSING, backend-first |
| Pricing | POST /api/price-list | pricelist.manage | WIRED |
| Purchase orders | POST/PATCH, :id/submit, :id/approve | po.create/submit/approve | WIRED |
| Proforma invoices | POST (create), :id/approve, :id/reject | pi.review | WIRED |
| Shipments | POST /api/purchase-orders/:poId/shipments (create) | shipment.manage | **MISSING** |
| Shipments | PATCH /api/shipments/:id (update) | shipment.manage | **MISSING** |
| Shipments | :id/receive-units, :id/resolve-variance, :id/complete-receipt, :id/close | shipment.receive/manage | WIRED |
| Landed costs | POST :id/landed-costs, PATCH /landed-costs/:id, POST :id/allocate-landed-cost | landedcost.manage + costdata.view | **MISSING** |
| Sales orders | POST/PATCH, :id/submit, :id/invoice, :id/authorise-release | salesorder.create / payment.confirm | WIRED |
| Sales orders | POST /api/sales-orders/:id/cancel | salesorder.create | **MISSING** |
| Payments | POST :id/payments, :id/confirm, :id/reject | payment.record/confirm | WIRED |
| Delivery/Release | delivery-note, waybill, dispatch, proof-of-delivery, close | delivery.manage | WIRED |
| Returns | POST :id/returns, :id/inspect, :id/resolve | return.manage | **MISSING** |
| Assembly | POST /api/assembly-jobs, :id/complete, :id/fail | assembly.perform | WIRED |
| Units | POST /api/units/:idOrEngineNumber/adjust | unit.adjust | **MISSING** |
| Historical load | shipment, units/:shipmentId, spare-parts | historicalload.run | WIRED |
| Sync | POST /api/sync/id-ranges, /api/sync/actions | self | WIRED (engine) |
| Sync | POST /api/sync/conflicts/:id/resolve | conflict.resolve | DESIGN (resolved client-side) |

## Gap inventory

### G1. Create / update a shipment against a PO  — BUILD NOW (verify with Theresa)
Endpoints: `POST /api/purchase-orders/:poId/shipments`, `PATCH /api/shipments/:id` (`shipment.manage`).
Workflow: after a PO is approved and the supplier's PI is recorded, procurement
creates the inbound shipment (the consignment to receive against). The receiving
flow (receive-units, resolve-variance, complete-receipt, close) is fully wired,
but there is no UI to CREATE the shipment it receives against. Today shipments
only enter via historical-load (legacy back-loading). For ongoing operations the
"create shipment for this PO" step is the missing link in the procurement chain.
Operationally **critical** for the live procurement loop (without it, new POs
cannot be received in-app). Scope: MEDIUM (a create form on the PO detail or
shipments list, manifest lines from the PO). Verify with Theresa whether
shipments are expected to originate in-app or are imported.

### G2. Cancel a sales order  — BUILD NOW
Endpoint: `POST /api/sales-orders/:id/cancel` (`salesorder.create`).
Workflow: a clerk creates an SO in error, or a customer backs out before
fulfilment. The backend supports cancellation; there is no UI button. Without
it, abandoned/erroneous SOs cannot be closed out and clutter the pipeline.
Operationally **substantial**, very common. Scope: SMALL (one gated, confirmed
action on the SO detail page, alongside the existing submit/invoice/release
actions).

### G3. Unit lifecycle transitions / adjustments  — BUILD NOW or DEFER (needs Theresa)
Endpoint: `POST /api/units/:idOrEngineNumber/adjust` (`unit.adjust`; the seed
also defines `unit.transfer`).
Workflow: warehouse/ops needs to move a unit to repair, mark it demo or
internal-use, record a return-to-stock, or transfer between warehouses. The unit
domain has rich backend states (IN_REPAIR, DEMO, INTERNAL_USE, RETURNED, with
REPAIR_IN/REPAIR_OUT/RESTOCK_FROM_REPAIR movements) but the units screen is
read-only. Operationally **substantial**; how urgent depends on whether day-one
ops include repair/demo/transfer handling. Scope: MEDIUM-LARGE (an adjust action
with a state-transition picker on the unit detail). Ambiguous: could be BUILD
NOW (at least repair + restock + demo) or DEFER (if these states are rare at
launch). Flag for Theresa.

### G4. Returns module  — BUILD NOW or DEFER (needs Theresa)
Endpoints: `POST /api/sales-orders/:id/returns`, `POST /api/returns/:id/inspect`,
`POST /api/returns/:id/resolve` (`return.manage`).
Workflow: a customer returns a defective or unwanted unit; ops initiates a
return, inspects it, and resolves it (restock / refund / scrap). The backend
built the full three-step returns flow; the frontend has no returns UI at all
(no list, no detail, no actions). Operationally **substantial to critical** for a
physical-goods sales business. The backend investment suggests it was deemed
needed. Scope: MEDIUM-LARGE (a returns list + detail + the three actions).
Ambiguous: depends on whether returns are a day-one workflow. Flag for Theresa.

### G5. Landed-cost entry and allocation  — DEFER POST-LAUNCH (verify)
Endpoints: `POST /api/shipments/:id/landed-costs`, `PATCH /api/landed-costs/:id`,
`POST /api/shipments/:id/allocate-landed-cost` (`landedcost.manage` +
`costdata.view`).
Workflow: finance enters freight/insurance/duty/handling costs on a shipment and
allocates them across the received units to compute true landed cost per unit
(feeding margin reporting). The cost FIELDS are already surfaced read-side
(reports show landedCost/margin when `costdata.view`), but there is no UI to
ENTER or ALLOCATE landed costs; the values can only be seeded. Operationally
**substantial** for accurate costing/margin, but deferrable if launch does not
depend on in-app cost analysis (costs can be back-loaded). Scope: MEDIUM. Verify
with Theresa whether costing is launch-critical.

### G6. Parent-product management  — DEFER POST-LAUNCH (backend-first)
The products controller is read-only (no write endpoints). Variant management
exists, but creating a brand-new parent Product (a new model line) requires
backend endpoints that do not exist yet (`POST/PATCH/DELETE /api/products`).
New product models are infrequent, so an engineer-assisted insert is an
acceptable interim. Backend-first: the API must exist before a UI can be built.
Already noted in BACKLOG.

### G7. Roles management  — DELIBERATELY NOT BUILDING (for launch)
Endpoints: `POST/PATCH/DELETE /api/roles` (`role.manage`). The roles screens are
intentionally read-only (gated `role.read`); runtime role editing is a documented
pending stakeholder decision. Roles are seeded at the system level. `role.manage`
is referenced nowhere in the frontend, consistent with the decision. Keep
deferred unless Theresa wants in-app role editing at launch.

### G8. Feature toggles / approval rules / documents  — DELIBERATELY NOT BUILDING
The seed forward-declares `toggle.read/manage`, `approval.read/manage`, and
`document.read/manage`, but no backend controllers were found for these modules
and the frontend references none of the keys. These are future modules whose
permissions were declared ahead of implementation. Not part of MVP scope.

### Not a gap: sync conflict resolution
`POST /api/sync/conflicts/:id/resolve` (`conflict.resolve`) is unused by the
frontend by design. The conflicts UI (`/sync/conflicts` + detail) resolves
client-side by dismissing/discarding the queued action (`removeByClientId`); it
does not call the backend resolve endpoint. The conflict workflow is complete on
the frontend; the backend endpoint is simply a path the current resolution model
does not use.

## Recommendations (ordered for sequencing)

BUILD NOW (close before the stakeholder bundle / launch):
1. **SO cancel** — SMALL. One gated action on the SO detail page. Highest
   value-to-effort; ship first.
2. **Create/update shipment against a PO** — MEDIUM. Completes the procurement
   chain so new (non-legacy) POs can be received in-app. Confirm shipment origin
   with Theresa, then build.

BUILD NOW or DEFER (decide with Theresa's operational reality first):
3. **Unit lifecycle transitions (adjust/transfer)** — MEDIUM-LARGE. Build at
   least repair / restock / demo if day-one ops need them.
4. **Returns module** — MEDIUM-LARGE. Build if returns are a day-one workflow;
   the backend is ready.

DEFER POST-LAUNCH (acceptable to launch without; document the rationale):
5. **Landed-cost entry/allocation** — MEDIUM. Costs can be back-loaded; build
   when in-app costing becomes a priority. Confirm not launch-critical.
6. **Parent-product management** — backend-first; rare operation.

DELIBERATELY NOT BUILDING for launch (state explicitly to Theresa):
7. **Roles management** — pending stakeholder decision; roles seeded at system
   level.
8. **Toggles / approvals / documents** — forward-declared modules, out of MVP
   scope.

## Meta note

Per-prompt verification is forward-looking (this prompt's work passes its
assertions) and does not audit backward (is the cumulative system complete).
The PI-create gap and the gaps above are the class that a per-prompt posture
will not surface. The remedy is this kind of end-of-build completeness audit
before declaring "done," run against the API contract as the source of truth.
