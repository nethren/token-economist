import { describe, expect, it } from "vitest";
import { recommend, renderCard, fmtUSD } from "../src/core/card";
import { estimateAll } from "../src/core/estimate";
import { MODELS, getModel } from "../src/core/models";
import { DEFAULT_ASSUMPTIONS, type MeasureRun } from "../src/core/types";
import {
  buildPastedRun,
  previewRunCost,
  runFingerprint,
  scoreOutput,
  MAX_SAMPLES_PER_RUN,
} from "../src/core/measure";
import { renderCheckPack } from "../src/core/pack";
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
  source: "byo",
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

  it("attributes quality evidence to the author rather than to the tool", () => {
    const estimates = estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, MODELS);
    const card = renderCard({
      featureName: "Ticket classifier",
      prompt: BLOATED_PROMPT,
      estimates,
      assumptions: DEFAULT_ASSUMPTIONS,
      findings: [],
      runs: [fakeRun("claude-haiku-4-5", [true, true, true])],
      recommendation: recommend(estimates, [], "fp"),
      currentFingerprint: "fp",
      generatedAt: "2026-07-12",
    });
    expect(card).toContain("replies supplied by the author");
    expect(card).toContain("Quality evidence is self-reported");
  });

  it("marks demo data as demo data, so it can never pass as a measurement", () => {
    const estimates = estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, MODELS);
    const demo: MeasureRun = { ...fakeRun("claude-haiku-4-5", [true, true, true]), source: "demo" };
    const card = renderCard({
      featureName: "Ticket classifier",
      prompt: BLOATED_PROMPT,
      estimates,
      assumptions: DEFAULT_ASSUMPTIONS,
      findings: [],
      runs: [demo],
      recommendation: recommend(estimates, [demo], "fp"),
      currentFingerprint: "fp",
      generatedAt: "2026-07-12",
    });
    expect(card).toContain("demo data, not a measurement");
    // The self-reported footnote would contradict the line above it.
    expect(card).toContain("This card carries demo data only");
    expect(card).not.toContain("Quality evidence is self-reported");
  });
});

/**
 * Quality evidence is brought by the user: the app exports a check pack, the
 * user runs it in their own AI tool, and the replies come back to be scored
 * offline. Nothing here may call a provider or imply the tool did.
 */
describe("bring-your-own-AI evidence", () => {
  const m = getModel("claude-haiku-4-5");
  const samples = ["ticket one", "ticket two", "ticket three"];
  const build = (outputs: string[], maxTokens = 300) =>
    buildPastedRun({
      model: m,
      prompt: BLOATED_PROMPT,
      samples,
      outputs,
      check: { kind: "json" },
      maxTokens,
    });

  it("scores pasted replies locally and labels the evidence as user-supplied", () => {
    const run = build(['{"a":1}', "not json", ""]);
    expect(run.source).toBe("byo");
    expect(run.results.map((r) => r.pass)).toEqual([true, false, null]);
  });

  it("treats a blank box as missing evidence, not as a failure", () => {
    const run = build(["", "", ""]);
    expect(run.results.every((r) => r.pass === null)).toBe(true);
    expect(run.results.every((r) => r.outputTokens === 0)).toBe(true);
    expect(run.totalCostUSD).toBe(0);
  });

  it("binds the run to the prompt and reply cap it was collected against", () => {
    expect(build(["{}", "{}", "{}"]).ranAgainst).toBe(runFingerprint(BLOATED_PROMPT, 300));
    expect(build(["{}", "{}", "{}"], 400).ranAgainst).toBe(runFingerprint(BLOATED_PROMPT, 400));
  });

  it("honours the sample cap however many are pasted in", () => {
    const many = Array.from({ length: 20 }, (_, i) => `sample ${i}`);
    const run = buildPastedRun({
      model: m,
      prompt: "short prompt",
      samples: many,
      outputs: many.map(() => "{}"),
      check: { kind: "json" },
      maxTokens: 300,
    });
    expect(run.results).toHaveLength(MAX_SAMPLES_PER_RUN);
  });
});

describe("check pack", () => {
  const m = getModel("claude-haiku-4-5");
  const pack = renderCheckPack({
    featureName: "Ticket classifier",
    prompt: BLOATED_PROMPT,
    model: m,
    samples: ["ticket one", "ticket two"],
    check: { kind: "json" },
    maxTokens: 300,
  });

  it("carries everything needed to reproduce the check elsewhere", () => {
    expect(pack).toContain(m.displayName);
    expect(pack).toContain("ticket one");
    expect(pack).toContain("ticket two");
    expect(pack).toContain("valid JSON");
    expect(pack).toContain("300 tokens");
    expect(pack).toContain(BLOATED_PROMPT.trim().slice(0, 40));
  });

  it("is bound to the configuration it was generated from", () => {
    expect(pack).toContain(runFingerprint(BLOATED_PROMPT, 300));
  });

  it("states that the cost lands on the user's own account", () => {
    expect(pack).toContain("on your account");
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

  it("fmtUSD renders sensible magnitudes", () => {
    expect(fmtUSD(12345)).toBe("$12,345");
    expect(fmtUSD(3.456)).toBe("$3.46");
    expect(fmtUSD(0.00042)).toBe("$0.00042");
  });
});
