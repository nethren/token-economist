# Design — Ink & cobalt (v6)

The current system. Earlier concepts are summarized at the bottom as history;
**v6 supersedes them**. v5 (warm paper + brick red + Geist) read as the 2026
AI default and hid the answer from first-time visitors; v6 keeps v5's
light-first structure and honest-number principles, and changes the surface,
the type, the layout and the first impression. See DECISIONS.md D30.

The owner's APIFit project was the reference for taste: a neutral canvas
carrying a trace of the accent's hue (never cream), one deep accent, a
near-black dark mode with raised panels, readable working copy, dividers
instead of boxed cards, and motion only in response to the user. The typeface
is deliberately its own (Hanken Grotesk, D32), not APIFit's.

## Principles

- **Lead with the answer.** A first visit opens on a labelled example with the
  estimate already on screen. The example is named as one, with a one-click
  way to start blank.
- **One raised surface.** The estimate is the only card. Inputs sit on the
  canvas; the quality check, detail and "How it works" are separated by rules
  and space, so the page reads as one document.
- **The range is the hero.** The monthly figure is drawn with its likely range
  as a band beneath it (0-anchored, so the width of the uncertainty is
  honest). That band is the one bold element; everything around it is quiet.
- **The answer follows you.** Once the verdict scrolls away, a compact copy
  (model, cost, range, badge) appears in the header on wide screens and as a
  bottom bar on phones.
- **Colour means one thing.** Cobalt is actions, selection and the recommended
  pick. Green, amber and red are state only (quality-checked, unverified,
  error). Chart series use a validated categorical palette, never state colours.

## Colour

Tokens live in `src/index.css`: light on `:root`, dark on
`:root[data-theme="dark"]`. `public/theme.js` sets `data-theme` before first
paint (a same-origin file, because the CSP allows no inline script).

| Token | Light | Dark | Role |
|---|---|---|---|
| `--canvas` | `#f8f9fb` | `#0c0e12` | page |
| `--surface` | `#ffffff` | `#171a20` | the estimate, inputs |
| `--sunken` | `#f0f2f6` | `#101217` | tracks, code, disabled |
| `--ink` / `-soft` / `-faint` | `#171a21` / `#454b5a` / `#5f6677` | `#e8eaf0` / `#b3b9c6` / `#9098a8` | text ramp |
| `--control-border` | `#8c93a3` | `#6f7788` | input boundaries (≥3:1) |
| `--accent` | `#2748c9` | `#8fa6ff` | actions, selection, recommended pick |
| `--good` / `--warn` / `--bad` | `#1d7a45` / `#8a5a00` / `#b42318` | `#6fcf97` / `#e3c07a` / `#f19a90` | state only |
| `--series-1…5` | dataviz default slots 1–5 | dark steps | money split, by entity |

Measured contrast: every text pair ≥4.5:1 in both themes (lowest: green on
its tint, 4.72:1 light); control borders 3.08:1 light, 3.88:1 dark. The
series palette passes the dataviz validator in both modes (worst adjacent CVD
ΔE 9.1 light / 8.4 dark); three light slots sit under 3:1 against white, so
every segment carries a visible label with its percentage and dollar amount.
The bar keeps a fixed entity order so neighbours never change; only the legend
sorts by share.

## Type

Hanken Grotesk (variable, OFL, self-hosted via `@fontsource-variable/hanken-grotesk`)
for every role, numbers included via tabular figures. Chosen by the owner from
rendered comparisons against Public Sans and Schibsted Grotesk: compact,
slightly warm, and its figures are tabular by default. Geist Mono only where text is
pasted or raw: the prompt box, sample boxes, reply boxes, the Markdown card.
Fixed rem scale, about 1.2: 12 / 13 / 15 / 17 / 20 / 26 / 40, and the 64px
monthly figure. Nothing below 12px. Headings sentence case; no tracked
uppercase labels anywhere.

## Layout

- Sticky app bar: wordmark (Token 440 / **Economist** 700), the answer
  preview, How it works, GitHub, theme icon button. Solid background, no blur:
  the preview becomes a fixed bottom bar on phones, and a filtered ancestor
  would trap it.
- Intro: a question headline, one paragraph, the example notice.
- Workspace ≥960px: inputs 5fr | estimate 7fr. Below that, one column.
- Steps are numbered 1–3 because the decision really is that sequence.
- Quality check: full width, three parts (describe, run it in your own tool,
  paste back) divided by rules: three across from 1200px; describe beside
  run-over-paste from 760px; stacked below. It tests the recommended model by
  default and starts with the loaded example's test inputs and pass rule.
- Full comparison table and Markdown card in disclosures; "How it works" is an
  open section with the portfolio and GitHub links.
- Page max 1360px; gutter `clamp(16px, 4vw, 48px)`.

## Components and motion

- One button shape (8px radius, 40px, 32px small). Example chips use
  `aria-pressed` and turn cobalt when active.
- `VerifyBadge` (`src/components/Badge.tsx`) is the single source for the
  verification state in the result, the header preview and the quality check.
- Replacing the user's own prompt or changing an assumption from a suggestion
  (an example, an applied fix, a one-click cap or caching, start blank) shows
  a toast with Undo.
- Suggestions: title and amount on one row, the full explanation beneath, then
  the action. The reply-length finding shows "Caps up to $X/mo of overrun" in
  neutral ink, because a cap bounds risk rather than lowering the estimate.
  Findings beyond the top three open in place.
- Dark mode opens body text slightly (line-height 1.62, +0.008em tracking) so
  light-on-dark reads with the same weight as dark-on-light.
- Motion is state change only, all under 330ms with strong ease-out curves:
  the count-up on the figure, the range band and model bars re-pricing
  (transforms), the badge swap, the preview sliding in, the toast entering
  (`@starting-style`), press scale 0.97. No page-load choreography. Reduced
  motion removes durations.
- Z-index scale: sticky 20, preview 30, toast 40, tooltip 50, skip link 60.

---
# History (superseded)

## v5 — editorial, light-first (2026-07-25 to 2026-09-24)
Warm paper `#f6f4ef` with a brick-red accent, Geist + Geist Mono for numbers,
a sticky two-pane layout with the inputs in their own scroll area, tracked
uppercase labels, a rotated rubber stamp, and an empty first load. Replaced
because it matched the saturated AI palette (cream + clay), the answer was
2,140px down on a phone, step 3 was hidden in a nested scroll area, and 26
type declarations sat at 9–11px.

## v2–v4 — "the Instrument" (dark, rejected)
Dark green-black desk, mono-everywhere, verdict/cost as skeuomorphic printed
"receipts" with torn edges, an LED readout, a machine/receipt split. Rejected:
read as AI-generated, poor readability, jarring red, dark-only, used <50% of a
monitor.

## v1 — paper ledger
The original IBM Plex light ledger; formalized, then abandoned for v2.
