# Handoff: Enviable Inventory & Operations (MVP)

## Overview
**Enviable Inventory & Operations** is the internal back-office system for **Enviable Tricycle Auto Parts Ltd.**, a Nigerian importer and reseller of TVS King tricycle units (kekes). It covers the full lifecycle of inventory: procurement from overseas suppliers, shipment receipt and customs clearance, individual unit serialisation, optional assembly (CKD → CBU), wholesale sales to resellers, payment recording, dispatch documentation, and back-office reporting. The system is operated by 12 named users across 11 distinct roles (MD, ED, GM, Operations Director, Procurement Manager / Officer, Sales Manager / Head of Sales / Sales Officer, Warehouse Manager, Stock Auditor, IT Admin) plus a dual-role Executive Assistant.

This MVP scope is **Lagos channel, warehouse sales only**. Retail POS, Nigerian end-user customers, and the Sales/POS Terminal payment method are explicitly out of scope and tagged "Phase 2" in the designs.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. Your task is to **recreate these HTML designs in the target codebase's existing environment** (React + TypeScript is the most likely choice for a back-office system of this scale, but anything modern works) using its established patterns and libraries. If no environment exists yet, choose the framework that best fits the team's skill set and the deployment target (web-only is fine for MVP; native mobile is not required).

The HTML files are intentionally browser-runnable so a non-technical reviewer can click through every screen. **Do not ship them to production.** The CSS in `tokens.css` and the JS in `role-switcher.js` / `empty-system.js` are demonstration-grade — re-implement the equivalent behavior in your chosen framework idiom.

## Fidelity
**High-fidelity.** Pixel-perfect mockups with final colors, typography, spacing, density, and interactions. Match the spacing scale, font sizes, and component states exactly. The aesthetic target is **NetSuite / Odoo-class enterprise density** — dense tables, tight padding, restrained colour. Not a consumer SaaS look.

## Tech & Aesthetic Guidance
- **Density**: 28px control height, 5–6px table cell padding, 12.5px body text. Don't loosen this — it's intentional.
- **Type**: Inter for everything; JetBrains Mono for IDs (engine numbers, chassis numbers, PO/SO/SHP refs, audit IDs).
- **Colour**: Primary navy `#1F4E79`. Semantic colours used ONLY as pills, dot indicators, or text accents — never as full row/card backgrounds (with the rare exception of the immutability-violation row in the audit log).
- **Iconography**: 16px stroke icons inline as SVG. No emoji.

## Screens / Views

The system has **28 screens** in 8 groups. `All Screens.html` is a single-document index that embeds every screen in iframes for review; `All Screens — Print.html` paginates everything for PDF export.

### 1. Foundation
- **`Design System.html`** — Reference page with all reusable primitives: buttons (4 variants × 3 sizes), inputs (text/number/currency/date/select/multi-select/search/file), 16 semantic status pills (Draft / PendingApproval / Approved / InTransit / Cleared / Received / InWarehouseCKD / InAssembly / InWarehouseCBU / SoldAsCKD / SoldAsCBU / PaymentReceived / Dispatched / Delivered / Closed / Cancelled), data tables with sticky header / zebra rows / row hover / actions menu / pagination, page headers with breadcrumbs, sidebar nav with collapsible groups, modals, toasts (success / error / info), empty states, section cards with coloured left borders.
- **`App Shell.html`** — Top bar (company name left, global search centre, notifications bell + user avatar right) and collapsible left sidebar with grouped navigation. Sidebar bottom shows logged-in user (name, role, sign-out link). Bell shows red dot for unread notifications.

