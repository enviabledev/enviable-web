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

### RESOLVED (prompts 30 + 31): Admin cluster screens have no backend surface (users, roles)

Shipped: the backend user/role module landed (enviable-system 02bf3c3) and the
frontend built the management screens + forced-reset flow (prompt 31). user.manage
/ role.manage now exist and are held by IT Admin; /admin/users is a full
management surface, /admin/roles a read-only catalogue, and the mirror user/role
buckets are expanded. The original finding is retained below for history.



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

### User/role module (prompt 31) follow-ups

- **DEFAULT_INITIAL_PASSWORD must be configured in production.** The backend
  refuses to create users (500) until this env var is set. A dev value was set
  on the local backend for verification; production hosting must configure a
  real default-initial-password before go-live. Pre-launch prereq.
- **Roles are read-only at MVP** (per the pending stakeholder decision on
  runtime role management). The /admin/roles catalogue renders read-only; when
  runtime role editing is approved, extend with create/edit/delete (backend
  already exposes POST/PATCH/DELETE /api/roles gated role.manage).
- **Users list paginates the whole set client-side** (lists with pageSize 250
  then slices in the browser, so the mirror view and the search/filter narrow
  the full set consistently). Fine at current staff counts; switch to
  server-side pagination if the user count grows large.
- **Contract divergences from the prompt-30 report (live API was source of
  truth):** user rows carry roles as nested userRoles[].role.{id,name} (not a
  flat roles[]); the mirror `user` bucket carries userRoles[].roleId only and
  the mirror `role` bucket carries permission keys only (no category/
  description). Frontend builds against the live shapes and joins/falls back
  accordingly. Noted in case the backend later flattens these.

### Prompt 32: credential-display halves blocked on backend endpoint edits

Two of the four prompt-32 fixes need enviable-system source edits (a backend
session; not doable from the frontend session) and are NOT yet built on the
frontend because the live contract does not exist:

1. **Create-user initial-password display.** `POST /api/users` must include
   `initialPassword` in the response (gated on user.manage). Probed: the current
   response has no such field. Once it lands, the create-flow notification shows
   the value with copy-to-clipboard, transient (state-only, never persisted).
2. **Admin reset-password actually resetting the password.** Probed and
   confirmed the gap: `POST /api/users/:id/reset-password-required` currently
   ONLY sets mustResetPassword=true; it does NOT reset the password (after the
   action the default fails 401 and the user's old/forgotten password still
   works 200). The endpoint must reset the password to the default AND return
   `initialPassword`. Once it lands, the admin-reset flow shows the value with
   the same transient/copy treatment.

Shipped now (frontend, no backend dependency): the /profile account page
(view + self-service change-password via the existing
POST /api/auth/reset-password) and the login forgot-password link +
informational "contact your administrator" page (upgrades to email-based
self-service when email infrastructure lands).

Architectural note banked: the "never display passwords" discipline is refined
to "per-user passwords are never displayed; the deployment-wide default password
may be displayed transiently at create/admin-reset moments, with copy affordance
and no browser persistence."

## Prompt 34 findings (price-list entry-point affordances)

Shipped: a "Set price" / "Manage prices" affordance on the variant detail page
(/admin/variants/[id], gated pricelist.manage, hidden for DISCONTINUED variants
with a reactivation hint), an "Add variant" picker on /sales/price-lists (gated
pricelist.manage, ACTIVE-only via flattenVariantOptions), and a post-create
"Set price for this variant" deep-link on the variants list notification. All
route to the existing per-variant tier editor (single source of truth for entry
creation). The editor was fixed to render the set-price form when a (variant,
tier) has no current entry yet (it previously gated the form on series.current,
so a brand-new variant could not have its first price set).

Findings banked for a future round:

1. **Backend route `/api/customers/customer-tiers` is shadowed by `@Get(':id')`
   and returns 404 ("Customer customer-tiers not found").** There is therefore
   no reachable network endpoint that lists customer tiers; the frontend reads
   tiers exclusively from the mirror's `customerTier` bucket. This is a backend
   route-ordering bug (declare the literal route before the param route). Until
   fixed, anything needing the full tier list is mirror-only. Cross-repo: belongs
   to the enviable-system session.

2. **Tiers are a mirror-only read with no freshness signal (now mitigated).**
   The default-tier resolution and the picker's tier list snapshot the mirror at
   mount, so a cold mirror yielded an empty tier set and the affordances never
   appeared. Fixed with `useActiveTiers` (src/lib/pricing/use-tiers.ts), which
   re-reads `customerTier` on every mirror download/reconcile. The price-list
   list page's own tier FILTER still reads tiers once in its main effect and has
   the same latent cold-mirror gap; not changed here (it works once the mirror
   warms, which it has by the time a user opens the screen), but worth migrating
   to useActiveTiers in a cleanup pass.

3. **Tier surfacing on the price-list screen is implicit.** Tier is both a row
   dimension (one row per variant x tier) and an optional filter, but never an
   explicit "which tiers exist" view. The picker has to ask for a tier because
   the screen is not tier-scoped by default. If pricing grows beyond two tiers,
   consider a tier-led layout (tiers as columns, or a tier selector as the
   primary lens) so the (variant x tier) matrix is legible. Architectural, not
   urgent.

## Prompt 35 (Record proforma invoice flow) - shipped

Closed the gap where a PO could never receive a recorded PI through the UI
(the backend endpoint + createProformaInvoice wrapper existed; the create-side
UI was never wired).

Shipped:
- "Record proforma invoice" action on the PO detail page, gated pi.review and
  visible only on recordable PO statuses (APPROVED, SENT_TO_SUPPLIER,
  PI_RECEIVED, AWAITING_SHIPMENT, PARTIALLY_RECEIVED). Reads "(revision)" when
  an ACTIVE PI already exists. Disabled offline.
