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
- Never accept provider API keys in React or expose them through Vite client
  variables, status responses, logs, storage, or committed files.
- Real model calls must remain explicit, cost-previewed, bounded, cached, and
  routed through the loopback service.
- Keep provider endpoints fixed and model IDs allowlisted server-side.
- A static/public build must remain unable to make paid calls.
- Price refresh may fetch only the public model list and must never include
  prompts or Quality Lab data.
- Share links intentionally contain the prompt. Preserve the explicit user
  action and URL-fragment transport.
- `DECISIONS.md` is append-only. Add a new decision; do not rewrite history.

## Where to work

- `src/core/`: pure product logic and browser boundary client.
- `src/components/`, `src/App.tsx`: interface.
- `server/`: loopback-only paid provider adapters.
- `tests/`: deterministic suite; live provider checks stay opt-in.
- `documentation/`: architecture, boundaries, and shipping evidence.

## Required verification

Run all three before handing off:

```sh
npm run lint
npm test
npm run build
```

Do not run `npm run eval:live` or make real Quality Lab calls without
explicit authorization and configured throwaway/test inputs.

## Current non-blocking follow-ups

- Static deployments still need final-domain SEO/social metadata.
- The production bundle is large because the offline tokenizer data ships to
  the browser; measure before choosing a loading/code-splitting strategy.
- Default tests do not contact providers. Live calibration remains guarded.
