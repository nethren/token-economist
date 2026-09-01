# Design — the editorial system (v5)

The current system. Earlier concepts (v1 paper ledger, v2–v4 dark
"instrument / receipt") are summarized at the bottom as history; **v5
supersedes them**. After the dark instrument concept was rejected as
AI-looking and hard to read, v5 is a clean, minimal, light-first product UI.

## Principles

- **Minimal and classy over conceptual.** No metaphor skins (no receipt,
  torn edges, LED, scissors, dot leaders). Calm typographic hierarchy.
- **Light-first, dark as a real toggle.** Default light; a header toggle
  flips `data-theme` on `<html>`, persisted to localStorage, seeded from
  `prefers-color-scheme` on first load.
- **Sans for text, mono for numbers only.** Geist for every label, heading,
  and body; Geist Mono only on figures (cost, tokens, %) and the prompt box.
  This alone removed most of the "generated UI" feel.
- **One accent.** Brick-red is used only where cost needs emphasis (the
  headline figure, the recommended row, band fills). Green and amber are
  semantic state only (verified/savings; caution/unverified) — never
  decoration. Red is NOT used to alarm (the old red-drenched Quality panel is
  gone; it's a calm amber-tinted note now).
- **Fill the monitor.** Layout is `max-width: 1680px` and the results pane
  uses internal grids (money-split + model chart side by side, savings +
  quality side by side) so the width is used by content, not dead space.
  Was 50% of a 2560px screen; now ~66% and genuinely filled.

## Color

Semantic tokens in `index.css`; light is `:root`, dark is
`:root[data-theme="dark"]`. Every component themes through these, so the
toggle is free.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#f6f4ef` | `#1a1917` | page (warm paper / warm charcoal) |
| `--bg-raised` | `#fffefb` | `#221f1b` | panels, inputs |
| `--bg-sunken` | `#edeae1` | `#131210` | tracks, code |
| `--text` / `-soft` / `-faint` | `#201d18` / `#575049` / `#6f695c` | `#ece8e0` / `#ada699` / `#9a9385` | ink ramp (all ≥4.5:1) |
| `--accent` / `-deep` | `#a5352b` / `#8a2a22` | `#e0705f` / `#c85748` | cost emphasis (the one accent) |
| `--green` | `#3c7a54` | `#5cb07f` | verified / savings (state) |
| `--amber` | `#8a6a1f` | `#d0aa55` | caution / unverified (state) |

Legacy aliases (`--paper→--bg`, `--ink→--text`, `--red→--accent`, …) remain so
older component CSS resolves. Contrast verified in-browser both themes
(5.2–14.4 across text pairs).

## Type

Geist Variable + Geist Mono Variable (self-hosted @fontsource). No serif, no
width axis. Scale: cost figure `clamp(44–60px)`; model name `clamp(22–27px)`;
section heads 15px/600; card labels 11.5px uppercase 0.07em; body 13.5px;
numbers mono tabular.

## Layout

- Sticky translucent app bar (brand + theme toggle).
- Two-pane: controls (`minmax(360px,400px)`, sticky on desktop) + results
  (`1fr`). Collapses to one column ≤1000px.
- **Decision panel** (`.decision`, formerly the receipt): verdict headline
  (Recommended · stamp · model · big red total · range · reason), then two
  analytics grids (money-split | model chart; savings | quality). Empty state
  (`.decision--empty`) invites a prompt instead of pricing nothing.
- Full comparison table and raw Markdown card live in `<details>` below.

## Components / motion

- Preset & refresh = pill chips; primary action = ink-filled button.
- Toggle switches for caching/batch; numbered section badges; status lamp on
  the quality section (amber todo / green ok).
- Stamp keeps the rubber-stamp press animation on verify-flip.
- Motion is state-change only: band/split widths transition on re-price,
  section fade-up on load, press-scale on buttons. All respect
  `prefers-reduced-motion`; hovers gated to `(hover:hover)`.

---
# History (superseded)

## v2–v4 — "the Instrument" (dark, rejected)
Dark green-black desk, mono-everywhere, verdict/cost as skeuomorphic printed
"receipts" with torn edges, an LED readout, a machine/receipt split. Rejected:
read as AI-generated, poor readability, jarring red, dark-only, used <50% of a
monitor. Replaced wholesale by v5.

## v1 — paper ledger
The original IBM Plex light ledger; formalized, then abandoned for v2.
