import type { Band } from "../core/types";

/**
 * The signature element: every cost is drawn as a low—point—high band,
 * scaled against the most expensive model in the comparison. The range IS
 * the estimate; the tick is just the point scenario.
 */
export function BandBar({ band, max }: { band: Band; max: number }) {
  if (max <= 0) return null;
  const pct = (n: number) => `${Math.min(100, (n / max) * 100).toFixed(2)}%`;
  const width = Math.max(0.5, ((band.high - band.low) / max) * 100);
  return (
    <div
      className="bandbar"
      role="img"
      aria-label={`cost range ${band.low.toFixed(4)} to ${band.high.toFixed(4)} dollars, point ${band.point.toFixed(4)}`}
    >
      <div className="range" style={{ left: pct(band.low), width: `${width.toFixed(2)}%` }} />
      <div className="point" style={{ left: pct(band.point) }} />
    </div>
  );
}
