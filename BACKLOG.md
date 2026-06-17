# Backlog

Deferred work and known gaps. Items here are recorded as findings during a
build round, not promised by a specific deadline; surface them when planning
the next round so they become explicit candidates rather than rediscovered
items.

Each entry: a one-line title, a short body explaining the gap and the
interim behaviour, and (where relevant) a decision the next round needs
to make before the fix can land. Remove an entry once the work ships.

## Pending

### BACKEND: invoice template assets land in the wrong dist path

Found while booting the backend to run the invoice e2e suite. The
backend (`enviable-system`) crashes on startup with
`ENOENT ... dist/src/documents/templates/invoice-styles.css`. The
compiled `InvoiceTemplateEngine` (`dist/src/documents/template-engine.js`)
reads templates and font/logo assets from its own `__dirname`, i.e.
`dist/src/documents/templates` and `dist/src/documents/assets`. But
`nest-cli.json` copies those assets to `dist/documents/templates` and
`dist/documents/assets` (the `assets` entries use `outDir: "dist"` with
includes relative to `sourceRoot: "src"`, so they land one level above
where the engine looks). Result: a clean `nest build` + run cannot render
any invoice PDF/HTML; the module fails to instantiate.

Interim (verification only, no source edit): the assets were copied into
`dist/src/documents/templates` and `dist/src/documents/assets` by hand so
the backend could boot for the e2e run.

**Action (backend session, not this repo):** fix the `nest-cli.json`
asset `outDir` to `dist/src` (or change the engine's base path), so a
plain `nest build` places the templates/fonts/logo where the engine
reads them. Add a smoke check that the PdfRendererService instantiates
after a clean build.

### Responsive pass (prompt 29): findings surfaced during audit

Full audit + proposed strategy live in `RESPONSIVE.md` (repo root), awaiting
sign-off before implementation. Findings banked here per convention:

- **The frontend-design skill carries no responsive guidance.** It is the
  generic creative-design skill (typography / colour / motion); it has no
  breakpoint tokens, table-to-card patterns, or navigation-collapse
  conventions. The responsive patterns chosen during this pass should be
  formalised as the project's responsive standard (design system / a project
  skill) so future screen builds inherit them rather than re-deciding case by
  case. Recommended as a follow-up once the patterns are settled.
- **Dialog primitive (resolved in Phase 2).** Correction to the original
  finding: the app had exactly ONE true overlay modal (`fixed inset-0`,
  historical-load), not five. The PI / counterparties / assembly / SO
  "dialogs" are inline `role="dialog"` confirmation panels that flow with the
  page. Extracted `src/components/ui/Modal.tsx` (responsive overlay) and
  migrated the one overlay; future overlay modals (prompt 31 user-creation)
  should use it.
- **Topbar search + user chip have no shrink behaviour**, so even
  content-light pages force a wide min-width. Part of the cross-cutting shell
  fix in the responsive pass.
- **Baseline:** only 1 of 70 component/page files uses any responsive utility;
  `<main>` renders at 163px on a 375px viewport because the 212px sidebar never
  collapses. This is a from-zero responsive pass.

### Product / variant catalogue has no management surface

Same shape as the users / roles gap, surfaced during the prompt 27
historical-load audit. The products controller
(`enviable-system/src/products/products.controller.ts`) exposes only
`GET /api/products` (list). There is NO:

- `POST /api/products` or `POST /api/product-variants` to create
- `PATCH /api/products/:id` or `PATCH /api/product-variants/:id` to edit
- `DELETE` to soft-delete or reactivate
- `historical.variants` handler under historical-load (only Shipment, Units,
  SpareParts; variants are not bulk-loadable)

There is no `product.manage` or `productvariant.manage` permission in the
catalogue (the products controller's gate is `product.read` for the list and
nothing else). Variants are 100% seed-managed: defined in
`enviable-system/prisma/seed.ts` and applied at deploy time. Adding a new
variant (e.g., a new model/colour combination) requires an engineer to edit
the seed and redeploy, same as adding a new user or modifying a role.

