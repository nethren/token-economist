# Shipping packet: Token Economist

## Documentation inventory

| Document | Status | Notes |
|---|---|---|
| `README.md` | Present | Product case, setup, local paid mode, verification |
| `PRODUCT.md` | Present | Audience, purpose, principles |
| `DESIGN.md` | Present | Current visual system and superseded history |
| `DECISIONS.md` | Present | Append-only implementation record |
| `architecture.md` | Present | Stack, runtime modes, trust boundaries, risks |
| `flows.md` | Present | Network, privacy, share, and paid-call journeys |
| `permissions.md` | Present | Single-user capability matrix and enforcement |
| `variables.md` | Present | Secrets, rotation, pre-publication checks |
| `automation.md` | Present | Quality Lab trigger, API surface, hard guardrails |
| `seo.md` | Present | Single public SPA route; final-domain metadata backlog |
| `tests.md` | Present | Existing/proposed/gap separation and CI recommendation |
| Email / cron docs | N/A | No email or scheduled work exists |

## Agent context

`CLAUDE.md` contains the operating rules and verification commands.
`AGENTS.md` is a thin pointer so coding agents receive the same boundaries.

## Verification result

| Gate | Result |
|---|---|
| `npm run lint` | Pass |
| `npm test` | 60 passed; 5 guarded-live tests skipped |
| `npm run build` | Pass |
| `npm audit` | 0 known vulnerabilities after compatible transitive updates |
| Secret-pattern scan | No credentials found; only empty `.env.example` present |
| Loopback smoke | App proxy 200; direct and foreign-origin access 403; no provider call |

## Test coverage

The deterministic estimate, cost math, linter, recommendation, price fallback,
share codec, browser credential boundary, and core request validation are
covered. The main gaps are full loopback integration, live provider contracts,
component-level public-mode behavior, accessibility automation, and a bundle
budget. See [tests.md](tests.md).

## Security summary

**Surviving findings:** Critical 0 · High 0 · Medium 0 · Low 0

The review traced every network, storage, environment, share-link, and paid
provider path. Candidate risks were self-refuted where implementation evidence
stopped them at the sink:

- The paid route is not remotely deployed; it binds to loopback, requires an
  ephemeral Vite-injected token, checks local host/origin, validates bounded
  JSON, allowlists model/provider pairs, fixes upstream URLs, and times out.
- Provider credentials remain in process memory or ignored local environment
  files. The browser receives provider names only.
- The public price refresh uses a fixed GET and maps only finite positive
  prices for known slugs; no user content reaches it.
- Share-link prompt disclosure follows an explicit user action and uses a URL
  fragment; the privacy consequence is documented in-product.
- React renders prompt and model output as text; no raw HTML, dynamic code,
  shell input, database, cross-tenant store, or server-side renderer exists.

The root risk theme is concentrated paid usage on a local developer machine,
not remote multi-user authorization. That boundary is unusually well isolated
for a local portfolio application. What remains unverified is wiring-level
regression coverage and real provider response drift, not a known exploitable
path.

## Performance summary

### Initial static load

- **Finding:** The production JavaScript is 2.29 MB minified / 1.11 MB gzip,
  above Vite’s 500 kB warning. The imported o200k tokenizer vocabulary is the
  dominant payload; its package contains a roughly 2.2 MB generated rank
  module.
- **Recommendation:** Profile a deployed build, then consider loading the
  tokenizer in a worker or lazy chunk while preserving offline behavior and an
  honest loading state.
- **Effort:** Medium
- **Priority:** Medium before deploying a public demo; low for source-only
  GitHub publication.
- **Expected effect:** Faster first load and less main-thread parse work.

### Recalculation path

- **Finding:** `estimateAll` currently tokenizes the same prompt once per
  model, while React already defers updates.
- **Recommendation:** Compute the base token count once per prompt and pass it
  into each model estimate.
- **Effort:** Low
- **Priority:** Low
- **Expected effect:** Less CPU work when editing very large prompts.

Already efficient: live prices use a six-hour cache and offline fallback;
Quality Lab results avoid repeat spend through a content-keyed cache; no
database, list API, query index, or over-fetch surface exists. Runtime browser
profiling is still required before claiming user-visible performance gains.

## Intended versus implemented

The documented claims match the inspected enforcement points:

- Offline calculation contains no network sink.
- Price refresh has one fixed public endpoint and no prompt input.
- Share disclosure requires an explicit copy action.
- Paid provider access is unavailable in static mode and keyless in browser
  code.
- Local paid requests are revalidated server-side rather than trusting the UI.

No material documented/implemented mismatch survived review.

## Launch blockers

None for publishing the source as a public GitHub portfolio repository.

This packet does not approve a hosted paid-call backend. Deploying Quality Lab
would be a different architecture requiring authentication, managed secrets,
metering, rate limits, and abuse prevention.

## Recommended next actions

1. Publish the source repository and add it to the portfolio index.
2. Add the proposed GitHub Actions verification workflow after owner approval,
   then require it on `main`.
3. Add deterministic loopback integration tests.
4. Refresh the screenshot after final browser QA.
5. If deploying the static estimator, add final-domain SEO/social metadata and
   measure the tokenizer bundle on a real connection.
