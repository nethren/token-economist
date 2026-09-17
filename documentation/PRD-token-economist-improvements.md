# Token Economist — Improvement PRD

**Status:** Draft for owner review; no implementation authorised by this document alone  
**Prepared:** 14 September 2026, by Codex for the project owner  
**Basis:** Hands-on evaluation using APIFit's four AI prompts, public weather documentation, offline counterexamples and code inspection  
**Recommended order:** Repair trust → support complete workflow costs → improve quality-test fidelity

## 1. Executive summary

Token Economist already delivers useful, working cost planning: a prompt and usage assumptions become a model comparison, cost breakdown and reusable decision card. The next iteration should make the strength of its recommendations match the strength of its evidence, then extend the calculator from one prompt to a small multi-stage AI feature.

The immediate priority is a confirmed bug that can label five samples as passed after only one has been reviewed. The main product opportunity is a simple workflow cost builder—not a new visual design, an AI-powered calculator or an agent execution platform.

| ID | Priority | Improvement | Evidence status | Delivery order |
|---|---|---|---|---|
| TE-01 | P0 | Truthful quality status and sample counts | Confirmed bug | First |
| TE-02 | P1 | Evidence-based recommendation wording | Reproduced misleading inference | With TE-01 |
| TE-03 | P1 | Separate stages and total cost per user action | Observed product gap | Next |
| TE-04 | P2 | Clearer quality criteria and test compatibility | Observed limitation; live calls untested | After trust fixes |
| TE-05 | P2 | Visible cost assumptions and estimate limits | Observed communication gap | Alongside TE-03 |

Priorities reflect this review, not an agreed deadline or implementation commitment.

## 2. Background and evidence

### What was tested

The running application at `http://localhost:5173/` was given APIFit's actual prompts for:

1. Turning a project brief into requirements.
2. Explaining API documentation.
3. Assessing an API against requirements.
4. Checking proposed findings against their evidence.

The example used public Visual Crossing weather documentation and a fictional request for hourly Singapore forecasts and JSON responses. Additional input sizes were rounded from locally counted example payloads; response lengths were assumptions, not measured averages. No secrets were entered or transferred.

### What worked

- The tokenizer, live price refresh, interactive estimates, model table and inspectable Markdown card worked.
- An independent calculation matched the Haiku assessment estimate.
- The app visibly separated estimated cost from unverified quality.
- Once APIFit's output cap was supplied, the linter did not invent unnecessary prompt fixes.
- Lint and production build passed; 60 offline tests passed. Five opt-in live calibration tests were skipped.

### What was not established

- The supplied runtime had Quality Lab disabled. Its live provider flow and actual cross-model quality were not tested.
- Passing the offline suite does not establish correct recommendations in every case; the partial-review counterexample was outside its existing coverage.
- There was no statistically meaningful quality benchmark, token-calibration study, load-time benchmark or full accessibility audit.
- GPT-5 mini was the lowest-cost option among seven listed models under the entered assumptions. It was not proven best for APIFit or cheapest across the whole market.

The existing README modification was preserved. No application source was changed, no paid AI calls were made, and APIFit's configured model was not changed.

## 3. Goals, non-goals and success measures

### Goals

- Make every quality label traceable to the exact samples and checks that support it.
- Let a PM distinguish “cheapest to test” from “passed my check.”
- Let a PM price a complete, small AI workflow without a separate spreadsheet.
- Preserve the private, deterministic, free estimation path.

### Non-goals

- Running or orchestrating the user's production workflow.
- A global model-quality leaderboard or automatic provider switching.
- Using an LLM to generate cost estimates or infer that a prompt is easy.
- Hosted credential storage, accounts, billing reconciliation or deployment.
- A full redesign or a general-purpose evaluation platform.
- Moving APIFit's key or spending authorisation into Token Economist.

### Release measures

These are proposed acceptance targets, not measured business outcomes.

