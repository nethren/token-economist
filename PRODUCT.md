# Product

## Register

product

## Users

Non-technical AI product managers and founders deciding — before any code is
written — whether an AI feature's unit economics work and which model to
ship. They arrive with a draft prompt and rough scale numbers, in the middle
of writing a ticket or PRD. Secondary: the engineers who receive that ticket
and want the assumptions stated.

## Product Purpose

A design-time pre-flight check: paste the prompt, state the scale, get an
honest cost range across model tiers, concrete quantified ways to make it
cheaper, and (opt-in) evidence from a check you run in your own AI tool that
the cheap model is good enough. Success = a PM goes from pasted prompt to a
defensible model-and-cost decision they trust enough to put in the ticket,
in under five minutes.

## Brand Personality

Honest ledger-keeper. Calm, precise, plain-spoken. Every number carries its
uncertainty (ranges, not quotes), its date, and its source. The tool never
performs confidence it hasn't earned — "UNVERIFIED" is a feature, not an
apology. Tokens are always translated into words, pages, and dollars.

## Anti-references

- Generic SaaS dashboard slop: hero metrics, gradient accents, icon-card grids.
- Model leaderboards and benchmark theater — quality here is measured against
  the user's own check, never a global score.
- False precision: single-point cost figures, "exact" token counts for
  providers whose tokenizers we can only estimate.
- Anything that hides spend. The tool spends nothing at all; where a check
  would cost money on the user's own account, it says so before they run it.
- Borrowed credibility: evidence the user supplied is labelled as theirs, and
  demo data is labelled as demo data.

## Design Principles

1. **Honesty made visible.** Uncertainty is rendered, not footnoted: band
   bars for ranges, stamps for verification state, dates on prices.
2. **The journey is the layout.** Paste → scale → verify → decide; the
   interface should read in the order the decision is made.
3. **Translate for the PM.** Every token figure gets a words/pages
   equivalent; every finding gets a $/month figure; jargon lives in tooltips.
4. **Determinism is the trust anchor.** Same input, same numbers — and the
   free path never touches the network with the prompt.
5. **One decision per screen.** Everything funnels into the stamped
   recommendation and the copy-ready cost card.

## Accessibility & Inclusion

Keyboard-reachable tooltips and controls, visible focus states, reduced
motion respected, verified responsive to 390px, contrast measured in both
themes (every text pair ≥4.5:1, input borders ≥3:1), nothing smaller than
12px.
