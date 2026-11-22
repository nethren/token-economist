import { afterAll, describe, expect, it } from "vitest";
import { calibrated, countBaseTokens } from "../src/core/tokenizer";
import { MODELS } from "../src/core/models";
import type { Band } from "../src/core/types";
import { BLOATED_PROMPT } from "./fixtures";
import { LIVE_FIXTURES } from "./liveFixtures";

/**
 * OPT-IN live accuracy eval (§7 "Cost accuracy" against the provider's own
 * count). Skipped unless ANTHROPIC_API_KEY is set — running it sends the
 * fixture texts (not user data) to Anthropic's free count_tokens endpoint,
 * once per Claude model in the registry per text.
 *
 * Pass criteria (see EVAL.md), reported as separate tests so a band that is
 * wrong can be told apart from a point that can't fit that content type:
 *  - the calibrated band [low, high] contains the provider's true count
 *  - the point estimate is within ±12% of the true count
 */

const KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODELS = MODELS.filter((m) => m.provider === "anthropic");
const CASES = [...LIVE_FIXTURES, { name: "bloated-prompt", text: BLOATED_PROMPT }];

// count_tokens includes a small per-request wrapper overhead beyond the
// raw text; measured empirically at ~7 tokens for a single user message.
const WRAPPER = 7;

async function providerCount(modelId: string, text: string): Promise<number> {
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: text }] }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status} for ${modelId}: ${await res.text()}`);
  const data = await res.json();
  return data.input_tokens as number;
}

const withinBand = (truth: number, b: Band) => truth >= b.low * 0.98 && truth <= b.high * 1.02;
const pointError = (truth: number, b: Band) => Math.abs(b.point - truth) / truth;

describe.skipIf(!KEY)("live accuracy vs Anthropic count_tokens (opt-in)", () => {
  const report: string[] = [];

  // One table at the end: the ratio column is what the band has to match, and
  // comparing it across models shows whether one band per provider still holds.
  afterAll(() => {
    if (report.length === 0) return;
    const header = `${"model".padEnd(20)}${"text".padEnd(17)}${"o200k".padStart(7)}${"Claude".padStart(8)}${"ratio".padStart(7)}${"band".padStart(6)}${"point error".padStart(13)}`;
    // eslint-disable-next-line no-console
    console.log([header, ...report].join("\n"));
  });

  describe.each(CLAUDE_MODELS)("$id", (model) => {
    describe.each(CASES)("$name", ({ name, text }) => {
      const base = countBaseTokens(text);
      const band = calibrated(base, model);

      // Both checks share one request.
      let pending: Promise<number> | undefined;
      const getTruth = () =>
        (pending ??= providerCount(model.id, text).then((count) => {
          const truth = count - WRAPPER;
          report.push(
            model.id.padEnd(20) +
              name.padEnd(17) +
              String(base).padStart(7) +
              String(truth).padStart(8) +
              (truth / base).toFixed(3).padStart(7) +
              (withinBand(truth, band) ? "ok" : "OUT").padStart(6) +
              `${(pointError(truth, band) * 100).toFixed(1)}%`.padStart(13),
          );
          return truth;
        }));

      it("band contains truth", async () => {
        const truth = await getTruth();
        expect(withinBand(truth, band), `${truth} is outside [${band.low}, ${band.high}]`).toBe(true);
      }, 30_000);

      it("point within ±12%", async () => {
        expect(pointError(await getTruth(), band)).toBeLessThanOrEqual(0.12);
      }, 30_000);
    });
  });
});
