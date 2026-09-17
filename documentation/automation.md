# Quality Lab automation

The project embeds no autonomous agent and makes no LLM call. This document
exists because the Quality Lab *evaluates* model output, which reviewers
reasonably expect to be an AI surface. It is not one.

## Trigger and owner

- **Owner:** The user and their own AI tool and provider account.
- **Trigger:** Explicit click to export a check pack, then an explicit click to
  score the replies pasted back.
- **Automatic behavior:** None. Nothing runs in the background, on a schedule,
  or on page load, and no code path in this repository can invoke a model.

## Inputs

- User-entered system prompt.
- Up to five user-entered test samples.
- One selected model, named in the pack so the user knows what to run.
- A 16–1024 reply cap, carried into the pack as an instruction.
- A deterministic check: valid JSON, contains, regex, or manual judgment.
- One reply document, pasted back whole, parsed into per-sample replies.

## Tool/API surface

None. The application has no provider client, no credential, and no outbound
request other than the fixed public price list. The model call happens in the
user's own tool, outside this system's boundary.

## Steering versus hard guardrails

The prompt and samples steer the model in the user's tool. They steer nothing
here. The guardrails that apply locally:

- five-sample cap and a 1024-token hard ceiling on the reply cap;
- pasted text is scored, never evaluated or executed;
- a blank reply stays unreviewed and can never count as a pass or a failure;
- a run is bound to the prompt and cap it was collected against, so editing
  either one retires the evidence instead of silently keeping the stamp;
- demo fixtures carry `source: "demo"` and can never render as a measurement;
- no persistence beyond the session and no logging of prompts or replies.

## Output contract and failure handling

`buildPastedRun()` returns a `MeasureRun`: per-sample verdict, estimated token
counts, estimated cost, `ranAgainst`, and `source`. Token counts for pasted
replies are offline estimates, and the evidence is self-reported — the app
cannot witness that a reply came from the model it is attributed to. Both
limits are stated in the interface and on the exported card.

## Side effects and controls

A clipboard write or a file download. That is the complete list. The panel
previews what running the pack will cost on the user's own account, and the app
charges nothing and calls nothing. Closing the tab is the kill switch.
