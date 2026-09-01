import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateAll, estimateModel } from "../src/core/estimate";
import { lintPrompt } from "../src/core/lint";
import { renderCard, recommend } from "../src/core/card";
import { MODELS, getModel } from "../src/core/models";
import { DEFAULT_ASSUMPTIONS } from "../src/core/types";
import { BLOATED_PROMPT } from "./fixtures";

/**
 * §7 "Determinism honoured": the cost + lint + card path makes ZERO calls to
 * priced models — demonstrated by replacing fetch (and XHR) with a landmine —
 * and the same input always yields the same estimate.
 */

describe("zero network on the free path", () => {
  let fetchCalls = 0;

  beforeEach(() => {
    fetchCalls = 0;
    vi.stubGlobal("fetch", () => {
      fetchCalls++;
      throw new Error("NETWORK CALL ON THE FREE PATH — determinism violated");
    });
    vi.stubGlobal("XMLHttpRequest", class {
      constructor() {
        fetchCalls++;
        throw new Error("XHR ON THE FREE PATH — determinism violated");
      }
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("estimate + lint + card complete with network disabled", () => {
    const a = { ...DEFAULT_ASSUMPTIONS, requestsPerMonth: 50_000 };
    const estimates = estimateAll(BLOATED_PROMPT, a, MODELS);
    const findings = lintPrompt(BLOATED_PROMPT, a, getModel("claude-sonnet-5"));
    const rec = recommend(estimates, [], true);
    const card = renderCard({
      featureName: "Ticket classifier",
      prompt: BLOATED_PROMPT,
      estimates,
      assumptions: a,
      findings,
      runs: [],
      recommendation: rec,
      generatedAt: "2026-07-12",
    });
    expect(estimates.length).toBe(MODELS.length);
    expect(findings.length).toBeGreaterThan(0);
    expect(card).toContain("Cost card");
    expect(fetchCalls).toBe(0);
  });
});

describe("determinism", () => {
  it("same input ⇒ deep-equal estimates across runs", () => {
    const a = { ...DEFAULT_ASSUMPTIONS, turnsPerConversation: 4, useCaching: true };
    const run1 = estimateAll(BLOATED_PROMPT, a, MODELS);
    const run2 = estimateAll(BLOATED_PROMPT, a, MODELS);
    expect(run1).toEqual(run2);
  });

  it("same input ⇒ byte-identical cost card", () => {
    const a = DEFAULT_ASSUMPTIONS;
    const make = () => {
      const estimates = estimateAll(BLOATED_PROMPT, a, MODELS);
      return renderCard({
        featureName: "X",
        prompt: BLOATED_PROMPT,
        estimates,
        assumptions: a,
        findings: lintPrompt(BLOATED_PROMPT, a, getModel("claude-sonnet-5")),
        runs: [],
        recommendation: recommend(estimates, [], false),
        generatedAt: "2026-07-12",
      });
    };
    expect(make()).toBe(make());
  });

  it("lint findings are stable across runs", () => {
    const a = DEFAULT_ASSUMPTIONS;
    const f1 = lintPrompt(BLOATED_PROMPT, a, getModel("claude-sonnet-5")).map((f) => ({
      ...f,
      apply: undefined,
    }));
    const f2 = lintPrompt(BLOATED_PROMPT, a, getModel("claude-sonnet-5")).map((f) => ({
      ...f,
      apply: undefined,
    }));
    expect(f1).toEqual(f2);
  });
});

describe("estimator math sanity", () => {
  const model = getModel("claude-haiku-4-5");

  it("bands are ordered low ≤ point ≤ high everywhere", () => {
    for (const e of estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, MODELS)) {
      for (const b of [e.promptTokens, e.inputTokensPerRequest, e.outputTokensPerRequest, e.costPerConversation, e.costPerMonth]) {
        expect(b.low).toBeLessThanOrEqual(b.point);
        expect(b.point).toBeLessThanOrEqual(b.high);
      }
    }
  });

  it("hand-computed single-turn case matches", () => {
    // Single turn, no caching, no tools, no retries, no batch.
    const a = {
      ...DEFAULT_ASSUMPTIONS,
      requestsPerMonth: 1000,
      avgUserInputTokens: 100,
      turnsPerConversation: 1,
      expectedOutputTokens: 200,
      retryRate: 0,
    };
    const e = estimateModel("hello world", a, model); // 2 base tokens
    const prefix = Math.ceil(2 * model.calibration.point); // 3
    const expected = ((prefix + 100) * model.inputPerMTok + 200 * model.outputPerMTok) / 1e6;
    expect(e.costPerConversation.point).toBeCloseTo(expected, 12);
    expect(e.costPerMonth.point).toBeCloseTo(expected * 1000, 9);
  });

  it("caching reduces cost for a large prefix at high volume", () => {
    // Sonnet 5's cache minimum is 1024 tokens; the fixture prompt (~2.6K
    // calibrated) engages it. On Haiku (4096 min) it must NOT engage.
    const a = { ...DEFAULT_ASSUMPTIONS, requestsPerMonth: 100_000 };
    const sonnet = getModel("claude-sonnet-5");
    const off = estimateModel(BLOATED_PROMPT, a, sonnet);
    const on = estimateModel(BLOATED_PROMPT, { ...a, useCaching: true }, sonnet);
    expect(on.costPerMonth.point).toBeLessThan(off.costPerMonth.point);

    const haikuOff = estimateModel(BLOATED_PROMPT, a, model);
    const haikuOn = estimateModel(BLOATED_PROMPT, { ...a, useCaching: true }, model);
    expect(haikuOn.costPerMonth.point).toBe(haikuOff.costPerMonth.point);
    expect(haikuOn.assumptionNotes.join(" ")).toContain("cache minimum");
  });

  it("batch API halves the bill", () => {
    const off = estimateModel(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, model);
    const on = estimateModel(BLOATED_PROMPT, { ...DEFAULT_ASSUMPTIONS, useBatch: true }, model);
    expect(on.costPerConversation.point).toBeCloseTo(off.costPerConversation.point * model.batchMult, 12);
  });

  it("more turns cost more (history growth is modeled)", () => {
    const one = estimateModel(BLOATED_PROMPT, { ...DEFAULT_ASSUMPTIONS, turnsPerConversation: 1 }, model);
    const five = estimateModel(BLOATED_PROMPT, { ...DEFAULT_ASSUMPTIONS, turnsPerConversation: 5 }, model);
    expect(five.costPerConversation.point).toBeGreaterThan(one.costPerConversation.point * 4);
  });

  it("retries scale cost linearly", () => {
    const base = estimateModel(BLOATED_PROMPT, { ...DEFAULT_ASSUMPTIONS, retryRate: 0 }, model);
    const retry = estimateModel(BLOATED_PROMPT, { ...DEFAULT_ASSUMPTIONS, retryRate: 0.1 }, model);
    expect(retry.costPerConversation.point).toBeCloseTo(base.costPerConversation.point * 1.1, 12);
  });
});