| Measure | Current evidence | Target and verification |
|---|---|---|
| False “all passed” status | Reproduced with one pass and four unreviewed samples | Zero false passes across the TE-01 regression matrix before release |
| Unsupported capability claims in recommendations | “Spelling” changes the task-complexity classification | No task-quality claims based only on keyword matches |
| Workflow total | Four stages had to be priced and added separately | In-app total matches the independent APIFit fixture and stage sum |
| UI/export agreement | Core card is reusable; new states need coverage | Same counts, model, assumptions and status in UI and Markdown |
| Privacy and deterministic estimates | Offline suite passes | Existing no-network/no-secret boundaries remain enforced |
| PM comprehension | Not measured | In a small follow-up check, 3/3 participants can explain cost scope and verification status without help; directional evidence only |

No analytics service is required to measure these targets. Use regression tests and a lightweight owner-led walkthrough.

## 4. Users and ownership

**Primary user:** A PM or founder deciding whether an AI feature is affordable and which model to test before committing a PRD.

**Secondary user:** An engineer checking whether the PM's cost assumptions reflect the actual requests, output settings and validation steps.

**Job to be done:** “Help me estimate the cost of one completed user action, understand what makes it expensive, and know what evidence is still missing before I choose a model.”

The project owner approves acceptance-policy changes, workflow scope and paid testing. An implementation owner and any delivery dates have not been assigned. APIFit is a useful test case, not evidence that all target users want the same workflow.

## 5. Requirements and acceptance criteria

### TE-01 — Correct quality status and incomplete reviews · P0

**Problem:** `recommend()` excludes unjudged samples when calculating the pass rate, then describes the total sample count as passed. The actual function returned `verified: true` and “passed your check on all 5 samples” for `[true, null, null, null, null]`.

**Evidence:** [Recommendation logic](../src/core/card.ts), especially the `passRate` calculation and the `rate === 1` branch; [Quality Lab](../src/components/QualityLab.tsx) supports manual verdicts.

**User story:** As a PM, I need to see how much testing is complete so I do not mistake a partially reviewed model for a proven option.

**Required behaviour:**

- Track total, reviewed, passed, failed and unreviewed counts separately.
- Incomplete review must not qualify as a completed quality check.
- Show the chosen criterion: JSON validity is not factual correctness.
- Preserve failed results and visible caveats; do not discard failures to improve a score.
- Quality evidence must belong to the current prompt, model, samples and generation settings. Old evidence must not silently certify a changed configuration.
- Preserve the existing 80% acceptance rule during a minimal bug fix unless the owner explicitly approves a policy change. Even where 80% is eligible, state the failures and never call it “all passed.”

| Regression input | Required output |
|---|---|
| No run / no samples | Not tested; no verified badge |
| Five unreviewed samples | 0 of 5 reviewed; not verified |
| One pass, four unreviewed | 1 of 5 reviewed; not verified |
| Four passes, one unreviewed | 4 of 5 reviewed; not verified |
| Five passes | “5/5 passed [named check]”; no general accuracy claim |
| Four passes, one failure | “4/5 passed; 1 failed”; explicit policy-dependent eligibility |
| Five failures | Failed check; never “no quality data” or “passed” |
| Provider failure / incomplete response | Visible error or incomplete result; not silently removed from coverage |
| Prompt or generation settings change | Previous result is stale/not applicable until matching evidence exists |

**Definition of done:** Cases pass through the recommendation function, visible UI and Markdown card. Partial-review reproduction no longer produces a completed badge. Existing successful and failed model-selection cases remain covered.

### TE-02 — Make model recommendations evidence-aware · P1

**Problem:** APIFit was called a simple task because the regex matched `spell` in the citation rule's word `spelling`. Replacing only that word with `characters` changed `isSimpleTask` from true to false without changing the task. With no quality data, the recommendation still selects the lowest-cost context-compatible model.

**Evidence:** [Task heuristic](../src/core/lint.ts), [recommendation and export](../src/core/card.ts), [decision panel](../src/components/Receipt.tsx).

**User story:** As a PM, I want to know whether a recommendation comes from price or testing, rather than language that implies an unperformed task analysis.

**Required behaviour and copy:**

