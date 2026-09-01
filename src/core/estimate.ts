import type { Band, CostBreakdown, ModelEstimate, ModelSpec, ScaleAssumptions } from "./types";
import { calibrated, countBaseTokens } from "./tokenizer";

/**
 * Deterministic cost engine. Free, offline, no model calls (see eval:
 * this module must run with fetch stubbed to throw).
 *
 * Request model (DECISIONS.md D5): a "request" is one API call; a
 * conversation is `turnsPerConversation` requests whose history grows.
 * Turn t input = prefix + t·userIn + (t−1)·output + toolOverhead.
 */

export const FALLBACK_OUTPUT_TOKENS = 250;

/** Resolve the output-per-turn band from the stated assumptions (D4). */
export function outputBand(a: ScaleAssumptions): { band: Band; notes: string[] } {
  const notes: string[] = [];
  const cap = a.maxOutputTokens;
  let expected = a.expectedOutputTokens;
  if (expected == null && cap != null) {
    expected = Math.round(cap * 0.6);
    notes.push(`No expected output length given; assumed 60% of the ${cap}-token cap.`);
  }
  if (expected == null) {
    expected = FALLBACK_OUTPUT_TOKENS;
    notes.push(
      `No expected output length or max-tokens cap given; assumed ${FALLBACK_OUTPUT_TOKENS} tokens. Set one — this is the least-grounded number in the estimate.`,
    );
  }
  const clamp = (n: number) => (cap != null ? Math.min(n, cap) : n);
  return {
    band: {
      low: clamp(Math.round(expected * 0.5)),
      point: clamp(expected),
      high: clamp(Math.round(expected * 1.5)),
    },
    notes,
  };
}

interface Scenario {
  prefixTokens: number; // calibrated prompt tokens for this bound
  outputTokens: number; // output per turn for this bound
}

/**
 * Cost of one conversation for one bound of the band, split by driver so the
 * UI can show "where the money goes". Retry and batch multipliers are folded
 * into every component, so the components sum exactly to the total.
 */
function conversationBreakdown(
  model: ModelSpec,
  a: ScaleAssumptions,
  s: Scenario,
): CostBreakdown & { total: number } {
  const N = Math.max(1, a.turnsPerConversation);
  const U = a.avgUserInputTokens;
  const O = s.outputTokens;
  const P = s.prefixTokens;
  const T = a.toolCallsPerTurn * a.tokensPerToolCall;
  const R = a.reasoningTokensPerTurn;

  const inPrice = model.inputPerMTok / 1e6;
  const outPrice = model.outputPerMTok / 1e6;
  const mult = (1 + a.retryRate) * (a.useBatch ? model.batchMult : 1);

  // Prefix billing: cached vs not.
  const cachingEngages = a.useCaching && P >= model.cacheMinTokens;
  let prefixCost: number;
  if (cachingEngages) {
    const h = a.cacheHitRate;
    prefixCost = P * N * inPrice * (h * model.cacheReadMult + (1 - h) * model.cacheWriteMult);
  } else {
    prefixCost = P * N * inPrice;
  }

  // Fresh user input + re-sent history (visible output only — providers strip
  // reasoning blocks from later-turn context, so R never re-bills as input).
  const userAndHistory = (U * ((N * (N + 1)) / 2) + O * ((N * (N - 1)) / 2)) * inPrice;
  const tools = T * N * inPrice;
  const output = O * N * outPrice;
  const reasoning = R * N * outPrice;

  const b: CostBreakdown = {
    prefix: prefixCost * mult,
    userAndHistory: userAndHistory * mult,
    tools: tools * mult,
    output: output * mult,
    reasoning: reasoning * mult,
  };
  return { ...b, total: b.prefix + b.userAndHistory + b.tools + b.output + b.reasoning };
}

/** Cost of one conversation in USD for one bound of the band. */
function conversationCost(model: ModelSpec, a: ScaleAssumptions, s: Scenario): number {
  return conversationBreakdown(model, a, s).total;
}

