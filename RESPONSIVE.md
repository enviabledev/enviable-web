# Responsive pass: audit + strategy (prompt 29, phases a + b)

Status: **strategy confirmed; implementation in progress.**

- Decisions confirmed: tables = progressive column-hiding default / card-reflow
  for finance-comparison tables / horizontal-scroll for nested line items;
  sidebar drawer below `lg`; extract a shared Dialog primitive.
- **Phase 1 (shell): DONE and verified.** Sidebar collapses to an off-canvas
  drawer below `lg` (persistent rail at `lg+`, unchanged desktop); topbar gains
  a hamburger and drops the search box + user-name to `lg+` so it fits tablet;
  content padding `p-4 sm:p-6`. Verified at 375/768/1280 in `e2e/shell.spec.ts`
  (drawer toggles, nav closes it, main reclaims full width, no shell-induced
  overflow); the invoice suite still passes through the new shell (desktop
  regression-clean).
- **Phase 2 (primitives): DONE.** Extracted the `Modal` overlay primitive and
  migrated the one true overlay (historical-load). Correction banked: the app
  had 1 overlay modal, not 5 (the rest are inline panels that flow). The
  filter / action-bar / detail-grid treatments are utility-class patterns
  (no shared component exists to extract without a broad refactor), applied
  per screen in Phase 3 per the documented standard above.
- **Phase 3 Sales cluster (reference): DONE and verified.** Applied the
  column-tier rule to sales-orders / customers / deliveries / price-lists
  lists; card-reflow to invoices + payments (the finance exception); filter
  stacking, detail-grid collapse, and header stacking across the cluster's
  detail pages. Tier classes centralised in `src/lib/responsive.ts`.
  - **Safety net:** every list table sits in an `overflow-x-auto` container, so
    even when the surviving Tier-1 columns are wider than the viewport (long SO
    numbers + a wide status pill), the table scrolls inside its card and the
    PAGE never overflows. Column-tiering minimises how often that scroll is
    needed; the container guarantees no page overflow regardless.
  - **Card-reflow breakpoint:** invoices/payments show cards below `lg` and the
    table at `lg+` (the 7-column finance table does not fit a 768 tablet), so
    tablet gets the card view too.
  - Verified in `e2e/sales-responsive.spec.ts`: no horizontal overflow across
    all 9 Sales screens at 375/768/1280, Tier-4 column hidden at 375 + shown at
    lg, invoices reflow to cards on mobile + table on desktop. Full suite
    (shell + invoices + sales) green; desktop regression-clean.
- **Pausing for the visual walkthrough of the Sales cluster** before
  propagating to inventory / procurement / reports / admin (Phases 3 continued
  + 4). One open question for the walkthrough: on the narrowest screens a few
  list tables scroll horizontally to reach the primary metric (Total) because
  the identity column (full SO number) is long; acceptable as-is, or truncate
  identity to keep Total in view without scroll?

## How this was measured

A Playwright sweep logged in (Managing Director, broad read perms), waited
for the mirror to fill so tables render with real rows, then visited every
shipped screen at 375px (mobile), 768px (tablet) and 1280px (desktop),
recording for each: the document scroll width vs the viewport width
(horizontal overflow), the rendered width of `<main>`, and a full-page
screenshot at 375 and 768. Screenshots and the raw `overflow.json` are under
`/tmp/inv-audit/` (not committed).

Caveat: the audit ran with one broad-permission user. Screens that user
cannot read (audit log) render their access-denied card instead of the data
table, so the audit-log table's specific width was not captured; it is a
known-wide table and is included in the table strategy regardless.

## Headline finding (the one number that matters)

**`<main>` renders at 163px on every screen at a 375px viewport, and 556px at
768px.** The sidebar is a fixed 212px (`--size-sidebar`), always present, with
no collapse, and the content area gets `375 - 212 = 163px` (mobile) or
`768 - 212 = 556px` (tablet). Every screen is crippled before any table,
filter, or form is considered. This is the load-bearing fix: collapse the
sidebar to an off-canvas drawer below `lg`, and every screen reclaims the full
width (`main` goes 163 -> ~343 at 375).

Only 1 of 70 component/page files currently uses any responsive utility
(`md:`/`lg:`/etc.), and that one is `globals.css`. The app is entirely
desktop-fixed; this is a from-zero responsive pass, not a touch-up.

## Per-screen overflow map (document-level horizontal scroll)

Document-level overflow is the *secondary* symptom (a table forcing the page
wider than the viewport). The *primary* symptom (content crushed into 163px)
affects 36/36 screens regardless of whether the number below is 0.

