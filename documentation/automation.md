# Quality Lab automation

The project does not embed an autonomous agent. Its only LLM workflow is the
user-triggered Quality Lab, documented here because it reaches paid external
APIs and evaluates model output.

## Trigger and owner

- **Owner:** The local user and their provider accounts.
- **Trigger:** Explicit click on the cost-labelled “Run check” button.
- **Automatic behavior:** None. Service-status detection is automatic, but it
  cannot invoke a model.

## Inputs

- User-entered system prompt.
- Up to five user-entered test samples.
- Up to two selected models.
- A 16–1024 output-token cap.
- A deterministic check: valid JSON, contains, regex, or manual judgment.

## Tool/API surface

The service may call exactly these API families:

- Anthropic Messages
- OpenAI Chat Completions
- Google Gemini `generateContent`

Provider and model identifiers must match the server allowlist. The request
cannot supply an upstream URL, headers, API key, or arbitrary provider
options.

## Steering versus hard guardrails

The user’s prompt and sample steer model behavior. They do not control the
service. Hard guardrails outside the prompt enforce:

- loopback-only listener and fixed Vite port;
- ephemeral Vite-to-service token;
- local-origin/host validation;
- JSON and 64 KiB request-body limit;
- provider/model allowlist;
- prompt and sample character limits;
- output-token cap and provider timeout;
- no automatic retries;
- no server-side persistence or logging of prompts and outputs.

## Output contract and failure handling

The service returns `text`, `inputTokens`, and `outputTokens`. The
browser validates those types, calculates cost from the active price table,
and evaluates the configured check. Provider or network errors surface to the
user and do not produce a passing result.

## Side effects and controls

The provider call and its billing are the only external side effects. The UI
previews a worst-case estimate before enabling the action, caps each run, and
caches completed samples to avoid accidental repeat spend. Stopping the local
launcher is the kill switch. There is no background execution, scheduled
retry, or model tool-calling.