- Before testing: **“Lowest estimated cost to test.”** Supporting text: “Among the models shown, [model] has the lowest estimated cost under these assumptions. Quality has not been tested.”
- After complete testing: **“Lowest-cost model meeting your check.”** State criterion, sample count and any allowed failures.
- If tested models fail: **“No tested model meets your check.”** Untested low-cost options can remain visible, labelled untested.
- Alternatives may be labelled “Higher-cost alternative,” but not “safest” based solely on a static tier label.
- Do not claim market-wide coverage. Show that comparisons are limited to the registry and stated constraints.
- Keep inference and card generation offline; do not replace the regex with a paid classifier.

**Acceptance criteria:** The spelling/characters pair receives identical evidence-status language. The cheapest-cost ordering remains correct. No-results, failed, incomplete and passing states have distinct copy. UI and exported card agree. Existing failures are not presented as missing observations.

An optional provider filter is a later convenience, not required for this fix. If added, label results “within selected providers” and do not equate provider availability with measured quality.

### TE-03 — Price a small multi-stage workflow · P1

**Problem:** APIFit needs independent drafting, explanation, assessment and conditional verification calls. Increasing “turns per conversation” instead adds growing chat history. In the reviewed fixture, two independent identical Haiku assessment calls cost $0.009894, while two chat turns cost $0.012744. Both calculations are valid for different workflows; they are not interchangeable.

**Evidence:** [Conversation cost model](../src/core/estimate.ts), [assumptions](../src/core/types.ts), and the APIFit fixture in Section 6.

**User story:** As a PM, I want the cost per completed user action, including its separate AI steps, so I do not omit verification or double-count history.

**Proposed first version:**

- Keep the current single-stage view as the default. Offer “Add another stage.”
- Each stage has a name, prompt, input/output assumptions, number of independent executions per user action and “Runs how often?” percentage.
- Reuse the current per-stage advanced controls for chat turns, retries, tools, thinking, caching and batch use. Separate executions must never silently become chat turns.
- Compare using the same candidate model across all stages initially. Mixed-model stage routing is deferred.
- A percentage is an unconditional frequency per eligible stage execution. Nested branches and graph dependencies are out of scope.
- Shared monthly volume means completed user actions, not an ambiguous mix of calls and conversations.
- Show cost per stage, total per user action, expected stage executions and monthly total. Export every assumption.
- Do not simulate or execute the workflow. If an upstream result is read by another stage, its text must be included explicitly in that stage's input allowance; do not infer an extra charge twice.

**Expected-cost formula:** For each stage, multiply its modeled cost by independent executions per user action and its execution frequency; sum stages; multiply by monthly user actions. Apply this consistently to the low/point/high scenario values. These remain assumption ranges, not statistical bounds.

**Acceptance criteria:**

- A one-stage workflow exactly reproduces the current calculator with the same inputs.
- Two independent executions equal twice the one-execution cost; chat history is unchanged unless turns are changed.
- A stage at 0%, 50% and 100% frequency contributes zero, half and full expected cost respectively.
- Doubling monthly volume doubles monthly cost, not cost per user action.
- Stage sums equal displayed totals before rounding. Reject invalid counts, percentages and non-finite input.
- Context-incompatible stages visibly disqualify the corresponding whole-workflow model comparison; an impossible stage must not disappear from the total.
- Existing single-stage share links still load. Any new workflow share format is versioned and remains in the URL fragment, with an explicit sharing warning.
- Keyboard controls, stage removal and error messages work at desktop and phone widths without losing unrelated stage data.

### TE-04 — Make quality checks explicit and comparable · P2

**Problem:** A valid JSON response can still contain invented API capabilities or unsupported citations. Quality Lab's generic single-call setup does not reproduce APIFit's structured output, deterministic checks and second model pass. Its 1,024-token reply ceiling is also below several APIFit task ceilings. This is a compatibility limitation—not proof the live service is broken.

**User story:** As a PM, I want to state what “good enough” means and see which part was tested, so a format check does not masquerade as product validation.

**Recommended staged solution:**

1. First expose check type, tested sample count, generation settings and limitations alongside results. Explain that a local service is required without blocking free estimation.
2. Add separate format checks and per-sample expected outcomes or a manual correctness checklist. A schema check can establish structure, not truth.
3. Consider a bounded structured-output schema option, with provider-specific support shown honestly. Any output-cap increase needs a new cost-preview and server-boundary review.
4. Defer external evaluation import until it has a versioned format, configuration identity and clear “externally supplied—not independently verified” provenance. Do not let an uploaded success flag directly become verified evidence.

