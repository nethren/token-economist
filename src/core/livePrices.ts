import type { ModelSpec } from "./types";
import { STALE_PRICE_DAYS, priceAgeDays } from "./models";

/**
 * Price check against a public list (D13, D14, D39). NEVER called on the free
 * estimate path — the eval landmines guarantee estimate/lint/card work with
 * fetch stubbed to throw. It downloads a public price table; the prompt is
 * never transmitted.
 *
 * Source: OpenRouter's public model list (no key, CORS-open). Prices there
 * are USD per token, as strings. Each registry entry carries its own
 * `openrouterSlug`, so the check covers whatever models are bundled and
 * never adds one.
 *
 * The bundled prices come from the providers' own pricing pages, and the
 * public list is an aggregator that can differ from them (it lists Gemini 3.8
 * Flash 10% above Google's price). So a current official price is kept and
 * the list's figure is recorded beside it. The list's price is used only
 * where the bundled one is stale (older than STALE_PRICE_DAYS) or was never
 * checked against the provider (`verifyPricing`). Every function here except
 * the fetch is pure and testable offline.
 */

export const PRICE_SOURCE_URL = "https://openrouter.ai/api/v1/models";
export const PRICE_SOURCE_NAME = "openrouter.ai";

/** USD per 1M tokens, as the list states it, keyed by registry id. */
type ListedPrices = Record<string, { input: number; output: number }>;

export interface LivePriceResult {
  /** The registry with each model reconciled against the list. */
  models: ModelSpec[];
  /** The list's price was used: the bundled one was stale or unverified. */
  updated: string[];
  /** The list agrees with the price in use. */
  matched: string[];
  /** The list disagrees; the official price was kept and the list's recorded. */
  differs: string[];
  /** Not on the list (or not parseable); bundled price kept. */
  missing: string[];
  /** ISO date of the check. */
  fetchedAt: string;
  /** What the list said, for the cache. */
  listed: ListedPrices;
}

/** USD/MTok from OpenRouter's per-token string, rounded to strip float noise
 *  ("0.0000001" × 1e6 is 0.09999999999999999); null when absent/invalid. */
function perMTok(v: unknown): number | null {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e12) / 1e6 : null;
}

/** Equal up to float noise from the per-token strings. */
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(a, b);

/** Reconcile every model with the list's prices (pure). */
export function reconcilePrices(models: ModelSpec[], listed: ListedPrices, checkedOn: string): LivePriceResult {
  const updated: string[] = [];
  const matched: string[] = [];
  const differs: string[] = [];
  const missing: string[] = [];
  const next = models.map((m): ModelSpec => {
    const p = listed[m.id];
    if (p === undefined || !(p.input > 0) || !(p.output > 0) || !Number.isFinite(p.input + p.output)) {
      missing.push(m.displayName);
      return m;
    }
    const listPrice = { inputPerMTok: p.input, outputPerMTok: p.output, checkedOn };
    if (same(p.input, m.inputPerMTok) && same(p.output, m.outputPerMTok)) {
      matched.push(m.displayName);
      // Record the agreed price exactly, so nothing downstream sees a difference.
      return { ...m, listPrice: { inputPerMTok: m.inputPerMTok, outputPerMTok: m.outputPerMTok, checkedOn } };
    }
    const trusted = !m.verifyPricing && priceAgeDays(m.pricesAsOf, checkedOn) <= STALE_PRICE_DAYS;
    if (trusted) {
      differs.push(m.displayName);
      return { ...m, listPrice };
    }
    updated.push(m.displayName);
    return {
      ...m,
      inputPerMTok: p.input,
      outputPerMTok: p.output,
      pricesAsOf: checkedOn,
      // An aggregator's figure, not the provider's own table.
      verifyPricing: true,
      priceSource: "live",
      listPrice,
    };
  });
  return { models: next, updated, matched, differs, missing, fetchedAt: checkedOn, listed };
}

/** Pure mapping of a fetched payload onto the model registry. */
export function applyLivePrices(models: ModelSpec[], payload: unknown, fetchedAt: string): LivePriceResult {
  const rows =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data as Array<Record<string, unknown>>)
      : [];
  const bySlug = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    if (typeof r?.id === "string") bySlug.set(r.id, r);
  }
  const listed: ListedPrices = {};
  for (const m of models) {
    const pricing = (bySlug.get(m.openrouterSlug)?.pricing ?? null) as Record<string, unknown> | null;
    const input = perMTok(pricing?.prompt);
    const output = perMTok(pricing?.completion);
    if (input !== null && output !== null) listed[m.id] = { input, output };
  }
  return reconcilePrices(models, listed, fetchedAt);
}

/** Fetches the public model price list without sending prompt data. */
export async function fetchLivePrices(models: ModelSpec[]): Promise<LivePriceResult> {
  const res = await fetch(PRICE_SOURCE_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Price source responded ${res.status}`);
  const payload: unknown = await res.json();
  return applyLivePrices(models, payload, new Date().toISOString().slice(0, 10));
}

// ------------------------------------------------- automatic refresh -----
// Prices change on a scale of days, not keystrokes, so the check runs once
// per app load, is served from a local cache inside the TTL, and falls back
// to the last known list (then the bundled prices alone) offline. Storage
// and clock are injected so every branch is testable without a browser or a
// network.

export const PRICE_CACHE_KEY = "token-econ.live-prices.v1";
export const PRICE_CACHE_TTL_MS = 6 * 3_600_000; // 6 hours

/** The subset of a fetch worth remembering: id → the list's $/MTok. */
interface PriceCache {
  /** Full ISO timestamp of the successful fetch (drives the TTL). */
  fetchedAt: string;
  prices: ListedPrices;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

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

/** Reconcile against a remembered list, as if it had just been fetched. */
function applyCache(models: ModelSpec[], cache: PriceCache): LivePriceResult {
  const clean: ListedPrices = {};
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  for (const [id, p] of Object.entries(cache.prices)) {
    // Caches written before D39 hold unrounded per-token products.
    if (typeof p?.input === "number" && typeof p?.output === "number") {
      clean[id] = { input: round(p.input), output: round(p.output) };
    }
  }
  return reconcilePrices(models, clean, cache.fetchedAt.slice(0, 10));
}

const checkedAny = (r: LivePriceResult) => r.models.some((m) => m.listPrice !== undefined);

export type AutoPriceResult = LivePriceResult & { via: "network" | "cache" };

/**
 * Check prices without user action: serve from cache inside the TTL,
 * otherwise fetch and remember; a failed fetch falls back to the last known
 * list. Returns null when there is nothing to check against (first run
 * while offline).
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
    return checkedAny(r) ? { ...r, via: "cache" } : null;
  }
  try {
    const r = await fetchLivePrices(models);
    rememberPrices(storage, r, now);
    return { ...r, via: "network" };
  } catch {
    if (cache !== null) {
      const r = applyCache(models, cache);
      if (checkedAny(r)) return { ...r, via: "cache" };
    }
    return null;
  }
}

/** Persist a successful fetch so the next load can check even offline. */
export function rememberPrices(storage: StorageLike, r: LivePriceResult, now: number): void {
  try {
    const cache: PriceCache = { fetchedAt: new Date(now).toISOString(), prices: r.listed };
    storage.setItem(PRICE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full/unavailable: the check still applies for this session.
  }
}