- RecordProformaInvoiceModal: header CIF fields (piNumber required, issue/valid
  dates defaulted, freight/insurance/ports/payment terms) + a line section
  pre-seeded from the PO lines (same variant, quantity, unit price). New lines
  use the ACTIVE-only variant picker; pre-seeded lines keep their variant even
  if now DISCONTINUED (existing-commitment exception, shown with a tag and not
  re-pickable). Client-side CIF total preview; server is source of truth.
- A "Proforma invoices" list section added to the PO detail (it previously
  showed none): lists recorded PIs with number, revision, status, total; the
  new PI appears PENDING_REVIEW immediately after recording; refreshes via a
  reload tick.
- Create lands PENDING_REVIEW; the existing PI detail approve flow activates it
  and pulls the PO to PI_RECEIVED.

Observations banked:
- The form is large but fits the Modal primitive at 375px (it scrolls
  vertically inside the scroll region); no need for a dedicated page.
- The PI detail's transient action-success banner unmounts on the post-approve
  re-read (the Review section is gated on PENDING_REVIEW), so visible-outcome
  checks for the approve should assert the durable ACTIVE status pill, not the
  success banner. Noted for any future PI-detail test work.

## Prompt 36 - write-flow completeness audit (see WRITE_FLOW_AUDIT.md)

Full cross-reference of all 51 backend write endpoints against frontend wiring.
0 unwired wrappers (API layer and components are in lockstep); 13 MISSING
(backend exists, no frontend path). Triage:

- BUILD NOW: SO cancel (small); create/update shipment against a PO (medium,
  completes the procurement chain for non-legacy POs).
- BUILD NOW or DEFER (needs Theresa): unit lifecycle transitions
  (POST /units/:id/adjust); returns module (initiate/inspect/resolve).
- DEFER post-launch: landed-cost entry/allocation; parent-product management
  (backend-first, no /api/products write endpoints exist).
- DELIBERATELY NOT for launch: roles management (pending decision); the
  toggle/approval/document modules (forward-declared permissions, no backend
  controllers).
- NOT a gap: POST /sync/conflicts/:id/resolve is unused by design (the conflicts
  UI resolves client-side via removeByClientId).

Mirror-only-read class sweep (the useActiveTiers cold-mirror bug shape): swept
every listByType/getById consumer under src/app and src/components. NO other
AT-RISK sites. roles list/detail are SAFE (network revalidate + focus/visibility/
online/tick); CreateCustomerModal re-reads on open (self-healing, not a one-shot
mount read). useActiveTiers confirmed SAFE-SUBSCRIBED. So the fix covered the
class, not just the instance.

Unused-permission-key sweep: 13 seed keys are referenced nowhere in the frontend
(landedcost.manage, unit.adjust, unit.transfer, sparepart.manage, return.manage,
conflict.resolve, role.manage, toggle.read/manage, approval.read/manage,
document.read/manage). Each maps to a gap or deferred/forward-declared module
above (conflict.resolve is the one exception: resolved client-side by design).

Meta-discipline banked: run an end-of-build completeness audit against the API
contract before declaring done; per-prompt verification is forward-looking and
will not surface cumulative-completeness gaps like the PI-create one.

## Prompt 37 (SO cancel flow) - shipped (frontend-only)

The prompt assumed the backend cancel endpoint was missing, but probing
confirmed it already exists (the write-flow audit's own enumeration had found
it): POST /api/sales-orders/:id/cancel, gated salesorder.create, reason
required, atomically frees the soft unit reservation (nulls each line's unitId;
unit STATUS is unchanged because allocation never moved units out of warehouse
status) and surfaces a refundOutstanding flag for confirmed payments. So this
was frontend-only; no backend source edits (which would be out of scope anyway).

Shipped on the SO detail page:
- Cancel action gated salesorder.create (matching the backend, NOT salesorder.
  manage as the prompt assumed) and the service's cancellable-state allowlist
  (DRAFT / AWAITING_PAYMENT / PAYMENT_RECEIVED, narrower than the legal-
  transition map).
- CancelSalesOrderModal: required reason (pick-list + Other free-text). No notes
  field, because the backend stores only the reason (no cancellationNotes
  column).
- CANCELLED state surfaced in the identity card: cancellation reason, cancelled-
  at, cancelled-by (resolved from the mirror users bucket). Other action gates
  already exclude CANCELLED, so no extra hiding was needed.
- refundOutstanding surfaced in the post-cancel banner when confirmed payments
  exist.
- The SO list status filter already includes CANCELLED (maps over SO_STATUS); no
  change. Left the default list showing all statuses rather than introducing a
  hidden default-exclude that could surprise.
- SoStatusPill already handled CANCELLED ("Cancelled" + danger tone).

e2e: 8 assertions (visibility by state + permission, successful cancel, reason
display, reserved-unit release, reason-required, back-out, responsive). The
backend probes A-G in the prompt were moot (endpoint pre-existing); the contract
was confirmed by live probe (cancel DRAFT -> CANCELLED + line unitId nulled;
no-reason -> 400; re-cancel -> 409).

## Prompt 38 (shipment create/edit against a PO) - shipped (frontend-only)

The backend create + update endpoints already existed (the prompt assumed they
might be missing): POST /api/purchase-orders/:poId/shipments and
PATCH /api/shipments/:id, both gated shipment.manage. So this was frontend-only.

Contract divergences from the prompt's assumptions (all matched to the live API):
- No ports field (the prompt assumed portOfLoading/Discharge). The DTO carries
  optional logistics-counterparty IDs (freightForwarder/clearingAgent/
  insuranceCompany) instead.
