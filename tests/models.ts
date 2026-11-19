import { DEFAULT_REFERENCE_ID, MODELS, getModel } from "../src/core/models";
import type { ModelSpec, Provider } from "../src/core/types";

/**
 * Tests name models by role, never by id. The curated lineup changes as
 * providers ship (DECISIONS.md D34, D35), and a test that pins
 * "claude-haiku-4-5" breaks on a lineup change that changed nothing it
 * tests. Pick by provider and tier instead; the registry guarantees each
 * pick exists or the suite fails here with a clear message.
 */
export function pick(provider: Provider, tier: ModelSpec["tier"]): ModelSpec {
  const m = MODELS.find((x) => x.provider === provider && x.tier === tier);
  if (!m) throw new Error(`The registry has no ${provider} ${tier} model; tests need one.`);
  return m;
}

/** What a share link falls back to; the lint reference in several suites. */
export const REFERENCE: ModelSpec = getModel(DEFAULT_REFERENCE_ID);

const listPrice = (m: ModelSpec) => m.inputPerMTok + m.outputPerMTok;

/** Lowest and highest list price in the registry. */
export const CHEAPEST: ModelSpec = [...MODELS].sort((a, b) => listPrice(a) - listPrice(b))[0];
export const PRICIEST: ModelSpec = [...MODELS].sort((a, b) => listPrice(b) - listPrice(a))[0];
