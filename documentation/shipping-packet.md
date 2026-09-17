# Shipping packet: Token Economist

## Documentation inventory

| Document | Status | Notes |
|---|---|---|
| `README.md` | Present | Product case, setup, quality flow, verification |
| `PRODUCT.md` | Present | Audience, purpose, principles |
| `DESIGN.md` | Present | Current visual system and superseded history |
| `DECISIONS.md` | Present | Append-only implementation record |
| `architecture.md` | Present | Stack, runtime mode, trust boundaries, risks |
| `flows.md` | Present | Network, privacy, share, and quality-check journeys |
| `permissions.md` | Present | Single-user capability matrix and enforcement |
| `variables.md` | Present | Secrets, rotation, pre-publication checks |
| `automation.md` | Present | Quality Lab trigger, absent API surface, guardrails |
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
| `npm test` | 88 passed; 5 guarded-live tests skipped |
| `npm run build` | Pass |
| `npm audit` | 0 known vulnerabilities after compatible transitive updates |
| Secret-pattern scan | No credentials found; only empty `.env.example` present |
| Paid-path absence | `dist` grepped for provider hostnames, key identifiers, and the dev fixture: zero hits |

## Test coverage

The deterministic estimate, cost math, linter, recommendation, price fallback,
share codec, quality-status accounting, evidence staleness, check-pack contents,
and pasted-reply scoring are covered. The main gaps are a committed
no-paid-path guard, accessibility automation, and a bundle budget. Self-reported
evidence is a designed-in limitation rather than a coverage gap. See
[tests.md](tests.md).

## Security summary

**Surviving findings:** Critical 0 · High 0 · Medium 0 · Low 0

The review traced every network, storage, environment, share-link, and paid
provider path. Candidate risks were self-refuted where implementation evidence
stopped them at the sink:

- There is no paid route. The application has no provider client, no
  credential handling, and no server process, so the entire class of paid-path
  findings has no sink to reach.
- Quality evidence arrives as text the user pastes in. It is scored, never
  evaluated or executed, and it is labelled self-reported wherever it appears.
- The public price refresh uses a fixed GET and maps only finite positive
  prices for known slugs; no user content reaches it.
- Share-link prompt disclosure follows an explicit user action and uses a URL
  fragment; the privacy consequence is documented in-product.
- React renders prompt and model output as text; no raw HTML, dynamic code,
  shell input, database, cross-tenant store, or server-side renderer exists.

The root risk theme is now disclosure, not spend: a share link and a check pack
both carry the prompt, by design and behind an explicit user action. There is no
credential to leak and no paid path to abuse. What remains unverified is a
committed regression guard against a future change reintroducing one.

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
quality scoring is local string work with nothing to cache; no database, list
API, query index, or over-fetch surface exists. Runtime browser
profiling is still required before claiming user-visible performance gains.

## Intended versus implemented

The documented claims match the inspected enforcement points:

- Offline calculation contains no network sink.
- Price refresh has one fixed public endpoint and no prompt input.
- Share disclosure requires an explicit copy action.
- No provider client or credential exists in any build, so the hosted build is
  the complete product rather than a degraded one.
- Quality claims are bounded by their evidence: partial review never verifies,
  a configuration change retires the stamp, and demo data is labelled as such.

No material documented/implemented mismatch survived review.

## Launch blockers

None for publishing the source as a public GitHub portfolio repository.

Deploying the static build is now approved in full, Quality Lab included: it
holds no secret and spends no money. Adding a hosted paid-call backend would be
a different architecture requiring authentication, managed secrets, metering,
rate limits, and abuse prevention, and this packet does not approve one.

## Recommended next actions

1. Publish the source repository and add it to the portfolio index.
2. Add the proposed GitHub Actions verification workflow after owner approval,
   then require it on `main`.
3. Add a committed test asserting the bundle contains no provider client.
4. Refresh the screenshot after final browser QA.
5. If deploying the static estimator, add final-domain SEO/social metadata and
   measure the tokenizer bundle on a real connection.
