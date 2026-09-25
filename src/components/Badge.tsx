/**
 * The verification state of the recommendation, everywhere it appears. One
 * component so the header preview, the result and the quality section can
 * never disagree. Links to the check that earns (or explains) it. The key
 * remounts it on a state flip so the swap reads as a change, not a repaint.
 */
export function VerifyBadge({ verified, compact = false }: { verified: boolean; compact?: boolean }) {
  return (
    <a
      key={verified ? "verified" : "unverified"}
      className={`badge ${verified ? "good" : "warn"}${compact ? " compact" : ""}`}
      href="#quality"
      title={
        verified
          ? "Passed the quality check you defined. It covers that check only."
          : "Cost is calculated. Quality isn't tested yet: run the check below."
      }
    >
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        {verified ? (
          <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.6" />
        )}
      </svg>
      {verified ? "Quality-checked" : "Unverified"}
    </a>
  );
}
