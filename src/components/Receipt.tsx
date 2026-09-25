import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { Band, LintAction, LintFinding, ModelEstimate } from "../core/types";
import type { Recommendation } from "../core/card";
import { BREAKDOWN_LABELS, fmtBand, fmtUSD } from "../core/card";
import { VerifyBadge } from "./Badge";

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
 *  the value directly; only later changes animate. */
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
  return <span className="dc-figure num">{fmtUSD(shown)}</span>;
}

/** The estimate drawn as what it is: a likely range with a most-likely point,
 *  on a scale that starts at zero so the width of the uncertainty is honest.
 *  Transforms only, so re-pricing never triggers layout. */
function RangeBand({ band }: { band: Band }) {
  const max = band.high * 1.2;
  if (!(max > 0)) return null;
  const at = (n: number) => Math.min(1, Math.max(0, n / max));
  return (
    <div className="rband" aria-hidden="true">
      <div className="rband-track">
        <div
          className="rband-range"
          style={{ transform: `translateX(${at(band.low) * 100}%) scaleX(${Math.max(0.005, at(band.high) - at(band.low))})` }}
        />
        <div className="rband-point" style={{ transform: `translateX(${at(band.point) * 100}%)` }}>
          <span />
        </div>
      </div>
    </div>
  );
}

/**
 * The decision panel: recommendation, likely range, what drives the cost,
 * every model side by side, and what to cut. Re-prices live as inputs change.
 * (The filename predates the redesign; it has not been a receipt since v5.)
 */

/** Series slot per driver, fixed by entity (never by rank), so a colour
 *  always means the same thing and neighbours in the bar never change. */
const SEG_CLASS: Record<string, string> = {
  prefix: "seg-1",
  userAndHistory: "seg-2",
  tools: "seg-3",
  reasoning: "seg-4",
  output: "seg-5",
};

function actionLabel(action: LintAction): string {
  switch (action.kind) {
    case "enable-caching":
      return "Turn on caching";
    case "set-output-cap":
      return `Cap replies at ${action.tokens} tokens`;
  }
}

