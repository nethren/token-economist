# Permissions

## Identity model

Token Economist has no accounts, organizations, roles, claims, database, or
row-level security. It is a single-user browser application. “Local user”
means the person controlling the browser profile and provider credentials on
the machine.

The Quality Lab’s ephemeral proxy token authorizes Vite—not a human
identity—to reach the loopback service during one local run.

## Resource and operation matrix

| Resource / operation | Public visitor | Local user | Vite process | Loopback service |
|---|---:|---:|---:|---:|
| Run offline estimate | Allowed | Allowed | N/A | N/A |
| Fetch public price list | Allowed from browser | Allowed | N/A | N/A |
| Create a prompt-bearing share link | Allowed after explicit click | Allowed after explicit click | N/A | N/A |
| Read provider-key values | Denied | May edit local environment file | Denied in browser/client bundle | Allowed in process memory |
| View configured provider names | Only through local Vite route | Allowed | Proxies authorized status | Returns names, never values |
| Trigger a paid completion | Unavailable in static build | Allowed after explicit click and preview | Adds ephemeral authorization | Validates and calls allowlisted provider |
| Choose arbitrary upstream URL/model | Denied | Denied | Denied | Denied by fixed endpoints and allowlist |
| Persist quality results | Browser origin only | Browser origin only | N/A | Does not persist |

## Enforcement locations

- UI run-size and spend preview: `src/components/QualityLab.tsx`
- Browser request shape and per-run cache: `src/core/measure.ts`
- Process token injection: `server/dev-quality.mjs` and `vite.config.ts`
- Server-side local authorization, validation, allowlist, and paid calls:
  `server/quality-proxy.mjs`
- Secret exclusion from version control: `.gitignore`

There are no database tables and no RLS/code-enforced row filters.
