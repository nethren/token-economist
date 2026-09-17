import { describe, expect, it } from "vitest";
import { estimateAll, estimateModel } from "../src/core/estimate";
import { MODELS, getModel, priceAgeDays, STALE_PRICE_DAYS } from "../src/core/models";
import { DEFAULT_ASSUMPTIONS } from "../src/core/types";
import { fmtBreakdown, recommend, renderCard } from "../src/core/card";
import { decodeShareState, encodeShareState, type ShareState } from "../src/core/share";
import {
  applyLivePrices,
  autoLoadPrices,
  rememberPrices,
  PRICE_CACHE_KEY,
  PRICE_CACHE_TTL_MS,
} from "../src/core/livePrices";
import { afterEach, vi } from "vitest";
import { PRESETS } from "../src/core/presets";
import { BLOATED_PROMPT } from "./fixtures";

const model = getModel("claude-haiku-4-5");

describe("cost breakdown (where the money goes)", () => {
  it("components sum exactly to the point cost, for every model and shape", () => {
    const shapes = [
      DEFAULT_ASSUMPTIONS,
      { ...DEFAULT_ASSUMPTIONS, turnsPerConversation: 5, useCaching: true, useBatch: true },
      { ...DEFAULT_ASSUMPTIONS, toolCallsPerTurn: 4, tokensPerToolCall: 800, retryRate: 0.1 },
      { ...DEFAULT_ASSUMPTIONS, reasoningTokensPerTurn: 2000 },
    ];
    for (const a of shapes) {
      for (const e of estimateAll(BLOATED_PROMPT, a, MODELS)) {
        const b = e.breakdown;
        const sum = b.prefix + b.userAndHistory + b.tools + b.output + b.reasoning;
        expect(sum).toBeCloseTo(e.costPerConversation.point, 12);
        for (const v of Object.values(b)) expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("attributes tool spend to tools and prefix share matches the breakdown", () => {
    const a = { ...DEFAULT_ASSUMPTIONS, toolCallsPerTurn: 2, tokensPerToolCall: 1000 };
    const e = estimateModel(BLOATED_PROMPT, a, model);
    expect(e.breakdown.tools).toBeGreaterThan(0);
    expect(e.prefixShareOfCost).toBeCloseTo(
      e.breakdown.prefix / e.costPerConversation.point,
      12,
    );
  });

  it("fmtBreakdown renders nonzero drivers in plain language, biggest first", () => {
    const e = estimateModel(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, model);
    const s = fmtBreakdown(e.breakdown);
    expect(s).toContain("your instructions");
    expect(s).toContain("the replies");
    expect(s).not.toContain("tools + retrieved data");
    expect(s).not.toContain("hidden thinking");
    // biggest driver leads: the bloated prompt dominates this estimate
    expect(s.startsWith("your instructions")).toBe(true);
  });
});

describe("reasoning-token accounting (thinking models)", () => {
  it("zero reasoning tokens changes nothing", () => {
    const base = estimateModel(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, model);
    const zero = estimateModel(
      BLOATED_PROMPT,
      { ...DEFAULT_ASSUMPTIONS, reasoningTokensPerTurn: 0 },
      model,
    );
    expect(zero).toEqual(base);
  });

  it("reasoning tokens bill at output price per turn and are flagged", () => {
    const a = { ...DEFAULT_ASSUMPTIONS, retryRate: 0, turnsPerConversation: 3 };
    const base = estimateModel(BLOATED_PROMPT, a, model);
    const R = 1500;
    const withR = estimateModel(BLOATED_PROMPT, { ...a, reasoningTokensPerTurn: R }, model);
    const expected = (R * 3 * model.outputPerMTok) / 1e6;
    expect(withR.costPerConversation.point - base.costPerConversation.point).toBeCloseTo(
      expected,
      12,
    );
    // Not re-sent as history: the delta is flat across bounds, not compounding.
    expect(withR.costPerConversation.high - base.costPerConversation.high).toBeCloseTo(
      expected,
      12,
    );
    expect(withR.assumptionNotes.join(" ")).toContain("reasoning");
  });
});

describe("stale-price flag", () => {
  it("priceAgeDays is a pure day difference, floored at zero", () => {
    expect(priceAgeDays("2026-01-15", "2026-07-12")).toBe(178);
    expect(priceAgeDays("2026-07-12", "2026-07-12")).toBe(0);
    expect(priceAgeDays("2026-08-01", "2026-07-12")).toBe(0); // future snapshot
    expect(priceAgeDays("garbage", "2026-07-12")).toBe(0);
  });

  it("the card flags prices older than the threshold, deterministically", () => {
    const staleModels = MODELS.map((m) =>
      m.provider === "openai" || m.provider === "google"
        ? { ...m, pricesAsOf: "2026-01-15", verifyPricing: true }
        : m,
    );
    const estimates = estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, staleModels);
    const card = renderCard({
      featureName: "X",
      prompt: BLOATED_PROMPT,
      estimates,
      assumptions: DEFAULT_ASSUMPTIONS,
      findings: [],
      runs: [],
      recommendation: recommend(estimates, [], "fp"),
      currentFingerprint: "fp",
      generatedAt: "2026-07-12",
    });
    // An explicitly old snapshot is ~6 months old at the injected date.
    expect(priceAgeDays("2026-01-15", "2026-07-12")).toBeGreaterThan(STALE_PRICE_DAYS);
    expect(card).toContain("months old — verify");
    expect(card).toContain("Where the money goes");
  });
});

describe("shareable permalink codec", () => {
  const state: ShareState = {
    featureName: "Docs bot — émojis 🎉 and «unicode»",
    prompt: "You are a helpful assistant.\n\nAnswer in 日本語 when asked. 🚀",
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      requestsPerMonth: 42_000,
      expectedOutputTokens: null,
      maxOutputTokens: 512,
      useCaching: true,
      reasoningTokensPerTurn: 100,
    },
    referenceId: "gpt-5-mini",
  };

  it("round-trips state byte-exactly, including unicode and nulls", () => {
    expect(decodeShareState(encodeShareState(state))).toEqual(state);
  });

  it("encoding is URL-fragment safe and deterministic", () => {
    const h = encodeShareState(state);
    expect(h).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeShareState(state)).toBe(h);
  });

  it("rejects garbage instead of throwing", () => {
    expect(decodeShareState("")).toBeNull();
    expect(decodeShareState("#")).toBeNull();
    expect(decodeShareState("#not-base64!!!")).toBeNull();
    expect(decodeShareState(btoa(JSON.stringify({ v: 99 })))).toBeNull();
  });

  it("falls back to defaults for ill-typed fields and unknown models", () => {
    const tampered = btoa(
      JSON.stringify({
        v: 1,
        prompt: "p",
        assumptions: { requestsPerMonth: "a lot", turnsPerConversation: 7 },
        referenceId: "model-that-does-not-exist",
      }),
    );
    const s = decodeShareState(tampered)!;
    expect(s.assumptions.requestsPerMonth).toBe(DEFAULT_ASSUMPTIONS.requestsPerMonth);
    expect(s.assumptions.turnsPerConversation).toBe(7);
    expect(s.referenceId).toBe("claude-sonnet-5");
  });
});

describe("live price refresh (opt-in; the mapper is pure and offline)", () => {
  const payload = {
    data: [
      { id: "anthropic/claude-haiku-4-5".replace("4-5", "4.5"), pricing: { prompt: "0.0000012", completion: "0.000006" } },
      { id: "openai/gpt-5-mini", pricing: { prompt: "0.0000003", completion: "0.0000025" } },
      { id: "openai/gpt-5", pricing: { prompt: "not-a-number", completion: "0.00001" } },
    ],
  };

  it("updates matched models, stamps date/source, and leaves the rest on snapshot", () => {
    const r = applyLivePrices(MODELS, payload, "2026-07-17");
    const haiku = r.models.find((m) => m.id === "claude-haiku-4-5")!;
    expect(haiku.inputPerMTok).toBeCloseTo(1.2, 10);
    expect(haiku.outputPerMTok).toBeCloseTo(6.0, 10);
    expect(haiku.pricesAsOf).toBe("2026-07-17");
    expect(haiku.priceSource).toBe("live");
    expect(haiku.verifyPricing).toBe(false);
    // malformed pricing and uncovered models stay untouched
    const gpt5 = r.models.find((m) => m.id === "gpt-5")!;
    expect(gpt5.inputPerMTok).toBe(getModel("gpt-5").inputPerMTok);
    expect(gpt5.priceSource).toBeUndefined();
    expect(r.updated).toContain("Claude Haiku 4.5");
    expect(r.missing).toContain("GPT-5");
  });

  it("does not mutate the bundled registry", () => {
    const before = JSON.stringify(MODELS);
    applyLivePrices(MODELS, payload, "2026-07-17");
    expect(JSON.stringify(MODELS)).toBe(before);
  });

  it("tolerates garbage payloads", () => {
    for (const junk of [null, 42, "x", {}, { data: "nope" }, { data: [{ id: 7 }] }]) {
      const r = applyLivePrices(MODELS, junk, "2026-07-17");
      expect(r.models).toEqual(MODELS);
      expect(r.updated).toEqual([]);
    }
  });

  it("live-priced estimates flag the source on the card", () => {
    const { models } = applyLivePrices(MODELS, payload, "2026-07-17");
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
      generatedAt: "2026-07-17",
    });
    expect(card).toContain("refreshed from a public price list (openrouter.ai) on 2026-07-17");
  });
});

