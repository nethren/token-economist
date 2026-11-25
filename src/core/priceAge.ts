/**
 * How old a price snapshot is, and when it counts as stale. Shared by the app
 * (the "stale — verify" flag and the live price check) and the weekly sync
 * (which keeps a current official price rather than overwriting it, D41).
 * It has no imports, so the sync script can load it under plain Node.
 */

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
