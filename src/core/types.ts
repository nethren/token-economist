/** A value that is honestly a range, not a point. */
export interface Band {
  low: number;
  point: number;
  high: number;
}

export type Provider = "anthropic" | "openai" | "google";

export interface ModelSpec {
  /** API model id, e.g. "claude-haiku-4-5" */
  id: string;
  provider: Provider;
  displayName: string;
  /** Coarse capability tier used for comparisons and linter suggestions. */
  tier: "frontier" | "workhorse" | "economy";
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
  /** Cache read price as a fraction of input price (e.g. 0.1). */
  cacheReadMult: number;
  /** Cache write (5m TTL) price as a multiple of input price (e.g. 1.25). */
  cacheWriteMult: number;
  /** Minimum cacheable prefix in tokens (0 = caching unavailable). */
  cacheMinTokens: number;
  /** Batch API discount as a fraction of price paid (0.5 = half price). */
  batchMult: number;
  contextWindow: number;
  maxOutput: number;
  /**
   * Calibration band applied to the offline o200k token count to estimate
   * this provider's true tokenization. OpenAI o200k models ≈ 1.0 exactly;
   * others are documented approximations — see DECISIONS.md D2.
   */
  calibration: Band;
  /** ISO date the prices were sourced. */
  pricesAsOf: string;
  /** True when the price was not taken from a same-month official table. */
  verifyPricing?: boolean;
  /** Where the current prices came from: bundled snapshot (default) or an
   *  explicit, user-triggered live refresh. */
  priceSource?: "snapshot" | "live";
  notes?: string;
}

/** Everything the user asserts about how the feature will run in production. */
export interface ScaleAssumptions {
  /** Requests (conversations started) per month. */
  requestsPerMonth: number;
  /** Average user input per turn, in tokens (estimated from words if needed). */
  avgUserInputTokens: number;
  /** Average turns per conversation (1 = single-shot). */
  turnsPerConversation: number;
  /** Expected output length per turn, in tokens. null = unknown. */
  expectedOutputTokens: number | null;
  /** max_tokens cap, if the feature will set one. null = uncapped. */
  maxOutputTokens: number | null;
  /** Fraction of requests retried (0.03 = 3%). */
  retryRate: number;
  /** Tool calls per turn. */
  toolCallsPerTurn: number;
  /** Average tokens per tool call (definition echo + result). */
  tokensPerToolCall: number;
  /**
   * Hidden reasoning/thinking tokens per turn (billed as output, invisible in
   * the reply). 0 = non-thinking model or thinking disabled. Not carried into
   * later-turn history: providers strip thinking blocks from context.
   */
  reasoningTokensPerTurn: number;
  /** Whether the static prefix will use prompt caching. */
  useCaching: boolean;
  /** Cache hit rate among requests when caching is on. */
  cacheHitRate: number;
  /** Whether the workload can run on the Batch API (50% discount). */
  useBatch: boolean;
}

export const DEFAULT_ASSUMPTIONS: ScaleAssumptions = {
  requestsPerMonth: 10_000,
  avgUserInputTokens: 150,
  turnsPerConversation: 1,
  expectedOutputTokens: null,
  maxOutputTokens: null,
  retryRate: 0.03,
  toolCallsPerTurn: 0,
  tokensPerToolCall: 400,
  reasoningTokensPerTurn: 0,
  useCaching: false,
  cacheHitRate: 0.9,
  useBatch: false,
};

/**
 * "Where the money goes": point-scenario USD per conversation split by
 * driver. Components include retry and batch effects, so they sum exactly
 * to costPerConversation.point.
 */
export interface CostBreakdown {
  /** Static prompt prefix (after any caching discount). */
  prefix: number;
  /** Fresh user messages + re-sent conversation history. */
  userAndHistory: number;
  /** Tool definitions echoed + tool results read back. */
  tools: number;
  /** Visible output tokens. */
  output: number;
  /** Hidden reasoning/thinking tokens (billed as output). */
  reasoning: number;
}

/** Deterministic cost estimate for one model. */
export interface ModelEstimate {
  model: ModelSpec;
  /** Base (o200k) token count of the pasted prompt. */
  promptBaseTokens: number;
  /** Calibrated prompt tokens for this provider. */
  promptTokens: Band;
  /** Average input tokens per API request (see DECISIONS.md D5). */
  inputTokensPerRequest: Band;
  /** Output tokens per API request. */
  outputTokensPerRequest: Band;
  /** USD per conversation (all turns, retries included). */
  costPerConversation: Band;
  /** USD per month at the stated request volume. */
  costPerMonth: Band;
  /** Point-scenario cost split by driver (sums to costPerConversation.point). */
  breakdown: CostBreakdown;
  /** Fraction of monthly cost attributable to the static prefix. */
  prefixShareOfCost: number;
  /** True if avg request exceeds the model's context window. */
  exceedsContext: boolean;
  /** Notes generated during estimation (assumption defaults used, etc.) */
  assumptionNotes: string[];
}

export type LintSeverity = "high" | "medium" | "low";

/**
 * A one-click assumption change the UI can offer next to a finding, so the
 * biggest savings are actionable where they're shown (plain data, not a
 * function, so findings stay deep-comparable in the determinism eval).
 */
export type LintAction =
  | { kind: "enable-caching" }
  | { kind: "set-output-cap"; tokens: number };

export interface LintFinding {
  rule: string;
  title: string;
  severity: LintSeverity;
  /** What was found, concretely, quoting the prompt where useful. */
  detail: string;
  /** Estimated prompt tokens saved if the suggestion is applied (base o200k). */
  tokensSaved: number;
  /** Estimated USD/month saved at the stated assumptions on a given model. */
  monthlySavingUSD: Band | null;
  /** Optional machine-applied transformation of the prompt (for the eval). */
  apply?: (prompt: string) => string;
  /** Optional one-click assumption change (rendered as a button in the UI). */
  action?: LintAction;
}

export interface QualityCheck {
  kind: "contains" | "regex" | "json" | "manual";
  /** For contains/regex: the pattern. */
  value?: string;
  caseSensitive?: boolean;
}

export interface SampleResult {
  input: string;
  output: string;
  pass: boolean | null; // null = awaiting manual judgment
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  cached: boolean;
  latencyMs: number;
}

export interface MeasureRun {
  modelId: string;
  check: QualityCheck;
  results: SampleResult[];
  totalCostUSD: number;
  ranAt: string;
  /**
   * Fingerprint of the prompt and reply cap this run measured. Evidence is
   * only valid for the configuration it was collected against: edit the
   * prompt and the run becomes stale rather than certifying something it
   * never saw.
   */
  ranAgainst: string;
}
