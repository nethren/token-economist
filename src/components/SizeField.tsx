import { useDeferredValue, useMemo, useState } from "react";
import { matchSize, type SizeOption } from "../core/sizes";
import { countBaseTokens, wordsFromTokens } from "../core/tokenizer";

/**
 * Asks for a length in words a person can picture, and answers in tokens.
 *
 * Three ways in, one control: pick a size, measure a real example, or type the
 * number. Measuring is the honest one — the tokenizer is already in the bundle,
 * so a pasted example gives an exact count instead of a guess — and it is one
 * click away rather than hidden behind "advanced".
 */
export function SizeField({
  label,
  value,
  onChange,
  options,
  unknownLabel,
  sampleLabel,
  what,
  tip,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  options: SizeOption[];
  /** When set, the field offers a "not sure yet" choice that stores null. */
  unknownLabel?: string;
  /** Placeholder for the measure-a-sample box. */
  sampleLabel: string;
  what: string;
  tip?: string;
}) {
  const [override, setOverride] = useState<null | "measure" | "custom">(null);
  const [sample, setSample] = useState("");
  const deferredSample = useDeferredValue(sample);

  const matched = matchSize(value, options);
  // A field with no "not sure" choice has nowhere to put a null, so clearing
  // the number box keeps it in custom mode rather than selecting an option
  // that is not in the list.
  const mode =
    override ??
    (value == null ? (unknownLabel ? "unknown" : "custom") : matched ? "preset" : "custom");
  const selectValue = mode === "preset" && matched ? matched.id : mode;

  const measured = useMemo(
    () => (deferredSample.trim() ? countBaseTokens(deferredSample) : null),
    [deferredSample],
  );

  const pick = (next: string) => {
    const option = options.find((o) => o.id === next);
    if (option) {
      setOverride(null);
      onChange(option.tokens);
      return;
    }
    if (next === "unknown") {
      setOverride(null);
      onChange(null);
      return;
    }
    setOverride(next as "measure" | "custom");
    // Keep whatever number is already there as the starting point, so
    // switching to a precise mode never silently resets the estimate.
    if (value == null) onChange(options[Math.floor(options.length / 2)].tokens);
  };

  const onSample = (text: string) => {
    setSample(text);
    const n = text.trim() ? countBaseTokens(text) : null;
    if (n != null) onChange(n);
  };

  return (
    <div className="field sizefield">
      <span>
        {label}
        <span className="info" tabIndex={0} role="note" aria-label={tip ? `${what} ${tip}` : what}>
          i
          <span className="info-bubble" role="tooltip">
            <span className="tip-what">{what}</span>
            {tip && <span className="tip-hint">{tip}</span>}
          </span>
        </span>
      </span>

      <select value={selectValue} onChange={(e) => pick(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {unknownLabel && <option value="unknown">{unknownLabel}</option>}
        <option value="measure">Measure a real example…</option>
        <option value="custom">Enter the number myself…</option>
      </select>

      {mode === "measure" && (
        <textarea
          className="sizefield-sample"
          value={sample}
          onChange={(e) => onSample(e.target.value)}
          placeholder={sampleLabel}
          spellCheck={false}
        />
      )}

      {mode === "custom" && (
        <input
          className="sizefield-num"
          type="number"
          min={0}
          step={10}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      )}

      <p className="hint">
        {value == null ? (
          "Left unknown — the estimate will flag it."
        ) : (
          <>
            <strong className="num">{value.toLocaleString("en-US")}</strong> tokens ≈{" "}
            {wordsFromTokens(value).toLocaleString("en-US")} words
            {mode === "measure" && measured != null ? " · counted from your example" : ""}
          </>
        )}
      </p>
    </div>
  );
}
