import type { CostBreakdown, LintFinding, MeasureRun, ModelEstimate, ScaleAssumptions } from "./types";
import { STALE_PRICE_DAYS, priceAgeDays } from "./models";

/**
 * The cost card: a one-screen decision artifact rendered as Markdown so a PM
 * can paste it straight into a ticket, doc, or PR description.
 */

export function fmtUSD(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (n >= 10) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(5)}`;
}

export function fmtBand(low: number, high: number): string {
  return `${fmtUSD(low)}–${fmtUSD(high)}`;
}

/**
 * Plain-language names for the cost drivers, shared by the UI legend and the
 * card so a PM never meets two names for the same thing. `label` is the short
 * name; `explain` is the one-line tooltip.
 */
export const BREAKDOWN_LABELS: Array<{
  key: keyof CostBreakdown;
  label: string;
  explain: string;
}> = [
  { key: "prefix", label: "your instructions", explain: "the prompt you pasted, sent on every request" },
  { key: "userAndHistory", label: "messages + history", explain: "what users type, plus earlier turns re-sent each turn" },
  { key: "tools", label: "tools + retrieved data", explain: "search results, documents, and tool output the model reads" },
  { key: "reasoning", label: "hidden thinking", explain: "tokens a reasoning model spends before it answers" },
  { key: "output", label: "the replies", explain: "the answers users actually see" },
];

/** "the model's replies 86% · messages + chat history 9% · …" — biggest driver
 *  first, zero drivers omitted. */
export function fmtBreakdown(b: CostBreakdown): string {
  const total = b.prefix + b.userAndHistory + b.tools + b.output + b.reasoning;
  if (total <= 0) return "";
  return [...BREAKDOWN_LABELS]
    .filter((s) => b[s.key] > 0)
    .sort((x, y) => b[y.key] - b[x.key])
    .map((s) => `${s.label} ${Math.round((b[s.key] / total) * 100)}%`)
    .join(" · ");
}

export interface ShortlistEntry {
  /** Plain-language role of this model in the decision. */
  label: "start here" | "balanced step up" | "safest step up";
  estimate: ModelEstimate;
}

export interface Recommendation {
  estimate: ModelEstimate;
  reason: string;
  verified: boolean;
  /** 2–3 model decision shortlist: cheapest, then the cheaper step-ups. */
  shortlist: ShortlistEntry[];
  /** The cheapest higher-tier alternative, for "if quality matters" framing. */
  stepUp: ModelEstimate | null;
}

/** The single source of truth for "cheapest model worth starting with" —
 *  used by both the headline recommendation and the linter's cheaper-tier
 *  finding so the tool never gives two different "cheap model" answers. */
export function cheapestUsable(estimates: ModelEstimate[]): ModelEstimate | null {
  const usable = estimates.filter((e) => !e.exceedsContext);
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (b.costPerMonth.point < a.costPerMonth.point ? b : a));
}

const TIER_RANK = { economy: 0, workhorse: 1, frontier: 2 } as const;

/**
 * Walk up the cost-sorted list and add a model only when it raises BOTH the
 * capability tier and the cost — a step up must actually buy more model.
 * (A "balanced" pick that costs more than a frontier model is noise.)
 */
function buildShortlist(byCost: ModelEstimate[]): ShortlistEntry[] {
  const cheapest = byCost[0];
  const shortlist: ShortlistEntry[] = [{ label: "start here", estimate: cheapest }];
  let lastRank: number = TIER_RANK[cheapest.model.tier];
  for (const e of byCost) {
    if (shortlist.length >= 3) break;
    if (TIER_RANK[e.model.tier] > lastRank) {
      shortlist.push({
        label: e.model.tier === "frontier" ? "safest step up" : "balanced step up",
        estimate: e,
      });
      lastRank = TIER_RANK[e.model.tier];
    }
  }
  return shortlist;
}

/**
 * Recommendation policy — the tool's north star is "the cheapest model that
 * is still good enough for THIS feature":
 * 1. If quality runs exist, recommend the cheapest model that passed the
 *    user's own check on every sample (or ≥80% with a caveat).
 * 2. With no quality data there is no evidence any tier is needed, so the
 *    recommendation is the CHEAPEST usable model, framed as a hypothesis to
 *    verify — never a silent default to a pricier tier. The step-up models
 *    are named alongside so "if quality matters" has a concrete next answer.
 */
export function recommend(
  estimates: ModelEstimate[],
  runs: MeasureRun[],
  simpleTask: boolean,
): Recommendation | null {
  const usable = estimates.filter((e) => !e.exceedsContext);
  if (usable.length === 0) return null;
  const byCost = [...usable].sort((x, y) => x.costPerMonth.point - y.costPerMonth.point);
  const shortlist = buildShortlist(byCost);
  const stepUp =
    shortlist.find((s) => s.label !== "start here")?.estimate ??
    byCost.find((e) => e.model.id !== byCost[0].model.id) ??
    null;

  const passRate = (r: MeasureRun) => {
    const judged = r.results.filter((s) => s.pass !== null);
    if (judged.length === 0) return null;
    return judged.filter((s) => s.pass).length / judged.length;
  };

  if (runs.length > 0) {
    for (const est of byCost) {
      const run = runs.find((r) => r.modelId === est.model.id);
      if (!run) continue;
      const rate = passRate(run);
      if (rate === null) continue;
      if (rate === 1) {
        return {
          estimate: est,
          reason: `Cheapest model that passed your check on all ${run.results.length} samples.`,
          verified: true,
          shortlist,
          stepUp,
        };
      }
      if (rate >= 0.8) {
        return {
          estimate: est,
          reason: `Cheapest model that passed on ${Math.round(rate * 100)}% of samples. Check the failures before you commit.`,
          verified: true,
          shortlist,
          stepUp,
        };
      }
    }
  }

  const cheapest = byCost[0];
  const stepUpPhrase = stepUp
    ? ` If it falls short, step up to ${stepUp.model.displayName} at ${fmtUSD(stepUp.costPerMonth.point)}/mo.`
    : "";
  return {
    estimate: cheapest,
    reason:
      (simpleTask
        ? "This looks like a short, bounded task, so the cheapest model should handle it. Run a check to be sure."
        : "No quality data yet. Start cheap, run a check, and pay for a bigger model only if this one fails.") +
      stepUpPhrase,
    verified: false,
    shortlist,
    stepUp,
  };
}

export function renderCard(opts: {
  featureName: string;
  prompt: string;
  estimates: ModelEstimate[];
  assumptions: ScaleAssumptions;
  findings: LintFinding[];
  runs: MeasureRun[];
  recommendation: Recommendation | null;
  generatedAt?: string; // injectable for deterministic tests
}): string {
  const { featureName, estimates, assumptions: a, findings, runs, recommendation } = opts;
  const date = opts.generatedAt ?? new Date().toISOString().slice(0, 10);
  const rec = recommendation;

  const lines: string[] = [];
  lines.push(`# Cost card — ${featureName || "Untitled AI feature"}`);
  lines.push("");
  lines.push(`*Generated ${date} by Token Economist. All costs are estimates with stated assumptions — ranges, not quotes.*`);
  lines.push("");

  if (rec) {
    const e = rec.estimate;
    lines.push(`## Recommendation: **${e.model.displayName}**${rec.verified ? " ✅ quality-checked" : " ⚠️ unverified"}`);
    lines.push("");
    lines.push(`${rec.reason}`);
    lines.push("");
    lines.push(
      `- **Per conversation:** ${fmtBand(e.costPerConversation.low, e.costPerConversation.high)} (point ${fmtUSD(e.costPerConversation.point)})`,
    );
    lines.push(
      `- **Per month at ${a.requestsPerMonth.toLocaleString("en-US")} conversations:** ${fmtBand(e.costPerMonth.low, e.costPerMonth.high)} (point ${fmtUSD(e.costPerMonth.point)})`,
    );
    const split = fmtBreakdown(e.breakdown);
    if (split) lines.push(`- **Where the money goes:** ${split}`);
    if (rec.shortlist.length > 1) {
      lines.push("");
      lines.push(`**Decision shortlist:**`);
      for (const s of rec.shortlist) {
        lines.push(
          `- ${s.label}: ${s.estimate.model.displayName} — ${fmtUSD(s.estimate.costPerMonth.point)}/mo (${fmtBand(s.estimate.costPerMonth.low, s.estimate.costPerMonth.high)})`,
        );
      }
    }
    lines.push("");
  }

  lines.push(`## Model comparison`);
  lines.push("");
  lines.push(`| Model | $/1M in/out | Per conversation | Per month | Notes |`);
  lines.push(`|---|---|---|---|---|`);
  for (const e of [...estimates].sort((x, y) => x.costPerMonth.point - y.costPerMonth.point)) {
    const ageDays = priceAgeDays(e.model.pricesAsOf, date);
    const notes = [
      e.exceedsContext ? "⛔ exceeds context window" : "",
      ageDays > STALE_PRICE_DAYS
        ? `prices ${Math.round(ageDays / 30)} months old — verify`
        : e.model.verifyPricing
          ? "verify pricing"
          : "",
    ]
      .filter(Boolean)
      .join("; ");
    lines.push(
      `| ${e.model.displayName} | $${e.model.inputPerMTok}/$${e.model.outputPerMTok} | ${fmtBand(e.costPerConversation.low, e.costPerConversation.high)} | ${fmtBand(e.costPerMonth.low, e.costPerMonth.high)} | ${notes} |`,
    );
  }
  lines.push("");

  if (findings.length > 0) {
    lines.push(`## Cost-cut suggestions (deterministic lint)`);
    lines.push("");
    for (const f of findings.slice(0, 5)) {
      const saving = f.monthlySavingUSD
        ? ` — est. ${fmtBand(Math.max(0, f.monthlySavingUSD.low), f.monthlySavingUSD.high)}/month`
        : "";
      lines.push(`- **${f.title}** (${f.severity})${saving}`);
      lines.push(`  ${f.detail}`);
    }
    lines.push("");
  }

  lines.push(`## Quality note`);
  lines.push("");
  if (runs.length === 0) {
    lines.push(
      `No quality measurement has been run. Cost is predictable from tokens; quality must be observed — run the Quality Lab (a handful of samples, cost previewed before spending) before treating the recommendation as final.`,
    );
  } else {
    for (const r of runs) {
      const judged = r.results.filter((s) => s.pass !== null);
      const passed = judged.filter((s) => s.pass).length;
      lines.push(
        `- **${r.modelId}**: ${passed}/${judged.length} samples passed the "${r.check.kind}" check (${r.results.length} run, ${fmtUSD(r.totalCostUSD)} spent, ${r.ranAt.slice(0, 10)}).`,
      );
    }
  }
  lines.push("");

  lines.push(`## Assumptions behind these numbers`);
  lines.push("");
  lines.push(`- ${a.requestsPerMonth.toLocaleString("en-US")} conversations/month, ${a.turnsPerConversation} turn(s) each`);
  lines.push(`- ~${a.avgUserInputTokens} user-input tokens/turn; expected output ${a.expectedOutputTokens ?? "unspecified"} tokens${a.maxOutputTokens ? `, capped at ${a.maxOutputTokens}` : ", uncapped"}`);
  lines.push(`- Retry rate ${(a.retryRate * 100).toFixed(0)}%; ${a.toolCallsPerTurn} tool call(s)/turn`);
  if (a.reasoningTokensPerTurn > 0) {
    lines.push(
      `- ${a.reasoningTokensPerTurn.toLocaleString("en-US")} hidden reasoning tokens/turn (thinking model), billed at output price`,
    );
  }
  lines.push(`- Prompt caching ${a.useCaching ? `ON (${(a.cacheHitRate * 100).toFixed(0)}% hit rate)` : "OFF"}; Batch API ${a.useBatch ? "ON" : "OFF"}`);
  lines.push(
    `- Token counts measured offline (o200k BPE) and calibrated per provider — non-OpenAI counts are estimates, which is why costs are ranges`,
  );
  const live = estimates.filter((e) => e.model.priceSource === "live");
  if (live.length > 0) {
    lines.push(
      `- Prices for ${live.length} model(s) refreshed from a public price list (openrouter.ai) on ${live[0].model.pricesAsOf} at the user's request`,
    );
  }
  const extraNotes = rec?.estimate.assumptionNotes ?? [];
  for (const n of extraNotes) lines.push(`- ${n}`);
  lines.push("");
  lines.push(`---`);
  lines.push(`*Deterministic estimate: same prompt + same assumptions ⇒ same numbers. No model was called to produce this card.*`);
  return lines.join("\n");
}