**Impact**: for a static catalogue this is fine (the seeded 3 variants cover
the current TVS King / ZS+ lineup). For a growing catalogue (new models, new
colours, supplier-changing-SKU-codes, variant retirements), the seed-and-
redeploy workflow is friction-heavy. The decision parallels the user-management
question: is the catalogue stable enough that seed-only is sufficient, or does
operational reality need runtime management?

**Recommended path** (same shape as the users/roles backend round):

1. `ProductsController` add `POST` for product creation, `PATCH`/`POST` for
   product update / retire. Same for `ProductVariantsController` (likely a
   new module) with `POST`/`PATCH`/`DELETE`. `@Audit` annotations on each
   mutation; @-RequirePermissions on `product.manage` and
   `productvariant.manage` (also need to seed these into the catalogue and
   grant to General Manager or similar).

2. Frontend: a `/catalogue/products` and `/catalogue/variants` (or unified
   `/catalogue` with tabs) screen for list/detail/create/edit. The mirror's
   product and productVariant buckets already exist (read-only); the
   management surface would be online-only writes (same pattern as
   counterparties).

3. Historical-load could optionally grow a `historical.variants` handler
   for bulk catalogue imports (one-off migrations of an existing variant
   catalogue from a spreadsheet). Same CSV + dry-run/commit shape as the
   existing handlers.

**Priority**: same framing as users/roles. Low for the operational system
(catalogue is stable); should be addressed if/when a regular cadence of
variant changes becomes operational reality. Stakeholder decision for
Theresa alongside the other deferred admin surfaces. No frontend
placeholder needed currently since there is no nav entry for variants
(unlike users/roles which had dead-link nav entries; variants have no
catalogue nav, the existing products list at `/inventory/units` flows
through variant context as a join, not as a standalone catalogue screen).

### Admin cluster screens have no backend surface (users, roles)

The `/admin/users` and `/admin/roles` nav entries (and the prompt 25 / prompt 26
builds they map to) have no implementable backend surface. Audit findings
(2026-06-03):

- **No users controller, no `/api/users` endpoints.** Survey of every
  `@Controller(...)` in `enviable-system/src` returns no users module. No
  list-all-users endpoint, no detail endpoint, no create, no
  deactivate/reactivate, no role-assignment endpoint. Nothing to call.
- **No roles controller, no `/api/roles` endpoints.** Same shape; no surface.
- **Permissions ARE defined and granted, but reference capabilities that
  don't exist.** `prisma/seed.ts:77-80` defines `user.read`, `user.manage`,
  `role.read`, `role.manage` in the permission catalogue. Three roles hold
  `user.read` and `role.read`: Managing Director, Executive Director, General
  Manager (so Theresa, the MD and the GM all see the `/admin/users` nav link
  rendered, but clicking it would lead to a 404 since no page is built and no
  API exists). NO role holds `user.manage` or `role.manage` — those two are
  defined-on-arrival but dead-on-arrival; not even IT Admin holds them.
- **Mirror's `user` bucket is minimal by design.** `sync-pull.service.ts:364`
  emits only `{ id, fullName, updatedAt }`. Email, status, role list are NOT
  in the mirror. The sync-pull docblock explicitly notes "Role labels are NOT
  mirrored: User-Role is many-to-many via UserRole (no single roleId), so
  resolving role names offline would need users + userRoles + roles joined
  client-side (a frontend change)." The minimal shape is for offline-
  attribution (so a deactivated staffer's name still resolves on past
  actions), not for an admin directory.

**Impact**: the frontend cannot build `/admin/users` or `/admin/roles` in any
meaningful shape without backend work first. A thin shell that papers over
the missing surface (mock data, mirror-only minimal directory) would violate
the "API is the source of truth" principle and silently break the screen's
primary value. The current state has a latent dead-link bug: the nav links
render for any user with `user.read` / `role.read` (Theresa included) and lead
to 404 on click.

