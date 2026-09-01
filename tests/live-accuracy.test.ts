import { describe, expect, it } from "vitest";
import { calibrated, countBaseTokens } from "../src/core/tokenizer";
import { getModel } from "../src/core/models";
import { BLOATED_PROMPT, TOKEN_FIXTURES } from "./fixtures";

/**
 * OPT-IN live accuracy eval (§7 "Cost accuracy" against the provider's own
 * count). Skipped unless ANTHROPIC_API_KEY is set — running it sends the
 * fixture texts (not user data) to Anthropic's free count_tokens endpoint.
 *
 * Pass criteria (see EVAL.md):
 *  - the calibrated band [low, high] contains the provider's true count
 *  - the point estimate is within ±12% of the true count
 */

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL_ID = "claude-haiku-4-5";

async function providerCount(text: string): Promise<number> {
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL_ID, messages: [{ role: "user", content: text }] }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.input_tokens as number;
}

describe.skipIf(!KEY)("live accuracy vs Anthropic count_tokens (opt-in)", () => {
  const model = getModel(MODEL_ID);
  // count_tokens includes a small per-request wrapper overhead beyond the
  // raw text; measured empirically at ~7 tokens for a single user message.
  const WRAPPER = 7;

  const cases = [
    ...TOKEN_FIXTURES.filter((f) => f.text.length > 50),
    { name: "bloated-prompt", text: BLOATED_PROMPT },
  ];

  for (const c of cases) {
    it(`band contains truth and point within ±12%: ${c.name}`, async () => {
      const truth = (await providerCount(c.text)) - WRAPPER;
      const band = calibrated(countBaseTokens(c.text), model);
      const pctErr = Math.abs(band.point - truth) / truth;
      // eslint-disable-next-line no-console
      console.log(
        `${c.name}: truth=${truth} band=[${band.low}, ${band.point}, ${band.high}] err=${(pctErr * 100).toFixed(1)}%`,
      );
      expect(truth).toBeGreaterThanOrEqual(band.low * 0.98);
      expect(truth).toBeLessThanOrEqual(band.high * 1.02);
      expect(pctErr).toBeLessThanOrEqual(0.12);
    }, 30_000);
  }
});
