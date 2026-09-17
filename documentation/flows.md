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

**Actor:** Any user, in any build
**Preconditions:** A prompt, a chosen model, 1–5 samples, and a pass condition.
No credential and no local service.
**Outcome:** A scored `MeasureRun` labelled `source: "byo"`, bound to the
prompt and reply cap it was collected against.

1. The user picks the model, samples, pass condition, and reply cap. The panel
   shows what running it will cost on the user's own account.
2. On an explicit click, `renderCheckPack()` produces a Markdown brief carrying
   the prompt, the samples, the pass condition, the cap, and the configuration
   fingerprint. The user copies or downloads it.
3. The user runs the pack in whatever AI tool they already pay for. That
   exchange is between them and their provider; this app is not in it.
4. The user pastes each reply into the matching box.
5. `buildPastedRun()` scores each reply offline with `scoreOutput`, estimates
   tokens with the bundled tokenizer, and stamps `ranAgainst` and `source`.

**Trust crossings:** Browser → check pack (only when the user moves it) →
user's own AI tool → pasted text back into the browser.
**Side effects:** Clipboard write or a file download. No billing, no request.
**Failure behavior:** A blank box stays unreviewed rather than counting as a
failure, so an unfinished paste can never certify a model. A clipboard block
falls back to the download button. Editing the prompt or the cap invalidates
the run through the fingerprint rather than silently keeping the stamp.

**Known limitation, stated in the product:** the app cannot witness that a
pasted reply came from the model it is attributed to, and its token counts for
pasted text are estimates. The run is labelled self-reported everywhere it is
shown, including on the exported card.