export function Receipt({
  hasPrompt,
  recommendation,
  estimates,
  findings,
  requestsPerMonth,
  featureName,
  onApply,
  onAction,
  verdictRef,
  emptyActions,
  priceNote,
  children,
}: {
  hasPrompt: boolean;
  recommendation: Recommendation | null;
  estimates: ModelEstimate[];
  findings: LintFinding[];
  requestsPerMonth: number;
  featureName: string;
  onApply: (f: LintFinding) => void;
  onAction: (a: LintAction) => void;
  /** Watched by the app so the header can show the answer once it scrolls away. */
  verdictRef?: Ref<HTMLDivElement>;
  /** Example buttons offered when there is no prompt yet. */
  emptyActions?: ReactNode;
  /** Price source and freshness, shown with the model comparison it applies to. */
  priceNote?: ReactNode;
  /** Actions rendered at the foot of the panel (copy, share). */
  children?: ReactNode;
}) {
  const [showAllFixes, setShowAllFixes] = useState(false);

  if (!hasPrompt) {
    return (
      <div className="decision decision--empty" id="receipt">
        <h2>Paste a prompt to see what it costs</h2>
        <p>
          Put the prompt you plan to ship in step 1. You'll get a monthly range on seven models,
          what drives it, and the cheapest one worth testing.
        </p>
        {emptyActions && <div className="dc-empty-actions">{emptyActions}</div>}
      </div>
    );
  }

  if (!recommendation) {
    return (
      <div className="decision" id="receipt">
        <h2 className="dc-block-title">No model fits these numbers</h2>
        <p className="dc-reason">
          The conversation runs past every model's context window. Lower the turns, the message
          size or the tool payloads in step 2.
        </p>
      </div>
    );
  }

  const rec = recommendation.estimate;
  const b = rec.breakdown;
  const splitTotal = BREAKDOWN_LABELS.reduce((s, seg) => s + b[seg.key], 0);
  const segments = BREAKDOWN_LABELS.map((s) => ({
    ...s,
    share: splitTotal > 0 ? b[s.key] / splitTotal : 0,
  })).filter((s) => s.share > 0);
  const legend = [...segments].sort((x, y) => y.share - x.share);

  const byCost = [...estimates].sort((a, c) => a.costPerMonth.point - c.costPerMonth.point);
  const maxCost = Math.max(...byCost.map((e) => e.costPerMonth.point));
  const shortlistLabel = (id: string) =>
    recommendation.shortlist.find((s) => s.estimate.model.id === id)?.label;

  const shownFindings = showAllFixes ? findings : findings.slice(0, 3);
  const moreFindings = findings.length - Math.min(findings.length, 3);
  const st = recommendation.status;

  return (
    <div className="decision" id="receipt" role="region" aria-label="Cost estimate">
      <div className="dc-verdict" ref={verdictRef}>
        <div className="dc-verdict-head">
          <span className="dc-kicker">
            Recommended{featureName.trim() ? ` for ${featureName.trim()}` : ""}
          </span>
          <VerifyBadge verified={recommendation.verified} />
        </div>
        <h2 className="dc-model">{rec.model.displayName}</h2>
        <div className="dc-total">
          <AnimatedUSD value={rec.costPerMonth.point} />
          <span className="dc-total-unit">a month</span>
        </div>
        <RangeBand band={rec.costPerMonth} />
        <p className="dc-under">
          Likely between{" "}
          <strong className="num">{fmtUSD(rec.costPerMonth.low)}</strong> and{" "}
          <strong className="num">{fmtUSD(rec.costPerMonth.high)}</strong>. That's{" "}
          <span className="num">{requestsPerMonth.toLocaleString("en-US")}</span> conversations at
          about <span className="num">{fmtUSD(rec.costPerConversation.point)}</span> each.
        </p>
        <p className="dc-reason">{recommendation.reason}</p>
        {st && st.state !== "passed" && (
          <p className="dc-quality">
            {st.state === "stale" &&
              "Your quality result was measured on a different prompt or reply cap, so it no longer applies. "}
            {st.state === "failed" &&
              `It failed your check: ${st.passed} of ${st.total} passed. `}
            {(st.state === "incomplete" || st.state === "unreviewed") &&
              `${st.unreviewed} of ${st.total} replies still need your judgment. `}
            <a href="#quality">Go to the quality check</a>
          </p>
        )}
        {!st && (
          <p className="dc-quality">
            <a href="#quality">Test it below</a> before this goes in the PRD.
          </p>
        )}
        {st?.state === "passed" && (
          <p className="dc-quality ok">
            {st.passed} of {st.total} passed your {st.checkName} check
            {st.failed > 0 ? `, ${st.failed} failed` : ""}. That covers this check, not accuracy in
            general.
          </p>
        )}
      </div>

      <div className="dc-grid">
        <section className="dc-block" aria-labelledby="dc-models-title">
          <h3 className="dc-block-title" id="dc-models-title">
            Every model, same assumptions
          </h3>
          <ul className="dc-models">
            {byCost.map((e) => {
              const isRec = e.model.id === rec.model.id;
              const tag = shortlistLabel(e.model.id);
              const share = maxCost > 0 ? e.costPerMonth.point / maxCost : 0;
              return (
                <li key={e.model.id} className={isRec ? "rec" : ""}>
                  <span className="dc-model-name">
                    {e.model.displayName}
                    {tag && <em className={`tag${tag === "start here" ? " accent" : ""}`}>{tag}</em>}
                    {e.exceedsContext && <em className="tag bad">too long for this model</em>}
                  </span>
                  <span className="dc-model-cost num">{fmtUSD(e.costPerMonth.point)}</span>
                  <div className="dc-model-bar" aria-hidden="true">
                    <div style={{ transform: `scaleX(${Math.max(0.01, share)})` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {priceNote && <div className="dc-note">{priceNote}</div>}
        </section>

        <section className="dc-block" aria-labelledby="dc-split-title">
          <h3 className="dc-block-title" id="dc-split-title">
            Where the money goes
          </h3>
          <div className="dc-splitbar" aria-hidden="true">
            {segments.map((s) => (
              <div
                key={s.key}
                className={SEG_CLASS[s.key]}
                style={{ width: `${(s.share * 100).toFixed(2)}%` }}
              />
            ))}
          </div>
          <ul className="dc-legend">
            {legend.map((s) => (
              <li key={s.key} title={s.explain}>
                <i className={SEG_CLASS[s.key]} aria-hidden="true" />
                <span className="dc-legend-label">{s.label}</span>
                <span className="dc-legend-pct num">{Math.round(s.share * 100)}%</span>
                <span className="dc-legend-usd num">{fmtUSD(rec.costPerMonth.point * s.share)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="dc-block dc-fixes-block" aria-labelledby="dc-fixes-title">
        <h3 className="dc-block-title" id="dc-fixes-title">
          Make it cheaper
        </h3>
        {findings.length === 0 ? (
          <p className="dc-empty-line">Nothing obvious to cut in this prompt at these numbers.</p>
        ) : (
          <ul className="dc-fixes">
            {shownFindings.map((f) => (
              <li key={f.rule}>
                <div className="dc-fix-head">
                  <span className="dc-fix-title">{f.title}</span>
                  {f.monthlySavingUSD &&
                    f.monthlySavingUSD.point > 0.005 &&
                    (f.action?.kind === "set-output-cap" ? (
                      // A cap bounds the worst case; the estimate's own range
                      // already sits under it, so this is risk, not a saving.
                      <span className="dc-fix-risk num">
                        Caps up to {fmtUSD(f.monthlySavingUSD.high)}/mo of overrun
                      </span>
                    ) : (
                      <span className="dc-fix-save num">
                        Save {fmtBand(Math.max(0, f.monthlySavingUSD.low), f.monthlySavingUSD.high)}
                        /mo
                      </span>
                    ))}
                </div>
                <p className="dc-fix-detail">{f.detail}</p>
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
        )}
        {moreFindings > 0 && (
          <button
            className="link-btn dc-more"
            aria-expanded={showAllFixes}
            onClick={() => setShowAllFixes((v) => !v)}
          >
            {showAllFixes
              ? "Show fewer"
              : `Show ${moreFindings} smaller ${moreFindings === 1 ? "suggestion" : "suggestions"}`}
          </button>
        )}
      </section>

      {children && <div className="dc-foot">{children}</div>}
    </div>
  );
}