**Acceptance criteria:** Valid-but-wrong JSON passes only the format check. Unreviewed correctness remains unreviewed. Unsupported provider settings are rejected or labelled before a paid run. Changed checks are re-evaluated against matching cached outputs where possible; they do not silently reuse an old verdict. A single-call check never certifies a complete multi-stage workflow.

Real-provider testing requires separate explicit approval, a spending limit and non-sensitive samples. The APIFit US$5 allowance does not authorise unmetered Token Economist calls.

### TE-05 — Make estimate limits visible · P2

**Problem:** The pasted prompt is calibrated by provider, while numeric additional-input tokens are treated as an entered assumption. Output lengths, schema overhead and reasoning may vary across providers. Displaying a range alone does not explain these differences.

**Required behaviour:**

- Distinguish locally counted prompt text, manually estimated input, assumed output and provider-reported usage if later available.
- Include the role of documentation, schemas and tool definitions in input guidance. Do not invent an exact schema-overhead constant.
- Clearly distinguish “expected cost,” “scenario range” and any genuinely enforced spend limit. Never relabel a calibrated estimate as a guaranteed maximum.
- Preserve per-model pricing dates and live/snapshot provenance; price refresh does not refresh the model catalogue or prove model quality.
- When comparing models with the same assumed reply length or zero reasoning, expose those assumptions rather than imply identical behaviour.

**Acceptance criteria:** These caveats appear in the exported card as well as the UI. Adding documentation changes estimated input cost. Editing output length affects output cost. No automatic provider count or model call is introduced into the free path.

## 6. Solution approach and reference fixture

### Keep the architecture small

Use pure core functions for status, selection and stage totals; use the same outputs in the interface and export. Keep UI wording separate from eligibility decisions. Prefer adapting the current estimate function over rewriting its tested chat, retry and cache arithmetic.

Likely touchpoints, to recheck before implementation:

| Area | Existing files |
|---|---|
| Status and recommendation | `src/core/card.ts`, `src/core/types.ts` |
| Prompt heuristic | `src/core/lint.ts` |
| Workflow calculations | `src/core/estimate.ts`, `src/core/types.ts` |
| Inputs, result state and display | `src/App.tsx`, `src/components/QualityLab.tsx`, `src/components/Receipt.tsx` |
| Quality checks and bounded provider requests | `src/core/measure.ts`, `server/quality-proxy.mjs` |
| Share links and fixtures | `src/core/share.ts`, `src/core/presets.ts`, `tests/` |

Respect `AGENTS.md` and `CLAUDE.md`. Keep credentials out of browser state and artifacts. Fixed provider endpoints, explicit paid actions and the static build's inability to make paid calls remain requirements. Append approved decisions to `DECISIONS.md`; do not rewrite historical entries.

### APIFit acceptance fixture

The reviewed prompts are in APIFit's `server/ai-prompts.mjs`. Capture a safe, versioned test fixture when implementing; do not make tests depend on another local repository or changing public documentation. The frozen prices below are for regression testing, not a future production-price claim.

All stages: one independent call, one chat turn, 100% execution frequency, no retries, tools, hidden reasoning, caching or batch processing.

| Stage | Static prompt, o200k tokens | Additional input assumption | Expected output | Output ceiling | Haiku point cost |
|---|---:|---:|---:|---:|---:|
| Draft requirements | 467 | 100 | 200 | 1,400 | $0.001638 |
| Explain documentation | 619 | 2,600 | 650 | 2,200 | $0.006562 |
| Assess requirements | 606 | 2,500 | 350 | 3,000 | $0.004947 |
| Verify findings | 613 | 2,800 | 150 | 1,200 | $0.004255 |
| **One example user action** | | | | | **$0.017402** |

At 10,000 such user actions, the Haiku point estimate is $174.02; the summed assumption range is $137.97–$211.23. Haiku's frozen rates are $1/$5 per million input/output tokens, with the existing 1.15 prompt point multiplier and ceiling rounding.

