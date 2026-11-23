import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estimateModel, estimateAll } from "../src/core/estimate";
import { MODELS, parseRegistry, pricesOn, pricingNotes } from "../src/core/models";
import { applyLivePrices } from "../src/core/livePrices";
import { THINKING_EXCLUDED, recommend, renderCard } from "../src/core/card";
import { DEFAULT_ASSUMPTIONS } from "../src/core/types";
import { BLOATED_PROMPT } from "./fixtures";

/**
 * D39: prices the way providers bill them — long prompts at their higher
 * rate, announced price changes from their date — and totals that say what
 * they leave out.
 */

const withLong = MODELS.find((m) => m.longContext !== undefined)!;
const withSchedule = MODELS.find((m) => m.scheduledPrice !== undefined)!;
const A = { ...DEFAULT_ASSUMPTIONS, requestsPerMonth: 1, retryRate: 0, expectedOutputTokens: 500 };

/** Hand-computed USD for one request at a given input size and rate card. */
const requestCost = (inputTokens: number, out: number, rate: { inputPerMTok: number; outputPerMTok: number }) =>
  (inputTokens * rate.inputPerMTok + out * rate.outputPerMTok) / 1e6;

describe("long-prompt pricing (per request, as billed)", () => {
  const l = withLong.longContext!;

  it("a request over the threshold is billed entirely at the long rate; one under it is not", () => {
    for (const [user, rate] of [
      [l.aboveInputTokens + 50_000, l],
      [Math.floor(l.aboveInputTokens / 2), withLong],
    ] as const) {
      const e = estimateModel("Summarize.", { ...A, avgUserInputTokens: user }, withLong);
      const input = e.promptTokens.point + user;
      expect(e.costPerConversation.point).toBeCloseTo(requestCost(input, 500, rate), 12);
    }
  });

  it("the threshold is exclusive: exactly at it is still the standard rate", () => {
    const probe = estimateModel("Summarize.", { ...A, avgUserInputTokens: 0 }, withLong);
    const user = l.aboveInputTokens - probe.promptTokens.point;
    const e = estimateModel("Summarize.", { ...A, avgUserInputTokens: user }, withLong);
    expect(e.costPerConversation.point).toBeCloseTo(requestCost(l.aboveInputTokens, 500, withLong), 12);
  });

  it("in a conversation, only the turns whose input crosses the threshold pay the long rate", () => {
    const U = Math.ceil(l.aboveInputTokens * 0.6); // turn 1 under, turns 2 and 3 over
    const a = { ...A, turnsPerConversation: 3, avgUserInputTokens: U };
    const e = estimateModel("Summarize.", a, withLong);
    const P = e.promptTokens.point;
    const turnInput = (t: number) => P + t * U + (t - 1) * 500;
    expect(turnInput(1)).toBeLessThanOrEqual(l.aboveInputTokens);
    expect(turnInput(2)).toBeGreaterThan(l.aboveInputTokens);
    const expected =
      requestCost(turnInput(1), 500, withLong) + requestCost(turnInput(2), 500, l) + requestCost(turnInput(3), 500, l);
    expect(e.costPerConversation.point).toBeCloseTo(expected, 12);
    expect(e.assumptionNotes.join(" ")).toContain(`exceed ${l.aboveInputTokens.toLocaleString("en-US")} input tokens`);
  });

  it("models without a long rate, and short prompts, are priced exactly as before", () => {
    const flat = MODELS.find((m) => m.longContext === undefined)!;
    const e = estimateModel("Summarize.", { ...A, avgUserInputTokens: 400_000 }, flat);
    expect(e.costPerConversation.point).toBeCloseTo(requestCost(e.promptTokens.point + 400_000, 500, flat), 12);
    expect(estimateModel(BLOATED_PROMPT, A, withLong).assumptionNotes.join(" ")).not.toContain("input tokens;");
  });
});

describe("announced price changes", () => {
  const s = withSchedule.scheduledPrice!;
  const dayBefore = new Date(Date.parse(s.from) - 86_400_000).toISOString().slice(0, 10);

  it("apply from their date, not before", () => {
    const before = pricesOn(MODELS, dayBefore).find((m) => m.id === withSchedule.id)!;
    expect(before.inputPerMTok).toBe(withSchedule.inputPerMTok);
    expect(pricingNotes(before, dayBefore).join(" ")).toContain(`from ${s.from}`);

    const after = pricesOn(MODELS, s.from).find((m) => m.id === withSchedule.id)!;
    expect(after).toMatchObject({ inputPerMTok: s.inputPerMTok, outputPerMTok: s.outputPerMTok, pricesAsOf: s.from });
    expect(after.scheduledPrice).toBeUndefined();
    expect(pricingNotes(after, s.from).join(" ")).not.toContain(`from ${s.from}`);
  });

  it("once applied, the public list agreeing with the new price counts as a match", () => {
    const priced = pricesOn(MODELS, s.from);
    const row = {
      id: withSchedule.openrouterSlug,
      pricing: { prompt: String(s.inputPerMTok / 1e6), completion: String(s.outputPerMTok / 1e6) },
    };
    const r = applyLivePrices(priced, { data: [row] }, s.from);
    expect(r.matched).toEqual([withSchedule.displayName]);
  });

  it("long rates are shown beside the price", () => {
    expect(pricingNotes(withLong, "2026-11-23").join(" ")).toContain(
      `when input is over ${Math.round(withLong.longContext!.aboveInputTokens / 1000)}K tokens`,
    );
  });

  it("the registry rejects malformed price fields", () => {
    const shipped = JSON.parse(readFileSync(new URL("../src/core/models.json", import.meta.url), "utf8"));
    const bad = (edit: (m: Record<string, unknown>) => void) => {
      const r = structuredClone(shipped);
      edit(r.models[0]);
      return () => parseRegistry(r);
    };
    expect(bad((m) => (m.longContext = { aboveInputTokens: 0, inputPerMTok: 1, outputPerMTok: 2 }))).toThrow(/aboveInputTokens/);
    expect(bad((m) => (m.longContext = { aboveInputTokens: 1000, inputPerMTok: -1, outputPerMTok: 2 }))).toThrow(/longContext/);
    expect(bad((m) => (m.scheduledPrice = { from: "Dec 1", inputPerMTok: 1, outputPerMTok: 2 }))).toThrow(/scheduledPrice.from/);
  });
});

describe("totals say when they leave thinking out", () => {
  const card = (reasoningTokensPerTurn: number) => {
    const a = { ...DEFAULT_ASSUMPTIONS, reasoningTokensPerTurn };
    const estimates = estimateAll(BLOATED_PROMPT, a, MODELS);
    return renderCard({
      featureName: "X",
      prompt: BLOATED_PROMPT,
      estimates,
      assumptions: a,
      findings: [],
      runs: [],
      recommendation: recommend(estimates, [], "fp"),
      currentFingerprint: "fp",
      generatedAt: "2026-11-23",
    });
  };

  it("the card carries the caveat at 0 thinking tokens and drops it once they are set", () => {
    expect(card(0)).toContain(THINKING_EXCLUDED);
    expect(card(500)).not.toContain(THINKING_EXCLUDED);
    expect(card(500)).toContain("500 hidden reasoning tokens/turn");
  });
});
