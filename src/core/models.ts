import type { Band, ModelSpec, Provider, RetiredModel } from "./types";
import registryJson from "./models.json";

/**
 * The pricing/model registry. The data lives in `models.json`; nothing else
 * in the codebase names a specific model.
 *
 * Two kinds of field share each entry (DECISIONS.md D34):
 * - Curated by a person: id, provider, displayName, tier, openrouterSlug,
 *   cacheMinTokens, notes, plus `defaultReferenceId` and the `retired` list.
 *   Tier and tokenizer handling change advice, so no script ever writes them.
 * - Refreshed by `npm run models:sync` (a weekly PR): input/output price,
 *   context window, max output, pricesAsOf, verifyPricing, retiresOn.
 *
 * Bundled prices are a dated snapshot. They are official provider prices as
 * of 2026-09-01 unless `verifyPricing` is set, which marks a value that came
 * from the public OpenRouter list and has not yet been checked against the
 * provider's own table.
 *
 * Calibration bands: see DECISIONS.md D2. The offline tokenizer is o200k
 * (OpenAI BPE); other providers' counts are estimated via the band. A band
 * belongs to a provider, so a new model inherits its provider's band.
 */
export const CALIBRATION: Record<Provider, Band> = {
  anthropic: { low: 1.05, point: 1.15, high: 1.3 },
  openai: { low: 0.98, point: 1.0, high: 1.02 },
  google: { low: 0.95, point: 1.05, high: 1.2 },
};

const TIERS = new Set(["frontier", "workhorse", "economy"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Registry {
  models: ModelSpec[];
  retired: RetiredModel[];
  defaultReferenceId: string;
}

/**
 * Validate the raw registry and attach calibration bands. Throws with the
 * offending id rather than shipping a half-valid model: a typo in a tier or a
 * price must fail the build and the tests, not change a recommendation.
 */
export function parseRegistry(raw: unknown): Registry {
  const r = raw as { models?: unknown; retired?: unknown; defaultReferenceId?: unknown };
  if (!Array.isArray(r?.models) || r.models.length === 0) throw new Error("Registry has no models");
  const models: ModelSpec[] = r.models.map((entry: Record<string, unknown>) => {
    const id = String(entry?.id ?? "?");
    const fail = (why: string): never => {
      throw new Error(`Registry model ${id}: ${why}`);
    };
    if (typeof entry.id !== "string" || entry.id === "") fail("missing id");
    if (typeof entry.provider !== "string" || !(entry.provider in CALIBRATION)) fail("unknown provider");
    if (typeof entry.tier !== "string" || !TIERS.has(entry.tier)) fail("unknown tier");
    for (const k of ["displayName", "openrouterSlug"]) {
      if (typeof entry[k] !== "string" || entry[k] === "") fail(`missing ${k}`);
    }
    for (const k of ["inputPerMTok", "outputPerMTok", "contextWindow", "maxOutput"]) {
      const v = entry[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) fail(`${k} must be a positive number`);
    }
    for (const k of ["cacheReadMult", "cacheWriteMult", "batchMult", "cacheMinTokens"]) {
      const v = entry[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(`${k} must be a number ≥ 0`);
    }
    if (typeof entry.pricesAsOf !== "string" || !ISO_DATE.test(entry.pricesAsOf)) fail("pricesAsOf must be yyyy-mm-dd");
    if (entry.retiresOn !== undefined && (typeof entry.retiresOn !== "string" || !ISO_DATE.test(entry.retiresOn))) {
      fail("retiresOn must be yyyy-mm-dd");
    }
    return {
      ...(entry as unknown as ModelSpec),
      calibration: CALIBRATION[entry.provider as Provider],
    };
  });

  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const m of models) {
    if (ids.has(m.id)) throw new Error(`Registry model ${m.id}: duplicate id`);
    if (slugs.has(m.openrouterSlug)) throw new Error(`Registry model ${m.id}: duplicate openrouterSlug`);
    ids.add(m.id);
    slugs.add(m.openrouterSlug);
  }

  const retired = (Array.isArray(r.retired) ? r.retired : []) as RetiredModel[];
  for (const x of retired) {
    if (ids.has(x.id)) throw new Error(`Retired model ${x.id} is still in the curated set`);
    if (!ids.has(x.successorId)) throw new Error(`Retired model ${x.id}: successor ${x.successorId} is not a current model`);
    if (typeof x.retiredOn !== "string" || !ISO_DATE.test(x.retiredOn)) throw new Error(`Retired model ${x.id}: retiredOn must be yyyy-mm-dd`);
  }

  const defaultReferenceId = r.defaultReferenceId;
  if (typeof defaultReferenceId !== "string" || !ids.has(defaultReferenceId)) {
    throw new Error("defaultReferenceId must name a current model");
  }
  return { models, retired, defaultReferenceId };
}

const REGISTRY = parseRegistry(registryJson);

export const MODELS: ModelSpec[] = REGISTRY.models;
export const RETIRED: RetiredModel[] = REGISTRY.retired;
/** Used when a share link names a model this build has never heard of. */
export const DEFAULT_REFERENCE_ID: string = REGISTRY.defaultReferenceId;

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

/**
 * The retirement note for a model on a given date, or null. Pure: callers
 * inject the date, so the card stays deterministic.
 */
export function retirementNote(model: ModelSpec, onDate: string): string | null {
  if (model.retiresOn === undefined) return null;
  return model.retiresOn <= onDate ? `retired ${model.retiresOn}` : `retires ${model.retiresOn}`;
}

/**
 * Resolve a model id from outside this build (a share link). A retired id
 * maps to its named successor and an unknown id to the default, and both say
 * so: an old link is never silently re-badged as a different model.
 */
export function resolveModelId(
  id: unknown,
  registry: Registry = REGISTRY,
): { id: string; note: string | null } {
  if (typeof id === "string" && registry.models.some((m) => m.id === id)) return { id, note: null };
  const retired = typeof id === "string" ? registry.retired.find((x) => x.id === id) : undefined;
  if (retired) {
    const successor = registry.models.find((m) => m.id === retired.successorId)!;
    return {
      id: successor.id,
      note: `This link was made for ${retired.displayName}, which retired on ${retired.retiredOn}. It now compares against ${successor.displayName}.`,
    };
  }
  if (typeof id === "string" && id !== "") {
    return {
      id: registry.defaultReferenceId,
      note: `This link names a model this version doesn't know ("${id.slice(0, 40)}"). It compares against today's models instead.`,
    };
  }
  return { id: registry.defaultReferenceId, note: null };
}

/** Spelled-out model count for running copy ("seven models"). */
export function modelCountWord(n: number = MODELS.length): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  return words[n] ?? String(n);
}

export function getModel(id: string): ModelSpec {
  const m = MODELS.find((m) => m.id === id);
  if (!m) throw new Error(`Unknown model id: ${id}`);
  return m;
}
