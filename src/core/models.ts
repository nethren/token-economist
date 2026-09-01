import type { ModelSpec } from "./types";

/**
 * The pricing/model registry. Adding or swapping a model or provider is a
 * config change here — nothing else in the codebase names a specific model.
 *
 * Prices and cache thresholds: official provider documentation verified
 * 2026-09-01. Long-context and non-standard processing tiers still require
 * separate handling where noted.
 *
 * Calibration bands: see DECISIONS.md D2. The offline tokenizer is o200k
 * (OpenAI BPE); other providers' counts are estimated via the band.
 */
const ANTHROPIC_CAL = { low: 1.05, point: 1.15, high: 1.3 };
const OPENAI_CAL = { low: 0.98, point: 1.0, high: 1.02 };
const GOOGLE_CAL = { low: 0.95, point: 1.05, high: 1.2 };

export const MODELS: ModelSpec[] = [
  {
    id: "claude-opus-4-8",
    provider: "anthropic",
    displayName: "Claude Opus 4.8",
    tier: "frontier",
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadMult: 0.1,
    cacheWriteMult: 1.25,
    cacheMinTokens: 1024,
    batchMult: 0.5,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    calibration: ANTHROPIC_CAL,
    pricesAsOf: "2026-09-01",
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    displayName: "Claude Sonnet 5",
    tier: "workhorse",
    inputPerMTok: 2.0,
    outputPerMTok: 10.0,
    cacheReadMult: 0.1,
    cacheWriteMult: 1.25,
    cacheMinTokens: 1024,
    batchMult: 0.5,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    calibration: ANTHROPIC_CAL,
    pricesAsOf: "2026-09-01",
    notes: "The launch price of $2/$10 per MTok is now the standard price.",
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    tier: "economy",
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    cacheReadMult: 0.1,
    cacheWriteMult: 1.25,
    cacheMinTokens: 4096,
    batchMult: 0.5,
    contextWindow: 200_000,
    maxOutput: 64_000,
    calibration: ANTHROPIC_CAL,
    pricesAsOf: "2026-09-01",
  },
  {
    id: "gpt-5",
    provider: "openai",
    displayName: "GPT-5",
    tier: "frontier",
    inputPerMTok: 1.25,
    outputPerMTok: 10.0,
    cacheReadMult: 0.1,
    cacheWriteMult: 1.0, // OpenAI caching is automatic; no write premium
    cacheMinTokens: 1024,
    batchMult: 0.5,
    contextWindow: 400_000,
    maxOutput: 128_000,
    calibration: OPENAI_CAL,
    pricesAsOf: "2026-09-01",
  },
  {
    id: "gpt-5-mini",
    provider: "openai",
    displayName: "GPT-5 mini",
    tier: "economy",
    inputPerMTok: 0.25,
    outputPerMTok: 2.0,
    cacheReadMult: 0.1,
    cacheWriteMult: 1.0,
    cacheMinTokens: 1024,
    batchMult: 0.5,
    contextWindow: 400_000,
    maxOutput: 128_000,
    calibration: OPENAI_CAL,
    pricesAsOf: "2026-09-01",
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    displayName: "Gemini 2.5 Pro",
    tier: "workhorse",
    inputPerMTok: 1.25,
    outputPerMTok: 10.0,
    cacheReadMult: 0.1,
    cacheWriteMult: 1.0,
    cacheMinTokens: 2048,
    batchMult: 0.5,
    contextWindow: 1_000_000,
    maxOutput: 65_000,
    calibration: GOOGLE_CAL,
    pricesAsOf: "2026-09-01",
    notes: "Prices for prompts ≤200K tokens; long-context tier costs more.",
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    displayName: "Gemini 2.5 Flash",
    tier: "economy",
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
    cacheReadMult: 0.1,
    cacheWriteMult: 1.0,
    cacheMinTokens: 2048,
    batchMult: 0.5,
    contextWindow: 1_000_000,
    maxOutput: 65_000,
    calibration: GOOGLE_CAL,
    pricesAsOf: "2026-09-01",
  },
];

/** Price snapshots older than this are flagged "stale — verify" in UI + card. */
export const STALE_PRICE_DAYS = 90;

/**
 * Whole days between the price snapshot and a reference date (ISO yyyy-mm-dd
 * both). Pure function of its inputs — callers inject "today" so the cost
 * card stays deterministic under an injected generatedAt.
 */
export function priceAgeDays(pricesAsOf: string, onDate: string): number {
  const ms = Date.parse(onDate) - Date.parse(pricesAsOf);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function getModel(id: string): ModelSpec {
  const m = MODELS.find((m) => m.id === id);
  if (!m) throw new Error(`Unknown model id: ${id}`);
  return m;
}
