# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`enviable-web` is the Next.js 15 (App Router, React 19, Tailwind v4, TypeScript) frontend for the Enviable inventory and operations system. The backend (NestJS, session-cookie auth) lives in the sibling repo `enviable-system`.

## Operational safety (non-negotiable)

Read this before running anything destructive.

- **Commit and push after every prompt.** A prior incident on the backend lost months of work to an unverified destructive command in a repo without version control. Every unit of work ends with a commit and a push to the private remote `enviabledev/enviable-web` so nothing is ever unsaved.
- **Never run `rm -rf`, folder reverts, or any destructive path operation on an unverified path.** macOS is case-insensitive, so a single character typo can wipe the wrong directory. Verify the path character by character before any destructive command.
- **Working directory stays scoped to `enviable-web` for SOURCE EDITS.** Do not edit files in `enviable-system`, or unrelated projects like `nmaas-project`. Source ownership is the boundary: each repo's code is owned by sessions scoped to that repo (the frontend agent does not edit backend source, the backend agent does not edit frontend source), and source changes happen in the right session via git remotes and the API contract. **Read-only operations in the sibling environment ARE in scope as part of the verification toolkit:** running fixture-setup scripts (`npm run set-password` against the dev DB), `docker exec ... psql` for fixture seeds, verification probes, password activations, and similar actions that touch the shared dev environment without changing sibling-repo source. The discriminator is "is this a source edit, or a verification-environment action," not "did I `cd` into another directory." Stalling on a legitimate one-line activation because "it lives in the sibling repo" is the too-strict failure mode; editing sibling-repo source under the guise of "verification" is the too-loose failure mode. Both are wrong; the source-ownership line tells them apart.
- **Never use em dashes (`—`) anywhere**, in code, comments, commit messages, or docs. Use commas, colons, or sentence breaks instead.

## Commands

```bash
npm run dev        # Next dev server with Turbopack on http://localhost:3100
npm run build      # Production build (Turbopack)
npm start          # Serve the production build on port 3100
npm run lint       # ESLint (flat config: next/core-web-vitals + next/typescript)
npm run typecheck  # tsc --noEmit (strict)
```

No test framework is wired up yet. Dev runs on port 3100 because port 3000 is the backend.