375px: document overflow on these (px past the viewport):
`proc-po-list +786`, `sales-invoices-payments +773`, `reports-revenue +696`,
`dashboard / inv-units-detail / inv-spareparts-list / proc-pi-document /
proc-counterparties-list / proc-shipments-detail +587`. The remaining list
screens show `+0` only because their table clips/wraps into 163px (unusably
narrow, not "fine").

768px still overflows: `sales-invoices-payments(payments tab) +558`,
`sales-so-detail +411`, `sales-deliveries +294`, `inv-movements-detail /
proc-pi-detail / proc-po-detail +194`.

1280px: 0 overflow (desktop unaffected, as required).

## Cross-cutting breakages (with evidence)

1. **Sidebar (every screen).** Fixed 212px, no collapse, no hamburger. Eats
   56% of a 375px viewport. Root cause of the 163px main. `AppShell` is a flex
   row of `<Sidebar>` + `<main>`.
2. **Topbar (every screen).** The fixed-width search box + full user chip
   ("Demo Managing Director / Managing Director") force a wide min-width; even
   the access-denied page measured ~1000px wide. The topbar never shrinks.
3. **Tables (every list + nested detail tables).** Render full desktop columns
   with `whitespace-nowrap`; overflow 190-786px. No column hiding, no card
   reflow, no scroll affordance.
4. **Filter bars (list screens).** At 375px the filter row does not reflow:
   labels overlap (the Sales Orders "CUSTOMER" label renders on top of itself)
   and controls cram. At 768px filters are fine, so this is a <=sm problem.
5. **Detail label/value grids.** `grid-cols-[160px_1fr]` cards keep a fixed
   160px label column; at 163px main there is ~3px for the value. Needs to
   stack below sm.
6. **Detail action bars / header actions.** Approve/Reject/Authorise buttons
   sit inline in the page header; at narrow widths they cram against the title.
7. **Dialogs.** There is no shared Dialog primitive; 5+ screens hand-roll
   `fixed inset-0` modals (historical-load, PI detail, counterparties detail,
   assembly new + detail). Each would need the narrow-viewport fix
   independently unless a primitive is extracted.
8. **Invoice document views (prompt 28).** The rendered A4 document is a fixed
   794px iframe in a horizontally-scrollable grey frame; that is acceptable
   (it is a fixed-size paper artifact), but the scroll container and the
   summary card above it still sit inside the 163px main until the sidebar
   collapses.

## Proposed strategy per element class

### Breakpoints
Use Tailwind v4 defaults already in effect: `sm` 640, `md` 768, `lg` 1024,
`xl` 1280. Desktop layout is the `lg+` baseline (unchanged). Tablet is
`md`..`lg`. Mobile is `< md` (with a few `< sm` refinements). No custom
breakpoint CSS; tokens carry the work.

### Navigation: sidebar -> off-canvas drawer (THE load-bearing fix)
- `lg+`: persistent 212px sidebar, exactly as today (no desktop change).
- `< lg`: sidebar hidden by default; a hamburger button appears at the left of
  the topbar; tapping it slides the sidebar in as an off-canvas drawer over a
  scrim; tap-scrim / nav-select / Escape dismisses it. The drawer reuses the
  existing `<Sidebar>` content verbatim (groups, permission gating, scroll).
- This single change reclaims full width on mobile and tablet and is the
  prerequisite for every other fix to matter.

### Topbar
- `< md`: search collapses to an icon button (expands to a full-width overlay
  on tap, or simply links to the existing `Cmd-K` palette); the user chip
  collapses to avatar-only (name/role hidden, still tappable); the hamburger
  occupies the freed left space. `lg+` unchanged.

### Tables: progressive column disclosure (THE load-bearing UX call)
Recommendation, matching the prompt's weak lean:

- **Default = (c) progressive column hiding.** Each list table keeps its
  identity column (SO number, PI number, unit engine no, etc.) plus 1-2
  decision columns (status, total) at mobile; secondary columns
  (`created`, `channel`, `customer code`, etc.) are hidden `< md` / `< lg`
  via `hidden md:table-cell` / `hidden lg:table-cell` and reappear as width
  grows. The row stays a link to the detail page, which is the affordance for
  the hidden fields (no information is dropped without a path to it). Preserves
  the table mental model, no horizontal scroll, consistent across every list.
- **Fallback = (b) card reflow** only where (c) would hide too much to be
  useful (a row whose value is the cross-column comparison, e.g.
  invoices+payments where amount/VAT/status are all primary). There each row
  becomes a stacked card `< md`.
