import type { ModelEstimate, ModelSpec } from "../core/types";
import type { Recommendation } from "../core/card";
import { fmtBand, fmtUSD } from "../core/card";
import { STALE_PRICE_DAYS, priceAgeDays } from "../core/models";
import { BandBar } from "./BandBar";
import { CostSplit } from "./CostSplit";

/** Evaluated once per load; staleness only needs day resolution. */
const TODAY = new Date().toISOString().slice(0, 10);

function PriceNote({ model }: { model: ModelSpec }) {
  if (model.priceSource === "live") {
    return <span className="livenote"> · live price {model.pricesAsOf}</span>;
  }
  const age = priceAgeDays(model.pricesAsOf, TODAY);
  if (age > STALE_PRICE_DAYS) {
    return <span className="stalewarn"> · prices {Math.round(age / 30)} mo old — verify</span>;
  }
  return model.verifyPricing ? <> · verify pricing</> : null;
}

export function ModelTable({
  estimates,
  recommendation,
  tableOnly = false,
}: {
  estimates: ModelEstimate[];
  recommendation: Recommendation | null;
  /** Render only the comparison table — the receipt owns the verdict/split. */
  tableOnly?: boolean;
}) {
  const sorted = [...estimates].sort((a, b) => a.costPerMonth.point - b.costPerMonth.point);
  const max = Math.max(...estimates.map((e) => e.costPerMonth.high));
  const recId = recommendation?.estimate.model.id;
  const shortlistLabel = (id: string) =>
    recommendation?.shortlist.find((s) => s.estimate.model.id === id)?.label;

  return (
    <>
      {!tableOnly && recommendation && (
        <div className="recbox">
          <div className="recbox-head">
            <a
              key={recommendation.verified ? "verified" : "unverified"}
              className={`stamp ${recommendation.verified ? "verified" : "unverified"}`}
              href="#quality"
              title={
                recommendation.verified
                  ? "Passed your own quality check — results in step 3."
                  : "Cost is computed, quality isn't measured yet — run the step-3 check to earn the stamp."
              }
            >
              {recommendation.verified ? "quality-checked" : "unverified"}
            </a>
            <span className="recbox-label">recommended model</span>
          </div>
          <div className="recbox-main">
            <span className="recbox-model">{recommendation.estimate.model.displayName}</span>
            <span className="recbox-range">
              {fmtBand(
                recommendation.estimate.costPerMonth.low,
                recommendation.estimate.costPerMonth.high,
              )}{" "}
              range
            </span>
            <span className="recbox-figure">
              {fmtUSD(recommendation.estimate.costPerMonth.point)}
              <em>/mo</em>
            </span>
          </div>
          <p className="recbox-reason">{recommendation.reason}</p>
        </div>
      )}
      {!tableOnly && recommendation && (
        <CostSplit
          breakdown={recommendation.estimate.breakdown}
          monthly={recommendation.estimate.costPerMonth.point}
        />
      )}
      <table className="mtable">
        <thead>
          <tr>
            <th>Model</th>
            <th>$/1M in / out</th>
            <th>Per conversation</th>
            <th>Per month</th>
            <th>Monthly range (shared scale)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => (
            <tr key={e.model.id} className={e.model.id === recId ? "recommended" : ""}>
              <td className="modelname">
                {e.model.displayName}
                {shortlistLabel(e.model.id) && (
                  <span className="tag">{shortlistLabel(e.model.id)}</span>
                )}
                <span className="provider">
                  {e.model.provider}
                  <PriceNote model={e.model} />
                  {e.exceedsContext ? " · ⛔ exceeds context" : ""}
                </span>
              </td>
              <td className="costcell">
                ${e.model.inputPerMTok} / ${e.model.outputPerMTok}
              </td>
              <td className="costcell">
                <span className="pt">{fmtUSD(e.costPerConversation.point)}</span>
                <span className="rng">{fmtBand(e.costPerConversation.low, e.costPerConversation.high)}</span>
              </td>
              <td className="costcell">
                <span className="pt">{fmtUSD(e.costPerMonth.point)}</span>
                <span className="rng">{fmtBand(e.costPerMonth.low, e.costPerMonth.high)}</span>
              </td>
              <td>
                <BandBar band={e.costPerMonth} max={max} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bandnote">
        band = low–high estimate under stated assumptions · tick = point scenario · ranges reflect
        tokenizer calibration and output-length uncertainty
      </div>
    </>
  );
}
