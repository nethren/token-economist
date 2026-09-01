import type { MeasureRun, ModelSpec, QualityCheck, SampleResult } from "./types";
import { countBaseTokens, calibrated } from "./tokenizer";

declare const __QUALITY_LAB_LOCAL__: boolean;

/**
 * Tier-2 quality measurement — the ONLY module allowed to spend money.
 * Everything here is explicitly user-triggered, bounded, cost-previewed,
 * and cached. Nothing in this file is imported by the cost/lint path.
 */

export const MAX_SAMPLES_PER_RUN = 5;
export const MAX_MODELS_PER_RUN = 2;
export const HARD_MAX_TOKENS = 1024;

/** Deterministic cost preview shown BEFORE the run button activates. */
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
  return { totalUSD: total, perSampleUSD: samples.length ? total / Math.min(samples.length, MAX_SAMPLES_PER_RUN) : 0 };
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

// ------------------------------------------------------------- adapters ----

export interface CompletionRequest {
  modelId: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface CompletionResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderAdapter {
  provider: ModelSpec["provider"];
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

export const QUALITY_LAB_PROVIDERS = ["anthropic", "openai", "google"] as const;

export interface QualityLabStatus {
  available: true;
  configuredProviders: ModelSpec["provider"][];
}

/** Detect the loopback-only service. Static/public builds have no such route. */
export async function getQualityLabStatus(): Promise<QualityLabStatus> {
  if (!__QUALITY_LAB_LOCAL__) {
    throw new Error("Local Quality Lab service is unavailable");
  }
  const res = await fetch("/api/quality/status", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Local Quality Lab service is unavailable");
  const data = (await res.json()) as Partial<QualityLabStatus>;
  if (data.available !== true || !Array.isArray(data.configuredProviders)) {
    throw new Error("Local Quality Lab service returned an invalid status");
  }
  return {
    available: true,
    configuredProviders: data.configuredProviders.filter((provider) =>
      QUALITY_LAB_PROVIDERS.includes(provider as (typeof QUALITY_LAB_PROVIDERS)[number]),
    ),
  };
}

function localProxyAdapter(provider: (typeof QUALITY_LAB_PROVIDERS)[number]): ProviderAdapter {
  return {
    provider,
    async complete(req) {
      const res = await fetch("/api/quality/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          provider,
          modelId: req.modelId,
          system: req.system,
          user: req.user,
          maxTokens: Math.min(req.maxTokens, HARD_MAX_TOKENS),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<CompletionResponse> & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `Quality Lab request failed (${res.status})`);
      if (
        typeof data.text !== "string" ||
        typeof data.inputTokens !== "number" ||
        typeof data.outputTokens !== "number"
      ) {
        throw new Error("Local Quality Lab service returned an invalid response");
      }
      return {
        text: data.text,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
      };
    },
  };
}

export const anthropicAdapter = localProxyAdapter("anthropic");
export const openaiAdapter = localProxyAdapter("openai");
export const googleAdapter = localProxyAdapter("google");

export const ADAPTERS: Record<string, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
};

// ---------------------------------------------------------------- runner ----

/** Storage-agnostic result cache so the same sample is never paid for twice. */
export interface ResultCache {
  get(key: string): SampleResult | null;
  set(key: string, value: SampleResult): void;
}

export function cacheKey(modelId: string, prompt: string, sample: string, maxTokens: number): string {
  // djb2 — stable, dependency-free; collisions are acceptable for a cost cache.
  const s = `${modelId}\0${prompt}\0${sample}\0${maxTokens}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `te-run-${modelId}-${(h >>> 0).toString(36)}-${s.length}`;
}

export async function runMeasurement(opts: {
  model: ModelSpec;
  prompt: string;
  samples: string[];
  check: QualityCheck;
  maxTokens: number;
  cache: ResultCache;
  onProgress?: (done: number, total: number) => void;
}): Promise<MeasureRun> {
  const adapter = ADAPTERS[opts.model.provider];
  if (!adapter) throw new Error(`No Tier-2 adapter for provider ${opts.model.provider}`);
  const samples = opts.samples.slice(0, MAX_SAMPLES_PER_RUN);
  const results: SampleResult[] = [];
  let total = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const key = cacheKey(opts.model.id, opts.prompt, sample, opts.maxTokens);
    const cached = opts.cache.get(key);
    if (cached) {
      results.push({ ...cached, pass: scoreOutput(cached.output, opts.check), cached: true });
      opts.onProgress?.(i + 1, samples.length);
      continue;
    }
    const started = Date.now();
    const res = await adapter.complete({
      modelId: opts.model.id,
      system: opts.prompt,
      user: sample,
      maxTokens: opts.maxTokens,
    });
    const cost =
      (res.inputTokens * opts.model.inputPerMTok + res.outputTokens * opts.model.outputPerMTok) / 1e6;
    const result: SampleResult = {
      input: sample,
      output: res.text,
      pass: scoreOutput(res.text, opts.check),
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUSD: cost,
      cached: false,
      latencyMs: Date.now() - started,
    };
    total += cost;
    opts.cache.set(key, result);
    results.push(result);
    opts.onProgress?.(i + 1, samples.length);
  }

  return {
    modelId: opts.model.id,
    check: opts.check,
    results,
    totalCostUSD: total,
    ranAt: new Date().toISOString(),
  };
}
