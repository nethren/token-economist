import type { LintAction, LintFinding } from "../core/types";
import { fmtBand } from "../core/card";

function actionLabel(action: LintAction): string {
  switch (action.kind) {
    case "enable-caching":
      return "Turn on prompt caching";
    case "set-output-cap":
      return `Set response limit to ${action.tokens} tokens`;
  }
}

export function Findings({
  findings,
  onApply,
  onAction,
}: {
  findings: LintFinding[];
  onApply: (f: LintFinding) => void;
  onAction: (a: LintAction) => void;
}) {
  if (findings.length === 0) {
    return <p className="hint">No cost-cut findings — the prompt is tight. Nice.</p>;
  }
  return (
    <div>
      {findings.map((f) => (
        <div className="finding" key={f.rule}>
          <div className="finding-head">
            <span className={`sev ${f.severity}`}>{f.severity}</span>
            <strong>{f.title}</strong>
            {f.monthlySavingUSD && f.monthlySavingUSD.point > 0.005 && (
              <span className="saving">
                save {fmtBand(Math.max(0, f.monthlySavingUSD.low), f.monthlySavingUSD.high)}/mo
              </span>
            )}
          </div>
          <p>{f.detail}</p>
          {f.tokensSaved > 0 && (
            <span className="hint num">~{f.tokensSaved} prompt tokens </span>
          )}
          {f.apply && (
            <button className="btn small" onClick={() => onApply(f)}>
              Apply fix to prompt
            </button>
          )}
          {f.action && (
            <button className="btn small" onClick={() => onAction(f.action!)}>
              {actionLabel(f.action)}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
