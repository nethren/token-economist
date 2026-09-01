import type { ModelSpec } from "./types";

/**
 * Opt-in live price refresh. NEVER called on the free estimate path — the
 * eval landmines guarantee estimate/lint/card work with fetch stubbed to
 * throw. This module runs only when the user clicks "Update prices", and it
 * downloads a public price table; the prompt is never transmitted.
 *
 * Source: OpenRouter's public model list (no key, CORS-open). Prices there
 * are USD per token, as strings. `applyLivePrices` is a pure function of
 * (models, payload, date) so the mapping is fully testable offline; only
 * `fetchLivePrices` touches the network.
 */

export const PRICE_SOURCE_URL = "https://openrouter.ai/api/v1/models";
export const PRICE_SOURCE_NAME = "openrouter.ai";

/** Our registry id → OpenRouter model slug. Adding a model = one line here. */
const SLUGS: Record<string, string> = {
  "claude-opus-4-8": "anthropic/claude-opus-4.8",
  "claude-sonnet-5": "anthropic/claude-sonnet-5",
  "claude-haiku-4-5": "anthropic/claude-haiku-4.5",
  "gpt-5": "openai/gpt-5",
  "gpt-5-mini": "openai/gpt-5-mini",
  "gemini-2.5-pro": "google/gemini-2.5-pro",
  "gemini-2.5-flash": "google/gemini-2.5-flash",
};

export interface LivePriceResult {
  /** Full model list: updated copies where a live price was found, the
   *  original spec (bundled snapshot) everywhere else. */
  models: ModelSpec[];
  /** Display names whose prices were refreshed. */
  updated: string[];
  /** Display names the source did not cover (kept on snapshot prices). */
  missing: string[];
  /** ISO date of the refresh. */
  fetchedAt: string;
}

/** USD/MTok from OpenRouter's per-token string; null when absent/invalid. */
function perMTok(v: unknown): number | null {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n * 1e6 : null;
}

/** Pure mapping of a fetched payload onto the model registry. */
export function applyLivePrices(
  models: ModelSpec[],
  payload: unknown,
  fetchedAt: string,
): LivePriceResult {
  const rows =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data as Array<Record<string, unknown>>)
      : [];
  const bySlug = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    if (typeof r?.id === "string") bySlug.set(r.id, r);
  }

  const updated: string[] = [];
  const missing: string[] = [];
  const next = models.map((m) => {
    const row = bySlug.get(SLUGS[m.id] ?? "");
    const pricing = (row?.pricing ?? null) as Record<string, unknown> | null;
    const input = perMTok(pricing?.prompt);
    const output = perMTok(pricing?.completion);
    if (input === null || output === null) {
      missing.push(m.displayName);
      return m;
    }
    updated.push(m.displayName);
    return {
      ...m,
      inputPerMTok: input,
      outputPerMTok: output,
      pricesAsOf: fetchedAt,
      verifyPricing: false,
      priceSource: "live" as const,
    };
  });
  return { models: next, updated, missing, fetchedAt };
}

/** The only network call in the codebase outside the Quality Lab. */
export async function fetchLivePrices(models: ModelSpec[]): Promise<LivePriceResult> {
  const res = await fetch(PRICE_SOURCE_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Price source responded ${res.status}`);
  const payload: unknown = await res.json();
  return applyLivePrices(models, payload, new Date().toISOString().slice(0, 10));
}

// ------------------------------------------------- automatic refresh -----
// Prices change on a scale of days, not keystrokes, so "always fresh" means:
// refresh once per app load, serve from a local cache inside the TTL, and
// fall back to the last known prices (then the bundled snapshot) offline.
// Storage and clock are injected so every branch is testable without a
// browser or a network.

export const PRICE_CACHE_KEY = "token-econ.live-prices.v1";
export const PRICE_CACHE_TTL_MS = 6 * 3_600_000; // 6 hours

/** The subset of a fetch worth remembering: id → $/MTok. */
interface PriceCache {
  /** Full ISO timestamp of the successful fetch (drives the TTL). */
  fetchedAt: string;
  prices: Record<string, { input: number; output: number }>;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function toCache(models: ModelSpec[], fetchedAt: string): PriceCache {
  const prices: PriceCache["prices"] = {};
  for (const m of models) {
    if (m.priceSource === "live") prices[m.id] = { input: m.inputPerMTok, output: m.outputPerMTok };
  }
  return { fetchedAt, prices };
}

function readCache(storage: StorageLike): PriceCache | null {
  try {
    const raw = storage.getItem(PRICE_CACHE_KEY);
    if (raw === null) return null;
    const p: unknown = JSON.parse(raw);
    if (typeof p !== "object" || p === null) return null;
    const c = p as PriceCache;
    if (typeof c.fetchedAt !== "string" || Number.isNaN(Date.parse(c.fetchedAt))) return null;
    if (typeof c.prices !== "object" || c.prices === null) return null;
    return c;
  } catch {
    return null;
  }
}

/** Apply remembered prices to the registry (same honesty flags as a fetch). */
function applyCache(models: ModelSpec[], cache: PriceCache): LivePriceResult {
  const date = cache.fetchedAt.slice(0, 10);
  const updated: string[] = [];
  const missing: string[] = [];
  const next = models.map((m) => {
    const p = cache.prices[m.id];
    if (
      p === undefined ||
      !Number.isFinite(p.input) ||
      !Number.isFinite(p.output) ||
      p.input <= 0 ||
      p.output <= 0
    ) {
      missing.push(m.displayName);
      return m;
    }
    updated.push(m.displayName);
    return {
      ...m,
      inputPerMTok: p.input,
      outputPerMTok: p.output,
      pricesAsOf: date,
      verifyPricing: false,
      priceSource: "live" as const,
    };
  });
  return { models: next, updated, missing, fetchedAt: date };
}

export type AutoPriceResult = LivePriceResult & { via: "network" | "cache" };

/**
 * Keep prices current without user action: serve from cache inside the TTL,
 * otherwise fetch and remember; a failed fetch falls back to the last known
 * prices. Returns null when there is nothing better than the bundled
 * snapshot (first run while offline).
 */
export async function autoLoadPrices(
  models: ModelSpec[],
  storage: StorageLike,
  now: number = Date.now(),
): Promise<AutoPriceResult | null> {
  const cache = readCache(storage);
  const fresh = cache !== null && now - Date.parse(cache.fetchedAt) < PRICE_CACHE_TTL_MS;
  if (cache !== null && fresh) {
    const r = applyCache(models, cache);
    return r.updated.length > 0 ? { ...r, via: "cache" } : null;
  }
  try {
    const r = await fetchLivePrices(models);
    rememberPrices(storage, r, now);
    return { ...r, via: "network" };
  } catch {
    if (cache !== null) {
      const r = applyCache(models, cache);
      if (r.updated.length > 0) return { ...r, via: "cache" };
    }
    return null;
  }
}

/** Persist a successful fetch so the next load starts current even offline. */
export function rememberPrices(storage: StorageLike, r: LivePriceResult, now: number): void {
  try {
    storage.setItem(PRICE_CACHE_KEY, JSON.stringify(toCache(r.models, new Date(now).toISOString())));
  } catch {
    // Storage full/unavailable: prices still applied for this session.
  }
}