- No unit/engine detail at create time; that is receive-time. Create takes
  manifest lines of {productVariantId, quantityDeclared}.
- Declared quantities are independent of PO quantities, so partial fulfilment
  (ship fewer than ordered, or across several shipments; PO:shipment is 1:many)
  is the natural case.
- New shipments default to IN_TRANSIT; manifest is editable until RECEIVED/CLOSED
  (mirrors backend assertManifestEditable).

Shipped:
- "Record shipment" action on the PO detail, gated shipment.manage and the
  shipment-recordable PO states (PI_RECEIVED, AWAITING_SHIPMENT,
  PARTIALLY_RECEIVED). Opens ShipmentFormModal pre-seeded from PO lines.
- ShipmentFormModal (create + edit): BL number, vessel, ETD/ETA, manifest lines
  (adjustable quantities, removable, add-line with the ACTIVE-only picker;
  pre-seeded lines keep a now-DISCONTINUED variant with a tag, not re-pickable).
- Pre-receive Edit on the shipment detail (hidden once RECEIVED/CLOSED).
- createShipment / updateShipment / shipmentManifestEditable added to the API.

Decisions / notes:
- Optional logistics-counterparty selects (freight forwarder / clearing agent /
  insurer) are NOT surfaced in the form yet (optional fields, untested). Add
  later if operationally wanted; the backend accepts them omitted.
