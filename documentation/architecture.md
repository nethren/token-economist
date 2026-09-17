# Architecture

## Product overview

Token Economist is a single-user, design-time calculator for estimating the
token cost of an AI feature before implementation. The default application is
a static React client: prompts, assumptions, estimates, lint findings, and
recommendations remain in the browser.

An optional Quality Lab exports a check pack the user runs in their own AI
tool, then scores the replies they paste back. The application itself never
calls a model and holds no provider credential.

## Stack

| Layer | Implementation |
|---|---|
| UI | React 19, TypeScript, Vite |
| Estimator | Pure TypeScript under `src/core/` |
| Tokenizer | Bundled `gpt-tokenizer` o200k data |
| Quality evidence | Exported Markdown check pack; replies scored offline |
| Tests | Vitest |
| Lint | Oxlint |
| Persistence | Browser `localStorage` only |

There is no database, account system, cookie session, telemetry SDK, hosted
API, email system, scheduled work, or server-side rendering.

## Runtime mode

There is one mode. `npm run dev`, `npm run build`, and a static deployment all
provide the same complete product: the offline estimator, linter,
recommendation, cost card, share-link codec, and Quality Lab. Nothing is
disabled in a hosted build, because nothing in the app calls a model provider.

The browser may fetch the fixed public OpenRouter model-list endpoint to
refresh price inputs. That request carries no prompt or user-entered content.
It is the only outbound request the application makes.

### How quality evidence gets in

The Quality Lab renders a **check pack** (`src/core/pack.ts`): a Markdown brief
carrying the prompt, the samples, the pass condition, the reply cap, and the
configuration fingerprint. The user copies or downloads it, runs it in an AI
tool they already pay for, and pastes the replies back. `buildPastedRun()`
scores them offline and returns a `MeasureRun` tagged `source: "byo"`.

The app therefore cannot witness that a reply came from the model it is
attributed to, and token counts for pasted replies are offline estimates rather
than provider-reported usage. Both facts are stated in the interface and on the
card rather than papered over.

## Trust boundaries

| Boundary | Data crossing | Enforcement |
|---|---|---|
| User input → estimator | Prompt and numeric assumptions | Pure local functions; no network dependency |
| Browser → OpenRouter | No user content; fixed model-list GET | Hard-coded HTTPS URL; numeric price validation; six-hour local cache |
| Browser → share link | Feature name, prompt, assumptions, model ID | Explicit copy action; URL-safe JSON in the fragment; tolerant decoder |
| Browser → check pack | Prompt, samples, check, reply cap, fingerprint | Explicit copy or download action; plain Markdown; leaves the app only when the user moves it |
| User's AI tool → browser | Pasted replies | Treated as untrusted text: scored, never executed; blank stays unreviewed |
| Quality result → app state | Sample, reply, estimated tokens, verdict, source | In-memory for the session; bound to `ranAgainst` so it expires with its configuration |

There is no browser-to-provider path, no server process, and no credential
anywhere in the system.

## Authentication and identity

There are no user accounts or roles. The application assumes one local user
operating their own browser. It holds no provider credential of any kind, so
there is nothing to authenticate and nothing to leak.

## Known risks and assumptions

- The live price source is a third-party aggregator, not an official provider
  billing endpoint. Values are type-checked and missing values fall back to
  bundled snapshots, but users must still verify prices before committing
  budget.
- A copied share link intentionally gives its recipient the prompt embedded
  in the URL fragment. The fragment is not sent in HTTP requests, but it can
  remain in browser history and any place the user pastes it.
- An exported check pack contains the prompt and the samples in plain text.
  It leaves the app only when the user copies or downloads it, and it then
  travels wherever they paste it, including into a third-party AI tool.
- Quality evidence is self-reported. The app scores what the user pastes and
  cannot confirm which model produced it, so every run is labelled with its
  source rather than presented as a first-party measurement.
- Bundled model prices and model identifiers can become stale. The UI dates
  price data and falls back explicitly when live refresh is unavailable.

## Related documents

- [Flows](flows.md)
- [Permissions](permissions.md)
- [Variables and secrets](variables.md)
- [Quality Lab automation](automation.md)
- [SEO and public routes](seo.md)
- [Test coverage](tests.md)
- [Shipping packet](shipping-packet.md)

No email capability exists, so there is no `emails.md`. No scheduled or
background work exists, so there is no `cron.md`.
