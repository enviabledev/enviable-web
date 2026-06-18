# Deployment (Vercel)

The frontend is hosted on Vercel and deploys via Vercel's Git integration.

## Domain
- `portal.enviabletricycle.com` → this Vercel project (CNAME at the DNS provider,
  pointing to the target Vercel shows in the project's Domains settings).

## Environment variables (Vercel project → Settings → Environment Variables)
| Name | Value | Scope |
|---|---|---|
| `BACKEND_API_URL` | `https://api.enviabletricycle.com` | Production (and Preview if used) |

The frontend holds no secrets. It proxies `/api/*` to the backend server-side, so
session cookies stay same-origin on `portal.enviabletricycle.com`.
