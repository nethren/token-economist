import { encode } from "gpt-tokenizer/encoding/o200k_base";
import type { Band, ModelSpec } from "./types";

/**
 * Deterministic offline token count (o200k BPE). This is the *base* count;
 * provider-specific counts are derived via each model's calibration band.
 * Never makes a network call.
 */
export function countBaseTokens(text: string): number {
  if (text.length === 0) return 0;
  return encode(text).length;
}

/** Calibrated token band for a specific model/provider. */
export function calibrated(baseTokens: number, model: ModelSpec): Band {
  const c = model.calibration;
  return {
    low: Math.ceil(baseTokens * c.low),
    point: Math.ceil(baseTokens * c.point),
    high: Math.ceil(baseTokens * c.high),
  };
}

/** Rough words→tokens helper for assumption inputs (documented: ~0.75 words/token). */
export function tokensFromWords(words: number): number {
  return Math.ceil(words / 0.75);
}

/** Inverse helper so the UI can speak in words next to every token figure. */
export function wordsFromTokens(tokens: number): number {
  return Math.round(tokens * 0.75);
}

/** Plain-language size ("≈ 3,990 words · ~16 pages") for a token count. */
export function humanSize(tokens: number): string {
  const words = wordsFromTokens(tokens);
  const pages = words / 250;
  const w = `≈ ${words.toLocaleString("en-US")} words`;
  return pages >= 1 ? `${w} · ~${Math.round(pages)} page${Math.round(pages) === 1 ? "" : "s"}` : w;
}
