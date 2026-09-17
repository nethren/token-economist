import { useEffect, useRef, useState } from "react";
import type { LintAction, LintFinding, MeasureRun, ModelEstimate } from "../core/types";
import type { Recommendation } from "../core/card";
import { BREAKDOWN_LABELS, fmtBand, fmtUSD } from "../core/card";

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** Roll a number toward its target over `duration` ms (ease-out cubic), like a
 *  meter recomputing. Jumps instantly under reduced motion. First mount shows
 *  the value directly; only later changes animate — the panel's entrance owns
 *  the first appearance. */
function useCountUp(target: number, duration = 260) {
  const reduce = usePrefersReducedMotion();
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    displayRef.current = display;
  });

  useEffect(() => {
    if (reduce || displayRef.current === target) {
      setDisplay(target);
      displayRef.current = target;
      return;
    }
    const from = displayRef.current;
    // Seed `start` from the first frame's own timestamp: the rAF argument can
    // predate a performance.now() taken mid-frame, which would make t < 0 and
    // flash an undershot value.
    let start = 0;
    const tick = (now: number) => {
      if (start === 0) start = now;
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      displayRef.current = v;
      setDisplay(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, reduce]);

  return display;
}

function AnimatedUSD({ value }: { value: number }) {
  const shown = useCountUp(value);
  return <span className="dc-total-fig num">{fmtUSD(shown)}</span>;
}

/**
 * The decision panel: the whole outcome — recommendation, cost drivers,
 * model comparison, top savings, quality state — as clean typographic
 * hierarchy. It re-prices live as the controls change. (Formerly a
 * skeuomorphic "receipt"; kept the filename, dropped the gimmickry.)
 */

const SEG_CLASS: Record<string, string> = {
  prefix: "seg-prefix",
  userAndHistory: "seg-history",
  tools: "seg-tools",
  output: "seg-output",
  reasoning: "seg-reasoning",
};

function actionLabel(action: LintAction): string {
  switch (action.kind) {
    case "enable-caching":
      return "Turn on caching";
    case "set-output-cap":
      return `Cap replies at ${action.tokens}`;
  }
}

export function Receipt({
  hasPrompt,
  recommendation,
  estimates,
  findings,
  requestsPerMonth,
  onApply,
  onAction,
}: {
  hasPrompt: boolean;
  recommendation: Recommendation | null;
  estimates: ModelEstimate[];
  findings: LintFinding[];
  runs: MeasureRun[];
  requestsPerMonth: number;
  onApply: (f: LintFinding) => void;
  onAction: (a: LintAction) => void;
}) {
  if (!hasPrompt) {
    return (
      <div className="decision decision--empty" id="receipt">
        <div className="dc-empty">
          <span className="dc-empty-mark" aria-hidden="true">
            $
          </span>
          <h2>Paste a prompt to see the cost</h2>
          <p>
            Add the prompt you plan to ship, or start from a template. You'll get the monthly cost on
            every model, where that money goes, and the cheapest option that still does the job. No
            code required.
          </p>
        </div>
      </div>
    );
  }

  if (!recommendation) {
    return (
      <div className="decision" id="receipt">
        <p className="dc-reason">
          No model fits these numbers: the conversation runs past every context window. Trim turns,
          history, or tool payloads on the left.
        </p>
      </div>
    );
  }

  const rec = recommendation.estimate;
  const b = rec.breakdown;
  const splitTotal = BREAKDOWN_LABELS.reduce((s, seg) => s + b[seg.key], 0);
  const splitRows = BREAKDOWN_LABELS.map((s) => ({
    ...s,
    share: splitTotal > 0 ? b[s.key] / splitTotal : 0,
  }))
    .filter((s) => s.share > 0)
    .sort((x, y) => y.share - x.share);

  const byCost = [...estimates].sort((a, c) => a.costPerMonth.point - c.costPerMonth.point);
  const maxCost = Math.max(...byCost.map((e) => e.costPerMonth.point));
  const shortlistLabel = (id: string) =>
    recommendation.shortlist.find((s) => s.estimate.model.id === id)?.label;

  const topFindings = findings.slice(0, 3);
  const moreFindings = findings.length - topFindings.length;

  return (
    <div className="decision" id="receipt" role="region" aria-label="The cost decision">
      {/* headline */}
      <div className="dc-verdict">
        <div className="dc-verdict-label">
          Recommended
          <a
            key={recommendation.verified ? "verified" : "unverified"}
            className={`stamp ${recommendation.verified ? "verified" : "unverified"}`}
            href="#quality"
            title={
              recommendation.verified
                ? "Passed your own check. See step 3 on the left."
                : "Cost is computed. Quality isn't measured yet: run the check in step 3 to earn this."
            }
          >
            {recommendation.verified ? "quality-checked" : "unverified"}
          </a>
        </div>
        <div className="dc-model">{rec.model.displayName}</div>
        <div className="dc-total">
          <AnimatedUSD value={rec.costPerMonth.point} />
          <span className="dc-total-unit">/mo</span>
        </div>
        <div className="dc-under num">
          {fmtBand(rec.costPerMonth.low, rec.costPerMonth.high)} range ·{" "}
          {requestsPerMonth.toLocaleString("en-US")} conversations/mo ·{" "}
          {fmtUSD(rec.costPerConversation.point)} each
        </div>
        <p className="dc-reason">{recommendation.reason}</p>
      </div>

      {/* three-up analytics */}
      <div className="dc-grid">
        <section className="dc-card">
          <h3>Where the money goes</h3>
          <div className="dc-splitbar" aria-hidden="true">
            {splitRows.map((s) => (
              <div
                key={s.key}
                className={SEG_CLASS[s.key]}
                style={{ width: `${(s.share * 100).toFixed(2)}%` }}
              />
            ))}
          </div>
          <ul className="dc-legend">
            {splitRows.map((s) => (
              <li key={s.key} title={s.explain}>
                <i className={SEG_CLASS[s.key]} aria-hidden="true" />
                <span className="dc-legend-label">{s.label}</span>
                <span className="dc-legend-val num">{Math.round(s.share * 100)}%</span>
                <span className="dc-legend-usd num">{fmtUSD(rec.costPerMonth.point * s.share)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dc-card dc-card--wide">
          <h3>Across models</h3>
          <ul className="dc-models">
            {byCost.map((e) => {
              const isRec = e.model.id === rec.model.id;
              const tag = shortlistLabel(e.model.id);
              return (
                <li key={e.model.id} className={isRec ? "rec" : ""}>
                  <span className="dc-model-name">
                    {e.model.displayName}
                    {tag && <em className="dc-tag">{tag}</em>}
                    {e.exceedsContext && <em className="dc-tag bad">exceeds context</em>}
                  </span>
                  <span className="dc-model-cost num">{fmtUSD(e.costPerMonth.point)}</span>
                  <div className="dc-model-bar" aria-hidden="true">
                    <div style={{ width: `${((e.costPerMonth.point / maxCost) * 100).toFixed(2)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* savings + quality */}
      <div className="dc-grid">
        {topFindings.length > 0 && (
          <section className="dc-card">
            <h3>Make it cheaper</h3>
            <ul className="dc-fixes">
              {topFindings.map((f) => (
                <li key={f.rule}>
                  <div className="dc-fix-row">
                    <span className="dc-fix-title">{f.title}</span>
                    {f.monthlySavingUSD && f.monthlySavingUSD.point > 0.005 && (
                      <span className="dc-fix-save num">
                        save {fmtBand(Math.max(0, f.monthlySavingUSD.low), f.monthlySavingUSD.high)}
                      </span>
                    )}
                  </div>
                  {(f.apply || f.action) && (
                    <div className="dc-fix-actions">
                      {f.apply && (
                        <button className="btn small" onClick={() => onApply(f)}>
                          Apply to prompt
                        </button>
                      )}
                      {f.action && (
                        <button className="btn small" onClick={() => onAction(f.action!)}>
                          {actionLabel(f.action)}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {moreFindings > 0 && (
              <p className="dc-note">+{moreFindings} smaller finding(s) in the full card below</p>
            )}
          </section>
        )}

        <section className="dc-card">
          <h3>Quality</h3>
          {(() => {
            const st = recommendation.status;
            if (!st || st.state === "not-run")
              return (
                <p className="dc-quality">
                  Cost is computed. Quality isn't. Run step&nbsp;3 on a few samples and the stamp
                  flips once a model passes your check.
                </p>
              );
            if (st.state === "passed")
              return (
                <p className="dc-quality ok">
                  {st.passed}/{st.total} passed the {st.checkName} check
                  {st.failed > 0 ? `, ${st.failed} failed` : ""}. That is a {st.checkName} result,
                  not a general accuracy guarantee.
                </p>
              );
            if (st.state === "stale")
              return (
                <p className="dc-quality">
                  Stale evidence: this result was measured against a different prompt or reply cap,
                  so it doesn't apply here. Re-run the check in step&nbsp;3.
                </p>
              );
            if (st.state === "failed")
              return (
                <p className="dc-quality">
                  Failed your check: {st.passed}/{st.total} passed the {st.checkName} check. The
                  pick stays <em>unverified</em>.
                </p>
              );
            return (
              <p className="dc-quality">
                Review incomplete — {st.reviewed} of {st.total} samples reviewed, {st.unreviewed}{" "}
                still unjudged. Not verified.
              </p>
            );
          })()}
        </section>
      </div>

      <p className="dc-foot">
        Same inputs, same numbers, every time. No model was called to produce this.
      </p>
    </div>
  );
}
