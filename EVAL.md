# Token Economist — Eval

The eval **is** the product claim. Run it with `npm run eval`. Nothing in it
requires a network connection or an API key except the explicitly opt-in live
accuracy check.

The Quality Lab makes no calls at all. It exports a check pack you run in your
own AI tool and scores the replies you paste back, offline. The app holds no
provider credential, so there is no paid path in the product to guard.

## Headline metric

> **Input-cost estimates carry an honest range that contains the provider's
> true token count, with the point estimate within ±12% — computed at zero
> estimation cost (no model calls, works offline).**

The offline half of that claim is enforced on every `npm run eval`. The
accuracy half is enforced by the opt-in live check (below) whenever a key is
provided; for OpenAI o200k models the count is exact by construction (same
BPE data), so the ±12% band is the *worst case* across providers.

## Scoreboard (spec §7) — results as of 2026-09-01 (60 offline tests)

| Criterion | Test | Result |
|---|---|---|
| **Determinism honoured** — zero calls to priced models on the cost+lint path | `tests/determinism.test.ts` replaces `fetch` and `XMLHttpRequest` with throwing landmines, then runs estimate → lint → recommend → card | ✅ passes, 0 network calls |
| **Cost accuracy (repeatability)** — same input ⇒ same estimate | deep-equal estimates, byte-identical cost card across runs | ✅ passes |
| **Cost accuracy (reference counts)** — token counts match pinned o200k reference vectors | `tests/tokenizer.test.ts`, 6 fixtures incl. unicode/code/JSON | ✅ exact match |
| **Cost accuracy (provider truth)** — calibrated band contains Anthropic's own `count_tokens` result; point within ±12% | `tests/live-accuracy.test.ts` (opt-in: set `ANTHROPIC_API_KEY`, run `npm run eval:live`) | ⏭ skipped by default — sends fixture texts (never user data) to the free count_tokens endpoint |
| **Suggestion usefulness** — top suggestions on a deliberately bloated prompt produce a real, re-measured reduction ≥15% | `tests/lint.test.ts` applies the machine-applicable fixes and re-tokenizes | ✅ **87.6% measured reduction** (2,299 → 284 tokens); all 7 planted problem classes detected |
| **Suggestion honesty** — claimed savings within ±25% of measured | same file | ✅ passes |
| **Suggestion coverage (prose dumps)** — realistic RAG prompts (Q&A/FAQ paragraphs, not bullets/JSON) trigger the retrieval finding, and the applied fix removes >70% of the prompt, measured | `tests/lint.test.ts`, `FAQ_DUMP_PROMPT` fixture (added after a PM-persona test exposed the gap) | ✅ passes |
| **Decision usefulness** — pasted prompt → defensible model choice + cost number, no code | recommendation policy tests (`tests/card-measure.test.ts`): with quality data the cheapest *passing* model wins; with none, the recommendation is the **cheapest usable model as a verify-first hypothesis** with a named step-up and a cost-monotonic shortlist — never a silent default to a pricier tier | ✅ passes; end-to-end in the UI in under a minute |
| **Advice consistency** — the headline recommendation and the cheaper-tier lint finding name the same model | `tests/lint.test.ts` (both derive from `cheapestUsable()`) | ✅ passes |

Math sanity is also covered: band ordering (low ≤ point ≤ high) on every
output, a hand-computed single-turn case, caching engaging only above the
per-model minimum prefix, batch discount, retry linearity, and history-growth
monotonicity.

## What the eval deliberately does NOT claim

- Anthropic/Google token counts are **estimates** (calibration bands 1.05–1.30
  and 0.95–1.20 over the o200k base count). The tool never displays them as
  exact — every cost is a range. Exactness is only claimed for OpenAI o200k
  models.
- Quality is never scored by the tool's own opinion. The Quality Lab reports
  pass/fail against the *user's* check, per example.
- Thresholds were set before results were measured (±12% point accuracy,
  ≥15% linter reduction, ±25% savings honesty) and must not be loosened to
  keep the suite green. The measured 87.6% comfortably exceeding 15% is the
  fixture being deliberately awful, not the bar being low.

## Running

```sh
npm run eval        # offline suite — must pass with networking disabled
ANTHROPIC_API_KEY=… npm run eval:live   # opt-in provider-truth check
```
