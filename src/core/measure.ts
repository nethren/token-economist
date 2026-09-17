import type { MeasureRun, ModelSpec, QualityCheck, SampleResult } from "./types";
import { countBaseTokens, calibrated } from "./tokenizer";

/**
 * Quality evidence.
 *
 * Token Economist never calls a model. You run the check in whatever AI tool
 * you already pay for, paste the replies back, and everything here scores them
 * locally and deterministically. That keeps the app offline and keyless, and
 * it means the evidence belongs to you rather than to us — which is also why
 * every run is labelled with where it came from.
 */

export const MAX_SAMPLES_PER_RUN = 5;
export const HARD_MAX_TOKENS = 1024;

/**
 * What running this check would cost, on the user's own account, in their own
 * tool. Informational only: no money moves through this app.
 */
export function previewRunCost(
  model: ModelSpec,
  prompt: string,
  samples: string[],
  maxTokens: number,
): { totalUSD: number; perSampleUSD: number } {
  const capped = Math.min(maxTokens, HARD_MAX_TOKENS);
  const promptTok = calibrated(countBaseTokens(prompt), model).high;
  let total = 0;
  for (const s of samples.slice(0, MAX_SAMPLES_PER_RUN)) {
    const inTok = promptTok + calibrated(countBaseTokens(s), model).high;
    total += (inTok * model.inputPerMTok + capped * model.outputPerMTok) / 1e6;
  }
  return {
    totalUSD: total,
    perSampleUSD: samples.length ? total / Math.min(samples.length, MAX_SAMPLES_PER_RUN) : 0,
  };
}

/** Score an output against the user's "good enough" definition. */
export function scoreOutput(output: string, check: QualityCheck): boolean | null {
  switch (check.kind) {
    case "contains": {
      if (!check.value) return null;
      const hay = check.caseSensitive ? output : output.toLowerCase();
      const needle = check.caseSensitive ? check.value : check.value.toLowerCase();
      return hay.includes(needle);
    }
    case "regex": {
      if (!check.value) return null;
      try {
        return new RegExp(check.value, check.caseSensitive ? "" : "i").test(output);
      } catch {
        return null;
      }
    }
    case "json": {
      try {
        JSON.parse(extractJson(output));
        return true;
      } catch {
        return false;
      }
    }
    case "manual":
      return null;
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = text.search(/[[{]/);
  if (first >= 0) return text.slice(first).trim();
  return text.trim();
}

/**
 * Identifies the exact prompt and reply cap a run measured, so a stamp earned
 * on one configuration cannot follow the user to a different one. It also ties
 * an exported check pack to the prompt it was generated from.
 */
export function runFingerprint(prompt: string, maxTokens: number): string {
  const s = `${prompt}\0${maxTokens}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}-${s.length}`;
}

/**
 * Turn replies the user produced in their own tool into a scored run.
 *
 * Token counts are estimated with the offline tokenizer, because the real
 * usage lives in their provider dashboard and never reaches us. They are
 * labelled as estimates wherever they are shown. An empty reply stays
 * unreviewed rather than counting as a failure — a box the user has not filled
 * in is missing evidence, not bad evidence.
 */
export function buildPastedRun(opts: {
  model: ModelSpec;
  prompt: string;
  samples: string[];
  outputs: string[];
  check: QualityCheck;
  maxTokens: number;
}): MeasureRun {
  const samples = opts.samples.slice(0, MAX_SAMPLES_PER_RUN);
  const promptTok = calibrated(countBaseTokens(opts.prompt), opts.model).point;
  let total = 0;

  const results: SampleResult[] = samples.map((sample, i) => {
    const output = opts.outputs[i] ?? "";
    const filled = output.trim().length > 0;
    const inputTokens = promptTok + calibrated(countBaseTokens(sample), opts.model).point;
    const outputTokens = filled ? calibrated(countBaseTokens(output), opts.model).point : 0;
    const costUSD =
      (inputTokens * opts.model.inputPerMTok + outputTokens * opts.model.outputPerMTok) / 1e6;
    if (filled) total += costUSD;
    return {
      input: sample,
      output,
      pass: filled ? scoreOutput(output, opts.check) : null,
      inputTokens,
      outputTokens,
      costUSD,
      cached: false,
      latencyMs: 0,
    };
  });

  return {
    modelId: opts.model.id,
    check: opts.check,
    results,
    totalCostUSD: total,
    ranAt: new Date().toISOString(),
    ranAgainst: runFingerprint(opts.prompt, opts.maxTokens),
    source: "byo",
  };
}
