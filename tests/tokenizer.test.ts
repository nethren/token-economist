import { describe, expect, it } from "vitest";
import { countBaseTokens, calibrated, tokensFromWords } from "../src/core/tokenizer";
import { TOKEN_FIXTURES } from "./fixtures";
import { pick } from "./models";

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
    const m = pick("anthropic", "economy");
    const b = calibrated(1000, m);
    expect(b.low).toBeLessThanOrEqual(b.point);
    expect(b.point).toBeLessThanOrEqual(b.high);
    // Anthropic tokenizes prose to MORE tokens than o200k — the band must
    // sit above 1.0 or the estimate would systematically undercount.
    expect(b.low).toBeGreaterThanOrEqual(1000);
  });

  it("the Anthropic band covers the measured Claude/o200k ratios (D36)", () => {
    // Anthropic's own count_tokens over 30 real-world texts (prose, code in 11
    // languages, JSON, logs, diffs, SQL, CJK), minus the 7-token message
    // wrapper, divided by this app's o200k count of the same text. Source:
    // williamliu-ai/token-count-compare, 2026-10-12 run, claude-opus-5-5.
    const MEASURED = { min: 1.345, median: 1.564, max: 1.801, corpus: 1.545 };
    const c = pick("anthropic", "economy").calibration;
    expect(c.low).toBeLessThanOrEqual(MEASURED.min);
    expect(c.high).toBeGreaterThanOrEqual(MEASURED.max);
    // The point holds EVAL.md's ±12% on the typical text and the corpus as a whole.
    for (const r of [MEASURED.median, MEASURED.corpus]) {
      expect(Math.abs(c.point - r) / r).toBeLessThanOrEqual(0.12);
    }
  });

  it("words→tokens helper is a documented 0.75 words/token", () => {
    expect(tokensFromWords(75)).toBe(100);
  });
});
