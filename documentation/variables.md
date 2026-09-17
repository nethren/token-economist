# Variables and secrets

## Inventory

The application has no secrets. It never calls a model provider, so it holds no
provider credential in any form.

| Name | Used by | Scope | Source | Rotation | Risk |
|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | `npm run eval:live` only | Test process; never the app | Shell environment | Revoke/replace in the Anthropic console | Free token-counting endpoint; sends fixture texts, never user data |

Nothing is read from a `VITE_`-prefixed variable, placed in `localStorage`, or
bundled into production assets. The Quality Lab gets its evidence from a check
pack the user runs in their own AI tool and pastes back, so there is no key for
the browser to mishandle.

## Local setup

None required. `npm install && npm run dev` gives the complete product.

Set `ANTHROPIC_API_KEY` in your shell only when you deliberately want to run the
calibration check. `.env.local` and the broader `.env.*` family stay ignored;
`.env.example` remains tracked as documentation.

## Pre-publication checklist

- Confirm `git status --ignored` lists local environment files as ignored.
- Scan the full tracked tree and Git history for provider-key patterns.
- Run lint, the deterministic tests, and the production build.
- Grep `dist/` for `apiKey`, `Authorization`, and provider hostnames; a hit
  means something reintroduced a paid path.
- Do not run `eval:live` unless live provider use is explicitly intended.
- If any key is ever committed, revoke it before rewriting or republishing
  history; removing the text alone is not sufficient.
