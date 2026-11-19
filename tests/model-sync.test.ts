import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFERENCE_ID,
  MODELS,
  getModel,
  modelCountWord,
  parseRegistry,
  resolveModelId,
  retirementNote,
} from "../src/core/models";
import {
  MACHINE_FIELDS,
  assertOnlyMachineFields,
  renderReport,
  syncModels,
  type RawRegistry,
} from "../src/core/modelSync";
import { applyLivePrices } from "../src/core/livePrices";
import { estimateAll } from "../src/core/estimate";
import { cheapestUsable, recommend, renderCard } from "../src/core/card";
import { DEFAULT_ASSUMPTIONS, type MeasureRun } from "../src/core/types";
import { BLOATED_PROMPT } from "./fixtures";

const SHIPPED: RawRegistry = JSON.parse(
  readFileSync(new URL("../src/core/models.json", import.meta.url), "utf8"),
);
const clone = <T>(x: T): T => structuredClone(x);

/**
 * The shipped registry with sync state cleared: no retirement dates, no
 * verify flags, and a seen-through marker before every fixture row. Sync
 * behaviour is tested against this, so a real sync PR (which sets those
 * fields in models.json) can't break the tests that judge it.
 */
const BASE: RawRegistry = (() => {
  const r = clone(SHIPPED);
  r.candidatesSeenThrough = "2026-09-01";
  for (const m of r.models) {
    delete m.retiresOn;
    delete m.verifyPricing;
  }
  return r;
})();
const NOW = new Date("2026-11-18T12:00:00Z");
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** A public-list row in OpenRouter's shape. Prices are USD per token. */
function row(id: string, inPerM: number, outPerM: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Vendor: ${id.split("/")[1]}`,
    created: unix("2026-07-01"),
    context_length: 1_000_000,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: String(inPerM / 1e6), completion: String(outPerM / 1e6) },
    top_provider: { context_length: 1_000_000, max_completion_tokens: 128_000 },
    expiration_date: null,
    ...extra,
  };
}

/** The shipped registry, echoed back unchanged, plus filler rows. */
function echoList(reg: RawRegistry) {
  const rows = reg.models.map((m) =>
    row(m.openrouterSlug, m.inputPerMTok, m.outputPerMTok, {
      expiration_date: m.retiresOn ?? null,
      context_length: m.contextWindow,
      top_provider: { context_length: m.contextWindow, max_completion_tokens: m.maxOutput },
      pricing: {
        prompt: String(m.inputPerMTok / 1e6),
        completion: String(m.outputPerMTok / 1e6),
        input_cache_read: String((m.inputPerMTok * m.cacheReadMult) / 1e6),
      },
    }),
  );
  for (let i = 0; i < 30; i++) rows.push(row(`other-lab/filler-${i}`, 1, 2));
  return { data: rows };
}

describe("registry (models.json)", () => {
  it("ships valid: unique ids and slugs, a known default, provider calibration attached", () => {
    expect(MODELS.length).toBeGreaterThan(0);
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
    expect(new Set(MODELS.map((m) => m.openrouterSlug)).size).toBe(MODELS.length);
    expect(MODELS.some((m) => m.id === DEFAULT_REFERENCE_ID)).toBe(true);
    for (const m of MODELS) expect(m.calibration.low).toBeLessThanOrEqual(m.calibration.high);
  });

  it("refuses a bad tier, an unknown provider, a duplicate slug, and a dangling successor", () => {
    const bad = (mutate: (r: RawRegistry) => void) => {
      const r = clone(SHIPPED);
      mutate(r);
      return () => parseRegistry(r);
    };
    expect(bad((r) => (r.models[0].tier = "premium"))).toThrow(/unknown tier/);
    expect(bad((r) => (r.models[0].provider = "acme"))).toThrow(/unknown provider/);
    expect(bad((r) => (r.models[1].openrouterSlug = r.models[0].openrouterSlug))).toThrow(/duplicate openrouterSlug/);
    expect(bad((r) => (r.models[0].inputPerMTok = -1))).toThrow(/positive/);
    expect(bad((r) => (r.defaultReferenceId = "gone"))).toThrow(/defaultReferenceId/);
    expect(
      bad((r) => r.retired.push({ id: "old", displayName: "Old", retiredOn: "2026-01-01", successorId: "nope" })),
    ).toThrow(/successor/);
    expect(
      bad((r) =>
        r.retired.push({ id: r.models[0].id, displayName: "x", retiredOn: "2026-01-01", successorId: r.models[1].id }),
      ),
    ).toThrow(/still in the curated set/);
  });

  it("model-count copy follows the registry", () => {
    expect(modelCountWord(7)).toBe("seven");
    expect(modelCountWord(14)).toBe("14");
    expect(modelCountWord()).toBe(modelCountWord(MODELS.length));
  });
});

describe("retired and unknown model ids (share links)", () => {
  const reg = (() => {
    const r = clone(SHIPPED);
    // Start from no retired entries: the shipped ones name successors that
    // this fixture may have just removed.
    r.retired = [];
    const gone = r.models.shift()!;
    r.retired.push({ id: gone.id, displayName: gone.displayName, retiredOn: "2026-12-11", successorId: r.models[0].id });
    r.defaultReferenceId = r.models[0].id;
    return { parsed: parseRegistry(r), gone, successor: r.models[0] };
  })();

  it("a retired id resolves to its named successor and says so", () => {
    const res = resolveModelId(reg.gone.id, reg.parsed);
    expect(res.id).toBe(reg.successor.id);
    expect(res.note).toContain(reg.gone.displayName);
    expect(res.note).toContain("2026-12-11");
    expect(res.note).toContain(reg.successor.displayName);
  });

  it("an unknown id falls back to the default with a note; a missing one silently", () => {
    expect(resolveModelId("made-up", reg.parsed)).toMatchObject({ id: reg.parsed.defaultReferenceId });
    expect(resolveModelId("made-up", reg.parsed).note).toContain("made-up");
    expect(resolveModelId(undefined, reg.parsed)).toEqual({ id: reg.parsed.defaultReferenceId, note: null });
    expect(resolveModelId(reg.successor.id, reg.parsed)).toEqual({ id: reg.successor.id, note: null });
  });
});

describe("retiring models in the table and on the card", () => {
  it("retirementNote depends only on the injected date", () => {
    const m = { ...getModel(DEFAULT_REFERENCE_ID), retiresOn: "2026-12-11" };
    expect(retirementNote(m, "2026-11-18")).toBe("retires 2026-12-11");
    expect(retirementNote(m, "2026-12-11")).toBe("retired 2026-12-11");
    expect(retirementNote(getModel(DEFAULT_REFERENCE_ID), "2026-11-18")).toBeNull();
  });

  it("the card names the retirement date in the comparison", () => {
    const models = MODELS.map((m, i) => (i === 0 ? { ...m, retiresOn: "2026-12-11" } : m));
    const estimates = estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, models);
    const card = renderCard({
      featureName: "X",
      prompt: BLOATED_PROMPT,
      estimates,
      assumptions: DEFAULT_ASSUMPTIONS,
      findings: [],
      runs: [],
      recommendation: recommend(estimates, [], "fp"),
      currentFingerprint: "fp",
      generatedAt: "2026-11-18",
    });
    expect(card).toMatch(new RegExp(`${models[0].displayName} \\|.*retires 2026-12-11`));
  });

  /** The registry with its cheapest model (by this estimate) marked retiring. */
  const withCheapestRetiring = () => {
    const base = estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, MODELS);
    const cheapestId = [...base].sort((a, b) => a.costPerMonth.point - b.costPerMonth.point)[0].model.id;
    const models = MODELS.map((m) => (m.id === cheapestId ? { ...m, retiresOn: "2026-12-11" } : m));
    return { cheapestId, models, estimates: estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, models) };
  };

  it("a retiring model is never 'start here' or a step up, but stays in the comparison", () => {
    const { cheapestId, models, estimates } = withCheapestRetiring();
    const rec = recommend(estimates, [], "fp")!;
    expect(rec.estimate.model.id).not.toBe(cheapestId);
    expect(rec.shortlist.map((s) => s.estimate.model.id)).not.toContain(cheapestId);
    expect(rec.stepUp?.model.id).not.toBe(cheapestId);
    // "Cheapest" must not contradict the table: the reason names what it skipped.
    const skipped = models.find((m) => m.id === cheapestId)!.displayName;
    expect(rec.reason).toContain(`${skipped} costs less but is being retired`);
    // Still estimated and shown: excluded from advice, not from the table.
    expect(estimates.map((e) => e.model.id)).toContain(cheapestId);
    // The linter's cheaper-tier answer agrees with the headline.
    expect(cheapestUsable(estimates)!.model.id).toBe(rec.estimate.model.id);
    // A passing run on the retiring model does not make it the pick either.
    const run: MeasureRun = {
      modelId: cheapestId,
      check: { kind: "json" },
      results: [{ input: "x", output: "{}", pass: true, inputTokens: 1, outputTokens: 1, costUSD: 0, cached: false, latencyMs: 0 }],
      totalCostUSD: 0,
      ranAt: "2026-11-18T00:00:00Z",
      ranAgainst: "fp",
      source: "byo",
    };
    expect(recommend(estimates, [run], "fp")!.estimate.model.id).not.toBe(cheapestId);
    expect(models.find((m) => m.id === cheapestId)!.retiresOn).toBe("2026-12-11");
  });

  it("when every model is retiring, the cheapest is still recommended rather than nothing", () => {
    const models = MODELS.map((m) => ({ ...m, retiresOn: "2026-12-11" }));
    const estimates = estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, models);
    const cheapest = [...estimates].sort((a, b) => a.costPerMonth.point - b.costPerMonth.point)[0];
    expect(recommend(estimates, [], "fp")!.estimate.model.id).toBe(cheapest.model.id);
  });
});

describe("live price refresh reads each model's own slug", () => {
  it("a renamed slug is followed; nothing is added", () => {
    const models = MODELS.map((m, i) => (i === 0 ? { ...m, openrouterSlug: "vendor/renamed" } : m));
    const r = applyLivePrices(models, { data: [row("vendor/renamed", 7, 21)] }, "2026-11-18");
    expect(r.models).toHaveLength(MODELS.length);
    expect(r.models[0].inputPerMTok).toBeCloseTo(7, 9);
    expect(r.updated).toEqual([models[0].displayName]);
  });
});

describe("model sync (weekly PR)", () => {
  it("an unchanged list changes nothing, so no PR opens", () => {
    const r = syncModels(BASE, echoList(BASE), NOW);
    expect(r.changed).toBe(false);
    expect(r.priceChanges).toEqual([]);
    expect(r.gone).toEqual([]);
    expect(r.candidates).toEqual([]);
  });

  it("applies price, limit and retirement changes; flags the price for verification", () => {
    const list = echoList(BASE);
    const target = BASE.models[0];
    const i = list.data.findIndex((x) => x.id === target.openrouterSlug);
    list.data[i] = {
      ...list.data[i],
      pricing: { prompt: "0.000003", completion: "0.000015" },
      top_provider: { context_length: 2_000_000, max_completion_tokens: 64_000 },
      expiration_date: "2026-12-11",
    };
    const r = syncModels(BASE, list, NOW);
    const m = r.next.models[0];
    expect(r.changed).toBe(true);
    expect(m).toMatchObject({
      inputPerMTok: 3,
      outputPerMTok: 15,
      pricesAsOf: "2026-11-18",
      verifyPricing: true,
      contextWindow: 2_000_000,
      maxOutput: 64_000,
      retiresOn: "2026-12-11",
    });
    expect(r.priceChanges.map((c) => c.field)).toEqual(["inputPerMTok", "outputPerMTok"]);
    expect(r.retirementChanges).toHaveLength(1);
    // Untouched models keep their snapshot date.
    expect(r.next.models[1].pricesAsOf).toBe(BASE.models[1].pricesAsOf);
    // Second run on its own output is a no-op: the job is idempotent.
    expect(syncModels(r.next, list, NOW).changed).toBe(false);
  });

  it("reports a reply cap above half the context window instead of applying it", () => {
    const list = echoList(BASE);
    const target = BASE.models[0];
    const i = list.data.findIndex((x) => x.id === target.openrouterSlug);
    list.data[i] = {
      ...list.data[i],
      top_provider: { context_length: target.contextWindow, max_completion_tokens: Math.round(target.contextWindow * 0.9) },
    };
    const r = syncModels(BASE, list, NOW);
    expect(r.next.models[0].maxOutput).toBe(target.maxOutput);
    expect(r.limitChanges).toEqual([]);
    expect(r.toCheck.map((c) => c.field)).toContain("maxOutput");
  });

  it("clears a retirement date the list withdrew", () => {
    const reg = clone(BASE);
    reg.models[0].retiresOn = "2026-12-11";
    const r = syncModels(reg, echoList(BASE), NOW);
    expect(r.next.models[0].retiresOn).toBeUndefined();
  });

  it("reports a vanished model as gone and never removes it", () => {
    const list = echoList(BASE);
    list.data = list.data.filter((x) => x.id !== BASE.models[0].openrouterSlug);
    const r = syncModels(BASE, list, NOW);
    expect(r.gone.map((g) => g.id)).toEqual([BASE.models[0].id]);
    expect(r.next.models).toHaveLength(BASE.models.length);
    expect(r.changed).toBe(false);
  });

  it("lists new text models from the curated providers once, with a suggested entry", () => {
    const list = echoList(BASE);
    const created = unix("2026-11-10T08:00:00Z");
    list.data.push(
      row("anthropic/claude-new-1", 3, 15, { created }),
      row("anthropic/claude-new-1:batch", 1.5, 7.5, { created }),
      row("openai/old-model", 1, 2, { created: unix("2026-08-01") }),
      row("google/image-maker", 1, 2, {
        created,
        architecture: { input_modalities: ["text"], output_modalities: ["image", "text"] },
      }),
      row("other-lab/new-thing", 1, 2, { created }),
    );
    const r = syncModels(BASE, list, NOW);
    expect(r.candidates.map((c) => c.slug)).toEqual(["anthropic/claude-new-1"]);
    const c = r.candidates[0];
    expect(c.suggestedEntry).toMatchObject({ provider: "anthropic", openrouterSlug: c.slug, verifyPricing: true });
    expect(["frontier", "workhorse", "economy"]).toContain(c.suggestedEntry.tier);
    // Never added: identity is the reviewer's call.
    expect(r.next.models.some((m) => m.openrouterSlug === c.slug)).toBe(false);
    // The marker moves past it, so next week's run doesn't repeat it.
    expect(r.next.candidatesSeenThrough).toBe("2026-11-10T08:00:00.000Z");
    expect(syncModels(r.next, list, NOW).candidates).toEqual([]);
  });

  it("reports cache and batch multiplier drift without applying it", () => {
    const list = echoList(BASE);
    const m = BASE.models[0];
    const i = list.data.findIndex((x) => x.id === m.openrouterSlug);
    list.data[i] = {
      ...list.data[i],
      pricing: { ...list.data[i].pricing, input_cache_read: String((m.inputPerMTok * 0.25) / 1e6) },
    };
    list.data.push(row(`${m.openrouterSlug}:batch`, m.inputPerMTok * 0.4, m.outputPerMTok * 0.4));
    const r = syncModels(BASE, list, NOW);
    expect(r.toCheck.map((c) => c.field).sort()).toEqual(["batchMult", "cacheReadMult"]);
    expect(r.next.models[0].cacheReadMult).toBe(m.cacheReadMult);
    expect(r.changed).toBe(false);
  });

  it("refuses a payload that doesn't look like the model list", () => {
    expect(() => syncModels(BASE, null, NOW)).toThrow(/looks wrong/);
    expect(() => syncModels(BASE, { data: [] }, NOW)).toThrow(/looks wrong/);
    const strangers = { data: Array.from({ length: 50 }, (_, i) => row(`x/y-${i}`, 1, 1)) };
    expect(() => syncModels(BASE, strangers, NOW)).toThrow(/looks wrong/);
  });

  it("the machine-field boundary is enforced, not assumed", () => {
    expect(MACHINE_FIELDS).not.toContain("tier");
    const after = clone(BASE);
    after.models[0].tier = "economy" === after.models[0].tier ? "frontier" : "economy";
    expect(() => assertOnlyMachineFields(BASE, after)).toThrow(/curated field/);
    const dropped = clone(BASE);
    dropped.models.pop();
    expect(() => assertOnlyMachineFields(BASE, dropped)).toThrow(/model set/);
    const reref = clone(BASE);
    reref.defaultReferenceId = reref.models.find((m) => m.id !== BASE.defaultReferenceId)!.id;
    expect(() => assertOnlyMachineFields(BASE, reref)).toThrow(/registry field/);
  });

  it("the PR body is deterministic and says what was and wasn't applied", () => {
    const list = echoList(BASE);
    list.data = list.data.filter((x) => x.id !== BASE.models[0].openrouterSlug);
    list.data.push(row("google/gemini-next", 2, 10, { created: unix("2026-11-10") }));
    const r = syncModels(BASE, list, NOW);
    const body = renderReport(r, NOW);
    expect(renderReport(r, NOW)).toBe(body);
    expect(body).toContain("Model sync — 2026-11-18");
    expect(body).toContain("Gone from the public list");
    expect(body).toContain("`google/gemini-next`");
    expect(body).toContain("Review checklist");
  });
});