**Never run `npm run build` while `npm run dev` is running.** Both write the same `.next` directory, so a production build clobbers the dev server's incremental cache, including the `next/font/google` fonts (Inter, JetBrains Mono) that Next downloads at compile time. On a healthy network the dev server silently re-downloads them and you never notice the cost; if `fonts.gstatic.com` is unreachable (a blocked CDN, an offline test session), the re-fetch fails and the dev server dies with `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'`. Treat build and dev as mutually exclusive in this directory: to verify a build, stop the dev server first (or build in a separate clone / with a separate `.next`). Prefer `npm run typecheck` + `npm run lint` for routine validation and let the running dev server compile routes on demand.

## Backend relationship: API is the source of truth

The backend is a separate, complete, tagged NestJS API at `enviable-op/enviable-system` (repo `enviabledev/enviable-system`, tag `v0.1.0-backend-complete`). It serves under the `/api` prefix and is the canonical contract for everything this frontend renders.

**Rule: where the design handoff and the running API disagree, the API wins.** The handoff predates the final backend and lists fewer Unit and Shipment states than actually exist. When building a screen, derive the state list, the resource shape, and the permission keys from the running API (and the backend types and Prisma schema in `enviable-system`), not from handoff illustrations. If the handoff shows three Unit states and the API returns six, render all six (including `IN_REPAIR`, `DEMO`, `INTERNAL_USE`, `RETURNED`, and any others the API exposes).

Concretely: before building a screen that surfaces a domain model, check the API response shape and any enum-valued fields. Do not hardcode an enum list lifted from the handoff.

## Option A auth model (security-relevant)

Auth is **session cookie**, not JWT. The backend issues an httpOnly cookie named `enviable.sid`. The Next app proxies same-origin `/api/...` to the backend (`next.config.ts`), and the cookie flows in both directions automatically.

The hard rules:

- **Client JavaScript never reads, writes, or stores the session cookie.** It is httpOnly by design and inaccessible to JS.
- **Do not use `localStorage` or `sessionStorage` for auth tokens or session state.** The httpOnly cookie is the only auth token, and putting any auth artifact in JS-accessible storage breaks the security model Option A was chosen to enforce.
- **The app's only knowledge of auth state is the in-memory principal** from `GET /api/auth/me`, shaped `{ id, fullName, email, roles, permissions }`. Resolve it once, hold it in memory (context or store), and re-fetch on navigation or on any 401.
- Always fetch from relative `/api/...` URLs with `credentials: "include"`. Never reference `BACKEND_API_URL` from client code; it is a server-only env var.
- Treat HTTP 401 as the "logged out" signal, not an error.

### Principal caching (offline reload), important distinction, do not "tidy"

The principal (identity metadata: `id`, `fullName`, `email`, `roles`, `permissions`) is cached in IndexedDB to enable full offline app rendering across reloads. See `src/lib/auth/principal-cache.ts`. This is **NOT** caching the auth token; the httpOnly session cookie remains the sole credential, is never in JS, and is never stored here. The no-auth-artifact rule above is about the token (the credential that grants access). The principal does not grant access; it describes who the cookie belongs to, and so caching it does not violate the rule.

The pattern is hydrate-then-revalidate: on boot, `AuthProvider` reads the cached principal from IDB and flips to `authenticated` immediately so a cold reload (including offline) renders the full app shell without waiting for the network. `fetchMe` then runs in the background to confirm against the backend. Three outcomes:

- **200**: principal saved (refreshed if the backend's view has changed), state stays authenticated.
- **401 (confirmed logged-out from a reachable backend)**: cached principal cleared, state flips to anonymous, layout redirects to `/login`.
- **unreachable (network throw or 5xx)**: cached principal kept, state stays authenticated, the user keeps working offline.

The hygiene rule is that the cache MUST be cleared on logout AND on confirmed-401. Both code paths exercise this and must keep working under refactor. The failure mode to avoid is a stale principal surviving after logout or session expiry (so a future user reopening the device offline sees the previous user's identity until reconnection).

The cached principal is **rendering only**, NOT authorization enforcement. The backend's `PermissionsGuard` is the real check on every API call. The role-aware UI gating (`has(permissionKey)`) is fine to compute from the cached principal because it is convenience-mirroring-the-backend (see role-aware UI principle below); the worst case for a stale cached permission is the UI offering an action the backend then 403s on sync, which is the same graceful failure pattern that exists when online.

**Do not "clean up" the principal cache thinking it violates the no-auth-artifact rule.** It does not. Caching the principal (identity metadata) is distinct from caching the credential (the cookie), and this distinction is what makes offline reload actually work in a warehouse / field-device context. A removal would silently break cold-offline reload (full app -> empty loading shell).

## Design system constraints

NetSuite/Odoo enterprise density, not consumer SaaS. Read the `frontend-design` skill before building any UI.

- **Palette.** Navy `#1F4E79` (with scale 50/100/500/600/700/800/900) is the primary. Semantic colors (`success-700` green, `warning-700` amber, `danger-700` red) appear only as pills, dots, and text accents. Never paint a full row background in a semantic color. Rare exception: the audit immutability-violation row.
- **Type.** Inter for all text. JetBrains Mono only for IDs (engine and chassis numbers, PO/SO/SHP refs, audit IDs). Sizes: 10.5px uppercase table headers, 12.5px body, 13px form labels, 14px section headers, 18px page titles, 22px KPI numbers.
- **Density.** 28px controls (buttons, inputs), 30px table rows, 44px topbar, 212px sidebar, 4px spacing base.
- **Radii.** 2 to 3 px for controls, 4px max for cards. Anything 6px or larger reads as consumer SaaS and is wrong.
- **Token sources.** `src/app/globals.css` (Tailwind v4 `@theme` directive) is the source of truth; tokens from the handoff's `tokens.css` were lifted into it during the scaffold. `src/styles/tokens.ts` is a TS mirror for non-Tailwind contexts (canvas, charts, inline styles). Keep both aligned.