**Recommended backend round** (before resuming prompts 25 / 26):

1. **Users controller**: `GET /api/users` (paginated list with status / role /
   name filters), `GET /api/users/:id` (detail with roles + reportsTo +
   status), `POST /api/users` (create without password; initial-password
   flow needs stakeholder decision — see below), `PATCH /api/users/:id`
   (update fullName / roles / status / reportsTo), `POST /api/users/:id/
   deactivate` (soft-delete), `POST /api/users/:id/reactivate`. Permissions
   `user.read` and `user.manage` (and seed `user.manage` into IT Admin role
   so someone can actually use the manage endpoints).

2. **Roles controller**: `GET /api/roles` (list with permission grants),
   `GET /api/roles/:id` (detail with assigned users + permissions),
   permissions `role.read` and `role.manage`. Whether roles are mutable at
   runtime or are seed-only is a stakeholder decision (the simpler shape is
   read-only view of seeded roles; the more flexible shape is full
   management). Roles being mutable opens questions about migrations and
   permission-grant audit trails, so read-only is the safer default.

3. **Mirror surface adjustment**: if `/admin/users` needs offline read at
   all, the `user` bucket needs to grow to include email, status, and the
   user-role junction (or a denormalised `roles: string[]` projection). This
   is a sync-pull change. The simpler shape is online-only-with-honest-notice
   (like the audit log's was originally framed), since admin surfaces are
   not field-device workflows.

4. **Stakeholder decision: initial-password flow.** When an admin creates a
   new user in the UI, how does the new user get their first password?
   Options: (a) generated, displayed once to the admin, never stored (admin
   reads it out / pastes into a secure channel); (b) generated, emailed to
   the new user (requires email infrastructure); (c) admin runs
   `set-password` script separately after creating the user in the UI (no
   in-UI password flow at all, the cleanest from a security perspective);
   (d) password-reset-link flow with self-service (requires email infra and
   a token-expiry surface). The `set-password` script already exists; option
   (c) is the minimum-viable path, with the create-user flow returning the
   user record and an explicit "set this user's initial password via the
   set-password script before they can sign in" message.

5. **Other admin permissions also defined-but-unimplemented**:
   `approval.read`, `approval.manage`, `toggle.read`, `document.read`,
   `document.manage` are similarly seeded with no controllers. Same pattern,
   same backend gap. None have nav entries currently; left as backend-side
   findings.

**Frontend interim choices** (to prevent the dead-link footgun until the
backend round lands):

- **Option (i)**: leave the nav links as-is, accept the 404 (worst — silent
  user-confusion, violates the no-silent-skips principle at the nav layer).
- **Option (ii)**: comment out the `/admin/users` and `/admin/roles` nav
  entries in `src/lib/nav/config.ts` until the backend ships (cleanest, but
  loses the affordance that "user admin is intended to exist").
- **Option (iii)**: ship a placeholder page at each route that, for any user
  with the permission, renders "This surface is not yet available; the
  backend endpoints have not been implemented. See BACKLOG.md for the
  required backend work." (honest, prevents the 404, preserves the
  affordance, ~30 lines per page).

Recommended: option (iii) — honest about the gap, prevents the dead link,
mirrors the access-denied treatment pattern but for "not yet built" rather
than "denied."

**Priority**: low for the actual user/role management features (system is
operable without them; user admin happens via seed + `set-password` script
during the build phase), but the dead-link footgun should be fixed before
Theresa or anyone else clicks `/admin/users` and hits a 404 in a demo. The
backend round to implement the actual surface can defer until after go-live
or whenever user management becomes operationally needed.

### Audit-log cost-strip asymmetry: direct-read preserves landedCost, sync-pull strips it

The audit-log report's offline view silently loses cost-bearing fields for
users with audit.read but without costdata.view (e.g., the Internal Auditor
seed role). Asymmetry confirmed empirically (2026-06-03):