describe("automatic price refresh (cache + TTL + offline fallback)", () => {
  const fakeStorage = (seed: Record<string, string> = {}) => {
    const map = new Map(Object.entries(seed));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      dump: () => Object.fromEntries(map),
    };
  };
  const NOW = Date.parse("2026-07-17T12:00:00Z");
  const goodPayload = {
    data: [{ id: "openai/gpt-5-mini", pricing: { prompt: "0.0000004", completion: "0.000003" } }],
  };

  afterEach(() => vi.unstubAllGlobals());

  it("fresh cache: applies remembered prices with NO network call", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("must not fetch on a fresh cache");
    });
    const storage = fakeStorage();
    const fetched = applyLivePrices(MODELS, goodPayload, "2026-07-17");
    rememberPrices(storage, fetched, NOW - PRICE_CACHE_TTL_MS / 2);
    const r = await autoLoadPrices(MODELS, storage, NOW);
    expect(r?.via).toBe("cache");
    expect(r?.models.find((m) => m.id === "gpt-5-mini")?.inputPerMTok).toBeCloseTo(0.4, 10);
    expect(r?.models.find((m) => m.id === "gpt-5-mini")?.priceSource).toBe("live");
  });

  it("stale cache: fetches fresh prices and re-remembers them", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return { ok: true, json: async () => goodPayload };
    });
    const storage = fakeStorage();
    rememberPrices(storage, applyLivePrices(MODELS, goodPayload, "2026-07-01"), NOW - PRICE_CACHE_TTL_MS * 2);
    const r = await autoLoadPrices(MODELS, storage, NOW);
    expect(calls).toBe(1);
    expect(r?.via).toBe("network");
    expect(storage.dump()[PRICE_CACHE_KEY]).toContain("gpt-5-mini");
  });

  it("fetch fails with a stale cache: falls back to last known prices", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const storage = fakeStorage();
    rememberPrices(storage, applyLivePrices(MODELS, goodPayload, "2026-07-01"), NOW - PRICE_CACHE_TTL_MS * 10);
    const r = await autoLoadPrices(MODELS, storage, NOW);
    expect(r?.via).toBe("cache");
    expect(r?.models.find((m) => m.id === "gpt-5-mini")?.priceSource).toBe("live");
  });

  it("first run offline: returns null so the app keeps the bundled snapshot", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await autoLoadPrices(MODELS, fakeStorage(), NOW)).toBeNull();
  });

  it("corrupted cache is ignored, not fatal", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => goodPayload }));
    for (const junk of ["not json", "42", '{"fetchedAt":"garbage"}', '{"prices":null}']) {
      const r = await autoLoadPrices(MODELS, fakeStorage({ [PRICE_CACHE_KEY]: junk }), NOW);
      expect(r?.via).toBe("network");
    }
  });
});

