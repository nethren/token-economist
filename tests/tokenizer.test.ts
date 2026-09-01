import { describe, expect, it } from "vitest";
import { countBaseTokens, calibrated, tokensFromWords } from "../src/core/tokenizer";
import { getModel } from "../src/core/models";
import { TOKEN_FIXTURES } from "./fixtures";

/**
 * §7 "Cost accuracy": the same input must always yield the same count, and
 * counts must match the pinned reference values (o200k BPE — identical data
 * to OpenAI's published tokenizer, so OpenAI-model counts are exact by
 * construction). Anthropic/Google accuracy is covered by the opt-in live
 * eval (tests/live-accuracy.test.ts) since no offline ground truth exists.
 */

// Pinned from gpt-tokenizer o200k_base, 2026-07-12. If these ever change,
// the tokenizer dependency changed underneath us — that must be a conscious
// decision, not a silent drift.
const PINNED: Record<string, number> = {
  empty: 0,
  hello: 2,
  prose: 20,
  code: 19,
  unicode: 32,
  json: 25,
};

describe("offline tokenizer", () => {
  it("matches pinned reference counts exactly", () => {
    for (const f of TOKEN_FIXTURES) {
      expect(countBaseTokens(f.text), f.name).toBe(PINNED[f.name]);
    }
  });

  it("is deterministic across repeated calls", () => {
    for (const f of TOKEN_FIXTURES) {
      expect(countBaseTokens(f.text)).toBe(countBaseTokens(f.text));
    }
  });

  it("calibration bands are ordered and conservative for Anthropic", () => {
    const m = getModel("claude-haiku-4-5");
    const b = calibrated(1000, m);
    expect(b.low).toBeLessThanOrEqual(b.point);
    expect(b.point).toBeLessThanOrEqual(b.high);
    // Anthropic tokenizes prose to MORE tokens than o200k — the band must
    // sit above 1.0 or the estimate would systematically undercount.
    expect(b.low).toBeGreaterThanOrEqual(1000);
  });

  it("words→tokens helper is a documented 0.75 words/token", () => {
    expect(tokensFromWords(75)).toBe(100);
  });
});
