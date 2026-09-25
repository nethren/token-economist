import type {
  CostBreakdown,
  LintFinding,
  MeasureRun,
  ModelEstimate,
  QualityCheck,
  ScaleAssumptions,
} from "./types";
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
  /** Sample-level accounting behind `verified`, so the interface and the
   *  exported card can never print different counts. Null when nothing ran. */
  status: QualityStatus | null;
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

// ------------------------------------------------------ quality accounting ----

/**
 * Sample-level accounting for one measurement run.
 *
 * The distinction that matters: a run is evidence of a COMPLETED check only
 * when every sample carries a verdict. Reviewing one sample out of five tells
 * you about one sample — reporting it as "all five passed" is the difference
 * between a measurement and a claim.
 */
export interface QualityStatus {
  state: "not-run" | "unreviewed" | "incomplete" | "passed" | "failed" | "stale";
  total: number;
  reviewed: number;
  passed: number;
  failed: number;
  unreviewed: number;
  /** passed / reviewed — null when nothing has been reviewed yet. */
  rate: number | null;
  /** Every sample carries a verdict. */
  complete: boolean;
  /** Plain-language name of the check that was applied. */
  checkName: string;
}

/** Eligibility threshold among FULLY reviewed runs. Policy unchanged. */
export const PASS_THRESHOLD = 0.8;

/** What was actually checked — a format check is not a correctness check, so
 *  the name travels with every claim the tool makes. */
export function checkName(check: QualityCheck): string {
  switch (check.kind) {
    case "json":
      return "valid JSON";
    case "contains":
      return `contains “${check.value ?? ""}”`;
    case "regex":
      return `matches /${check.value ?? ""}/`;
    case "manual":
      return "manual review";
  }
}

export function summarizeRun(run: MeasureRun): QualityStatus {
  const total = run.results.length;
  const passed = run.results.filter((s) => s.pass === true).length;
  const failed = run.results.filter((s) => s.pass === false).length;
  const reviewed = passed + failed;
  const unreviewed = total - reviewed;
  const complete = total > 0 && unreviewed === 0;
  const rate = reviewed === 0 ? null : passed / reviewed;
  const state: QualityStatus["state"] =
    total === 0
      ? "not-run"
      : reviewed === 0
        ? "unreviewed"
        : !complete
          ? "incomplete"
          : (rate as number) >= PASS_THRESHOLD
            ? "passed"
            : "failed";
  return {
    state,
    total,
    reviewed,
    passed,
    failed,
    unreviewed,
    rate,
    complete,
    checkName: checkName(run.check),
  };
}

/**
 * Recommendation policy — "the cheapest model that is still good enough for
 * THIS feature", stated only as far as the evidence supports:
 * 1. A model is presented as MEETING your check only when its run is complete
 *    (every sample reviewed) and at least PASS_THRESHOLD passed. Partial
 *    review never verifies, and an observed failure is never reported as
 *    "no quality data".
 * 2. Without complete evidence the pick is the cheapest usable model, framed
 *    as the lowest-cost option to TEST. The tool makes no claim about whether
 *    the prompt is "simple" — it has not analysed the task, and a keyword
 *    match is not a capability assessment.
 */