- ONLINE (via `GET /api/reports/audit-log`): the controller is `@SkipCostStrip()`,
  so the global `CostVisibilityInterceptor` is bypassed. Audit entries return
  with the full nested JSON, including `landedCost` inside a Shipment's
  `afterState.units[]`. This is documented intent per I-8 (privacy of the audit
  log comes from gating audit.read narrowly, not from sanitising rows).
- OFFLINE (from the mirror, populated via `GET /api/sync/pull`): the sync-pull
  controller is NOT `@SkipCostStrip()`, so the same `CostVisibilityInterceptor`
  runs. The interceptor recursively walks the response tree and strips any key
  named `landedCost` or `landedCostPerUnit` at every nesting level, including
  inside audit entries' `beforeState`/`afterState` JSON blobs. For an auditor-
  test (cost-blind) user, the mirror's audit entries have `landedCost` absent
  from nested Unit snapshots.

**Net effect**: the same auditor-test user, querying the same audit entry,
sees different data depending on whether they are online (cost-bearing fields
visible per @SkipCostStrip intent) or offline (cost-bearing fields stripped
by sync-pull's interceptor pass-through). The mirror's audit data for cost-
blind users is a permission-filtered view, not the comprehensive system of
record the audit-log endpoint promises. A question like "what was this unit's
landedCost in the audit snapshot?" answers correctly online and incompletely
offline for the same auditor.

**Three resolution options** (all backend changes, not frontend):

1. **Add per-bucket SkipCostStrip equivalent to sync-pull**: the cost
   interceptor would skip stripping for specific buckets named in a route-
   level option, so the `auditLogEntries` bucket is exempt while other buckets
   (units, shipments) continue to strip. Closest to "match the audit-log
   endpoint's intent in the mirror layer too." Requires interceptor refactor.
2. **Tighten role seeding so audit.read implies costdata.view**: the asymmetry
   never manifests because no user has audit.read without costdata.view. The
   Internal Auditor's "cost-blind reporting" framing (no costdata.view) would
   need revision; audit.read users would all see cost in reports too. Smallest
   code change, biggest role-design implication.
3. **Accept the asymmetry; document it in the HorizonDisclosure**: extend the
   offline disclosure wording to "Offline: showing cached audit entries from
   \[date\]; this is a subset, AND for users without costdata.view, cost-
   bearing fields in entity snapshots may be absent." Frontend-only change but
   surfaces an awkward "you don't see this offline" caveat to the auditor.

Recommendation: **option (2)** if the Internal Auditor role is supposed to
have uniform cost visibility (the simplest mental model), **option (1)** if
the cost-blind-reporting + cost-visible-audit split is intentional and the
offline experience needs to match the online intent. The decision is a role-
design question for Theresa, not a technical fix. Bank both options here so
the next planning round has the full picture.

### Audit log beforeState capture missing across all update/delete actions (RESOLVED 2026-06-03, forward-only)

**Resolution**: backend fix landed in `enviable-system` commit `aaf7003`. The
interceptor now does a best-effort `findUnique` by `req.params.id` on the
`@Audit`-declared entityType BEFORE the handler runs, captures the row as
`beforeState`. Update and delete entries created from that commit forward
carry semantic pre-mutation snapshots; verified empirically by Playwright at
the visible-outcome level (`/tmp/sw-investigation/test-audit-log-beforestate.mjs`
scenario A: live counterparty.update via UI, audit-log expand pane shows the
pre-update name in Before and the post-update name in After, exactly the
delta plus Prisma's auto-bumped `updatedAt`). Pre-fix entries (the 222
historical) remain at null beforeState as historical artifacts; the frontend
report renders them with explanatory copy ("Prior state not captured for
this entry") to distinguish from "no prior state" for creates. Forward-only
fix; no backfill.

**Residual edge cases left in BACKLOG**:

- Three historical-load handlers (`historical.shipment`, `historical.units`,
  `historical.spareparts`) still yield null beforeState. `historical.shipment`
  and `historical.spareparts` are genuine bulk-create operations (null is
  correct, same as any other create handler). `historical.units` is more
  ambiguous: it loads units INTO an existing Shipment (audit entityType =
  Shipment), so from the Shipment's perspective it IS an update (manifest
  lines added, units attached); but the URL uses `:shipmentId` rather than
  `:id`, so the interceptor's pre-mutation findUnique returns null. The
  agent's commit docblock frames this as "acceptable for the bulk-load case";
  worth a follow-up if anyone ever needs to know "what was the shipment's
  manifest before historical units were loaded?" Could be fixed by either
  renaming the URL param to `:id` or adding optional `paramKey` to `@Audit`.

- Audit writes are NOT transactional with the handler. The current
  architecture: handler runs, response emits, THEN audit write happens via
  fire-and-forget in an RxJS `tap`. This means a handler that throws (or a
  guard rejection) produces no audit row (good: no half-written audit), but
  it also means a handler can succeed (database commits the change) and then
  the audit write can fail (database hiccup, connection drop, anything),
  leaving a mutation with no audit row. Different failure mode from "audit
  for non-mutation"; arguably worse for an audit-log system: changes happen,
  audit is silently missing, no operator-visible signal. Mitigation options:
  post-commit transactional outbox pattern; retry-with-dedupe on audit write
  failure; accept the gap with monitoring (Logger.error already fires on
  failure, just needs an alert). Should be evaluated before any audit-trail-
  based investigation happens in production.

### Audit log: rendering treatment for populated beforeState/afterState

Currently the audit-log report's expand pane shows context / beforeState /
afterState as three side-by-side pretty-printed JSON blocks (ship-as-is per
prompt 24b option A). For the typical audit-log query "what did X change
about Y?", reading two full JSON snapshots and mentally diffing them is
acceptable but not optimal. A structural diff treatment would highlight only
the fields that actually differ between before and after, making the answer
visually prominent rather than buried in the full snapshot.

Deferred at prompt 24b on the principle that populated beforeState alone is
the substantive improvement, and full snapshots preserve the inspect-anything
property. Worth revisiting if auditors report the JSON blobs are hard to
scan in practice; the implementation would add a small DiffTable component
that walks before/after keys and renders rows for only the keys whose values
differ, with the before / after values side by side. A toggle between "Full
snapshots" and "Changed fields only" is the natural shape.

### Audit log beforeState capture missing across all update/delete actions (HISTORICAL ENTRY, see above for resolution)

The audit interceptor at `enviable-system/src/audit/audit.interceptor.ts:58-70`
never passes `beforeState` to `audit.write`, so every audit log entry's
`beforeState` is null. Verified empirically: 222 entries in fixtures, 0 with
non-null beforeState.

**Impact**: for *create* actions, null is correct (no prior state); for
*update* actions, the audit log cannot show what changed (only the after-
state is captured, not the delta), so an entry like "Theresa updated First
Bank" records that the record was updated and what it currently says, but
not whether she changed the bank's name, SWIFT code, account note, or
status; for *delete* actions, the audit log records the action but not
what was destroyed (no surviving snapshot for any case where the deletion
is later questioned, and the only snapshot at all if the row later gets
hard-purged). This is a systemic audit-completeness issue affecting the
trail's primary inspection value for change-history queries, not a
localized gap. The audit-log report (`/reports/audit-log`) is faithfully
rendering the data it has; the empty "Before" column is exposing the
backend data-completeness gap, not a frontend bug.

**Recommended fix**: interceptor-wrapping approach. The interceptor does a
`prisma.<entity>.findUnique({ where: { id: params.id } })` on the entity's
id BEFORE the handler runs for non-create actions, threads the result into
the audit row as `beforeState`. Most update/delete handlers are in the
`entity/:id` URL shape, so a single change in the interceptor fixes the
bulk of the problem uniformly. Trade-off: couples the interceptor to
Prisma and the `:id` URL convention; may duplicate work the handler is
about to do (most update handlers read-then-write); the cleaner long-term
architecture is service-layer responsibility (each `@Audit`-annotated
mutation reads-then-writes and passes `beforeState` to `audit.write`
directly so the pre-mutation read serves double duty), but the simpler
first-pass fix is interceptor-level. Service-layer override remains
available for handlers that don't fit the standard shape (bulk-mutation
operations, actions that mutate multiple entities, etc.).

