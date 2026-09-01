import type { CostBreakdown } from "../core/types";
import { BREAKDOWN_LABELS, fmtUSD } from "../core/card";

const SEG_CLASS: Record<keyof CostBreakdown, string> = {
  prefix: "seg-prefix",
  userAndHistory: "seg-history",
  tools: "seg-tools",
  output: "seg-output",
  reasoning: "seg-reasoning",
};

/**
 * "Where the money goes": the cost split as a stacked bar plus one aligned
 * row per driver, biggest first — the single number becomes a story a PM can
 * read top-down ("most of this is the replies themselves"). Labels and
 * explanations come from BREAKDOWN_LABELS so the card says the same words.
 */
export function CostSplit({ breakdown, monthly }: { breakdown: CostBreakdown; monthly: number }) {
  const total = BREAKDOWN_LABELS.reduce((s, seg) => s + breakdown[seg.key], 0);
  if (total <= 0) return null;
  const parts = BREAKDOWN_LABELS.map((s) => ({ ...s, share: breakdown[s.key] / total }))
    .filter((s) => s.share > 0)
    .sort((x, y) => y.share - x.share);
  const label = parts.map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(", ");
  return (
    <div className="costsplit">
      <div className="costsplit-head">
        <span className="costsplit-title">Where the money goes</span>
        <span className="costsplit-sub">recommended model · typical month</span>
      </div>
      <div className="costsplit-bar" role="img" aria-label={`cost split: ${label}`}>
        {BREAKDOWN_LABELS.filter((s) => breakdown[s.key] > 0).map((s) => (
          <div
            key={s.key}
            className={SEG_CLASS[s.key]}
            style={{ width: `${((breakdown[s.key] / total) * 100).toFixed(2)}%` }}
          />
        ))}
      </div>
      <div className="costsplit-rows">
        {parts.map((s) => (
          <div className="costsplit-row" key={s.key} title={s.explain}>
            <i className={SEG_CLASS[s.key]} aria-hidden="true" />
            <span className="costsplit-label">{s.label}</span>
            <span className="costsplit-pct num">{Math.round(s.share * 100)}%</span>
            <span className="costsplit-usd num">{fmtUSD(monthly * s.share)}/mo</span>
          </div>
        ))}
      </div>
    </div>
  );
}
