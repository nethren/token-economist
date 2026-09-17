# Token Economist — Decisions Log (append-only)

Format: one dated entry per decision. Never edit past entries; append corrections.

---

## 2026-07-12 — D1: Stack

Vite + React 19 + TypeScript SPA, zero backend. Rationale: the privacy guardrail
(§8) says pasted prompts must never leave the user's machine except on an
explicit Tier-2 run. A pure client-side app makes that true *by construction* —
there is no server to leak to. Cost + lint run entirely in the browser.
Core logic lives in `src/core/` as a plain TS library with no React imports,
so the same code is exercised by the vitest eval suite in Node.

## 2026-07-12 — D2: Tokenizer & calibration (the honesty core)

No public offline tokenizer reproduces Anthropic's or Google's tokenization.
Using OpenAI's o200k BPE for everything and calling it exact would be false
precision (§8). Design:

- Base count: `gpt-tokenizer` (o200k_base), pure JS, deterministic, offline.
- Each model in the registry carries a **calibration band** `{point, low, high}`
  applied to the base count:
  - OpenAI o200k models: 1.00 [0.98, 1.02] — same BPE, essentially exact.
  - Anthropic: 1.15 [1.05, 1.30] — Anthropic's own guidance is that
    tiktoken-style counts undercount Claude tokens by ~15–20% on prose, more
    on code/non-English. (Source: Anthropic API docs / claude-api skill,
    2026-06 snapshot.)
  - Google: 1.05 [0.95, 1.20].
- Cost is therefore always a **range**; the point estimate is labeled with the
  calibration source. This satisfies §4 (deterministic + free) while staying
  honest about tokenizer mismatch.
- Anthropic's free `POST /v1/messages/count_tokens` exists and the spec permits
  it, but it transmits the prompt — so it is **opt-in only** (used in the live
  eval and offered as an explicit "refine with provider count" action, never
  the default path).

## 2026-07-12 — D3: Pricing table

`src/core/models.json`-style registry in `src/core/models.ts` with per-model:
input/output $/MTok, cache-read multiplier, cache-write multiplier, batch
discount, context window, max output, calibration band, `pricesAsOf` date.
Anthropic prices from the 2026-06-24 official table (Fable 5 $10/$50,
Opus 4.8 $5/$25, Sonnet 5 $3/$15 — intro $2/$10 to 2026-08-31 noted but the
standard price is used to avoid a cliff surprise — Haiku 4.5 $1/$5). OpenAI
and Google prices from Jan-2026 public price lists, flagged `verify: true` so
the UI shows a "confirm current pricing" hint. Adding a model = adding one
object literal; no code changes (§5.5).

## 2026-07-12 — D4: Output-token estimate

The output side cannot be tokenized in advance. The user states either an
expected output length (words or tokens) or a max-tokens cap. The estimator
uses a triangular band: low = 0.5×expected, high = min(1.5×expected, cap).
If only a cap is given, expected = 0.6×cap. If neither, we default to
250 tokens and the linter flags "missing output cap" as a finding.

## 2026-07-12 — D5: Request model (what "per-request" means)

Full production request per §5.1, averaged over a conversation of N turns:
turn t input = staticPrefix + Σ_{i<t}(userIn+output) + userIn + toolOverhead.
Averaged closed-form: perTurnInput = P + U + (N−1)/2·(U+O) + tools.
Caching: hitRate fraction of P billed at cache-read rate; misses pay the
write premium. Retries multiply the whole thing by (1+retryRate).
All assumptions are explicit, editable, and printed on the cost card.

## 2026-07-12 — D6: Eval design (offline vs live)

Offline (always runs, zero network — vitest stubs `fetch` to throw):
determinism (same input ⇒ byte-identical estimate), zero-network proof,
token-count regression fixtures, linter usefulness (top suggestion on a
deliberately bloated prompt must yield a real, re-tokenized reduction ≥15%).
Live (opt-in, needs ANTHROPIC_API_KEY): compares calibrated counts against
the provider's free count_tokens endpoint; asserts the range contains the
true count and the point is within ±12%. Headline metric comes from this.

## 2026-07-12 — D7: Tier-2 quality measurement

Provider adapters behind one interface (`ProviderAdapter`), called directly
from the browser with a user-pasted API key (Anthropic supports direct
browser access via the `anthropic-dangerous-direct-browser-access` header;
OpenAI-compatible adapters likewise). Bounded: ≤5 samples × ≤2 models per
run, hard max_tokens, cost previewed from the estimator before the Run
button activates. Results cached in localStorage keyed by
hash(model+prompt+input+params). "Good enough" = user-defined checks:
contains / regex / valid-JSON / manual pass-fail. Per-example outcomes shown,
not just averages.