**Scope**: one backend change in the audit interceptor plus a sweep over
existing `@Audit`-annotated handlers to confirm the `:id` convention
holds or surface the override-needed cases. Historical entries (the
existing 222) can't recover their pre-action state; the fix is
fix-forward only, new entries from the fix onward will be complete.

**Priority**: should be addressed before any audit-trail-based
investigation happens in production (i.e., before go-live), since the
audit log is the system's inspection-of-truth mechanism. Right now any
"what changed?" or "what did this look like before deletion?" question
asked of the audit log can only be partially answered. Worth surfacing
to Theresa alongside the other pending decisions (invoice PDFs, variant
management, warranty), since it affects the audit-trail's value for
compliance and investigation purposes; the fix is straightforward
technically, the priority question (pre-go-live or post-) is hers.

### Audit log: deep-link gaps for entity types without a detail page

The /reports/audit-log screen deep-links the entityId of an audit entry to
the affected entity's detail page where one exists. Entity types with
detail pages: PurchaseOrder, SalesOrder, Shipment, Counterparty,
AssemblyJob, ProformaInvoice, Customer, Unit, SparePart. Entity types
WITHOUT a detail page (entityId renders as plain text instead of a link):
Invoice, Payment, ReleaseAuthorisation, DeliveryNote, Waybill,
PriceListEntry, Product, ConflictReviewItem, Return, LandedCost.

