# Backlog

Deferred work and known gaps. Items here are recorded as findings during a
build round, not promised by a specific deadline; surface them when planning
the next round so they become explicit candidates rather than rediscovered
items.

Each entry: a one-line title, a short body explaining the gap and the
interim behaviour, and (where relevant) a decision the next round needs
to make before the fix can land. Remove an entry once the work ships.

## Pending

### RETURN bucket not mirrored (movements reference resolution)

`MovementReferenceType.RETURN` is a value the backend emits (returns service
writes a RETURN-typed movement on both init and resolution), but the
frontend's `ENTITY_TYPES` in `src/lib/sync/mirror/types.ts` has no `return`
bucket. RETURN-referenced movements on the stock-movements detail page
therefore degrade to "entity bucket not yet mirrored; reference shown by
id" rather than a clickable deep link. The interim is honest (the id is
shown, no crash, no pretense) but the user cannot navigate to the return.

**Decision needed before the fix:** does a "returns" screen exist as its
own primary nav target, or is a return a sub-concept of a sales order
(surfaced inside the SO detail as a "this order had returns" section)?
The current nav has no `Returns` entry, which suggests the SO-sub-concept
model. If that's the model, the deep link from a RETURN movement should
go to the related sales order's detail page (with the return surfaced
within it), and `ENTITY_TYPES` still needs a `return` bucket so the join
can find the SO id from the return id.

**Scope when picked up:**
1. Confirm the data model: does a Return have a `salesOrderId` (or
   equivalent join column) the deep-link can resolve to?
2. Add `return` to the backend `ALL_TYPES` and the `referenceDelta` shape
   in `enviable-system/src/sync/sync-pull.service.ts`.
3. Add `return` to `ENTITY_TYPES` and `ReferenceData` /
   `REF_KEY_TO_ENTITY` in `src/lib/sync/mirror/types.ts`.
4. Update the RETURN case in `src/lib/movements/reference.ts` to do the
   join (return -> sales order or whichever model lands) and set the
   deep-link href.
5. Surface returns context on the sales-order detail page if that's the
   model.

### Verification-fixture password activation (clustered)

Several throwaway dev-fixture users are seeded with the placeholder hash
`$argon2id$PLACEHOLDER_RESET_REQUIRED` and need a single backend
`npm run set-password` call before they can drive Playwright verifications.
Grouped here so the activation work is one pass rather than rediscovered
round by round.

**Fixture users awaiting activation:**

| Email                                | Fixture id              | Role                | Unblocks |
|--------------------------------------|-------------------------|---------------------|----------|
| `costblind-test@enviable.example`    | fixt-user-costblind     | Stock Auditor       | true two-user cost-gating assertion (currently verified via mirror manipulation in `test-spare-parts.mjs` scenario D) |
| `confirmer-test@enviable.example`    | fixt-user-confirmer     | Sales Manager       | `pricelist.manage` supersede flow + SO confirmer flow (both pending) |

**Activation command** (run once from `enviable-system`):
```
npm run set-password -- <email> Password123!
```

**Action when picked up:** run the activation for each fixture user in
one pass, then any prior test that worked around the gap can be updated
to drive the true two-user / manage-capable flow directly. New verification
fixtures discovered later should be added to this table rather than as
sibling entries, so the activation step stays clusterable.

### Throwaway fixtures are the verification subjects, not seeded named accounts

Convention banked 2026-06-03. Playwright tests log in as throwaway dev-fixture
users (`*-test@enviable.example`) for any action that writes audit-attributable
state (price supersedes, SO confirmations, conflict resolutions, etc.). Seeded
named accounts (`theresa@`, `ikenna@`, `kelechi@`, `daniel@`, `itadmin@`)
represent real people in the organization and are reserved for those people's
own sessions; using them as test identities pollutes the audit log so the
"who did what" trail becomes less trustworthy.

Read-only Playwright assertions (mirror download, list rendering, navigation)
can use any user whose permissions match, including seeded named accounts,
because reads do not write audit entries. Writes go through throwaway fixtures.

### No SparePartMovement writer outside historical-load

Only `enviable-system/src/historical-load/historical-load.service.ts`
writes `SparePartMovement` rows today (audited 2026-06-02). Assembly does
not currently record a SparePartMovement when consuming parts, and there
is no manual adjustment endpoint. This is the MVP state per the
spare-parts module comment, but it has two downstream effects on the
movement-history UX:

1. The spare-part detail's movement timeline reads cleanly for stock
   that was received via the historical-load tool, but shows no entries
   for parts seeded directly via the dev fixtures or for any "consumed
   in assembly" activity. Fixed for fixtures by seeding a RECEIPT
   movement per part in `setup-fixtures.sql`; nothing to do for the
   assembly-consumption gap until the backend writes those movements.