## 2026-07-12 — D8: Linter fixes must be applicable to be evaluable

First eval run failed the ≥15% reduction bar: only the text-cleanup rules
(dedupe, filler, whitespace) had machine-applicable fixes, worth 3.65% on the
fixture. Rather than lowering the bar, the two structural findings gained
faithful `apply` transforms: few-shot trim keeps the 2 largest example
blocks; stuffed-context swaps the detected blob for a retrieval placeholder
(the static-prefix half of what "use retrieval" means). Measured result:
87.6% reduction (2,299 → 284 tokens) with claimed savings verified within
±25% of re-tokenized reality.

## 2026-07-12 — D9: UI

Ledger visual system (IBM Plex Serif/Sans/Mono, pale ledger paper, accounting
red for spend, green for verified). Signature element: every cost drawn as a
low—point—high band bar on a shared scale — the honesty constraint made
visible. Recommendations carry an UNVERIFIED/QUALITY-CHECKED stamp that flips
only when the user's own check passes. Verified responsive to 390px, reduced
motion respected, visible focus states. Bundle is ~2.2MB minified because the
o200k BPE ranks ship to the browser — accepted as the price of fully-offline
tokenization (privacy by construction beats bundle size for this tool).

## 2026-07-12 — D10: Final self-score against §7

- Cost accuracy: pinned-vector + repeatability tests pass; provider-truth
  check is opt-in (±12% point / band-contains-truth) since it must transmit
  fixture text. OpenAI counts exact by construction.
- Determinism: enforced with fetch/XHR landmines in the suite. PASS.
- Suggestion usefulness: 87.6% measured on the bloated fixture. PASS.
- Decision usefulness: paste → stamped recommendation + range + card, no code.
- Headline metric: "honest range contains the provider's true count, point
  within ±12%, at zero estimation cost."
Open items honestly noted: Google has no Tier-2 adapter yet (config-only
addition); intro pricing for Sonnet 5 shown as standard price; OpenAI/Google
prices flagged verify-before-commit.

## 2026-07-12 — D11: PM-persona test drove a P0 correctness fix in the advice

Ran two realistic scenarios as a non-technical PM (ticket classifier; RAG
docs chatbot at 200k conv/mo). Four defects found and fixed, with eval
coverage so they stay fixed:

1. **Recommendation contradicted the north star.** With no quality data,
   `recommend()` defaulted to the cheapest *workhorse* tier — steering the
   docs-chatbot user to a $7,939/mo model while $1,339 and $1,936 options sat
   above it in the same table. New contract: unverified recommendation is
   always the CHEAPEST usable model, framed as a verify-first hypothesis,
   with a named step-up ("if it falls short, next is X at $Y/mo") and a
   cost-and-tier-monotonic shortlist (start here / balanced / safest step
   up). Tier labels alone proved non-monotonic in cost (GPT-5 frontier <
   Gemini Pro workhorse), so the shortlist walks the cost-sorted list and
   only adds entries that raise both tier and cost.
2. **Two different "cheap model" answers.** Headline said GPT-5 mini; the
   cheaper-tier lint finding said Haiku (it was scoped to the reference
   provider). Both now derive from one function, `cheapestUsable()`, and an
   eval test asserts they agree.
3. **The linter missed prose doc dumps** — the #1 fix for a RAG feature.
   `findDataDump` only matched bullet/JSON/CSV lines; realistic FAQ/API docs
   are Q&A paragraphs. Detector now also matches Q:/A: and key-value shapes
   and treats blank lines as run-neutral. New fixture test locks it in
   (fires on an 80-entry FAQ dump, saving ~$19–24k/mo in the scenario).
4. **Biggest savings weren't actionable.** Findings can now carry a
   serializable `action` (enable-caching, set-output-cap) rendered as a
   one-click button; verified in-browser that clicking resolves the finding
   and re-prices everything.

Also: tokens translated for PMs everywhere (≈ words / pages next to every
token figure, "Response length limit (max_tokens)" relabel, o200k jargon
moved to a tooltip), and a 3-step how-to strip. Suite grew 29 → 34 tests.

## 2026-07-17 — D12: Evaluation-driven improvements (permalink, presets, breakdown, staleness, reasoning tokens)