Most of these align with the existing build scope (Invoice / Payment are
list-only at this stage; DeliveryNote / Waybill are downstream artefacts
of SalesOrder and accessible via the SO detail; Product / PriceListEntry
are flat-list-only). The two genuine gaps are Return (no list or detail
screen yet, surfaced separately in the BACKLOG) and ConflictReviewItem
(handled by /sync/conflicts which uses a different id shape). When those
ship, add their routes to the ENTITY_ROUTE table in
src/app/(app)/reports/audit-log/page.tsx.

### Customers report has no cost gating (deviation noted)

The frontend prompt 23 framing carried the cost-gating assertion from the
revenue/stocks report templates. The customers report doesn't have cost
gating: the backend's reports.controller.ts comment is explicit ("Outstanding
balance is a sales/AR figure (not cost data), so no cost gating here"), and
the response has no cost-shaped fields to strip or omit. The
recomputeCustomersFromMirror replicates this faithfully (it never reads
Unit.landedCost). The verification substitutes a symmetric "no-cost user
sees identical figures" assertion to prove the report is genuinely cost-
blind rather than stealthily-gated. This is a templating-vs-actual-shape
gap, surfaced as the verification work, not a backend gap; recorded here
so future report builds check the controller's cost-strip declaration
before assuming the template applies.

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

### Verification-fixture password activation (RESOLVED 2026-06-03)

Pre-reports-cluster batch activation pass completed. Every throwaway
fixture covering a verification permission shape used by the remaining
screens (reports, admin) is now activated. Future fixture additions
should be added to this table during the round that surfaces the need,
not deferred.

**Fixture users:**