### 2. Dashboards · per role
- **`Dashboard.html`** — Warehouse Manager (Kelechi Ekuru). 4 KPIs (Total Units 2,070 with 1,955 CKD / 115 CBU split; Pending Receipts 0; Assembly Backlog 0; Movements Today 0). Active Shipments table (1 row: SHP-2026-001 Cleared with "Receive into warehouse" action). Recent Movements empty state. Stock by Variant horizontal bar chart.
- **`Dashboard - Procurement.html`** — Procurement Officer (Funmi Adebayo). 4 KPIs (Open POs 1; Awaiting PI Approval 0; Shipments in Transit 0; Shipments in Clearing 0). POs by Status as a 9-stage horizontal funnel (only FullyReceived populated with 1). Recent Proforma Invoices (1 row). Suppliers grid grouped by counterparty type.
- **`Dashboard - Sales.html`** — Sales Officer (Chioma Nwankwo). **No cost data anywhere.** 4 KPIs (Sales This Month ₦0; Available CKD 1,955; Available CBU 115; Active Customers 0). "My Recent Sales Orders" empty state with primary "New Sales Order" CTA. Two side-by-side stock-available-for-sale tables (CKD and CBU) with per-row "Add to order" buttons.
- **`Dashboard - Executive.html`** — Executive read-only view (MD/ED/GM). Headline KPI: Total Inventory Value ₦5.96 billion. 3-up row: Unit Status donut (2,070 with 94.4% CKD / 5.6% CBU), Sales Trend (flat zero line with system-launch marker), Approval Queue (empty). Recent Activity feed showing 10 plain-English audit entries.

### 3. Procurement
- **`Create Purchase Order.html`** — 4 numbered section cards (PO Details / Line Items / Documents / Notes). PO Number auto-generated as PO-2026-002 (read-only with copy button). Supplier select shows expanded meta line. Line Items table is inline-editable with live recalculation (qty × price → line total; lines → subtotal).
- **`Purchase Order Detail.html`** — PO-2026-001 detail page demonstrating the **ApprovalLadder component**: horizontal stepper with one node per required approver, showing approver name (or role placeholder if unassigned), status (pending/approved/rejected/upcoming), and timestamp. The PO chain is 4 stages: Submitted (Funmi, done) → Procurement (Tunde, done) → Operations (Ikenna, current/pending) → Executive (Theresa, upcoming for commitments > $2M).
- **`Review Proforma Invoice.html`** — PI ORD0000023649 Rev 1 with tabs: Line Items / Compare to Revision 0 (side-by-side diff with red strike-through + green added) / Source Document (rendered PDF preview with letterhead, stamp, signature).
- **`Receive Shipment.html`** — SHP-2026-002 receipt with 4 tabs: Manifest Match (editable Received column with red-on-mismatch + Variance Reason textarea), Unit Serialisation (left rail of variants, scan zone with pulsing scanner indicator, manual paste-friendly textarea), Landed Cost (editable component rows with attachment status — NPA Port Charges row flagged red for missing doc), Documents (8 file rows). Bottom summary panel shows 3 blocking stats.

### 4. Inventory
- **`Units Listing.html`** — 2,070 individually-tracked unit table. Filter bar (Variant, Status, Warehouse, Received Date, Engine/Chassis search). 20 rows mixing GS+ CKD (G Yellow / NEP Blue / Wine Red / Eco Green) and ZS+ (CBU + CKD InAssembly). Engine # in mono navy as deep-link. Row overflow menu: View / View history / Transfer / Allocate to Demo / Mark damaged (red).
- **`Unit Detail.html`** — Single unit (TVSKGS25E0001234) summary + Movement History timeline with one real receipt entry and two faded "illustrative" placeholders (Assembly started, Sold as CBU). **Landed Cost row is role-gated**: visible to Warehouse Manager and above; replaced with "Cost data not visible at your access level" for Sales Officer (see role-switcher.js demonstration).
- **`New Assembly Job.html`** — Assembly Supervisor (Daniel Omage). Job AJ-2026-0119 with auto-filled supervisor/timestamp. Two-column "Units to Assemble": left has Scan input (green pulsing scanner) + "Bulk Add by Variant" modal trigger + Available CKD inventory snapshot; right has 8-unit queued list. Four-step Confirm Assembly workflow guide.