- On create, the PO detail shows a success notification with a "View shipment"
  Link rather than auto-navigating: router.push from the create flow (parent
  onSuccess AND the modal's own router) did not navigate reliably in this
  create-then-re-render path, while a Link navigates fine. This matches the PI
  flow's notification+Link pattern on the same page. Worth a deeper look at why
  router.push no-ops here, but the Link pattern is the robust, consistent choice.

e2e: 11 assertions (visibility by state + permission, pre-seeding, partial qty,
line removal, DISCONTINUED-kept, create+link to detail IN_TRANSIT, edit-persists,
edit-hidden-after-receive, end-to-end create->clear->receive into inventory,
responsive 375/768/1280).

## Variant auto-create UI (prompt 37-followup)

Shipped (verified + committed b5c48b4): similarity-warning surfaces, pending-
classification list/detail, reclassification, PO line SKU-or-id input, shared
SimilarityWarningModal, historical-load newVariants/similarity/override toggle,
audit surfacing of productvariant.autocreate.

e2e added (variant-autocreate.spec, 3 scenarios, green against live backend):
pending banner + filter + pill + detail curation surface; historical-load
newVariants preview + similarity warning + override-moves-to-newVariants; PO
line SKU mode opens the SimilarityWarningModal with both SKUs + three choices.
Base variant-mgmt suite (9) still green; historical-load-dryrun spec updated to
the resolved-catalog reality.

Deferred / open findings:
- Per-row override on historical-load is file-level only (one toggle applies to
  every similarity-flagged row). The data model supports per-row decisions; the
  API does not expose them yet. MVP-acceptable: a mixed upload is handled by
  editing specific row SKUs or overriding the whole file. Revisit post-launch if
  operators hit it.
- supplierSkuCode has no DB unique index; app-level uniqueness holds at single-
  operator scale but a high-volume concurrent upload could theoretically race a
  duplicate. Low risk for Enviable's scale. Backend hardening (enviable-system),
  not blocking.
- Historical-load shipment-id field takes the system cuid, not the human-readable
  reference (SH-2026-NNNN). The Section-1 auto-flow passes the cuid correctly, but
  a manual paste of the reference 404s. Frontend fix: replace the free-text field
  with a recent-shipments selector (value = cuid, label = reference). In scope,
  not yet done. Carried from the historical-load trim-fix round.
- e2e coverage NOT yet written for: destructive commit paths (historical-load
  commit auto-creating real variants; PO create persisting an auto-created
  variant; an actual reclassification mutation), and the audit-log auto-create
  rendering. The UI compiles and the read/dry/modal paths are verified; the
  write-commit and audit-render paths are verified at the API/contract level,
  not yet at the visible-outcome level.

## Historical-load shipment selector (prompt 38)

Shipped: free-text shipment-id input replaced with a ShipmentSelect dropdown
(label = reference SH-YYYY-NNNN, value = cuid). Mirror-first + listShipments
revalidate, recent-first by createdAt, status shown per option. Section-1
auto-flow now passes {id, reference} and the just-created shipment is injected
ahead of the mirror so it shows selected immediately. Closes the cuid-vs-
reference UX failure carried from the historical-load diagnostic round.

e2e (shipment-selector.spec, 3 scenarios, green): lists-by-reference + cuid-in-
request-path (never the reference); section-1 auto-flow pre-selects the created
shipment; responsive 375/768/1280. The historical-load-dryrun + variant-
autocreate specs were updated from .fill() to .selectOption() and stay green.

Decisions / notes:
- NO hard shipment-status filter. Section 1 creates the parent shipment directly
  in RECEIVED (isHistoricalImport=true) and the backend units-load does not gate
  on status, so a pre-receive filter would hide the exact shipments this screen
  targets and break the auto-flow. Status is shown per option as context instead.
  If an "actionable states only" view is wanted later, add it as an opt-in toggle,
  not a default.
- The units free-text input (and its input-layer trim from the prior round) is
  gone; the selector makes a whitespace/wrong-shape id structurally impossible.
  The defensive trim in loadHistoricalUnits (API helper) stays as a backstop for
  any other caller.
- Empty-state branch ("No shipments available yet…") is NOT driven by a live e2e
  assertion: the dev DB always has shipments and the mirror fills on sync, so the
  zero-shipments + empty-mirror condition is not reproducible without DB/IDB
  surgery. Covered by construction + typecheck; flagged here honestly.
- No display cap on the option list yet (all shipments, recent-first). Fine at
  current scale; add a "most recent N + typeahead" cap if the shipment count
  grows large.

## Unit lifecycle adjustments (prompt 39)

Shipped: an Adjust-status action on the unit detail page (gated unit.adjust,
state-gated to the legal targets for the current status), driven by AdjustUnitModal
(uniform { toStatus, reason } DTO, dynamic consequence copy). adjustUnit() API,
a client mirror of the backend adjustment map (src/lib/units/adjustments.ts), and
optimistic status + refetch so the new movement lands on the existing timeline.

Audit confirmed most of the hypothesised scope was already built: StatusPill already
covers all 13 statuses with mobile shorthand; the units list filter already offers
every status; the unit detail movement timeline already renders all movement types
(including ADJUSTMENT). So prompt 39 was just the adjust ACTION that feeds them.

e2e (unit-lifecycle.spec, 4 green): adjust + reverse round-trip (CKD->Demo->CKD)
with status + timeline + reason; reason-required gating; permission gating (a
unit.read-only user sees no Adjust action); responsive 375/768/1280 (detail + modal).
Round-trips restore fixture state; non-destructive.

Decisions / findings:
- TRANSFERRED is in the enum and state machine but has NO adjustment-map entry (the
  backend 400s a transfer attempt: "deferred multi-warehouse feature"). So there is
  no transfer UI; transfer is genuinely not buildable until the backend wires it.
  Operational note for Theresa: multi-warehouse transfer is deferred.
- The adjust endpoint deliberately rejects assembly / sale / customer-return edges
  (use their workflow endpoints); customer returns are prompt 40, not this.
- formatUnitStatus renders the handoff's COMPACT label with no spaces
  ("InWarehouseCKD", "WrittenOff"). Established convention used across the units UI;
  flagged as a low-priority readability nit, not changed here (touches every units
  screen + several specs).
- Fixed a pre-existing responsive tightness on the unit-detail SummaryCard surfaced
  by the new responsive test: the "Current Status" cell (pill + duplicate status
  text) overflowed the 2-column grid at ~768px for longer values; made the value
  column shrink/wrap (min-w-0, smaller gap, flex-wrap on the status cell).
- inventory-responsive.spec has 4 PRE-EXISTING failures (cluster-overflow, Tier-1-at-
  375, units-table and movements-table column hiding). They are IDENTICAL before and
  after this prompt's changes (verified), on list-table screens prompt 39 never
  touched, and the units list itself has zero overflow at 375 (checked directly). The
  likely cause is the spec's waitForMirror(>450 records) threshold vs the session's
  reseeded data (a timing/data mismatch, not a layout regression). Needs a separate
  look; NOT a prompt-39 regression.
- e2e NOT written for (covered by construction + walkthrough): the state-gating-
  negative case (no non-adjustable unit exists as a fixture to assert the Adjust
  button hides without a destructive write-off), the list filter-by-lifecycle-state
  (pre-existing filter, not re-tested), and the audit-log rendering of unit.adjust
  entries (pre-existing generic audit render). The adjust write + audit are verified
  at the API/contract level (round-trip + audit annotation), not the audit-screen
  render.

## Returns module (prompt 40)

Shipped: Returns nav entry + list (/sales/returns, network-only, status filter),
return detail (/sales/returns/:id) with state-gated Begin-inspection and Resolve
actions, InitiateReturnModal (from the SO detail, SO-scoped), ResolveReturnModal
(REPAIR / WRITE_OFF + consequence), ReturnStatusPill, and cross-context surfaces:
an Initiate-return affordance + a Returns card on the sales-order detail, and a
"View return" callout on the unit detail (sourced from the RETURN movement's
referenceId, no extra fetch). All writes gated return.manage; reads salesorder.read.

Audit-first findings (the backend is much leaner than the prompt assumed):
- The Return model is minimal: one unit + one SO + a free-text reason + a
  disposition. Workflow is INITIATED -> INSPECTING -> RESOLVED.
- Dispositions are ONLY REPAIR and WRITE_OFF. There is no refund / replace /
  supplier-claim, and no condition-claimed/condition-actual inspection fields.
  Inspect takes NO body (it just advances the status). The elaborate resolution
  modals in the prompt were not buildable; built exactly what exists.
- Permissions are COARSE: a single return.manage gates initiate + inspect +
  resolve (not granular per-step). Mirrored on the client.
- Initiate is sales-order-scoped (POST /sales-orders/:id/returns): the entry
  point is the SO detail, picking a currently-SOLD unit on that order (I-15).
- Resolution cascades the unit: REPAIR -> IN_REPAIR, WRITE_OFF -> WRITTEN_OFF;
  initiate cascades SOLD_* -> RETURNED. Verified live end to end.

e2e (returns.spec): full workflow initiate->inspect->resolve(REPAIR); list +
status filter; cross-context unit-return callout; permission gating (a
salesorder.read user sees the list but no Initiate action); responsive
375/768/1280. The full-workflow test is CONSUMPTIVE (the workflow is forward-
only, so each run turns one SOLD unit into a return) and test.skip()s gracefully
once the fixture order's SOLD units are exhausted, so the suite stays green on
re-run. SO-2026-0002's SOLD units are now exhausted by this round's runs; a
future workflow run needs a different SO with SOLD units (or a re-seed).

Deferred / open findings:
- WARRANTY (flag for Theresa): the backend resolve() has an explicit deferred
  warranty hook (currently a no-op) "pending Theresa's contractual answers and a
  future schema change." When warranty-validity tracking lands it will inform or
  constrain the disposition (e.g. in-warranty defects routed to REPAIR at no
  charge). The UI will need warranty surfacing then; nothing to build until the
  backend does.
- Customer-context returns link NOT built: the returns list endpoint has no
  customer filter and rows carry only the sales order (not the customer), so a
  per-customer returns view would need a client-side return->SO->customer join
  against an unfiltered list. Deferred rather than build a fragile join; revisit
  if a customer returns view is wanted (likely a small backend filter is the
  right fix).
- Returns are not in the sync mirror, so the returns screens are network-only
  (offline shows a graceful notice). Acceptable: returns are a deliberate online
  workflow. If offline read is wanted later, add a returns mirror bucket.
- e2e NOT written at visible-outcome level for: the WRITE_OFF resolution path
  (only REPAIR is driven; WRITE_OFF is covered by the modal option + the live
  contract probe), and the audit-log rendering of return.initiate/inspect/
  resolve (generic audit render, not asserted). Covered by construction +
  walkthrough.

## Assembly cancel (prompt 44b) - shipped (frontend-only)

Shipped against the 44a backend (`POST /api/assembly-jobs/:id/cancel`, body
`{reason}`, gated assembly.perform, IN_ASSEMBLY -> IN_WAREHOUSE_CKD intact, job
-> CANCELLED): a "Cancel Assembly" action on the assembly job detail (visible
only when the job is IN_PROGRESS and the principal has assembly.perform, sitting
alongside Complete/Fail), a `CancelAssemblyJobModal` reason-capture modal
(reusing the SO-cancel pattern: pick-list + Other free-text, required non-empty
trimmed reason mirroring the backend 400), CANCELLED added to the frontend
`ASSEMBLY_JOB_STATUS` enum and the `AssemblyStatusPill` (grey tone, "Cancelled"
label + shorthand). Cross-context verified end to end (Playwright + DB): job
CANCELLED, unit reverted to IN_WAREHOUSE_CKD, the cancel-reason ADJUSTMENT
movement appears in the unit's timeline (fromState IN_ASSEMBLY -> toState
IN_WAREHOUSE_CKD, notes = reason), and the audit entry (`assembly.cancel`,
AssemblyJob, actor present, afterState.status CANCELLED + notes = reason) is
written. Online-only write (modal blocks offline), consistent with SO cancel.

