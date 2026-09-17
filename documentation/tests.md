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
| Quality status accounting | Total, reviewed, passed, failed and unreviewed are tracked separately; only a fully reviewed run at ≥80% can verify; an observed failure is reported as a failure, never as "no quality data"; the interface and the card print the same counts | Partial review certifying a model, or a failure reported as missing data, fails | `tests/quality-status.test.ts` | Unit | Existing |
| Evidence-aware wording | Before testing the copy is "lowest estimated cost to test" with no task-capability claim; the lexical hint is anchored on both sides, so "spelling", "moderately" and "labelled" no longer register as bounded tasks | A keyword match that changes the recommendation's evidence language fails | `tests/quality-status.test.ts` | Unit | Existing |
| Evidence staleness | A run carries the fingerprint of the prompt and reply cap it measured; once either changes the run reports as stale, never as passed, failed or missing, and the card marks it | A run verifying against a configuration it never measured fails | `tests/quality-status.test.ts` | Unit | Existing |
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

## Phase 1 verification record (TE-01 / TE-02, 2026-09-15)

**Tested.** `npm run lint` (0 warnings, 0 errors), `npm test` (78 passed, 5
skipped), `npm run build` — all green. Both defects were reproduced by
executing the real core functions before any fix: `recommend()` returned
`verified: true` with *"passed your check on all 5 samples"* for
`[true, null, null, null, null]`, and the task regex matched `spell` inside
"spelling". Eighteen regression tests now cover the full status matrix.

**A second defect found during reproduction, not in the original report.** A
sub-threshold but *reviewed* run (for example one pass, one failure) fell
through to *"No quality data yet."* — reporting observed failure as absent
evidence. Covered by the matrix and by an explicit test.

**Skipped.** Guarded live calibration (`tests/live-accuracy.test.ts`, 5 tests)
— unchanged and still opt-in; no provider was contacted and no credential was
configured.

**Browser pass (2026-09-16).** Checked against the running dev server in both
themes at 1440 px and 390 px: no horizontal overflow, no clipped text, no
console errors. Contrast measured on the rewritten copy — step-3 status
6.7:1, decision-panel quality note 7.9:1, receipt 16.7:1 — all above the 4.5:1
AA threshold. The evidence-aware recommendation renders as "Lowest estimated
cost to test … Quality has not been tested." beside an UNVERIFIED badge, and
the `not-run` branch agrees across the step-3 panel and the decision panel. An
apparent light-mode contrast failure (2.1:1) was investigated and disproved —
it was a measurement taken mid colour-transition, not a real state.

**Unresolved limitations.**

1. The lexical hint still matches semantic negations such as
   "extraction-free" — a regex cannot resolve that. It is now mitigated
   structurally: the recommendation makes no capability claim at all, so the
   hint no longer drives user-visible language.
2. Resolved on 2026-09-17. A dev-only fixture in the Quality Lab seeds each
   evidence state, so `passed`, `failed`, `partial` and `stale` were all
   confirmed in the browser without contacting a provider. The stamp, the
   step-3 panel, the decision panel and the Markdown card agree in every
   state, including the STALE marker. The fixture is gated on
   `import.meta.env.DEV` and is absent from production builds.
3. TE-03, TE-04 and TE-05 are not implemented.

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