- **(a) horizontal scroll** reserved as a deliberate escape hatch for genuinely
  wide *nested* numeric tables (SO/PO line items, PI lines) wrapped in
  `overflow-x-auto` with a visible scroll affordance, where every column is
  essential and hiding any is wrong. Never the default for a top-level list.

**Column-priority rule (the standard, applied consistently across every
table, not per-table judgement):**

- **Tier 1 (always visible, including mobile `< sm`):** the row identity
  (SO/PI/PO number, unit engine no, SKU, customer name) + the primary status
  pill + the primary metric (total / quantity / amount). This is the minimum
  that makes a row scannable and tappable.
- **Tier 2 (reveal at `sm` 640+):** the most useful secondary reference (e.g.
  the counterparty/customer when identity is a document number, or the linked
  PO/SO).
- **Tier 3 (reveal at `md` 768+):** dates (issued / created / due), codes
  (customer code, supplier ref), and secondary references.
- **Tier 4 (reveal at `lg` 1024+):** tertiary metadata (channel, notes,
  secondary timestamps, secondary metrics).

Hidden columns are never dropped silently: the row links to its detail page,
which carries every field. When a table applies this rule, the per-table
column-to-tier assignment is recorded in the cluster commit so reviewers can
confirm it follows the standard rather than bespoke judgement. The same
column type gets the same tier across clusters (a "created" date is Tier 3
everywhere; a status pill is Tier 1 everywhere).

### Filters (standard)
- `< sm`: the filter form switches to a vertical stack (`flex-col`) with each
  control full-width (`w-full`), fully usable, no overlap. `sm+`: the existing
  inline row (`sm:flex-row`, controls revert to auto width). Applied uniformly
  across every list's filter form. A "Filters" drawer is not needed at this
  density (2-3 controls per screen); revisit only if a screen's filter set is
  wide enough to push the list below the fold even when stacked.

### Action bars / header actions (detail pages)
- `< sm`: primary actions stack full-width below the title; `sm+`: inline as
  today. Confirmation rows (Approve/Reject) become a full-width stacked pair on
  mobile so they are thumb-reachable.