describe("feature presets", () => {
  it("every preset estimates cleanly on every model", () => {
    for (const p of PRESETS) {
      const estimates = estimateAll(p.prompt, p.assumptions, MODELS);
      expect(estimates.some((e) => !e.exceedsContext)).toBe(true);
      for (const e of estimates) {
        expect(e.promptBaseTokens).toBeGreaterThan(20);
        expect(e.costPerMonth.point).toBeGreaterThan(0);
      }
      expect(recommend(estimates, [], "fp")).not.toBeNull();
    }
  });

  it("presets cover the real workflow shapes the tool is asked about", () => {
    const byId = new Map(PRESETS.map((p) => [p.id, p]));
    expect(byId.get("rag-assistant")!.assumptions.toolCallsPerTurn).toBeGreaterThan(0);
    expect(byId.get("agent")!.assumptions.reasoningTokensPerTurn).toBeGreaterThan(0);
    expect(byId.get("support-bot")!.assumptions.turnsPerConversation).toBeGreaterThan(1);
    expect(byId.get("summarizer")!.assumptions.useBatch).toBe(true);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it("presets round-trip through the permalink codec", () => {
    for (const p of PRESETS) {
      const s: ShareState = {
        featureName: p.featureName,
        prompt: p.prompt,
        assumptions: p.assumptions,
        referenceId: "claude-sonnet-5",
      };
      expect(decodeShareState(encodeShareState(s))).toEqual(s);
    }
  });
});
