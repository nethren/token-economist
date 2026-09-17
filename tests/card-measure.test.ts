import { describe, expect, it } from "vitest";
import { recommend, renderCard, fmtUSD } from "../src/core/card";
import { estimateAll } from "../src/core/estimate";
import { MODELS, getModel } from "../src/core/models";
import { DEFAULT_ASSUMPTIONS, type MeasureRun } from "../src/core/types";
import { previewRunCost, scoreOutput, cacheKey, MAX_SAMPLES_PER_RUN } from "../src/core/measure";
import { BLOATED_PROMPT } from "./fixtures";

const fakeRun = (modelId: string, passes: boolean[]): MeasureRun => ({
  modelId,
  check: { kind: "json" },
  results: passes.map((p) => ({
    input: "x",
    output: p ? "{}" : "not json",
    pass: p,
    inputTokens: 100,
    outputTokens: 50,
    costUSD: 0.001,
    cached: false,
    latencyMs: 500,
  })),
  totalCostUSD: 0.005,
  ranAt: "2026-07-12T00:00:00Z",
  ranAgainst: "fp",
});

describe("recommendation policy", () => {
  const estimates = estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, MODELS);

  it("without quality data: recommends the CHEAPEST usable model as a hypothesis", () => {
    // North star: "cheapest model that is still good enough." With no quality
    // evidence, defaulting to a pricier tier would contradict the product —
    // the recommendation must be the cheapest model, framed as verify-first.
    const cheapest = [...estimates].sort(
      (a, b) => a.costPerMonth.point - b.costPerMonth.point,
    )[0];
    const rec = recommend(estimates, [], "fp");
    expect(rec).not.toBeNull();
    expect(rec!.verified).toBe(false);
    expect(rec!.estimate.model.id).toBe(cheapest.model.id);
    // Evidence-status wording: lowest cost to TEST, with no capability claim.
    expect(rec!.reason).toContain("Lowest estimated cost to test");
    expect(rec!.reason).toContain("Quality has not been tested");
  });

  it("names a concrete step-up so 'if quality matters' has an answer", () => {
    const rec = recommend(estimates, [], "fp");
    expect(rec!.stepUp).not.toBeNull();
    expect(rec!.stepUp!.model.id).not.toBe(rec!.estimate.model.id);
    expect(rec!.reason).toContain(rec!.stepUp!.model.displayName);
  });

  it("builds a shortlist covering distinct tiers, cheapest first", () => {
    const rec = recommend(estimates, [], "fp");
    expect(rec!.shortlist.length).toBeGreaterThanOrEqual(2);
    expect(rec!.shortlist[0].label).toBe("start here");
    expect(rec!.shortlist[0].estimate.model.id).toBe(rec!.estimate.model.id);
    const ids = rec!.shortlist.map((s) => s.estimate.model.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    // shortlist is ordered by cost ascending
    const costs = rec!.shortlist.map((s) => s.estimate.costPerMonth.point);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });

  it("with quality data: picks the CHEAPEST model that passes", () => {
    const cheap = getModel("gpt-5-mini");
    const expensive = getModel("claude-opus-4-8");
    const runs = [fakeRun(expensive.id, [true, true, true]), fakeRun(cheap.id, [true, true, true])];
    const rec = recommend(estimates, runs, "fp");
    expect(rec!.verified).toBe(true);
    expect(rec!.estimate.model.id).toBe(cheap.id);
  });

  it("a cheap model that fails the check is not recommended", () => {
    const runs = [
      fakeRun("gpt-5-mini", [false, false, true]),
      fakeRun("claude-sonnet-5", [true, true, true]),
    ];
    const rec = recommend(estimates, runs, "fp");
    expect(rec!.estimate.model.id).toBe("claude-sonnet-5");
  });
});

describe("cost card", () => {
  it("contains model, monthly cost, assumptions, quality note, and disclaimer", () => {
    const estimates = estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, MODELS);
    const card = renderCard({
      featureName: "Ticket classifier",
      prompt: BLOATED_PROMPT,
      estimates,
      assumptions: DEFAULT_ASSUMPTIONS,
      findings: [],
      runs: [fakeRun("claude-haiku-4-5", [true, true, false])],
      recommendation: recommend(estimates, [], "fp"),
      currentFingerprint: "fp",
      generatedAt: "2026-07-12",
    });
    expect(card).toContain("Recommendation");
    expect(card).toContain("Per month");
    expect(card).toContain("Assumptions behind these numbers");
    // The card reports the same counts the UI does, names the check that ran,
    // and never collapses "reviewed" into "total".
    expect(card).toContain("2/3 passed, 1 failed, 0 unreviewed");
    expect(card).toContain("valid JSON check");
    expect(card).toContain("No model was called to produce this card");
  });
});

describe("Tier-2 guardrails (no network in these tests)", () => {
  it("cost preview is computed before any spend and uses the high bound", () => {
    const m = getModel("claude-haiku-4-5");
    const { totalUSD } = previewRunCost(m, BLOATED_PROMPT, ["ticket one", "ticket two"], 500);
    expect(totalUSD).toBeGreaterThan(0);
    expect(totalUSD).toBeLessThan(0.1); // sanity: a handful of samples is cents
  });

  it("sample count is hard-bounded", () => {
    const m = getModel("claude-haiku-4-5");
    const many = Array.from({ length: 50 }, (_, i) => `sample ${i}`);
    const capped = previewRunCost(m, "short prompt", many, 100);
    const atMax = previewRunCost(m, "short prompt", many.slice(0, MAX_SAMPLES_PER_RUN), 100);
    expect(capped.totalUSD).toBeCloseTo(atMax.totalUSD, 10);
  });

  it("scoring: contains / regex / json checks behave", () => {
    expect(scoreOutput("Category: BILLING", { kind: "contains", value: "billing" })).toBe(true);
    expect(scoreOutput("Category: BILLING", { kind: "contains", value: "billing", caseSensitive: true })).toBe(false);
    expect(scoreOutput("abc-123", { kind: "regex", value: "\\d{3}" })).toBe(true);
    expect(scoreOutput('{"a": 1}', { kind: "json" })).toBe(true);
    expect(scoreOutput('```json\n{"a": 1}\n```', { kind: "json" })).toBe(true);
    expect(scoreOutput("nope", { kind: "json" })).toBe(false);
    expect(scoreOutput("anything", { kind: "manual" })).toBe(null);
  });

  it("cache keys are stable and input-sensitive", () => {
    const k1 = cacheKey("m", "p", "s", 100);
    expect(cacheKey("m", "p", "s", 100)).toBe(k1);
    expect(cacheKey("m", "p", "s2", 100)).not.toBe(k1);
  });

  it("fmtUSD renders sensible magnitudes", () => {
    expect(fmtUSD(12345)).toBe("$12,345");
    expect(fmtUSD(3.456)).toBe("$3.46");
    expect(fmtUSD(0.00042)).toBe("$0.00042");
  });
});