### 5. Sales
- **`New Customer.html`** — Sales Officer onboarding a Reseller. Customer Type radio with EndUser disabled ("Phase 2"). Business/Personal segmented toggle. Phone with +234 prefix + flag glyph. Pricing Tier dropdown with live price preview that swaps when you change tier (Reseller Standard ₦2,800,000 / Reseller Volume ₦2,720,000).
- **`New Sales Order.html`** — SO-2026-001 for ABC Tricycle Dealers Ltd. Lines table picks individual units by engine number (each line = one physical unit). Sale Form pill (CKD navy / CBU green). Right-side totals panel: Subtotal ₦9,000,000, Discount −₦100,000, Net ₦8,900,000, VAT 7.5% ₦667,500, **Total ₦9,567,500**. 9-state lifecycle strip at the bottom (Draft → AwaitingPayment → PaymentReceived → ReleaseAuthorised → Picking → ReadyForDispatch → Dispatched → Delivered → Closed).
- **`Record Payment Modal.html`** — 520px modal that opens from a SO in AwaitingPayment. Dark navy "amount due ₦9,567,500.00" headline strip. Payment Method radio (Bank Transfer selected; POS Terminal disabled with "Phase 2"). Cash is intentionally NOT an option. Live amount-match feedback below the amount input. Confirmation Source radio (Webhook disabled / Manual upload selected). Triggers a success toast "Payment confirmed. Release authorisation can now be issued for this order."
- **`SO Documents Review.html`** — Three tabs: **Invoice** (full VAT invoice PDF preview with letterhead, beneficiary bank block, "PAID" watermark), **Release Authorisation** (internal doc with payment confirmation banner, items-to-release table with bay locations, signature blocks with cursive ink-name + rubber stamp), **Delivery Note** (waybill format with picking checkboxes + 3 signature blocks: Warehouse / Driver / Customer). Right sidebar has the 9-state vertical lifecycle with current stage highlighted.

### 6. Reports
- **`Stocks Report.html`** — As-of snapshot. Filter bar + 3 KPIs (Total Units / Total Market Value as headline / Total Variants). Stock by Variant table with 5 lifecycle-state columns (CKD / InAssembly / CBU / Sold / Other) + market price + market value. Separate Spare Parts table valued at landed cost (note: spare parts have no market price in MVP). Donut + horizontal bars at the bottom.
- **`Audit Log.html`** — Internal Auditor view (Ifeoma Achebe). **Immutable** tag in header. Filter bar with 5 controls. Each entry is a card row with actor avatar, action verb (CREATE/UPDATE/STATUS_CHANGE/DELETE_BLOCKED), entity reference, timestamp, action+entity tags, and expandable property diff (side-by-side before/after). **Critical demo**: entry #audit-0942 has an amber notice referencing #audit-0943, and #audit-0943 itself is the blocked-mutation event styled red with full forensic detail (attempted SQL, source IP, blocked-by trigger, notification recipients). Side panel has filtered stats (142 entries, 7 actors, top action "update 62%") and compliance checks.

### 7. Admin
- **`Users v2.html`** — IT Admin user list (12 accounts). Columns: Name, Email, Roles (chip), **Reports To** (mini avatar + linked name showing the org tree), Status, Last Login, row actions menu (Edit / Reset Password / Deactivate). Right-side Roles Quick Reference card with 11 role descriptions and member counts.
- **`User Detail.html`** — Kelechi Ekuru (Warehouse Manager). 56px avatar headline + 3 tabs: Profile (form with Name/Email/Phone/Status/Reports-To picker), Roles (1 role card with assignment date and assigning-admin meta), Activity (filtered audit slice scoped to this user). Phase-2 note for custom role creation.
- **`Historical Data Load.html`** — 5-step import wizard (Shipment Details / Upload Kekes / Upload Spare Parts / Landed Cost / Review & Commit). Step 2 active. Drop zone, CSV template link, validation summary (2,070 rows / 2,070 valid / 0 errors / 0 duplicates), errors panel collapsed, preview table of 20 rows, note about post-arrival movements in Step 6.

