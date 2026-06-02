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