export function recommend(
  estimates: ModelEstimate[],
  runs: MeasureRun[],
  currentFingerprint: string,
): Recommendation | null {
  const usable = estimates.filter((e) => !e.exceedsContext);
  if (usable.length === 0) return null;
  const byCost = [...usable].sort((x, y) => x.costPerMonth.point - y.costPerMonth.point);
  const shortlist = buildShortlist(byCost);
  const stepUp =
    shortlist.find((s) => s.label !== "start here")?.estimate ??
    byCost.find((e) => e.model.id !== byCost[0].model.id) ??
    null;

  let firstFailed: { est: ModelEstimate; st: QualityStatus } | null = null;
  let firstPartial: { est: ModelEstimate; st: QualityStatus } | null = null;
  let firstStale: { est: ModelEstimate; st: QualityStatus } | null = null;

  for (const est of byCost) {
    const run = runs.find((r) => r.modelId === est.model.id);
    if (!run) continue;
    const st = summarizeRun(run);
    // Evidence gathered against a different prompt or reply cap proves nothing
    // about this one. It never verifies, and it does not count as a failure
    // either — it simply no longer applies.
    if (run.ranAgainst !== currentFingerprint) {
      if (!firstStale) firstStale = { est, st: { ...st, state: "stale" } };
      continue;
    }
    if (st.state === "passed") {
      const reason =
        st.failed === 0
          ? `Lowest-cost model meeting your check: ${st.passed}/${st.total} samples passed the ${st.checkName} check. That is a ${st.checkName} result, not a general accuracy guarantee.`
          : `Lowest-cost model meeting your check: ${st.passed}/${st.total} passed the ${st.checkName} check and ${st.failed} failed. Review the failures before you commit.`;
      return { estimate: est, reason, verified: true, status: st, shortlist, stepUp };
    }
    if (st.state === "failed" && !firstFailed) firstFailed = { est, st };
    if ((st.state === "incomplete" || st.state === "unreviewed") && !firstPartial)
      firstPartial = { est, st };
  }

  const stepUpPhrase = stepUp
    ? ` If it falls short, step up to ${stepUp.model.displayName} at ${fmtUSD(stepUp.costPerMonth.point)}/mo.`
    : "";

  // Ran, but the review is unfinished — say so; do not certify and do not
  // pretend the run never happened.
  if (firstPartial) {
    const { est, st } = firstPartial;
    return {
      estimate: byCost[0],
      reason: `Quality check incomplete: ${st.reviewed} of ${st.total} samples reviewed on ${est.model.displayName}. Not verified — judge the remaining ${st.unreviewed} before relying on this.`,
      verified: false,
      status: st,
      shortlist,
      stepUp,
    };
  }

  // Ran and fell short. This is evidence, not an absence of evidence.
  if (firstFailed) {
    const { est, st } = firstFailed;
    const failedIds = new Set(
      runs.filter((r) => summarizeRun(r).state === "failed").map((r) => r.modelId),
    );
    const next = byCost.find((e) => !failedIds.has(e.model.id)) ?? byCost[0];
    const alt =
      next.model.id === est.model.id
        ? ""
        : ` ${next.model.displayName} is the lowest-cost option still untested.`;
    return {
      estimate: next,
      reason: `No tested model meets your check: ${est.model.displayName} passed ${st.passed}/${st.total} on the ${st.checkName} check.${alt}`,
      verified: false,
      status: st,
      shortlist,
      stepUp,
    };
  }

  // Ran, but against something else. Say so instead of showing a stamp the
  // current prompt never earned.
  if (firstStale) {
    const { est, st } = firstStale;
    return {
      estimate: byCost[0],
      reason: `Quality evidence is stale: ${est.model.displayName} was measured against a different prompt or reply cap. Re-run the check before you rely on it.`,
      verified: false,
      status: st,
      shortlist,
      stepUp,
    };
  }

  const cheapest = byCost[0];
  return {
    estimate: cheapest,
    reason:
      `Lowest estimated cost to test: ${cheapest.model.displayName} is the cheapest of the models shown under these assumptions. Quality has not been tested.` +
      stepUpPhrase,
    verified: false,
    status: null,
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
  /** Fingerprint of the prompt + reply cap the card describes, so runs
   *  collected against anything else are marked rather than counted. */
  currentFingerprint: string;
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
      `No quality check has been run. Cost is predictable from tokens; quality must be observed — export the check pack from the Quality Lab, run it in your own AI tool, and paste the replies back before treating the recommendation as final.`,
    );
  } else {
    for (const r of runs) {
      const st = summarizeRun(r);
      const stale = r.ranAgainst !== opts.currentFingerprint;
      const origin =
        r.source === "demo"
          ? "demo data, not a measurement"
          : `replies supplied by the author, est. ${fmtUSD(r.totalCostUSD)} of their own spend`;
      const caveat = stale
        ? ` — STALE: measured against a different prompt or reply cap, does not apply here`
        : st.complete
          ? ""
          : ` — INCOMPLETE (${st.unreviewed} unreviewed), not verified`;
      lines.push(
        `- **${r.modelId}**: ${st.passed}/${st.total} passed, ${st.failed} failed, ${st.unreviewed} unreviewed on the ${st.checkName} check (${origin}, ${r.ranAt.slice(0, 10)})${caveat}.`,
      );
    }
    lines.push("");
    if (runs.some((r) => r.source === "byo")) {
      lines.push(
        `*Quality evidence is self-reported. The author ran the check in their own AI tool and pasted the replies back; Token Economist scored them offline against the stated check.*`,
      );
    } else {
      lines.push(
        `*This card carries demo data only. Nothing here was measured; replace it with a real check before relying on the quality claim.*`,
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
