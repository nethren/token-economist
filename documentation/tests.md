# Test coverage

The default deterministic gate is `npm test`: 60 tests pass across six test
files. Five provider-truth tests are skipped unless
`ANTHROPIC_API_KEY` is deliberately supplied.

There is no CI workflow or protected-branch status check yet. “Existing”
below means a test is present in this repository, not that GitHub currently
enforces it.

## Existing coverage

| Use case | Rule | Expected behavior, including deny case | Evidence | Type | Status |
|---|---|---|---|---|---|
| Offline estimate | Estimation, lint, recommendation, and card generation do not use the network | A throwing `fetch`/XHR landmine does not interrupt the path; any network call fails the test | `flows.md` §1; `tests/determinism.test.ts` | Unit | Existing |
| Token counting | Pinned o200k fixtures remain exact and deterministic | Dependency drift changes a count and fails | `architecture.md`; `tests/tokenizer.test.ts` | Unit | Existing |
| Cost math | Bands are ordered; components sum; caching, batch, retries, turns, tools, and reasoning follow documented equations | Negative or inconsistent results fail | `src/core/estimate.ts`; `tests/determinism.test.ts`; `tests/improvements.test.ts` | Unit | Existing |
| Linter honesty | Findings are ranked and quantified; applied changes produce measured savings | Inflated savings or missing planted findings fail | `tests/lint.test.ts` | Unit | Existing |
| Recommendation | Cheapest usable hypothesis is unverified; cheapest passing model wins after evidence | A failing cheap model cannot become verified recommendation | `tests/card-measure.test.ts` | Unit | Existing |
| Share link | State round-trips in a URL-safe fragment; garbage and unknown fields fail safely | Invalid input returns null/defaults instead of throwing | `flows.md` §3; `tests/improvements.test.ts` | Unit | Existing |
| Price refresh | Only valid positive mapped prices apply; malformed/missing rows preserve snapshots; cache and offline fallback behave | Corrupt cache or payload cannot replace registry values | `flows.md` §2; `tests/improvements.test.ts` | Unit | Existing |
| Browser credential boundary | Browser completion request contains provider/model/prompt/sample/cap but no credential header or key field | Any API-key material in the request fails | `variables.md`; `tests/quality-proxy.test.ts` | Unit | Existing |
| Paid-request validation | Provider/model mismatch and an excessive output cap are rejected | Unknown pair or cap over 1,024 throws before a provider call | `flows.md` §4; `tests/quality-proxy.test.ts` | Unit | Existing |
| Environment parsing | Local key file is parsed as data, not evaluated | Comments/exports/quotes parse without executing content | `variables.md`; `tests/quality-proxy.test.ts` | Unit | Existing |
| Provider token calibration | Anthropic truth falls inside the band and point error is within ±12% | Out-of-band counts fail | `EVAL.md`; `tests/live-accuracy.test.ts` | Guarded live | Existing, opt-in |

## Proposed tests

| Proposed case | Assertion and negative case | Type |
|---|---|---|
| Loopback authorization integration | Start the service with a test token; authorized Vite-style request returns status, while missing token, direct request, foreign origin, wrong host, and wrong port return 403 | Integration, deterministic |
| Request-body boundary integration | Oversized body returns 413; wrong content type returns 415; invalid JSON returns 400; provider fetch stub records zero calls | Integration, deterministic |
| Missing-key fail closed | Allowlisted request without its provider key returns 503 and never calls `fetch` | Integration, deterministic |
| Registry/allowlist parity | Every Quality Lab model appears in the server allowlist with the same provider, and no extra allowlist model exists | Unit |
| Price-fetch privacy | Stub `fetch` and assert the fixed URL, GET semantics, and absence of prompt/sample data | Unit |
| Public-build paid-call state | Render without a local status route and assert the paid button cannot enable | Integration, deterministic |
| Provider adapter contract | With test credentials and fixtures, each provider returns text and numeric usage through the full local route | Guarded live |
| Keyboard, contrast, and responsive layout | Validate critical workflows at desktop and 390 px, both themes, reduced motion, and keyboard-only use | Manual |

## Gaps — documented but unverified

1. **Paid-boundary wiring:** token/origin/body-limit enforcement is verified by
   code review and a manual loopback smoke test, but not yet by a committed
   deterministic integration test.
2. **Provider compatibility:** default CI never calls external providers, so
   API response-shape drift for Anthropic, OpenAI, and Google remains guarded
   live coverage.
3. **Public UI state:** the browser request boundary is unit-tested, but the
   disabled local-only presentation in a static build has no component test.
4. **Accessibility and visual quality:** documented design checks remain
   manual because the repository has no browser test harness.
5. **Bundle budget:** production build reports size, but no automated threshold
   guards the 1.11 MB gzip initial JavaScript bundle.

## Recommended CI gate

Suggested, not installed:

```yaml
name: verify
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

After adding it, require the `verify` status check for merges to `main`.
Guarded-live and manual checks should not block the default deterministic
gate.