## Role-aware UI principle

Nav items, buttons, and routes are gated on the principal's permission set as a **convenience that mirrors the backend, not a security boundary**. The backend's `PermissionsGuard` is the real enforcement; the UI hides what the API would 403 anyway (defence in depth: UI hint plus API enforcement).

- The client check is `has(permissionKey)` against the principal's permission union. Membership only, no deny-list, no policy logic.
- Do not over-trust the client gate (hiding a button is not security). Server-side enforcement is the real gate.
- Do not under-build it either (the client does not replicate full permission logic; it checks membership).
- The backend `PermissionsGuard` is **AND-only**. Where an OR-of-permissions intent exists, it is satisfied by gating on the superset-holder permission. Mirror the same key on the client.

## Conventions

- **Commit and push after every unit of work.** Working directory `enviable-web`, remote `enviabledev/enviable-web`.
- **Feature-based commit messages.** Subject describes the feature or change ("add login route", "wire principal context"). Never the word "prompt".
- **No `Co-Authored-By: Claude` trailer on commits.**
- **No em dashes anywhere** (see operational safety).
- TypeScript is `strict: true`. Path alias `@/*` resolves to `src/*`.
- Next 15 App Router: server components by default, mark client islands with `"use client"`.
- Both `dev` and `build` use Turbopack (the `--turbopack` flag), not webpack.
- Fonts load via `next/font/google` (Inter, JetBrains Mono) and are exposed as `--font-inter` and `--font-jetbrains-mono` CSS variables. Do not import font files directly.
- **Silent skips are bugs.** Any guard that drops, swallows, or filters data without surfacing what it dropped is hiding a class of bug that only shows up when something else fails. If a skip is genuinely needed, make it loud (a `console.warn` with the entity type and the key set seen). Treat any `FINDING:`/`TODO:`/`HACK:` comment that *explains* unexpected behavior rather than *fixing* it as a flag that the underlying bug may still be live.
- **A convention is not enforced just because it has been banked.** When introducing a new pattern (mirror-first paint, field-access audit, etc.), grep the codebase for every existing site of the older pattern and either retrofit them in the same change or list them as a finding for scope decision. "Applied to new code" does not retroactively cover old code.
- **Playwright verification of the visible outcome is required, not optional.** Data verification (curl/SQL/typecheck/lint) is necessary but not sufficient. Before declaring a screen or flow done, drive the actual user flow in a real browser via Playwright (login, navigate, trigger the action, observe the outcome), and assert what the user would SEE, not just that the request was sent. For offline-capable flows, drive both online and offline branches plus the sync-on-return and sync-time-error paths. "HTML loaded at the right URL" is not the same as "the right data rendered"; Playwright reads the rendered text and asserts it matches what the URL/flow implies. If Playwright surfaces a UI issue, fix it and re-run; only declare done when Playwright passes cleanly. The data check and Playwright are two halves; both must pass.
- **Deferred work goes in `BACKLOG.md` (repo root).** Findings surfaced during a build round, gaps with a decision pending, defined-but-unwritten enum cases, and other "known but not now" items live there so they are visible candidates the next time we plan a round, rather than rediscovered.
- **Denormalized fields need same-transaction maintenance, forward-protection rule.** Where the backend stores a denormalized value (`SparePart.quantityOnHand`, etc.) maintained transactionally by a writer, every NEW writer that touches the underlying truth must update the denormalized field in the same transaction. The frontend trusts the stored value (no recompute), so a writer that bypasses the maintenance silently drifts the stored value from reality, the silent-staleness pattern at the application layer rather than the mirror layer. Parallel to the "raw-SQL update must explicitly bump updatedAt" rule applied to mirror invariants; same shape, applied to denormalized state.
- **Detail pages using `useUrlLastSegment` MUST guard their fetch effect with `if (!id) return;`.** `useUrlLastSegment` is a useState hook that initializes to `""` and reads `window.location.pathname` in its mount-time effect. The first render therefore has `id === ""`. Without an explicit guard, the fetch fires with `""`, which `encodeURIComponent` keeps as `""`, producing URLs like `/api/sales-orders//invoice` that Next collapses to `/api/sales-orders/invoice` (the LIST route). The response is a `SalesOrderListRow[]` typed as `SalesOrderDetail`, and the renderer crashes on the first nested field access (`so.customer.name`). The same shape applies to every detail page using this hook; if the effect does not check `id` (or the hook's variable name equivalent), add the guard. Existing detail pages: sales-orders, customers, shipments, purchase-orders, units, assembly-jobs, movements, spare-parts, price-lists, all guarded as of 2026-06-03.
- **Mirror-only read screens need an explicit freshness signal; phase-2-revalidate screens get freshness for free.** A read screen that paints from the mirror AND ALSO runs a network revalidate (`listUnits` after `listByType("unit")`, etc.) gets freshness automatically: when the network responds, the page re-renders with the fresh data. A read screen that reads **exclusively** from the mirror (because the backend has no list endpoint for the entity, e.g. spare-part movements, or because the multi-status filter would require a fan-out, e.g. deliveries) has no such second-render trigger; the page takes a snapshot at mount and never reflects subsequent SyncBoot reconciles, the silent-staleness pattern at the view layer. Wire `visibilitychange` + `focus` + `online` + a 15s tick while visible on every mirror-only read screen so a clerk who opens the tab before the first reconcile completes (or who keeps the tab open while a later reconcile lands) sees the fresh data. **Recognition:** if the screen renders entirely from `listByType` / `getById` with no follow-up network revalidate call, it is mirror-only and needs the explicit freshness signal. Phase-2-network-revalidate screens are recognizable by the second `fetch` / api-wrapper call that runs after the mirror paint. Apply the rule proactively when building (recognize the shape, wire the signal); the retroactive-sweep applies to the existing two known mirror-only sites (`/sales/deliveries`, the spare-part tab on `/inventory/movements`).
- **Empty states on mirror-backed screens MUST distinguish "still bootstrapping" from "no data."** When `useMirrorFreshness().historyComplete` is false, the mirror has not finished its initial download; an empty list at that moment is NOT a genuine "nothing here" state, and copy like "No invoices match the current filters." reads as a broken page to a first-time user. Branch the empty-state on the bootstrap flag: show a "Syncing your data..." message with a pulsing dot while `historyComplete === false` AND the mirror is empty; show the regular "No items match" message once history is complete. The route-level `(app)/loading.tsx` handles the route-compilation window (Turbopack first-hit can take 10s+); the bootstrap-state distinction handles the period AFTER the page mounts but BEFORE the data finishes syncing. Two distinct windows, two distinct signals; both need explicit handling.
- **Fixture rows must use `updatedAt = NOW()`, not backdated timestamps.** Any row seeded into a mirror-synced table via direct SQL (or via `setup-fixtures.sql`) must set its `updatedAt` to `NOW()`. The frontend mirror's since-mode delta only pulls rows where `updatedAt > since-cursor`; a row inserted with a backdated `updatedAt` (e.g., `NOW() - INTERVAL '1 day'`) is INVISIBLE to any session whose since-cursor has already advanced past that timestamp, including the session that just seeded the fixtures. Domain timestamps (`createdAt`, `issueDate`, `receivedAt`, `dispatchedAt`, etc.) MAY be backdated for realistic data; the spine column `updatedAt` MUST be NOW(). Same rule applies to `ON CONFLICT (id) DO UPDATE` clauses: include `"updatedAt" = NOW()` so re-running setup also bumps the spine.
