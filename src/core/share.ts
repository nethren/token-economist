import type { ScaleAssumptions } from "./types";
import { DEFAULT_ASSUMPTIONS } from "./types";
import { resolveModelId } from "./models";

/**
 * Shareable permalink codec: the whole design-time decision (feature name,
 * prompt, assumptions, reference model) round-trips through the URL hash as
 * URL-safe base64 JSON. Pure string↔state transforms, zero network — a link
 * pasted in a ticket reproduces the exact same deterministic estimate.
 *
 * Privacy note: the prompt lives in the URL *fragment*, which browsers never
 * send to any server — sharing the link shares the prompt with the recipient,
 * nothing else.
 */

export interface ShareState {
  featureName: string;
  prompt: string;
  assumptions: ScaleAssumptions;
  referenceId: string;
}

/** A decoded link, plus what happened to a model the link named that this
 *  build no longer carries (retired, or unknown). Never encoded. */
export interface DecodedShare extends ShareState {
  referenceNote: string | null;
}

const VERSION = 1;

/** Assumption keys where null is a meaningful value ("unknown / uncapped"). */
const NULLABLE = new Set<keyof ScaleAssumptions>(["expectedOutputTokens", "maxOutputTokens"]);

export function encodeShareState(s: ShareState): string {
  const json = JSON.stringify({ v: VERSION, ...s });
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a hash produced by encodeShareState. Tolerant by design: unknown or
 * ill-typed assumption fields fall back to defaults; garbage returns null so
 * the app loads its normal first-run state.
 */
export function decodeShareState(hash: string): DecodedShare | null {
  try {
    const b64 = hash.replace(/^#/, "").replace(/-/g, "+").replace(/_/g, "/");
    if (b64 === "") return null;
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (p.v !== VERSION || typeof p.prompt !== "string") return null;

    const raw = (typeof p.assumptions === "object" && p.assumptions !== null
      ? p.assumptions
      : {}) as Record<string, unknown>;
    const assumptions = { ...DEFAULT_ASSUMPTIONS };
    for (const k of Object.keys(assumptions) as (keyof ScaleAssumptions)[]) {
      const v = raw[k];
      const wanted = typeof (DEFAULT_ASSUMPTIONS[k] ?? 0);
      const ok =
        v === null
          ? NULLABLE.has(k)
          : typeof v === wanted && (typeof v !== "number" || Number.isFinite(v));
      if (ok) (assumptions as Record<string, unknown>)[k] = v;
    }

    // A retired model resolves to its named successor and an unknown one to
    // the default, with a note either way, never a silent swap.
    const reference = resolveModelId(p.referenceId);

    return {
      featureName: typeof p.featureName === "string" ? p.featureName : "",
      prompt: p.prompt,
      assumptions,
      referenceId: reference.id,
      referenceNote: reference.note,
    };
  } catch {
    return null;
  }
}
