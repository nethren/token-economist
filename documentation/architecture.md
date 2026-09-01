# Architecture

## Product overview

Token Economist is a single-user, design-time calculator for estimating the
token cost of an AI feature before implementation. The default application is
a static React client: prompts, assumptions, estimates, lint findings, and
recommendations remain in the browser.

An optional local Quality Lab lets the user make a small, explicitly
cost-previewed set of real model calls. It is a development-only workflow, not
a hosted backend.

## Stack

| Layer | Implementation |
|---|---|
| UI | React 19, TypeScript, Vite |
| Estimator | Pure TypeScript under `src/core/` |
| Tokenizer | Bundled `gpt-tokenizer` o200k data |
| Local paid-call boundary | Node HTTP service under `server/` |
| Tests | Vitest |
| Lint | Oxlint |
| Persistence | Browser `localStorage` only |

There is no database, account system, cookie session, telemetry SDK, hosted
API, email system, scheduled work, or server-side rendering.

## Runtime modes

### Static/public mode

`npm run dev`, `npm run build`, and a static deployment provide the
offline estimator, linter, recommendation, cost card, and share-link codec.
The Quality Lab stays visible but cannot make paid calls because no local
service exists.

The browser may fetch the fixed public OpenRouter model-list endpoint to
refresh price inputs. That request carries no prompt or user-entered content.

### Local Quality Lab mode

`npm run dev:quality` starts:

1. Vite on `127.0.0.1:5173`.
2. A Node service on `127.0.0.1:8787`.
3. A random, in-memory token shared only between those two processes.

The browser sends a bounded completion request to Vite. Vite adds the
ephemeral token and proxies it to the local service. The service validates the
origin, token, provider/model pair, body size, prompt sizes, and output-token
cap before calling a fixed provider endpoint.

## Trust boundaries

| Boundary | Data crossing | Enforcement |
|---|---|---|
| User input → estimator | Prompt and numeric assumptions | Pure local functions; no network dependency |
| Browser → OpenRouter | No user content; fixed model-list GET | Hard-coded HTTPS URL; numeric price validation; six-hour local cache |
| Browser → share link | Feature name, prompt, assumptions, model ID | Explicit copy action; URL-safe JSON in the fragment; tolerant decoder |
| Browser → Vite → local service | Prompt, test sample, provider/model ID, output cap | Same-machine listener, strict port, ephemeral proxy token, local-origin check |
| Local service → model provider | Prompt and one test sample; provider key in headers | Fixed HTTPS endpoints, model allowlist, 64 KiB body cap, 16–1024 output cap, 60-second timeout |
| Quality result → local storage | Sample, output, token counts, verdict, cost | Browser-origin storage; best-effort cache; no server persistence |

## Authentication and identity

There are no user accounts or roles. The application assumes one local user
operating their own browser and provider accounts. The ephemeral proxy token
is process-to-process authorization for the paid local route; it is not a
user session and is never persisted.

## Known risks and assumptions

- The live price source is a third-party aggregator, not an official provider
  billing endpoint. Values are type-checked and missing values fall back to
  bundled snapshots, but users must still verify prices before committing
  budget.
- A copied share link intentionally gives its recipient the prompt embedded
  in the URL fragment. The fragment is not sent in HTTP requests, but it can
  remain in browser history and any place the user pastes it.
- Quality Lab samples and outputs are cached in browser `localStorage`.
  Users should not run confidential production data on a shared browser
  profile.
- The local service is intentionally not suitable for deployment. A hosted
  version would need real authentication, per-user secret storage, metering,
  rate limits, and abuse controls.
- Bundled model prices and model identifiers can become stale. The UI dates
  price data and falls back explicitly when live refresh is unavailable.

## Related documents

- [Flows](flows.md)
- [Permissions](permissions.md)
- [Variables and secrets](variables.md)
- [Quality Lab automation](automation.md)
- [SEO and public routes](seo.md)
- [Test coverage](tests.md)
- [Shipping packet](shipping-packet.md)

No email capability exists, so there is no `emails.md`. No scheduled or
background work exists, so there is no `cron.md`.