An external product evaluation (TokenEconomist_Evaluation.md) prioritized a
roadmap; the "quick wins" plus one high-impact bet were implemented, all
within the locked constraints (deterministic free path, ranges, no eval
loosening). Notably, the evaluation's flagship "close the cost-quality loop"
was already built (D11's `recommend()` policy), and "exact per-provider
token counting" was rejected for the default path — it requires network
calls, which the determinism landmines forbid by design (it remains the
documented opt-in from D2).

1. **Shareable permalink** (`src/core/share.ts`): feature name + prompt +
   assumptions + reference model round-trip through the URL *fragment* as
   URL-safe base64 JSON (versioned, garbage-tolerant, ill-typed fields fall
   back to defaults). Fragments never reach a server, so the privacy
   guarantee holds by construction. "Copy share link" sits next to "Copy as
   Markdown" — the cost card becomes a link someone can open, not just read.
2. **Feature templates** (`src/core/presets.ts`): classifier / support bot /
   RAG / agent / summarizer starters that prefill both prompt and the
   assumption *shape* of that workflow (RAG = retrieved context as tool
   tokens, agent = tool loops + reasoning, summarizer = batch). Answers "my
   feature isn't one prompt" without new engine machinery.
3. **Where the money goes** (`CostBreakdown` on every estimate): the point
   scenario split into prefix / user+history / tools / output / reasoning,
   with retry+batch folded into each component so they sum exactly to the
   total (eval-tested). Rendered as a stacked bar under the recommendation
   (reasoning is striped — hidden spend shouldn't look like visible output)
   and as a percentage line on the card. `prefixShareOfCost` now derives
   from the same breakdown.
4. **Stale-price flag**: `priceAgeDays(pricesAsOf, onDate)` is pure; the UI
   passes today, the card passes its injectable `generatedAt`, so cards stay
   byte-deterministic. Prices >90 days old show "prices N mo old — verify"
   instead of the softer "verify pricing".
5. **Reasoning-token accounting**: `reasoningTokensPerTurn` (default 0 —
   all prior numbers unchanged, verified by an equality test). Billed at
   output price per turn, counted against the context window, but NOT
   compounded into history — providers strip thinking blocks from
   subsequent-turn context. Flagged in assumption notes and on the card.

Suite grew 34 → 48 tests; thresholds untouched. Verified end-to-end in the
browser (presets, permalink reload restore, garbage-hash fallback, breakdown
reactivity, stale flags).

## 2026-07-17 — D13: PM-language cost split + opt-in live prices

1. **"Where the money goes" redesign.** The first version's inline legend was
   cramped and used engineer vocabulary. Now: a sunken card with the split as
   sorted rows (biggest driver first) and aligned %/$ columns, and one shared
   vocabulary exported from card.ts (`BREAKDOWN_LABELS`) so the UI and the
   Markdown card always say the same words: "fixed instructions",
   "messages + chat history", "tools & retrieved data", "hidden thinking",
   "the model's replies". Each row carries a one-line plain-English tooltip.

2. **Opt-in live price refresh** (`src/core/livePrices.ts`). The determinism
   guarantee protects the *estimate function*, not the price table — prices
   were always config input (D3). So live prices don't touch the free path:
   an explicit "Update prices" button fetches OpenRouter's public model list
   (no key, CORS-open, prices per token) and maps it onto the registry.
   - `applyLivePrices(models, payload, date)` is pure and offline-tested
     (garbage payloads, malformed prices, uncovered models → snapshot kept).
   - Only `fetchLivePrices` touches the network, only on click. The prompt is
     never transmitted; the button's tooltip says exactly that. The eval
     landmines still pass — estimate/lint/card never call it.
   - Honesty: refreshed models get `priceSource: "live"`, pricesAsOf = fetch
     date, a green "live price <date>" badge, and the card discloses
     "refreshed from a public price list (openrouter.ai) on <date> at the
     user's request". Failures keep previous prices and say so in red.
   - Observed live: Sonnet 5 returns $2/$10 (the intro price actually billed
     today) vs the $3/$15 standard snapshot — exactly the drift this feature
     exists to surface. registry-id → OpenRouter-slug map is one line per
     model.

Suite 48 → 52 tests; thresholds untouched. Verified in-browser: refresh
updates all 7 models and re-sorts the table; sabotaged fetch shows the error
note and keeps prices.

## 2026-07-17 — D14: Automatic price refresh (no button required)

Request: keep prices current without user action ("trigger on every prompt
input"). Rejected the literal mechanism — a fetch per keystroke would hammer
a price list that changes on a scale of days and return identical data —
and implemented the goal instead:

- `autoLoadPrices(models, storage, now)` runs once on app load: serve from a
  localStorage cache when it is <6h old (`PRICE_CACHE_TTL_MS`), otherwise
  fetch and remember. A failed fetch falls back to the last known prices;
  a first run offline keeps the bundled snapshot with an honest note.
  Storage and clock are injected, so every branch is offline-tested.
- The "Update prices" button became a small "refresh now" (manual retry /
  force-skip-cache); it is no longer required.
- Honesty copy updated because the app is no longer zero-network by default:
  masthead badge now reads "deterministic · free · prompt never leaves the
  tab", and the footer states that the only automatic network call downloads
  a public price table. The determinism landmines still pass — core
  estimate/lint/card never fetch; the auto-refresh lives in the React layer
  and only swaps the registry input.
- Status line distinguishes "auto-updated · <date>", "(cached)", "couldn't
  reach the live price list — using bundled snapshot", and "refresh failed —
  keeping the previous prices".

Suite 52 → 57 tests. Verified in-browser: fresh load auto-updates all 7
models with no interaction; reload serves "(cached)" with zero requests to
the price source; cleared-storage + blocked network degrades to the snapshot
with the honest note and no fake "live" badges.

## 2026-07-17 — D15: The journey is the layout (UX restructure)

User feedback: the two-column layout didn't read as a flow, the Quality Lab
was buried, the UNVERIFIED stamp had no visible connection to the thing that
flips it, and the "Savings priced against" model selector felt redundant.
Restructured (with PRODUCT.md written first — register: product):

1. **Single-column 4-step journey** replacing the two-column grid, in the
   order the decision is actually made: ① Paste the prompt (templates) →
   ② Say how it runs at scale → ③ Check quality (optional, a few cents) →
   ④ Read the decision (recommendation, money split, model table, savings
   actions, cost card). The numbered how-to strip is gone; the steps ARE the
   numbers. A real sequence, so numbered headers are earned, not scaffold.
2. **Sticky verdict bar** under the masthead — current pick, $/mo, stamp —
   keeps the live result in view while steps 1–2 are edited (the feedback
   loop the two-column layout used to provide).
3. **Stamp ↔ Quality Lab linkage, both directions.** The stamp (verdict bar
   and recommendation box) is now an anchor to step 3 with an explanatory
   tooltip; step 3 opens with a status strip that states the contract in
   plain language: amber "nothing measured yet — the recommendation stays
   UNVERIFIED until a check passes" / amber "ran but nothing passed yet" /
   green "quality-checked". `scroll-margin-top` keeps anchored steps clear
   of the sticky bar.
4. **Savings selector removed.** Lint savings are now auto-priced against
   the RECOMMENDED model — the price the user will actually pay — instead of
   asking them to pick a reference. Consequence: the "cheaper tier fits"
   finding no longer fires (reference is already cheapest); the headline
   recommendation carries that message. Tradeoff accepted: teams committed
   to a specific pricier model lose "price savings against MY model" — can
   return as an advanced option if asked for.
5. **Fixed a pre-existing 390px overflow** the narrow layout surfaced:
   hidden InfoDot popovers (absolute, centered) widened the page; on ≤700px
   they now hang leftward from the marker.

Suite still 57 tests (UI-only change). Verified in-browser at 1440px and
390px: step order, stamp click scrolls to step 3 under the sticky bar,
zero horizontal overflow, savings note names the recommended model.

## 2026-07-20 — D16: Visual overhaul — "the Instrument" (DESIGN.md v2)

Two-stage redesign at the user's request, with PRODUCT.md/DESIGN.md written
first (impeccable init; register: product).

Stage 1 (preserve): motion system + hero moment on the paper ledger — press
physics on every button (scale 0.97, custom ease-out), re-price transitions
on band bars/cost-split segments (state-change feedback, deliberately
transitioning width on micro-elements), rubber-stamp press animation when
the verdict flips, one-time step-arrival stagger, Quality Lab open reveal,
sticky verdict bar that lifts only when stuck (IntersectionObserver
sentinel), row hovers gated to (hover:hover), brand mark.

Stage 2 (overhaul): user rejected the paper-ledger look as lifeless.
New system: dark green-black instrument desk (#0f1512 family — evolved from
the brand's own ink hue, not generic hacker-dark); bone text; money in
JetBrains Mono; display/UI in Archivo Variable (wdth axis nameplate);
IBM Plex + Google Fonts links dropped for self-hosted @fontsource variable
fonts. Concept: the machine is dark, its OUTPUTS are printed paper — the
verdict card and cost card render as light ruled receipts (--receipt
tokens), the page's only light surfaces, systematic not accidental.
index.css keeps legacy aliases (--paper→--bg, --ink→--text) so the older
stylesheet vocabulary re-themes wholesale; inverted-semantics spots fixed by
hand (inputs, tooltip, buttons, stamps-on-receipt, favicon, mark).

Verified: 57 tests + build green (UI-only change), WCAG AA spot-checks pass
(5.3–13.7 contrast on key pairs), zero horizontal overflow at 390px, fonts
confirmed rendering in-browser. Known deliberate exception: width/left
transitions on band-bar micro-elements (design hook flags layout-transition;
scaleX would distort the band's edge borders — accepted).

## 2026-07-20 — D17: Machine + Live Receipt (layout rebuild)

User rejected D16 as "just a background change" — correct diagnosis: tokens
changed, hierarchy didn't. Presented four directions (machine+receipt, Swiss
report, cockpit bento, gauge cluster); user chose machine+receipt hybridized
with the most suitable standout element of the others — the gauge cluster's
instrument language (LED readout, switches, lamps) for the machine side,
plus the Swiss giant-figure for the receipt total. Bento rejected as
fighting the split-screen concept.

Build: new Receipt.tsx (printed decision: stamp, ~56px red total,
dot-leader rows, split bar, model bar chart, top-3 savings with one-click
actions, quality line, torn-edge pseudo-elements); App.tsx became a
two-column workbench (machine rail: LED via DSEG7 npm font, numbered
sections, switch-styled toggles, status lamp, price footer); ModelTable
gained tableOnly and, with the raw Markdown card, moved into <details>
below the receipt; verdict bar + sentinel deleted (the receipt is the live
verdict). Findings' full list now lives on the receipt (top 3) + raw card.

Text-density: the decision surface went from four paragraph-heavy panels to
one artifact where every number has a visual (bar, chart, LED) and prose is
limited to the recommendation reason. Verified in-browser: live reprint
(LED 5.74→57 and receipt total on input change), stamp→machine anchor,
switches, zero overflow at 390px and 1440px. 57 tests, lint, build green.

## 2026-07-25 — D18: palette/type correction + LED removal + quality exposed

Feedback on D17: green-tinted dark clashed with the type ("not readable,
ugly"), LED readout "corny", Quality Check missable under a dropdown.

- **Color:** dropped the green cast entirely — desk is now neutral gunmetal
  (#0f1012 family, neutral rules, `--text #ececee`). Locked to ONE accent
  (accounting red `#e05545`/`#b3382c`); green and amber demoted to pure
  semantic state (verified/savings/live vs unverified/stale). WCAG AA
  re-verified in-browser (5.2–14.4 on all key text pairs).
- **Type:** Archivo/JetBrains → Geist + Geist Mono (@fontsource variable,
  self-hosted). Sans+mono from one family = cohesive and readable on dark;
  removed every `font-stretch` (Geist has no width axis, they were no-ops).
  Removed `dseg` dependency.
- **LED readout removed** from the machine head (markup + CSS). The receipt's
  giant red total is the single hero number; the LED was redundant/gimmicky.
- **Quality Lab un-hidden:** was a `<details>` dropdown, now an always-open
  panel in machine section 3 (details→div in QualityLab.tsx). Amber status
  strip + status lamp signal the unstarted state.

UI-only: 57 tests, lint, build green. Verified in-browser at 1440px and
390px (no overflow, LED gone, lab inline, Geist rendering).

## 2026-07-25 — D19: full redesign — editorial, light-first (DESIGN.md v5)

Proper UX audit (ran the live app on a 2560px monitor) confirmed the user's
critique: (1) the app used exactly 50% of a wide monitor — 1280px cap + a
560px centered "receipt" marooned in a void; (2) it read as AI-generated —
mono font on ALL text (cockpit-cosplay), skeuomorphic torn-paper receipt with
a ✂ cut-line and dotted leaders; (3) the entire Quality panel was drenched in
alarm-red for an optional feature; (4) dark-only; (5) real bug — an empty
prompt still printed a full $5.74/mo decision against 0 tokens (no empty
state). No JS crashes; engine robust (0→$0, huge→$27k, no NaN).

Redesign (design-taste-frontend-v1 + emil-design-eng; user picked "warm
editorial + ink red, light-first"):
- **index.css rewritten**: light-first warm-paper token system as `:root`,
  dark under `:root[data-theme="dark"]`. Sans (Geist) is the base for ALL
  text; mono (Geist Mono) only for `.num`/code. One accent = brick-red for
  cost; green/amber demoted to semantic state. Contrast AA both themes.
- **Theme toggle**: App state → `data-theme` on <html> + localStorage, seeded
  from prefers-color-scheme. Header button (sun/moon). Persists across reload.
- **Metaphor deleted**: Receipt.tsx rewritten from skeuomorphic "receipt" to
  a clean `.decision` panel — verdict headline + two analytics grids
  (money-split | model chart; savings | quality) + empty state. No torn
  edges, scissors, dot leaders.
- **Monitor fill**: App.tsx → app bar + two-pane layout, `max-width 1680px`,
  results pane uses internal grids so width is filled by content (50%→66% of
  a 2560px screen, results pane ~1164px).
- **Quality de-red**: calm amber-tinted status + neutral lab panel; red only
  on the cost figure.
- **Empty state**: blank prompt now shows an inviting "Paste a prompt" panel.
- App.css fully rewritten (the old 1700-line file had layered dead concepts:
  masthead/cols/panel/verdict-bar/instrument/workbench/receipt). New file
  covers every class the untouched components still use (mtable, bandbar,
  costsplit, lab, results-table, field, stamp, etc.) so nothing breaks.

UI-only: 57 tests, lint, build all green. Verified in-browser at 2560px
(light+dark), 1440px, 390px (no overflow), empty state, toggle persistence,
WCAG AA (5.2–14.4). Removed dseg dependency earlier (D18); Archivo/JetBrains
already gone. This is the design of record; v2–v4 are dead.

## 2026-07-25 — D20: copy pass (stop-slop) + Quality Lab QA fix

Copy pass across all visible UI strings (stop-slop skill): tightened the
empty state, recommendation reasons (card.ts), decision-panel quality text,
labstatus, tooltips, price status, and the money-split labels
("fixed instructions"→"your instructions", "the model's replies"→
"the replies", etc.). Removed em-dashes from every user-facing string
(kept the "—" placeholder glyph on empty number fields, which is a UI
convention, not prose). Two copy assertions updated in tests (reason now
says "check" not "quality lab"; breakdown labels renamed); 57 tests green.

Text → visual, to cut the density:
- Quality Lab's four-sentence warning paragraph became one short lead line
  plus three fact chips (≤5 samples × 2 models · keys stay in this tab ·
  results cached, re-runs free).
- The footer paragraph became a trust-badge row (Ranges, not quotes · Cost
  path never calls a model · Prompt stays in your tab) plus one caveat line.

QA fix (the formatting bug in the screenshot): the Quality Lab's inner
`.lab-grid` was a 2-column layout gated by a *viewport* media query, but the
lab lives in the ~383px controls rail, so on desktop it forced ~180px
columns that wrapped every model name and clipped the "reply is valid JSON"
select. Rebuilt as a clean single-column flow: full-width model list (one row
per model, provider inline, 0 wrapped), full-width test-inputs, and a
1fr/88px row for the pass-check + reply-cap. Verified in-browser: 0 wrapped
model rows, select not clipped, no overflow at 1440px or 390px, both themes.

## 2026-07-27 — D21: empty-by-default inputs + subtle motion

Two requests. (1) Prompt and feature-name inputs now start empty with
placeholder text instead of pre-filled with the sample prompt, so first load
shows the empty-state decision panel and invites a paste or a template.
Removed the CLASSIFIER_PROMPT default import (presets still use it).

(2) Three subtle animations (user chose these from four; skipped the copy-pop),
all under ~260ms, custom ease-out, and disabled under prefers-reduced-motion:
- **Cost figure count-up**: the hero $/mo rolls to its new value when an
  assumption changes (rAF hook `useCountUp` in Receipt.tsx, no library). First
  mount shows the value directly; only later changes animate, so the panel
  entrance owns the first appearance. Bug found + fixed in QA: seeding `start`
  from performance.now() while comparing against the rAF timestamp made t<0 for
  one frame and flashed a negative dollar value; now `start` is seeded from the
  first rAF timestamp and t is clamped to [0,1].
- **Decision reveal**: `.decision:not(.decision--empty) > *` fade-up staggered
  0/60/120/165ms, and `.dc-model-bar > div` grows from scaleX(0) once. Fires on
  empty→filled mount only (editing re-renders in place, doesn't re-trigger).
- **Theme-toggle polish**: sun/moon svg keyed so it remounts on flip, running
  `icon-in` (rotate -90°+scale 0.5→1, fade). Big surfaces (.decision/.appbar/
  .lab) got a background/border color transition so light↔dark crossfades.

Verified in-browser: count-up interpolates cleanly (no bad frames), reduced
motion jumps instantly, reveal/icon animations fire, no console errors. 57
tests, build, lint green.

## 2026-09-01 — D22: Quality Lab keys move behind a loopback-only boundary

The original Tier-2 adapters accepted keys in React state and called provider
APIs directly from the browser. That was convenient for a one-machine
prototype, but it was the wrong security boundary for a public portfolio
project: browser code should never receive long-lived API credentials.

Quality Lab remains part of the product, with two explicit modes:

- `npm run dev` and production/static builds are estimate-only. The Quality
  Lab remains visible, explains that it is local-only, and cannot make paid
  calls.
- `npm run dev:quality` starts Vite plus a Node service bound to
  `127.0.0.1:8787`. The service reads `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, and `GEMINI_API_KEY` from the process environment or
  ignored `.env.local`; keys never cross the browser boundary.

The service accepts only local origins, JSON under 64 KiB, registered
provider/model pairs, bounded prompt/input sizes, and 16–1024 output tokens.
It exposes no general-purpose URL forwarding and never logs prompts, outputs,
or credentials. Anthropic, OpenAI, and Google are supported so every model in
the estimator can also be measured. Cached-result and cost-preview behavior
is unchanged. The launcher also generates an ephemeral per-run token shared
only by Vite and the service, preventing unrelated localhost pages or
processes from invoking the paid-call route.

## 2026-09-01 — D23: Official pricing and cache-threshold refresh

The pre-publication review rechecked every bundled model against official
provider documentation. Anthropic made Claude Sonnet 5's launch price of
$2/$10 per million input/output tokens permanent and cancelled the planned
September 1 increase to $3/$15, so the registry now uses $2/$10.

The same pass corrected cache thresholds to 1,024 tokens for Claude Opus 4.8
and Sonnet 5, 4,096 for Haiku 4.5, and 2,048 for Gemini 2.5 Pro/Flash. Google
cache-hit multipliers now reflect the documented 10% of standard text-input
price. GPT-5, GPT-5 mini, Gemini 2.5 Pro/Flash, Opus 4.8, and Haiku 4.5 base
prices already matched their official tables. All bundled rows are stamped
2026-09-01.

Sources:
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://developers.openai.com/api/docs/models/gpt-5
- https://developers.openai.com/api/docs/models/gpt-5-mini
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/caching

## 2026-09-15 — D24: Quality status is counted, never inferred

`recommend()` computed its pass rate over *reviewed* samples but printed the
*total* sample count, so a single reviewed sample certified a model with
"passed your check on all 5 samples" and set `verified: true`. Reproduced
directly: `[true, null, null, null, null]` produced exactly that string. Its
mirror image was equally wrong — a reviewed but sub-threshold run (one pass,
one failure) fell through to "No quality data yet.", reporting observed
failure as absent evidence.

Runs are now summarised by `summarizeRun()` into an explicit `QualityStatus`
(total, reviewed, passed, failed, unreviewed, rate, complete, checkName) with
five states: `not-run`, `unreviewed`, `incomplete`, `passed`, `failed`. Only a
*complete* run — every sample judged — can verify, and the existing 80%
eligibility threshold is preserved among complete runs as `PASS_THRESHOLD`.
Failures are always stated; nothing is dropped to improve a score. The status
now travels on the `Recommendation`, so the decision panel and the Markdown
card cannot print different counts. Claims name the check that ran ("valid
JSON"), because a format check is not a correctness check.

The recommendation also stopped claiming task complexity. `isSimpleTask` is a
keyword hint whose alternatives lacked a trailing boundary, so `spell` matched
"spelling", `moderat` matched "moderately" and `label` matched "labelled" — an
essay prompt read as bounded classification, and changing one word flipped the
advice without changing the task. The alternatives are now anchored on both
sides, and more importantly `recommend()` no longer takes the flag at all:
before evidence exists the copy is "Lowest estimated cost to test … Quality has
not been tested." The tool states what it priced, not what it believes a model
can do.

Scope: Phase 1 of `documentation/PRD-token-economist-improvements.md` only.
TE-03 (multi-stage workflow), TE-04 and TE-05 are untouched. Deterministic and
offline paths are unchanged, no paid call was made, and no pricing was altered.
Verification and remaining limitations are recorded in `documentation/tests.md`.

## 2026-09-17 — D25: Quality evidence expires with its configuration

A `MeasureRun` recorded the model, the check and the results, but nothing about
the prompt or reply cap it measured, and nothing cleared runs when the prompt
changed. So you could run a check, earn the "quality-checked" stamp, rewrite the
prompt completely, and keep the stamp. The card would still report that a model
passed your check. This is the one row of the TE-01 regression matrix that the
earlier fix left open, and it is the same failure as the partial-review bug:
claiming more than the evidence supports.

Runs now carry `ranAgainst`, a fingerprint of the prompt plus the reply cap,
stamped by `runMeasurement` rather than by callers — a fingerprint you have to
remember to attach is one you will forget. `recommend()` takes the current
fingerprint and treats any mismatch as a fifth state, `stale`: it never
verifies, and it is not reported as a failure or as missing data either,
because evidence from another configuration simply does not apply. The card
marks the run STALE rather than counting it.

`maxTokens` moved from Quality Lab local state up to `App`, because it is part
of the configuration a result is valid for and the fingerprint has to see it.

The Lab also gained a dev-only fixture that seeds the passed, failed, partial
and stale states. Producing real evidence costs money, which meant these states
had never been looked at in a browser. The fixture is gated on
`import.meta.env.DEV`, so production builds drop it, and it makes the feature
demonstrable without provider credentials. All four states were then verified
across the stamp, both panels and the Markdown card.

Verification: lint clean, 83 tests passing (5 new), build clean. No paid call
was made and no pricing changed.

## 2026-09-17 — D26: Quality evidence is brought by the user, not bought by the app

Supersedes the paid path in D13 and the loopback service in D18. The Quality
Lab used to make real provider calls through a loopback-only Node service that
held the keys. It was safe, and almost nobody could use it. Trying the feature
meant cloning the repository, writing an `.env.local`, holding a provider key,
and starting a second process. A hosted build could not run it at all by
design, which is exactly where a portfolio project is seen. The most
interesting half of the product was gated behind a setup ritual.

The app now exports a **check pack**: a Markdown brief carrying the prompt, the
samples, the pass condition, the reply cap and the instructions. The user runs
it in whatever AI tool they already pay for, pastes the replies back, and
`buildPastedRun()` scores them locally with the same `scoreOutput` the paid path
used. The scoring, the status accounting, the staleness rule and the card are
unchanged. Only the transport changed: from our process calling a provider, to
the user's own tool doing it.

What this buys:

- The hosted build is now the complete product. Nothing is disabled in it.
- No key ever exists, so no key can leak. The strongest form of the D18
  boundary is not guarding the key, it is not having one.
- The spend is on the user's account, in their own tool, where they can see it.
  The app previews the cost and charges nothing.

What it costs, stated plainly: token counts for pasted replies are offline
estimates rather than provider-reported usage, and the evidence is
self-reported. The app cannot witness that a reply came from the model it is
attributed to. So every run carries `source`, the panel says "replies you
supplied", and the card says the evidence is self-reported. Demo fixtures are
labelled `demo` and can never render as a measurement. An unverifiable claim
presented as a measurement would be the same dishonesty the whole quality path
was built to avoid.

Removed: `server/quality-proxy.mjs`, `server/dev-quality.mjs`, the
`dev:quality` script, the `/api/quality` Vite proxy, the
`__QUALITY_LAB_LOCAL__` define, `tests/quality-proxy.test.ts`, and the
`runMeasurement` / `ResultCache` / provider-adapter layer. The result cache went
with them: re-scoring pasted text is free, so there is nothing left to cache.

Verification: lint clean, 88 tests passing (5 skipped), build clean. The
production bundle was grepped for `api/quality`, `QUALITY_LAB`, `loopback`,
`apiKey` and the dev fixture — zero hits for each.

## 2026-09-17 — D27: One document out, one document back

D26 moved the model call to the user's own AI tool but left the paste-back as a
form: one textarea per sample, filled in one at a time. For five samples that is
five copy-paste round trips between two windows, and the friction lands exactly
where the user is least invested — after they have already done the work. A
feature nobody finishes is not much better than a feature nobody can start.

The pack now specifies its own return format. It asks for a single document
carrying the configuration id and `## Reply N` sections, and `parseReplyPack()`
reads that back out of one paste. The flow is: prompt → scale → download the
check → run it → paste the reply → score.

`parseReplyPack` is deliberately forgiving about formatting and deliberately
strict about alignment. It accepts `## Reply 1`, `### Reply 1:`, `Output 2`,
`Answer #3`, unwraps a code fence around the whole document or around one
reply, and falls back to horizontal rules or, for a single sample, to the whole
paste. What it will not do is guess: a reply numbered outside the sample range
or repeated is dropped with a warning rather than shifted into a neighbouring
slot, because a reply attributed to the wrong sample is worse evidence than a
missing one, and the user cannot see the mistake.

The declared configuration id is now authoritative for `ranAgainst`. Paste a
document generated before a prompt edit and the run records the configuration
it actually measured, so it reports stale instead of being re-badged as
current. The mismatch is also surfaced at paste time, before scoring.

The scale inputs were cut from nine fields and two toggles to four fields:
conversations per month, turns per conversation, user tokens per turn, and
expected reply tokens. Reply cap, retry rate, tool calls, tokens per tool call,
thinking tokens, caching and batch moved into an advanced panel, which opens
itself when a lint action changes something inside it — a control the user
cannot see changing on its own looks like a bug. Nothing was removed from the
model; the estimate still prices all of it, and the defaults are unchanged.

Verification: lint clean, 100 tests passing (12 new, all on the parser and the
configuration-id stamping), build clean. The whole flow was walked in the
browser: download, paste a realistic reply document with a fenced JSON answer, a
prose answer and a bare JSON answer, read 3 of 3, score 2/3 as failed, then edit
the prompt and confirm the amber mismatch warning and the STALE card line.
Contrast for the new parse banner and advanced summary measured above 6.7:1 in
both themes.