| Email                                | Fixture id              | Role                          | Status | Unblocks |
|--------------------------------------|-------------------------|-------------------------------|--------|----------|
| `costblind-test@enviable.example`    | fixt-user-costblind     | Stock Auditor                 | ✓ activated 2026-06-03 | Two-user cost-gating across `/reports/stocks`, units detail, spare-parts detail. The mirror-manipulation workaround in `test-spare-parts.mjs` scenario D can now be upgraded to a true two-user login. |
| `confirmer-test@enviable.example`    | fixt-user-confirmer     | Sales Manager                 | ✓ activated 2026-06-03 | `pricelist.manage` supersede flow (exercised in prompt 17), `report.revenue` + `report.customers` WITH `costdata.view` (cost-permitted reporting). |
| `procurement-test@enviable.example`  | fixt-user-procurement   | Procurement Officer           | ✓ activated 2026-06-03 | `pi.review` approve/reject on `/procurement/proforma-invoices`; `counterparty.manage` on `/procurement/counterparties`. |
| `salesofficer-test@enviable.example` | fixt-user-salesofficer  | Sales Officer (Warehouse)     | ✓ activated (prior round) | Discount / payment separation-of-duties, sales-cluster permission boundaries. |
| `auditor-test@enviable.example`      | fixt-user-auditor       | Internal Auditor / Compliance | ✓ activated 2026-06-03 | `/reports/audit` (the only role that holds `audit.read`); cost-blind reporting on `/reports/revenue` + `/reports/customers` (auditor has report.X access WITHOUT `costdata.view`, the only seeded role that combination matches). |

**Permission-shape gaps that turned out NOT to be gaps:**

The pre-cluster audit identified one apparent gap: a user with
`counterparty.read` WITHOUT `counterparty.manage`. The seeded
Executive Director (theresa@) role holds exactly that combination
(read-only counterparty access). Named accounts are reserved for the
people they represent (the throwaway/named convention banked below),
so for write-attribution tests this remains a fixture gap; for the
counterparty's edit/delete/new-CTA-hidden assertion, the architecture
of the gate is verified in code, and the visual no-buttons-rendered
verification can use any reader. Acceptable as-is.

**Activation command** (run once from `enviable-system`):
```
npm run set-password -- <email> Password123!
```

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

### Sales-cluster responsive: price-lists list table near the 375 boundary

Surfaced during the Inventory responsive pass when running the full
`npm run e2e:responsive` suite (shell + sales + inventory) back-to-back:
the `/sales/price-lists` list table measured 443px in a 341px container
at 375 once (Tier-1-fits assertion failed), but PASSED on an isolated
re-run. So it sits right at the 375 boundary and flakes under the longer
combined run.

Root cause: the Sales session applied the column-tier classes to this
table (`COL.md` on SKU + Effective-from) but NOT the other two parts of
the standard: the identity column (Variant) has no
`max-w-[..] sm:max-w-none truncate`, and the cell helper still uses
`px-3.5` rather than `px-2 sm:px-3.5`. With the standard's truncation +
reduced mobile padding, the surviving Tier-1 columns would have margin
and stop flaking.

**Price-lists: FIXED** in the Inventory-cluster session: the Variant
identity cell is wrapped in `block max-w-[150px] sm:max-w-none truncate`
and the `Td`/`Th` padding switched to `px-2 sm:px-3.5`, giving the
Tier-1-fits assertion headroom instead of sitting on the 375 line.

**Open action (broader Sales sweep):** the customers and deliveries list
tables were tiered before the identity-truncation + `px-2 sm:px-3.5`
padding rule was finalised in the Sales reference. Audit those two for the
same near-boundary risk and apply the truncation + padding where the
identity column can be long. Not yet observed to flake (only price-lists
did), so this is precautionary alignment, not a known break.

### Sales-responsive invoices test had no mirror-wait (FIXED)

The `invoices reflow to cards` test in `e2e/sales-responsive.spec.ts`
asserted on a fixture invoice 1.5s after login with no mirror-fill wait
(unlike its sibling tests, which wait for `mirrorCount > 450`). In a cold
context the mirror has not synced, so the fixture text was absent and the
test failed reproducibly. Fixed in the Inventory-cluster session by adding
the same mirror-wait loop the sibling tests use. Noted here only as the
record of why the sales spec was edited from an Inventory session.