For comparison, the same four-stage assumptions produced $52.76 for GPT-5 mini, $65.02 for Gemini 2.5 Flash and $348.04 for Sonnet 5 per 10,000 actions. These are price scenarios, not cross-model performance results. Source rates were checked on 14 September 2026 against the app's refreshed list and the relevant [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing) and [OpenAI](https://developers.openai.com/api/docs/models/gpt-5-mini) documentation.

### Why prompt trimming is not the main improvement

In the assessment example, the instructions represented about 10% of GPT-5 mini's modeled cost. Documentation/input and replies accounted for the rest. Preserve necessary safety and evidence rules; prioritise correct workflow modeling and response assumptions over aggressive prompt shortening.

## 7. Decisions to confirm

| Decision | Recommendation | When needed |
|---|---|---|
| Should 80% passing qualify for a recommendation? | Preserve current eligibility in the minimal bug fix, show failures clearly; decide separately whether complete 100% pass should outrank cheaper partial pass | Before changing acceptance policy |
| Should early workflow comparison allow different models per stage? | No; compare one candidate model across the whole workflow first | Before TE-03 |
| Should stage frequency support nested dependencies? | No; use explicit per-action frequency and explain it | Before TE-03 |
| Should Quality Lab execute complete user pipelines? | No; label single-call evidence and defer integration/import work | Before TE-04 |
| Should reply limits or spending controls change? | Only after an explicit owner decision and boundary review | Before any paid-test expansion |

These choices are owned by the project owner; no deadlines have been agreed. The confirmed partial-review bug and unsupported complexity wording can be fixed without resolving every later-stage question.

## 8. Release plan and implementation handoff

### Phase 1 — Trust fixes

Deliver TE-01 and TE-02 together: reproduce the failures first, correct eligibility/counts and wording, then align UI and exports. Do not add new paid functionality or alter model prices as part of this phase.

**Release gate:** All new status cases pass; the spelling counterexample no longer changes quality claims; full and partial outcomes are visibly distinct. Inspect both light and dark modes and a phone-width view after copy changes.

### Phase 2 — Complete-feature cost planning

Deliver TE-03 plus the directly related TE-05 guidance. Start with the APIFit fixture; preserve single-stage entry and legacy share-link behaviour.

**Release gate:** Stage totals, execution frequency, input validation, context rejection, exports and sharing tests pass. A PM can tell whether the displayed unit is one AI call or one completed user action.

### Phase 3 — Better quality evidence

Deliver TE-04's explicit criteria and compatibility disclosures before considering schema support or external result import. Plan real-provider tests only after scope and spending approval.

**Release gate:** Format success cannot become a correctness claim. Incompatible settings and incomplete evidence are visible. Offline tests remain separate from paid checks.

### Required verification for each implemented phase

- Run `npm run lint`, `npm test` and `npm run build`.
- Exercise the affected interface and raw Markdown card in a real browser, including failure and incomplete states.
- Preserve deterministic/no-network tests; use fictional inputs and mocked providers by default.
- Record what was tested, what was skipped and any unresolved limitation in `documentation/tests.md`.
- Update relevant architecture/flow docs only for behaviour actually implemented; append decisions rather than rewriting history.
- Keep the owner's unrelated changes. Do not commit, publish, deploy or modify credentials without explicit direction.

The 2.29MB JavaScript bundle warning is a lower-priority follow-up. Measure actual loading impact before changing tokenizer loading; preserve offline operation. It should not delay the trust fixes.

### Ready-to-use implementation handoff

Start with Phase 1 of this PRD only. Reproduce TE-01 with one passed sample and four unreviewed samples, and reproduce TE-02 using the spelling/characters prompt pair. Add failing regression tests, implement the smallest correction, and make the decision panel and Markdown card agree. Preserve existing acceptance thresholds unless separately approved; distinguish incomplete, failed and untested outcomes. Keep the free path offline, do not configure or use provider credentials, and do not implement the workflow builder yet. Verify lint, tests, build and the affected browser states, then report the changes and remaining decisions.