### 8. Responsive variants
- **`Dashboard — Tablet.html`** / **`Dashboard — Mobile.html`**
- **`New Sales Order — Tablet.html`** / **`New Sales Order — Mobile.html`**
- **`Unit Detail — Tablet.html`** / **`Unit Detail — Mobile.html`**

Tablet (1024px): icon-rail 64px sidebar, denser layouts. Mobile (390px): hamburger drawer, KPI stack, tables become card-list, sticky bottom action bar. **Only these three screens have mobile + tablet variants at MVP.** Every other screen is desktop-only.

## Interactions & Behavior

### Global behaviors
- **Role switcher** (`role-switcher.js`): floating bottom-left widget with two options (IT Admin / Sales Officer). When set to Sales Officer, all elements labelled "landed cost", "margin", "profit", "cost basis", "COGS" are hidden via DOM scan. On Unit Detail specifically, the Landed Cost row is replaced with a lock icon + "Cost data not visible at your access level". Persists to localStorage.
- **Empty-system toggle** (`empty-system.js`): on dashboards only. Switches all data to zero ("day one" state) — KPIs flatten to 0, tables show empty-state rows, bars collapse, donut greys out, suppliers grid empties, an amber "Day one · empty system" banner appears below the page header.

### Form patterns
- **Auto-fields** (PO number, SO number, Job ref, Created By, timestamps): rendered as locked grey rows with an "Auto" tag on the right. Cannot be edited.
- **Live recalc**: line totals and subtotals update on `input` event in editable cells.
- **Sticky form footer**: bottom: 16px sticky with shadow, repeats primary action and shows saved-state.
- **Modal confirmation toasts**: on submit, modal closes and a bottom-right toast slides in. Errors are sticky; success/info auto-dismiss after ~5s.

### Approval lifecycle (PO)
4 stages: Submitted → Procurement Manager → Operations Director → Executive Director (last is conditional on commitment threshold > $2M). Render with the ApprovalLadder component (see CSS in tokens.css under `.approval-ladder`).

### Sales order lifecycle (SO)
9 stages: Draft → AwaitingPayment → PaymentReceived → ReleaseAuthorised → Picking → ReadyForDispatch → Dispatched → Delivered → Closed. Render as a horizontal step strip with connecting lines.

### Audit log immutability
Audit entries are append-only. Any UPDATE/DELETE attempt against the audit table is itself logged as a "DELETE_BLOCKED" entry by a row-level trigger. The UI shows both the target entry (with an amber notice linking forward) and the blocking event (styled red with forensic detail). This is **not** decorative — implement at the DB layer.

## State Management

Each entity has a state machine. Implement as enums + a transitions map. Transitions emit audit entries.

- **PurchaseOrder**: Draft / PendingApproval / Approved / SentToSupplier / PIReceived / AwaitingShipment / PartiallyReceived / FullyReceived / Closed / Cancelled
- **ProformaInvoice**: per-PO, revisioned. State: Active / Superseded / Rejected
- **Shipment**: InTransit / Cleared / Received / Discrepancy
- **Unit** (per-keke): InWarehouseCKD / InAssembly / InWarehouseCBU / SoldAsCKD / SoldAsCBU / Damaged / Closed
- **AssemblyJob**: Draft / Started / Completed / Cancelled
- **SalesOrder**: see above (9 states)
- **Payment**: Pending / Confirmed / Reconciled

Required data fetches per screen are list-API style (paginated, filterable). Most dashboards need a single aggregate-stats endpoint each.

## Design Tokens

All tokens live in `tokens.css` as CSS custom properties on `:root`. Lift these into your design system (e.g. a TypeScript constants file, a Tailwind config, or a CSS-in-JS theme).