/** Average input tokens per API request for one bound. */
function avgInputPerRequest(a: ScaleAssumptions, s: Scenario): number {
  const N = Math.max(1, a.turnsPerConversation);
  const U = a.avgUserInputTokens;
  const O = s.outputTokens;
  const T = a.toolCallsPerTurn * a.tokensPerToolCall;
  return Math.round(s.prefixTokens + (U * (N + 1)) / 2 + (O * (N - 1)) / 2 + T);
}

export function estimateModel(
  prompt: string,
  a: ScaleAssumptions,
  model: ModelSpec,
): ModelEstimate {
  const baseTokens = countBaseTokens(prompt);
  const promptTokens = calibrated(baseTokens, model);
  const { band: out, notes } = outputBand(a);
  const assumptionNotes = [...notes];

  const N = Math.max(1, a.turnsPerConversation);

  const bound = (prefix: number, output: number) =>
    conversationCost(model, a, { prefixTokens: prefix, outputTokens: output });

  const costPerConversation: Band = {
    low: bound(promptTokens.low, out.low),
    point: bound(promptTokens.point, out.point),
    high: bound(promptTokens.high, out.high),
  };
  const costPerMonth: Band = {
    low: costPerConversation.low * a.requestsPerMonth,
    point: costPerConversation.point * a.requestsPerMonth,
    high: costPerConversation.high * a.requestsPerMonth,
  };

  // Point-scenario split by driver — powers "where the money goes".
  const pointBreakdown = conversationBreakdown(model, a, {
    prefixTokens: promptTokens.point,
    outputTokens: out.point,
  });
  const breakdown: CostBreakdown = {
    prefix: pointBreakdown.prefix,
    userAndHistory: pointBreakdown.userAndHistory,
    tools: pointBreakdown.tools,
    output: pointBreakdown.output,
    reasoning: pointBreakdown.reasoning,
  };

  // Prefix share (point scenario): what fraction of spend is the pasted prompt.
  const prefixShareOfCost =
    costPerConversation.point > 0 ? breakdown.prefix / costPerConversation.point : 0;

  if (a.useCaching && promptTokens.point < model.cacheMinTokens) {
    assumptionNotes.push(
      `Prompt (~${promptTokens.point} tokens) is below ${model.displayName}'s ${model.cacheMinTokens}-token cache minimum — caching will not engage.`,
    );
  }
  if (a.reasoningTokensPerTurn > 0) {
    assumptionNotes.push(
      `Includes ${a.reasoningTokensPerTurn} hidden reasoning tokens/turn billed at output price (thinking models); they are not re-sent as history.`,
    );
  }
  if (model.verifyPricing) {
    assumptionNotes.push(
      `Prices for ${model.displayName} sourced ${model.pricesAsOf}; confirm current pricing before committing.`,
    );
  }

  // Context check on the largest (last) turn, high bound. Reasoning tokens
  // occupy the window during generation even though they never re-bill.
  const lastTurnInput =
    promptTokens.high +
    N * a.avgUserInputTokens +
    (N - 1) * out.high +
    a.toolCallsPerTurn * a.tokensPerToolCall;
  const exceedsContext =
    lastTurnInput + out.high + a.reasoningTokensPerTurn > model.contextWindow;

  return {
    model,
    promptBaseTokens: baseTokens,
    promptTokens,
    inputTokensPerRequest: {
      low: avgInputPerRequest(a, { prefixTokens: promptTokens.low, outputTokens: out.low }),
      point: avgInputPerRequest(a, { prefixTokens: promptTokens.point, outputTokens: out.point }),
      high: avgInputPerRequest(a, { prefixTokens: promptTokens.high, outputTokens: out.high }),
    },
    outputTokensPerRequest: out,
    costPerConversation,
    costPerMonth,
    breakdown,
    prefixShareOfCost,
    exceedsContext,
    assumptionNotes,
  };
}

export function estimateAll(
  prompt: string,
  a: ScaleAssumptions,
  models: ModelSpec[],
): ModelEstimate[] {
  return models.map((m) => estimateModel(prompt, a, m));
}