Findings / observations:

- UX, cancel-vs-fail decision point: the detail page now offers three terminal
  actions (Complete / Fail / Cancel) with NO inline guidance on when Cancel
  applies versus Fail. The semantic line is real and easy to get wrong: Fail
  marks the unit DAMAGED (irreversible damage handling), Cancel reverts the unit
  to IN_WAREHOUSE_CKD intact (clean, re-assemblable). A supervisor who picks the
  wrong one creates a wrong unit state with real downstream cost (a DAMAGED unit
  needs a separate adjust to recover). The modal's framing text disambiguates
  Cancel, and the Fail ConfirmBar disambiguates Fail, but only AFTER the button
  is clicked. Consider a one-line helper under the action row ("Cancel = stop an
  in-progress build, unit stays intact. Fail = the unit was damaged during
  assembly.") so the distinction is visible before commitment. Deferred: the
  per-action confirmation copy already states the consequence; a pre-click hint
  is a refinement, not a correctness gap.

- Pill tone choice (recorded, not a gap): CANCELLED is rendered grey, NOT danger
  (red), deliberately distinct from FAILED. A cancel is a clean intact reversal,
  not a failure; the SO pill uses danger for CANCELLED, but for assembly the
  red is reserved for FAILED (Damaged) so the two terminal-but-different outcomes
  read apart at a glance. If a future design pass wants cross-entity pill-tone
  uniformity for CANCELLED, this is the deliberate deviation to revisit.

- Assembly jobs LIST has no status-filter control at all (it is a plain table,
  no filter UI). The prompt asked to "include CANCELLED in the status filter if
  not already present"; since there is no filter to extend, the deliverable
  reduced to the CANCELLED pill shorthand (shipped). If a status filter is wanted
  on the assembly list later, build it to include all four states
  (IN_PROGRESS / COMPLETED / FAILED / CANCELLED).

- Mobile responsiveness (375/768/1280 verified): the three action buttons stack
  full-width at <640px (existing flex-col) and sit in a row at sm+. With three
  terminal actions the mobile stack is now three full-width buttons tall before
  the lifecycle card; acceptable at 375 but the action column is getting heavy.
  If a fourth action is ever added, reconsider collapsing secondary actions
  (Fail/Cancel) into an overflow menu on mobile rather than a fourth stacked
  full-width button. No change needed now.

- Cancel is online-only with no offline queue (unlike Complete/Fail, which queue
  through the sync engine). This matches SO cancel and the reason-capture write
  pattern. If field supervisors need to cancel offline later, the queueing
  machinery exists (queueCompleteAssembly/queueFailAssembly) and a
  queueCancelAssembly with the reason payload would follow the same shape; the
  honest "saved locally, will sync" UX would need the reason captured before the
  offline branch. Deferred: cancel is an administrative correction, less
  time-critical than complete/fail on the floor.

## Overpayment handling (prompt 42b) - shipped (frontend)

Shipped against the 42a backend (POST /api/sales-orders/:id/payments extended
with overpaymentResolution / refundMechanism / refundReference / creditNotes,
required IFF amount > remaining where remaining = SO.total - sum(CONFIRMED),
floored at 0): client-side overpayment detection on the record-payment form
(extracted to src/components/sales-orders/RecordPaymentForm.tsx with internal
state and exact integer-cents math), a resolution sub-form (Refund -> mechanism
required + optional reference; Credit -> optional notes) that reveals/hides live
as the amount crosses the threshold and clears its values on reversal, the
overpayment fields on the API types (Payment + RecordPaymentBody) and api index,
SO-detail payment-row rendering of the recorded resolution ("Refund issued via
Bank Transfer (ref: X)" / "Credit applied (notes: X)") as a distinct warning
sub-row, the PENDING-balance caveat on the indicator, and a distinct "Overpay"
badge on the /sales/invoices-payments payments tab (cross-context). The sales
invoice payment+overpayment block is backend-rendered (template already carries
it); the frontend embeds the backend HTML/PDF and was verified end to end.
33/33 Playwright visible-outcome assertions pass (a-w) plus audit DB + UI.

Findings / observations:

- BACKEND ENV (operational, surfaced during 42b verification): the running dev
  backend (nest start --watch, serving from dist/) was rendering a STALE invoice
  template. dist/src/documents/templates/sales-invoice.hbs had 0 matches for the
  new payment block while the committed source had it (6 matches), so the invoice
  HTML/PDF omitted Amount Paid / Balance Due / Overpayment despite confirmed
  payments. The Handlebars template is compiled ONCE at engine construction and
  cached in memory, so even refreshing the dist file needs a process restart.
  Compounding it, a stale watcher child kept :3000 (EADDRINUSE on the new one),
  so the old in-memory template kept serving. Resolved for verification by
  refreshing the dist artifact + a clean single restart (no source edit). This is
  the same class as the existing "invoice template assets land in the wrong dist
  path" finding: the nest-cli asset-copy for templates is not reliably refreshing
  dist on watch rebuilds. Backend should fix the asset pipeline so a rebuild
  always recopies templates; until then, a backend restart is required after any
  template change to see it rendered.

- UX, the PENDING-balance caveat (item 7, implemented): detection is on the
  CONFIRMED balance, so a freshly-recorded (still PENDING) payment does not move
  the displayed remaining. The caveat ("Based on payments currently confirmed.
  Pending payments may affect the actual balance.") shows on the indicator only
  when the SO has PENDING payments. This is honest but subtle: a clerk recording
  a second payment while the first is unconfirmed may see an "overpayment" that
  will not be one once the first confirms (or vice versa). Considered, not built:
  surfacing the pending total inline ("X confirmed, Y pending") so the user sees
  the two balances side by side. Deferred as visual cost vs benefit; the caveat
  plus the backend-as-source-of-truth (it re-derives on submit, and the form
  re-reveals on a stale 400) is sufficient. Revisit if clerks report confusion.

- Cross-context where overpayment is operationally useful: built the payments-tab
  badge this round. Other useful surfaces NOT built: (1) customer detail has no
  payments section at all, so a customer's overpayment history is not visible
  anywhere customer-scoped; if finance wants "which customers are carrying
  credits," that is a new surface (likely needs a backend customer-payments
  filter, none exists today). (2) Reports: a "credits outstanding" / "refunds to
  process" report would be genuinely operational (the system records refund/credit
  INTENT but does not process it, so someone must action the refunds), but there
  is no backend aggregation endpoint for it. Both are findings for a future round,
  gated on backend support.

- Stale-data (item/assert k): handled by re-fetching the balance on a validation
  400 (the parent refreshes payments, the form re-derives and re-reveals the
  sub-form with the prompt) plus a focus/visibilitychange re-fetch while the form
  is open. There is no optimistic lock / version token on the payment write, so
  two clerks racing can still both submit; the backend balance check is the
  backstop. Acceptable for this workflow; note if payment contention grows.

- Mobile (375): the resolution sub-form is a conditional addition to an existing
  3-column record form. No pre-existing layout change was needed: the record form
  already reflows to single-column at <sm, and the sub-form uses the same grid,
  so it stacks cleanly. The overpayment row on the SO-detail payments table is a
  full-width colspan sub-row, which reads well on mobile (no extra column added to
  an already 7-column table). No horizontal overflow at 375/768/1280.

## Sales-side proforma invoice (prompt 43b) - shipped (frontend)

Shipped against the 43a backend (SalesProformaInvoice auto-issued on SO
creation; GET /api/sales-proforma-invoices/:id{,/html,/pdf}, all salesorder.read,
PDF Content-Disposition: inline; the SO list + detail now carry
salesProformaInvoice {id, piNumber, issuedAt} | null): a Proforma Invoice card on
the SO detail (View PI + Open PDF opening the html/pdf in a NEW TAB, PI number,
issued date, a live-render info tooltip, and an honest "no PI was issued" note
for legacy SOs), a per-row View PI link on the invoices tab of
/sales/invoices-payments, the salesProformaInvoiceDoc endpoint builder, the
SalesProformaInvoiceSummary type on the SO list + detail, and the procurement PI
relabel ("View document" -> "VSK PI reference (internal)" with a clarifying
title). 31/31 Playwright visible-outcome assertions pass (a-f, h-w); g and m are
intentionally skipped (see below).

Decisions / findings:

- (g) SO list: NOT added. The sales-orders list is text-only (rows link to the
  detail; no per-row document affordances), so per the prompt's "if the list has
  per-row actions" condition, PI access stays on the SO detail. Adding a per-row
  PI column to a list with no other actions would be inconsistent with the
  existing convention.

- (m) Customer detail: NOT added. The customer detail page does not render a
  per-row SO list with actions (it surfaces deletion/deactivation, not an SO
  table), so there is no row to hang a PI link on. PI is reachable via the SO
  detail. Operationally a customer-scoped "their proforma invoices" view could be
  useful (a dealer asking for a re-send), but it needs a new customer->SOs surface
  (and ideally a backend customer-SO filter); deferred as a future round.

- invoices-payments PI link is INVOICE-stage-scoped. That tab lists invoices
  (and payments), both downstream of SO progression, so a brand-new SO that has a
  PI but no invoice/payment yet does NOT appear there. The PI link therefore shows
  only for SOs that have reached the invoice stage; the SO detail is the universal
  PI surface. If we want PI links for every PI-bearing SO on that page, it would
  need an SO-centric tab or list, which the page is not currently shaped for.

- No salesProformaInvoice mirror bucket exists (43a did not add one to the sync
  ALL_TYPES), so the invoices-tab PI links are sourced from a network fetch of the
  SO list (which carries the PI join) rather than the mirror. Offline, the PI
  links simply do not render, which is acceptable: opening the document requires a
  connection regardless. The SO detail PI card distinguishes "offline/unknown"
  (mirror paint) from "confirmed no PI" (network) via the fromMirror flag, so a
  new SO viewed offline shows "loads when online" rather than a false "no PI".

- OPERATIONAL AMBIGUITY (flag for the team): the PI renders LIVE from the current
  SO and the affordance shows for ANY status, including CANCELLED. A cancelled
  order still has its salesProformaInvoice row, so the SO detail shows View PI and
  the document renders the (now cancelled) order's current details, with no
  "cancelled" marking on the PI itself. Backend behavior is unchanged and this is
  arguably fine (the PI is a live reference, not a contract), but sending a
  cancelled order's PI to a customer would be misleading. If the team wants it,
  the UX fix is small: when so.status is CANCELLED, add a caveat on the PI card
  ("This order was cancelled; the proforma invoice no longer reflects an active
  order") and/or suppress the affordance. Not built pending a product call.

- Single bank on the PI today (per 43a); per-product-type bank routing arrives
  with prompt 45. The frontend renders whatever the backend template emits, so no
  frontend change is needed when routing lands.

- Mobile (375/768/1280): no pre-existing layout adjustment was needed. The PI card
  reuses the InvoiceCard card+grid pattern (label/value rows that stack to a single
  column at <sm), and the View PI / Open PDF buttons sit in a wrap-friendly row.
  No horizontal overflow at any of the three widths; the affordances are 28px tall
  (tappable). The invoices-tab inline PI link reuses the existing row-action
  cluster (View / Print), so it inherited the responsive behavior for free.

## ProductType (2-wheeler / 3-wheeler) integration (prompt 45b) - shipped (frontend)

Shipped against the 45a backend (ProductType { TWO_WHEELER, THREE_WHEELER } on
ProductVariant; create requires it, PATCH accepts it, GET /api/product-variants
?productType=&status=&search= returns it, GET /api/units?productType= filters via
the variant relation, SO type enforced off lines[0] with a 409, PI/invoice bank
routing by type on the backend): a required product-type selector on the variant
create form; an editable type + "Change product type" affordance + a "verify type"
curation cue on the variant detail; a productType filter + column on the variant
list (re-sourced from GET /api/product-variants, which carries productType, vs the
old GET /api/products which omits it); SO single-type enforcement (the line picker
filters to the order's established type, an "This order: Nw" indicator, and a clear
409 panel on mismatch); an order-type pill on the SO detail; type filter chips on
the PO and price-list pickers; a productType filter + column on the units list and
a Product Type row on the unit detail; a shared ProductTypePill, ProductTypeFilterChip,
useVariantTypeMap hook, and product-type lib. 35/35 + 4/4 Playwright assertions
pass (a-ff; y is skip-by-design). Documents need no frontend change (bank routing
is backend); verified the 3-wheeler PI shows the real account and the 2-wheeler PI
shows the 0000000000 placeholder.

Findings / observations:

- SKD-vs-CBU OPERATIONAL LANGUAGE (flag for Theresa bundle): per the 45a audit,
  there is NO SKD-vs-CBU distinction in the codebase: both wheeler types complete
  assembly to IN_WAREHOUSE_CBU, so the assembly UI is product-type agnostic (no
  conditional was added). If users expect "SKD-ready" labelling on 3-wheelers (or
  any 2W-vs-3W difference in the assembly flow), that is a product-language gap
  between operations and engineering, not a code gap. Surfacing it here so the
  Theresa bundle can decide whether the assembly screens need type-aware copy.

- No backend guard on reclassification (verified live): PATCH productType on a
  variant that is already referenced by SO lines / units succeeds with 200 (no
  409). The frontend surfaces a conflict cleanly IF the backend ever adds a guard
  (saveEdit handles the conflict kind), but today reclassifying a referenced
  variant silently changes the type that downstream documents route on. The unit
  rows inherit the new type immediately (the type is read live from the variant,
  not snapshotted). If finance needs reclassification to be blocked or warned when
  references exist, that is a backend guard to add; the frontend is ready for it.

- The 2-wheeler bank account is the placeholder 0000000000 until Theresa provides
  the real details via the env var (45a). No frontend banner was added: the
  document itself shows the account, and the placeholder is self-evidently a
  placeholder. If a dev/staging "placeholder bank in use" hint is wanted, it would
  go on the SO detail PI card, gated on the SO being 2-wheeler; deferred pending a
  request (the deploy-time env update is the real fix).

- API-shape gap (worked around, candidate for backend tidy): GET /api/products
  (the SO/PO/price-list picker source) and GET /api/units rows do NOT carry
  productType, only GET /api/product-variants does. The frontend bridges this with
  a shared useVariantTypeMap hook (mirror-first, network-authoritative via
  listProductVariants) that joins productType by variantId. This works but means
  the type-aware picker filter, the units type column, and the SO/unit type
  indicators depend on a second network read resolving (a brief unfiltered/"--"
  window before it lands). If the backend adds productType to the /api/products
  variant projection and the /api/units row projection, those joins collapse and
  the surfaces show type on first paint. Recorded as a backend-projection request.

- Mirror staleness on productType: the 45a migration backfilled productType but
  (like other raw-SQL backfills) the mirrored productVariant rows can lag until a
  reconcile pulls them, so useVariantTypeMap leans on its network phase as the
  authoritative source. The variant detail's mirror paint must NOT guess a type
  when the raw row lacks one (it would pollute the edit baseline); saveEdit now
  sends productType unconditionally from the segmented control (which reflects the
  authoritative current value) so a stale-baseline diff can never skip the write.

- Cross-context NOT built (candidates): the customer detail page has no per-row SO
  list, so no per-SO type pill was added there (y skipped). Reports (revenue,
  stocks) could segment by productType, which would be genuinely useful for a
  2-wheeler-vs-3-wheeler business view, but the report endpoints do not group by
  type today; both are deferred pending backend support / a product decision.

- Mobile (375/768/1280): no pre-existing layout change was needed. The create-form
  type selector is a segmented control that fits at 375; the variant-list and
  units-list gained one column each (the lists already scroll-x on narrow screens);
  the units filter bar grid was widened from 5 to 6 columns and still stacks to one
  column at <sm. No horizontal overflow at any width.

## SKD state + SKD->CBU upgrade (prompt 46b) - shipped (frontend)

Shipped against 46a (IN_WAREHOUSE_SKD as a real UnitStatus; 3-wheeler kit assembly
completes to SKD, 2-wheeler to CBU; POST /api/assembly-jobs/upgrade {unitRef},
permission assembly.upgrade, jobType SKD_TO_CBU; shared complete/fail/cancel branch
by jobType; counts.skd in the stocks report; sales accept SKD or CBU 3-wheelers):
IN_WAREHOUSE_SKD added to the UnitStatus mirror (+ a distinct teal pill tone, "WH
SKD" shorthand) and AssemblyJobType added; the unit detail surfaces an "Upgrade to
CBU" action (gated assembly.upgrade, SKD-only) + an UpgradeToCbuModal; the assembly
job detail shows the job-type badge, a jobType/productType-aware completion target
(3-wheeler kit -> SKD), and a jobType-aware lifecycle strip; the cancel modal copy
branches (upgrade -> SKD, kit -> CKD); the assembly list gained a Type column +
filter; the adjust map mirrors the backend's SKD edges; the units list status filter
includes SKD; the stocks report (and the offline mirror recompute) carry a distinct
SKD on-hand bucket; the SO form offers SKD units on CBU-form lines. 26/26 Playwright
assertions pass (a-z).

Findings / observations:

- ENUM-DRIFT SWEEP (per the 44b finding): swept UnitStatus, MovementType,
  AssemblyJobStatus, AssemblyJobType frontend-vs-backend. Only UnitStatus was out
  of sync (missing IN_WAREHOUSE_SKD, now added). MovementType (14), AssemblyJobStatus
  (4), and the new AssemblyJobType (2) are all in sync. No further drift found. The
  recurring shape: a new backend enum VALUE (not a new enum) is the silent drift;
  the typed Record<Enum, ...> maps (pills, shorthand, tones, stocks buckets) are the
  safety net that turns a missing value into a compile error, which is why every
  surface that maps UnitStatus needed a one-line addition rather than silently
  mis-rendering.

- Upgrade modal has NO notes field, by design. The 46a contract (POST
  /api/assembly-jobs/upgrade) accepts only { unitRef } (no supervisor, no notes), so
  the modal is an honest confirm. The prompt suggested an optional Notes textarea; a
  field the backend cannot persist would be dishonest UX, so it was omitted. If notes
  on an upgrade are wanted operationally, the backend DTO needs a notes field first;
  then the modal grows one textarea with no other change.

- The 2-wheeler upgrade rejection (assert m) is effectively unreachable through a
  valid SKD unit: a 2-wheeler never enters IN_WAREHOUSE_SKD, so startUpgrade's status
  check (not SKD -> 409) fires before the productType check. The UI never offers the
  action on a 2-wheeler (the affordance is SKD-only and 2-wheelers are CBU), so the
  productType 409 is a pure backend backstop. Both 409 paths surface identically in
  the modal; no UX gap, noted only so the "2-wheeler rejected" path is understood as
  status-gated in practice.

- SKD pill tone: chose a cool teal (distinct hex, not a design-token colour) so SKD
  reads clearly apart from CBU's navy at a glance. This is the first non-token pill
  colour in the unit status set; if a teal token is added to globals.css later, swap
  the two inline hexes (StatusPill + AssemblyStatusPill) for the var. Recorded so the
  inline colour is not mistaken for an oversight.

- Cross-context coherence verified everywhere (unit list/detail, SO line items,
  assembly job detail, stock movements, audit log, reports). One minor copy note: the
  SO-detail line "Soft reservation" hint renders only for CKD/CBU units, not SKD, so
  an SKD line shows the SKD pill without the reservation hint. The reservation
  semantics are identical; if the hint is wanted on SKD lines too, extend the
  CKD/CBU condition to include IN_WAREHOUSE_SKD. Deferred (cosmetic).

- Mobile (375/768/1280): no pre-existing layout change needed. The Upgrade to CBU
  button joins the existing Adjust action row (wraps cleanly at 375); the upgrade
  modal reuses the Modal primitive; the assembly-list Type column and the stocks SKD
  bucket fit the existing scroll-x tables and the KPI split row. No horizontal
  overflow at any width.

- Stocks report layout: the variant table now has CKD / In Assembly / SKD / CBU /
  Sold / Other / Total columns (one wider). Already scroll-x on narrow screens; the
  extra column is fine but the table is getting wide. If more buckets are added,
  consider collapsing the breakdown into an expandable detail on mobile. Not needed
  now.