### Colours
```
--navy-900: #0F2A44     pressed
--navy-800: #163C61     deep brand (sidebar)
--navy-700: #1F4E79     PRIMARY
--navy-600: #2C5E8E
--navy-500: #5A82A8
--navy-100: #E6EEF6
--navy-50:  #F2F6FA

--green-700: #2E7D32    complete
--amber-700: #B45F06    in-progress
--red-700:   #C00000    problem

--ink:      #1A1A1A     primary text
--grey-700: #43474F     secondary headings
--grey-500: #7B7F87     secondary text
--grey-400: #AEB1B8     placeholder, icons
--grey-300: #D2D5DB     borders
--grey-200: #E6E8EC     dividers
--grey-100: #F2F3F5     subtle surfaces
--canvas:   #F6F7F9     page background
--surface:  #FFFFFF     card / table background
```

### Spacing (4px base)
4 / 8 / 12 / 16 / 20 / 24 / 32 px.

### Typography
- Body: Inter 12.5px / 1.4 line-height
- Page titles: 18px / 600 weight / -0.01em letter-spacing
- Section titles: 12.5px / 600
- Table cells: 12px
- Table headers: 10.5px / 600 / 0.04em uppercase
- KPI numbers: 22px / 700 / -0.02em
- Mono (IDs): JetBrains Mono 11–12px
- KPI headline (executive dashboard): 24px

### Border radius
2 / 3 / 4 px. Mostly 3px. **Don't use 6px+ rounded corners** — they read as consumer SaaS.

### Shadows
- `--shadow-sm`: subtle 1px elevation
- `--shadow-md`: floating panels
- `--shadow-lg`: modals, popovers

### Control sizes
- Buttons: 28px (`.btn-sm` 24px, `.btn-lg` 32px)
- Inputs: 28px
- Table row height: ~28–30px (5px vertical padding)
- Sidebar width: 212px
- Top bar height: 44px

## Assets

The design uses no raster imagery beyond rendered SVG icons inline. Logos and company brands are placeholder boxes (e.g. "EI" letter mark in a navy gradient square, "TVS" / "VSK" letter chips). When implementing, the developer should:
- Replace the "EI" placeholder logo with the real Enviable Tricycle logo if available
- Replace supplier letter-chips with actual supplier logos where available
- Keep all SVG icons as inline strokes; do not switch to icon fonts

## Files in this bundle

```
design_handoff_enviable_io/
├── README.md                              ← this file
├── tokens.css                             ← design tokens + density overlay + ApprovalLadder + role-switcher / empty-system styles
├── role-switcher.js                       ← demo role gating (IT Admin / Sales Officer)
├── empty-system.js                        ← demo day-one empty-state toggle (dashboards only)
│
├── Design System.html                     ← every reusable component, demonstrated
├── App Shell.html
│
├── Dashboard.html                         ← Warehouse Manager
├── Dashboard - Procurement.html
├── Dashboard - Sales.html
├── Dashboard - Executive.html
│
├── Create Purchase Order.html
├── Purchase Order Detail.html             ← ApprovalLadder component demo
├── Review Proforma Invoice.html
├── Receive Shipment.html
│
├── Units Listing.html
├── Unit Detail.html                       ← role-gated landed cost demo
├── New Assembly Job.html
│
├── New Customer.html
├── New Sales Order.html
├── Record Payment Modal.html
├── SO Documents Review.html
│
├── Stocks Report.html
├── Audit Log.html
│
├── Users v2.html
├── User Detail.html
├── Historical Data Load.html
│
├── Dashboard — Tablet.html
├── Dashboard — Mobile.html
├── New Sales Order — Tablet.html
├── New Sales Order — Mobile.html
├── Unit Detail — Tablet.html
├── Unit Detail — Mobile.html
│
├── All Screens.html                       ← consolidated index — opens every screen in iframes
└── All Screens — Print.html               ← print-ready paginated edition with cover + TOC + section dividers
```

To preview the full system: open `All Screens.html` in a browser and use the left-side TOC to jump between screens. To export the design pack to PDF: open `All Screens — Print.html`, wait for the helper bar to confirm all 28 screens loaded, then Ctrl/⌘ P → A3 landscape.