### Detail label/value grids (standard)
- `< sm`: single column, label as a small caption above its value (collapse
  `grid-cols-[160px_1fr]` to `grid-cols-1`). `sm`..`lg`: the existing
  label+value two-column grid. Multi-column metadata grids (2-up/4-up) follow
  `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (or the screen's existing top
  count at `lg`). Applied consistently across every detail page so a
  label/value block reads the same way on every screen.

### Tier classes (shared, so the tier rule is identical everywhere)
`src/lib/responsive.ts` exports the column-tier utility strings
(`COL.sm`/`COL.md`/`COL.lg` = `hidden sm:table-cell` etc.) and the detail-grid
and filter-form class strings, so every table/detail/filter references the
same constants rather than re-deriving the breakpoints. Each list table's
`Th`/`Td` gain a `className` passthrough; the paired header+cell for a column
get the SAME tier class.

### Identity-column truncation (standard)
Tier 1 must FIT at 375px, not merely be nominally present. The identity column
gets a width cap that bites only on mobile (`max-w-[~104px] sm:max-w-none`) with
`truncate` on a block child, plus `title={fullValue}` (desktop hover) and the
row's detail link (mobile affordance). Production ID formats are short
(`SO-2026-0001` 12 chars, `INV-2026-0001` 13 chars), so they fit under the cap
and never truncate; only long outliers elide. No collision risk: production IDs
display in full, so distinct IDs never collapse to the same string; truncation
only fires on outliers where the full value remains on title + detail page.
(Middle-truncation was prototyped but inline-flex does not enforce its cap
inside a nowrap table cell; block `truncate` is the reliable table-cell pattern.
Since production IDs never truncate, end-vs-middle is academic here.)

### Status-pill shorthand (standard)
When a long status would push the primary metric out of view, the pill shows a
consistent shorthand on mobile and the full label at `sm+` (two spans,
`sm:hidden` / `hidden sm:inline`; full value also on `title`). The mapping is a
fixed table so the same input always yields the same output across clusters
(e.g. `READY_FOR_DISPATCH` -> "Ready", `PAYMENT_RECEIVED` -> "Received"). See
`shortSoStatus` in `SoStatusPill.tsx`. Plus mobile table cells use
`px-2 sm:px-3.5` to reclaim margin; combined with column-tiering and identity
truncation, that padding rule is part of what makes Tier 1 fit at 375.

**Per-entity propagation:** there is ONE status/type pill component per entity,
each with its own FIXED (not computed) shorthand map following the SoStatusPill
shape (mobile short span `sm:hidden` + full span `hidden sm:inline` + full value
on `title`). As each cluster is done, give its pills the shorthand:
- Inventory: `UnitStatusPill`, `MovementTypePill`, `AssemblyStatusPill`
  (+ a spare-part status pill if one exists).
- Procurement: the proforma status pill, counterparty type pill.

A new list table added later must apply ALL of: column-tier classes, identity
truncation, the entity's status-pill shorthand, `px-2 sm:px-3.5` padding, the
stacked filter form, and the `overflow-x-auto` table container.

## Running the responsive suite

`npm run e2e:responsive` runs the shell spec + every `*-responsive.spec.ts`
(auto-includes new clusters by filename match). Each cluster spec asserts, at
375/768/1280: no document overflow, Tier-1-fits-without-table-scroll at 375,
and desktop regression-clean. Needs backend :3000 + dev :3100 + the broad-read
fixture user (md-demo). Prompt 29 closes when this is green across all clusters.

### No-info-dropped verification (per table)
Before a table hides a column at mobile, confirm that column's field is
actually rendered on the row's detail page (the detail link is the affordance
for hidden fields). If a hidden column has no detail-page home, it is NOT
hidden (or the detail page gains it). Checked per table as it is implemented.

### Dialogs (+ extract a primitive)
**Correction after closer inspection (Phase 2):** the app has exactly ONE
true overlay modal (`fixed inset-0`): the historical-load ConfirmDialog. The
other "dialogs" I flagged (PI approve/reject, counterparties, assembly start,
SO record-payment) are inline `role="dialog"` confirmation panels rendered in
the page flow, which wrap naturally on narrow viewports and were not a
breakage. The earlier "5+ hand-rolled modals" was an overcount.

Done in Phase 2: extracted `src/components/ui/Modal.tsx` (centered card,
`w-full` minus a 16px gutter on mobile, `max-w-[520px]` on larger screens,
`max-h-[90vh]` internal scroll, scrim-click + Escape to close, body-scroll
lock, 4px radius per the density rules) and routed the historical-load
ConfirmDialog through it. The primitive future-proofs the prompt-31
user-creation modal so that one is responsive-correct from the start. The
inline confirmation panels are left as-is (they flow) and re-verified per
cluster in Phase 3.

## Findings to bank (BACKLOG)

- **The frontend-design skill carries no responsive guidance.** It is the
  generic creative-design skill (typography/colour/motion), with no breakpoint
  tokens, table-to-card patterns, or navigation-collapse conventions. The
  patterns chosen here should be formalised as the project's responsive
  standard (ideally into the design system / a project skill) so future screen
  builds inherit them instead of re-deciding case by case.
- **No shared Dialog primitive** exists; modals are hand-rolled per screen.
  Recommend extracting one during this pass (see above).
- **Topbar search + user chip** have no shrink behaviour; they are the reason
  even content-light pages overflow.

## Open questions for confirmation (before implementation)

1. **Table strategy:** confirm (c) progressive column-hiding as the default,
   (b) card reflow for the finance/comparison tables, (a) scroll only for
   nested line-item tables. This is the decision that propagates across ~15
   list/detail tables, so it is the one to lock first.
2. **Sidebar drawer below `lg`:** confirm the breakpoint. `lg` (1024) means
   tablets in portrait (768) get the drawer + full width; an alternative is
   keeping the persistent sidebar at `md`..`lg` (tablet) and only drawering
   `< md`. Recommendation: drawer `< lg` (768 tablet benefits more from the
   width than from a persistent rail), but this is a genuine UX call.
3. **Dialog primitive extraction:** in scope for this pass, or bank as a
   follow-up and patch the 5 sites in place?

## Proposed implementation sequence (after sign-off)

1. Cross-cutting shell first: sidebar drawer + topbar shrink + hamburger.
   Re-run the audit; this alone clears the 163px-main breakage on all screens.
2. Primitives: the table column-tier utility/pattern, the filter-stack
   pattern, the action-bar stack, the detail-grid collapse, the Dialog
   primitive. One commit per primitive.
3. Per-cluster application (inventory, sales, procurement, reports, admin),
   one commit per cluster, applying the primitives to each screen's specifics.
4. Playwright at 375/768/1280 per cluster: assert no document overflow,
   primary affordances reachable, desktop regression-clean. Hand off the
   visual/usability walkthrough at mobile + tablet.