2. The resolver in `src/lib/movements/reference.ts` already handles
   every MovementReferenceType, so the day a writer starts setting
   referenceType (e.g. ASSEMBLY_JOB on a "consumed in assembly"
   movement, or ADJUSTMENT on a manual write-off), the deep-link
   target is already wired. No frontend change required at that point.

**Action when picked up:** none on the frontend until the backend lands
a consumption-writing path. Surface here so it is visible when the
spare-parts inventory operations story moves forward.

### Spare-parts catalogue management: bulk-only

The spare-parts catalogue is read-only on the screen because the backend's
spare-parts controller exposes only GET endpoints. The only write path is
`/api/historical-load/spare-parts` (admin bulk-CSV import, gated
`historicalload.run`), which is not a "regular add-a-SKU" flow.

**Action when picked up:** if the business wants in-app spare-part
catalogue management (add a new SKU, edit an existing one's name /
description / status), the backend gets the create/update endpoints
first (POST /api/spare-parts, PATCH /api/spare-parts/:id, gated
something like `sparepart.manage`), and then the screen adds the
management actions as state-and-permission-gated, confirmed-update
forms following the existing pattern. No frontend action until the
backend lands the endpoints.

### Delivery artifact buckets not mirrored (deliveryNote / waybill / proofOfDelivery)

The deliveries screen ships against the salesOrder mirror bucket and
filters by delivery-related statuses; `deliveryNote`, `waybill`, and
`proofOfDelivery` are NOT in
`enviable-system/src/sync/sync-pull.service.ts:ALL_TYPES` and therefore
not in `enviable-web/src/lib/sync/mirror/types.ts:ENTITY_TYPES`.

**Schema audit (where the timestamps live):** `dispatchedAt` and
`deliveredAt` are columns on `SalesOrder` itself (schema.prisma:913-914),
populated by the `dispatch` and `recordProofOfDelivery` action handlers
in the same transaction as the satellite record write. So the
deliveries-list view renders both timestamps offline from the already-
mirrored `salesOrder` bucket without needing the satellite records.

**Affected screens:**
- `/sales/deliveries` (new): **NOT affected.** All list columns
  (SO#, Customer, Status, Released, Dispatched, Delivered) source from
  the mirrored salesOrder + customer buckets. The view's primary value
  is intact offline.
- `/sales/sales-orders/[id]` DeliveryCard (existing, prompt 7): the
  *workflow state* renders from the SO's status field (mirrored), but
  the *document details* are unavailable offline: delivery-note number,
  vehicle registration, driver name, prepared-at timestamp at the
  document level, waybill number, POD signer / signed-at. These
  surface as empty / missing on an offline SO detail post-dispatch.

**Decision needed before the fix:** the audit from prompt 18 noted that
the delivery workflow as built does NOT have offline-queueable write
actions (createDeliveryNote, dispatch, recordProofOfDelivery are all
online-only by current implementation, similar to price-setting). Adding
the mirror buckets without also adding the offline-queue support gives
half the picture; the full offline-capable delivery workflow needs both.
The stakeholder question: is offline delivery workflow a priority? (A
delivery dispatcher in the field with intermittent connectivity might
need it; an in-warehouse dispatcher operating from a desk station may
not.)

**Scope when picked up:**
1. Confirm the stakeholder priority on offline-capable delivery actions.
2. Add `'deliveryNote', 'waybill', 'proofOfDelivery'` to backend
   `ALL_TYPES` in sync-pull.service.ts and the matching `referenceDelta`
   shape.
3. Add the same three to `ENTITY_TYPES` and `ReferenceData` /
   `REF_KEY_TO_ENTITY` in `src/lib/sync/mirror/types.ts`.
4. If offline-queue support is in scope: add the three delivery actions
   to backend `SyncActionType` enum + dispatch cases + payload DTOs;
   add queue helpers and wire the DeliveryCard form for offline submit
   following the assembly Start / Complete / Fail pattern from prompt
   14b.
5. Add the deliveries-list "has note / has POD" diagnostics once the
   buckets land in the mirror.

### TRANSFER referenceType: defined but unwritten

`MovementReferenceType.TRANSFER` is defined in the backend enum but no
service writes it today (audited in
`enviable-system/src/{shipments,sales-orders,assembly,returns,units}/*`).
The frontend's reference resolver handles the case for forward
compatibility (renders without crashing) but there is no deep-link
target because there is no entity to link to yet.

**Action when transfer movements start being written:** wire the
deep-link target in `src/lib/movements/reference.ts` to whatever entity
tracks transfers (probably a future `inventoryTransfer` model). Until
then, no action; the defensive case in the resolver is correct.
