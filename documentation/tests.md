# Test coverage

The default deterministic gate is `npm test`: 100 tests pass across six test
files. Five provider-truth tests are skipped unless `ANTHROPIC_API_KEY` is
deliberately supplied. Nothing in the application can contact a model provider,
so `eval:live` is the only path in the repository that reaches one, and it hits
a free token-counting endpoint.

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
| Bring-your-own evidence | Pasted replies are scored offline, labelled `source: "byo"`, and bound to the prompt and cap they were collected against | A run that verifies a configuration it never saw, or loses its provenance, fails | `flows.md` §4; `tests/card-measure.test.ts` | Unit | Existing |
| Missing evidence stays missing | A blank reply box is unreviewed, contributes no tokens and no cost | A blank box counting as a pass or a failure fails | `tests/card-measure.test.ts` | Unit | Existing |
| Check-pack completeness | The pack carries the prompt, samples, check name, reply cap, configuration fingerprint, the user's own estimated spend, and the reply shape it can read back | A pack that cannot reproduce the check elsewhere fails | `src/core/pack.ts`; `tests/card-measure.test.ts` | Unit | Existing |
| Reply-document parsing | Numbered replies are read back from one paste across the heading variants AI tools produce, fences are unwrapped, and horizontal rules and the single-sample case fall back correctly | Prose with no headings silently scoring, instead of asking for the headings, fails | `tests/card-measure.test.ts` | Unit | Existing |
| Parser alignment | An out-of-range or duplicated reply number is dropped with a warning; out-of-order replies land on their stated sample | A reply shifted onto a neighbouring sample fails | `tests/card-measure.test.ts` | Unit | Existing |
| Declared configuration wins | A pasted document that names a configuration id is stamped with it, so evidence from an earlier prompt reports stale | Re-badging old evidence as current fails | `flows.md` §4; `tests/card-measure.test.ts` | Unit | Existing |
| Provenance on the card | The card attributes evidence to the author and marks demo data as demo data | Demo data rendering as a measurement fails | `tests/card-measure.test.ts` | Unit | Existing |
| Provider token calibration | Anthropic truth falls inside the band and point error is within ±12% | Out-of-band counts fail | `EVAL.md`; `tests/live-accuracy.test.ts` | Guarded live | Existing, opt-in |

## Proposed tests

| Proposed case | Assertion and negative case | Type |
|---|---|---|
| No-provider-client guard | Assert the built bundle contains no provider hostname, `Authorization` header construction, or API-key identifier; a reintroduced paid path fails the build gate | Unit, on `dist` |
| Price-fetch privacy | Stub `fetch` and assert the fixed URL, GET semantics, and absence of prompt/sample data | Unit |
| Check-pack round trip | Parse an exported pack, confirm its fingerprint matches the live configuration, and confirm an edited prompt makes the pasted run stale | Unit |
| Dev-fixture absence | Render a production build and assert the demo controls are not present | Integration, deterministic |
| Keyboard, contrast, and responsive layout | Validate critical workflows at desktop and 390 px, both themes, reduced motion, and keyboard-only use | Manual |

## Gaps — documented but unverified

1. **Self-reported evidence:** the app cannot verify that a pasted reply came
   from the model it is attributed to. This is a property of the design, not a
   missing test. It is mitigated by labelling — `source` on every run, "replies
   you supplied" in the panel, and a self-reported note on the card — rather
   than by a check that cannot exist.
2. **Estimated usage on pasted replies:** token counts for pasted text come
   from the offline tokenizer, not from provider-reported usage, so they carry
   the same calibration error as the rest of the estimate. Labelled as
   estimates in the results table.
3. **No-paid-path guard:** the absence of a provider client is verified by
   grepping `dist` by hand, not by a committed test.
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

## Bring-your-own-AI verification record (D26, 2026-09-17)

**Tested.** `npm run lint` (0 warnings, 0 errors), `npm test` (88 passed, 5
skipped), `npm run build` — all green, on an isolated copy of the repository.
Ten new tests cover pasted-reply scoring, blank-box handling, fingerprint
binding, the sample cap, check-pack contents, and provenance on the card.

**Removed with the paid path.** `tests/quality-proxy.test.ts` and its three
coverage rows. They tested a loopback service, an ephemeral proxy token, and an
environment-file parser that no longer exist. Deleting a test because the risk
it guarded was designed out is not a coverage regression; keeping it would have
been theatre.

**Paid-path absence checked by hand.** The production bundle was grepped for
`api/quality`, `x-quality-lab-proxy-token`, `QUALITY_LAB`, `dev:quality`,
`loopback`, `apiKey`, and the dev fixture markers `seedDemo` and `Demo data`.
Zero hits for each. This should become a committed test; see Proposed tests.

## One-document round-trip record (D27, 2026-09-17)

**Tested.** `npm run lint` (0/0), `npm test` (100 passed, 5 skipped), `npm run
build` — all green on an isolated copy. Twelve new tests cover the parser:
the requested shape, the heading variants AI tools actually emit, fence
unwrapping, partial pastes, out-of-range and duplicate numbers, out-of-order
replies, the single-sample and horizontal-rule fallbacks, prose with no
headings, an empty paste, and configuration-id stamping.

**Browser pass.** The whole flow was walked against the dev server: download
the check, paste a reply document mixing a fenced JSON answer, a prose answer
and a bare JSON answer, read 3 of 3, score 2 of 3 as a failure. Editing the
prompt then raised the amber mismatch banner at paste time and produced a STALE
card line rather than a re-badged current one. A lint action opened the
advanced scale panel and its value landed visibly. Contrast on the new parse
banner and advanced summary measured 6.7:1 or better in both themes.

**Not covered.** The parser is exercised by unit tests only; there is no
fixture corpus of real outputs from several AI tools, so heading shapes outside
the tested set may still need a warning-and-retry from the user.

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
