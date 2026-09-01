# Operational flows

Only journeys that cross a privacy, network, or paid-usage boundary are
included here.

## 1. Offline estimate and recommendation

**Actor:** Browser user
**Precondition:** None
**Outcome:** A deterministic estimate, lint findings, recommendation, and
Markdown cost card.

1. The user enters a prompt and scale assumptions.
2. React passes those values to pure modules under `src/core/`.
3. The tokenizer counts locally; the estimator calculates cost bands; the
   linter proposes deterministic changes; the card renderer produces text.
4. No provider call, server request, storage write, or paid side effect is
   required.

**Deny/failure behavior:** Invalid or incomplete assumptions are normalized or
called out in notes. No network fallback is allowed on this path.

## 2. Public price refresh

**Actor:** Browser user; automatic refresh also runs once on application load
**Precondition:** The six-hour cache is absent or stale
**Outcome:** Known model prices are updated in memory and cached locally.

1. The browser sends a GET to the fixed OpenRouter model-list endpoint.
2. The response is mapped only for hard-coded model slugs.
3. Input and output prices must be finite positive numbers.
4. Missing or malformed rows retain the bundled snapshot.
5. A successful subset is cached in `localStorage` with its fetch time.

**Trust crossing:** Browser → public third-party endpoint.
**Side effects:** Network GET and local cache write.
**Privacy rule:** The request must never include the prompt, feature name,
assumptions, Quality Lab samples, or provider credentials.
**Failure behavior:** Use a valid prior cache; otherwise keep the bundled
snapshot and disclose the fallback in the UI.

## 3. Copy a share link

**Actor:** Browser user
**Precondition:** The user explicitly clicks “Copy share link”
**Outcome:** A URL that reconstructs the decision is placed on the clipboard.

1. The app serializes feature name, prompt, assumptions, and reference model.
2. UTF-8 JSON is encoded as URL-safe base64 in the URL fragment.
3. The current history entry is updated and the URL is copied.
4. A recipient’s browser decodes recognized fields and defaults invalid ones.

**Trust crossing:** The prompt leaves the current browser only when the user
shares the copied link. URL fragments are not sent to the web server.
**Side effects:** Clipboard write and browser-history update.
**Failure behavior:** Garbage or unsupported versions decode to no restored
state; malformed fields fall back to defaults.

## 4. Run a Quality Lab check

**Actor:** Local browser user
**Preconditions:** The user started `npm run dev:quality`, configured at
least one provider key, selected 1–2 models and 1–5 samples, reviewed the
worst-case cost, and clicked the paid action
**Outcome:** Per-sample output, token usage, cost, latency, and a pass/fail or
manual verdict.

1. The launcher generates an ephemeral proxy token and starts Vite plus the
   loopback service.
2. The browser checks service status through Vite; it receives provider names,
   never key values.
3. After the explicit click, the browser sends one completion request per
   uncached sample.
4. Vite adds the ephemeral token. The local service rejects direct,
   foreign-origin, missing-token, non-JSON, oversized, unknown-model, and
   over-cap requests.
5. The service reads the selected provider key from process environment or
   ignored `.env.local` and calls a fixed HTTPS endpoint.
6. The browser scores the returned text against the user’s selected rule and
   caches the result in `localStorage`.

**Trust crossings:** Browser → Vite → loopback service → paid provider.
**Side effects:** Provider billing, prompt disclosure to the chosen provider,
and local result-cache writes.
**Failure behavior:** Fail closed before the provider call when local
authorization or request validation fails. Provider/network errors return a
bounded error message and do not silently mark a sample as passed.
