# Token Economist

**A design-time cost/quality preview for AI product features.** Paste the
prompt you're about to ship, state your scale assumptions, and get — before a
line of the feature is built — an honest picture of what it will cost to run
per request and per month across model tiers, concrete ways to make it
cheaper, and (optionally, for a previewed few cents) evidence about whether a
cheaper model is good enough.

![Token Economist](docs/screenshot.png)

## The load-bearing idea

**Cost is predictable from tokens; quality must be observed.**

- The **cost estimate** and the **prompt linter** are free, deterministic, and
  fully offline — the eval suite proves the entire path runs with networking
  disabled. Token counts come from an offline BPE (o200k) calibrated per
  provider; prices come from a maintained table; the output side comes from
  your stated assumption. Costs are always shown as **ranges** because
  non-OpenAI tokenizers can only be estimated offline — the range bar is the
  UI's signature element, not a decoration.
- The **Quality Lab** is the only part that spends money: explicitly
  triggered, cost-previewed before the button activates, hard-bounded
  (≤5 samples × ≤2 models, capped max_tokens), cached so re-runs are free,
  and reporting per-example outcomes against *your* definition of good
  enough — not an average, not a leaderboard. Paid calls are available only
  through a loopback-only local service; a public/static build is estimate-only.
- Your prompt **never leaves the machine** except when you run the Quality
  Lab. There is no hosted backend, and provider keys never enter browser code.

## Quick start

```sh
npm install
npm run dev      # offline/public-safe mode; Quality Lab makes no paid calls
npm run eval     # the offline eval suite (see EVAL.md)
npm run build    # production build
```

To use the Quality Lab locally:

```sh
cp .env.example .env.local
# Add one or more provider keys to .env.local
npm run dev:quality
```

The Quality Lab service binds only to `127.0.0.1:8787`. It reads
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY` from the
process environment or ignored `.env.local`; the browser receives only the
list of configured providers, never the keys themselves. Restart the command
after changing `.env.local`.

## What you get

1. **Cost across models** — per-conversation and per-month ranges for 7 models
   across 3 providers, modeling the full production request: static prefix +
   user input + conversation-history growth + tool calls + retries + prompt
   caching + batch discounts. Assumptions are editable and printed on
   everything.
2. **Cost-cut suggestions** — deterministic lint findings, each quantified in
   tokens and $/month: duplicated instructions, filler phrasing, whitespace
   bloat, oversized few-shot sets, cacheable static prefixes, missing output
   caps, inlined data blobs that should be retrieval, unbounded history, and
   tasks a cheaper tier likely handles. Machine-applicable fixes have an
   "Apply" button; savings are verified by re-tokenizing, not self-reported.
3. **Cost card** — a one-screen Markdown artifact (recommended model,
   projected cost, quality note, assumptions) to paste into a ticket.
   Recommendations are stamped **UNVERIFIED** until they pass your own
   quality check.
4. **Quality Lab** — the opt-in measured half: define "good enough"
   (valid-JSON / contains / regex / manual judgment), run a handful of samples
   on 1–2 candidate models using locally configured provider credentials, see
   per-example outcomes, and let the recommendation flip to the cheapest model
   that actually passes.

## Architecture

```
src/core/        pure TS library, no React, no network on the free path
  models.ts      pricing/model registry — adding a provider is a config change
  tokenizer.ts   offline o200k count + per-provider calibration bands
  estimate.ts    deterministic cost engine (request model in DECISIONS.md D5)
  lint.ts        heuristic cost linter with measurable `apply` fixes
  card.ts        Markdown cost card + recommendation policy
  measure.ts     browser client for the local-only paid-call boundary
server/          loopback proxy + Anthropic/OpenAI/Google provider adapters
src/…            React UI over the core library
tests/           the eval suite (EVAL.md is the scoreboard)
DECISIONS.md     append-only build log
```

The estimator is model-agnostic by construction: its registry lives in
`src/core/models.ts`. The local Quality Lab server uses an explicit model
allowlist so a browser request cannot turn it into an arbitrary API proxy.

For a reviewer-oriented map of trust boundaries, operational flows, secrets,
permissions, and test coverage, start with
[`documentation/architecture.md`](documentation/architecture.md).

## Verification

```sh
npm run lint
npm test
npm run build
```

The default suite is deterministic and makes no paid provider calls. Live
tokenizer calibration remains explicitly opt-in through `npm run eval:live`.

## License

MIT

## Honesty notes

- Anthropic/Google token counts are calibrated estimates (documented bands),
  which is exactly why costs render as ranges. OpenAI counts are exact
  (same BPE). See `DECISIONS.md` D2 and `EVAL.md`.
- Prices carry an as-of date and were checked against official provider
  documentation on 2026-09-01. A live aggregator refresh is labelled with
  its source; verify numbers again before committing production budget.
- Not a runtime router, not a billing dashboard, not a prompt optimizer that
  burns runs, not a model leaderboard — this is a pre-flight check.
