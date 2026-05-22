# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`enviable-web` is the Next.js 15 (App Router, React 19, Tailwind v4, TypeScript) frontend for the Enviable inventory and operations system. The backend (NestJS, session-cookie auth) lives in the sibling repo `enviable-system`.

## Operational safety (non-negotiable)

Read this before running anything destructive.

- **Commit and push after every prompt.** A prior incident on the backend lost months of work to an unverified destructive command in a repo without version control. Every unit of work ends with a commit and a push to the private remote `enviabledev/enviable-web` so nothing is ever unsaved.
- **Never run `rm -rf`, folder reverts, or any destructive path operation on an unverified path.** macOS is case-insensitive, so a single character typo can wipe the wrong directory. Verify the path character by character before any destructive command.
- **Working directory stays scoped to `enviable-web`.** Do not reach into sibling directories (`enviable-system`, or unrelated projects like `nmaas-project`). Cross-repo coordination happens through git remotes and the API contract, not by editing files in another repo.
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
