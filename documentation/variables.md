# Variables and secrets

## Inventory

| Name | Used by | Scope | Source | Rotation | Risk |
|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Local Quality Lab service | Server process only | Shell environment or ignored `.env.local` | Revoke/replace in Anthropic console; restart local service | Paid usage and provider-account access |
| `OPENAI_API_KEY` | Local Quality Lab service | Server process only | Shell environment or ignored `.env.local` | Revoke/replace in OpenAI console; restart local service | Paid usage and provider-account access |
| `GEMINI_API_KEY` | Local Quality Lab service | Server process only | Shell environment or ignored `.env.local` | Revoke/replace in Google AI Studio/Cloud; restart local service | Paid usage and provider-account access |
| `QUALITY_LAB_PROXY_TOKEN` | Vite proxy and loopback service | Local server processes only | Random UUID generated for each `dev:quality` run | Automatic on every restart | Temporary authority to invoke the local paid route |

No variable with a `VITE_` prefix contains a secret. Provider credentials
are not accepted by React, returned by the status route, placed in
`localStorage`, or bundled into production assets.

## Local setup

Copy `.env.example` to `.env.local` and populate only the providers being
tested. Both `.env.local` and the broader `.env.*` family are ignored,
while `.env.example` remains tracked.

## Pre-publication and pre-live checklist

- Confirm `git status --ignored` lists local environment files as ignored.
- Scan the full tracked tree and Git history for provider-key patterns.
- Run the deterministic tests, lint, and production build.
- Do not run `eval:live` or Quality Lab smoke calls unless live provider use
  is explicitly intended.
- If any key is ever committed, revoke it before rewriting or republishing
  history; removing the text alone is not sufficient.
