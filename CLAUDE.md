# Token Economist — agent guide

## Purpose

This repository is a portfolio-quality, design-time AI cost estimator. The
trust anchor is a deterministic offline estimate; quality is observed only
through an explicit, bounded local run.

Read `README.md`, `PRODUCT.md`, `DECISIONS.md`, and
`documentation/architecture.md` before changing behavior.

## Non-negotiable boundaries

- Keep estimate, lint, recommendation, and card generation deterministic and
  usable with networking disabled.
- The app must never call a model provider and must never hold a provider API
  key — not in React, not in Vite client variables, not in a helper process,
  not in storage, logs, or committed files. There is no key to protect because
  there is no key.
- Quality evidence arrives by check pack: the app exports the brief, the user
  runs it in their own AI tool, and pasted replies are scored locally. Keep
  scoring offline and deterministic.
- Label provenance. Every run carries `source`; demo fixtures must never render
  as a measurement, and the card must state that evidence is self-reported.
- A run is valid only for the prompt and reply cap it was collected against
  (`ranAgainst`). A mismatch is stale — never passed, failed, or missing.
- Price refresh may fetch only the public model list and must never include
  prompts or Quality Lab data.
- Share links intentionally contain the prompt. Preserve the explicit user
  action and URL-fragment transport.
- `DECISIONS.md` is append-only. Add a new decision; do not rewrite history.

## Where to work

- `src/core/`: pure product logic — estimation, lint, card, check pack, scoring.
- `src/components/`, `src/App.tsx`: interface.
- `tests/`: deterministic suite; live provider checks stay opt-in.
- `documentation/`: architecture, boundaries, and shipping evidence.

## Required verification

Run all three before handing off:

```sh
npm run lint
npm test
npm run build
```

Do not run `npm run eval:live` without explicit authorization and configured
throwaway/test inputs. It is the only path in the repository that contacts a
provider, and it hits a free token-counting endpoint, not a completion.

## Current non-blocking follow-ups

- Static deployments still need final-domain SEO/social metadata.
- The production bundle is large because the offline tokenizer data ships to
  the browser; measure before choosing a loading/code-splitting strategy.
- Default tests do not contact providers. Live calibration remains guarded.
