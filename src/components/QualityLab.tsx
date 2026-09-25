import { useMemo, useState } from "react";
import type { MeasureRun, ModelSpec, QualityCheck, SampleResult } from "../core/types";
import { MODELS } from "../core/models";
import {
  MAX_SAMPLES_PER_RUN,
  buildPastedRun,
  previewRunCost,
  runFingerprint,
} from "../core/measure";
import { parseReplyPack, renderCheckPack } from "../core/pack";
import { fmtUSD, summarizeRun } from "../core/card";
import type { FeaturePreset } from "../core/presets";

/**
 * Quality Lab — one document out, one document back.
 *
 * Download the check, run it in whatever AI tool you already pay for, paste the
 * whole reply document into one box. No key, no proxy, no paid call from this
 * app, and no form to fill in per sample. Every run is labelled with where the
 * evidence came from, because "the user told us" and "we measured it" are not
 * the same claim.
 */
export function QualityLab({
  featureName,
  prompt,
  runs,
  setRuns,
  maxTokens,
  setMaxTokens,
  recommendedModelId,
  seed,
}: {
  featureName: string;
  prompt: string;
  runs: MeasureRun[];
  setRuns: (r: MeasureRun[]) => void;
  /** Owned by App: it is part of the configuration a result is valid for. */
  maxTokens: number;
  setMaxTokens: (n: number) => void;
  /** The model the estimate recommends. Tested by default, since that is the
   *  pick the badge is about; the user can still choose another. */
  recommendedModelId: string | null;
  /** Starting inputs and pass rule from the loaded example. Read once on
   *  mount; the app remounts the Lab when a different example is loaded. */
  seed?: FeaturePreset["check"] | null;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [samplesText, setSamplesText] = useState(() => seed?.samples.join("\n") ?? "");
  const [checkKind, setCheckKind] = useState<QualityCheck["kind"]>(seed?.kind ?? "json");
  const [checkValue, setCheckValue] = useState(seed?.value ?? "");
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const samples = useMemo(
    () =>
      samplesText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, MAX_SAMPLES_PER_RUN),
    [samplesText],
  );

  const modelId = pickedId ?? recommendedModelId ?? MODELS[0].id;
  const model = useMemo(() => MODELS.find((m) => m.id === modelId) ?? MODELS[0], [modelId]);
  const check: QualityCheck = { kind: checkKind, value: checkValue || undefined };
  const fingerprint = runFingerprint(prompt, maxTokens);
  const hasSamples = samples.length > 0;

  const preview = useMemo(
    () => previewRunCost(model, prompt, samples, maxTokens).totalUSD,
    [model, prompt, samples, maxTokens],
  );

  const pack = useMemo(
    () => renderCheckPack({ featureName, prompt, model, samples, check, maxTokens }),
    // `check` is rebuilt every render; its parts are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [featureName, prompt, model, samples, checkKind, checkValue, maxTokens],
  );

  const parsed = useMemo(
    () => parseReplyPack(pasted, samples.length),
    [pasted, samples.length],
  );

  const mismatched = Boolean(parsed.configId && parsed.configId !== fingerprint);

  const copyPack = async () => {
    setError("");
    try {
      await navigator.clipboard.writeText(pack);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Your browser blocked the clipboard. Use Download instead.");
    }
  };

  const downloadPack = () => {
    const blob = new Blob([pack], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quality-check-${model.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const score = () => {
    setError("");
    const run = buildPastedRun({
      model,
      prompt,
      samples,
      outputs: parsed.replies,
      check,
      maxTokens,
      declaredConfigId: parsed.configId,
    });
    setRuns([...runs.filter((r) => r.modelId !== run.modelId), run]);
  };

  const overrideResult = (runModelId: string, idx: number, pass: boolean) => {
    setRuns(
      runs.map((r) =>
        r.modelId === runModelId
          ? { ...r, results: r.results.map((s, i) => (i === idx ? { ...s, pass } : s)) }
          : r,
      ),
    );
  };

  // Dev-only. Seeds each evidence state so the Lab can be demoed and checked
  // without leaving the page. `import.meta.env.DEV` is false in a production
  // build, so this and its control are dropped from the bundle.
  const seedDemo = (kind: "passed" | "failed" | "partial" | "stale") => {
    const verdicts: Record<string, (boolean | null)[]> = {
      passed: [true, true, true, true, true],
      failed: [true, false, false, false, false],
      partial: [true, null, null, null, null],
      stale: [true, true, true, true, true],
    };
    const results: SampleResult[] = verdicts[kind].map((pass, i) => ({
      input: `demo sample ${i + 1}`,
      output: pass === false ? "sorry, I can't do that" : '{"category":"billing"}',
      pass,
      inputTokens: 120,
      outputTokens: 40,
      costUSD: 0.0002,
      cached: false,
      latencyMs: 0,
    }));
    setRuns([
      {
        modelId,
        check,
        results,
        totalCostUSD: 0.001,
        ranAt: new Date().toISOString(),
        ranAgainst: kind === "stale" ? "demo-other-configuration" : fingerprint,
        source: "demo",
      },
    ]);
  };

  const nameOf = (id: string) => MODELS.find((m) => m.id === id)?.displayName ?? id;

  return (
    <div className="lab">
      <div className="lab-cols">
        <section className="lab-col" aria-labelledby="lab-describe">
          <h3 id="lab-describe">Describe the check</h3>
          <p className="lab-col-note">A few real inputs, and what a good reply looks like.</p>

          <label className="field">
            <span>Test inputs, one per line (up to {MAX_SAMPLES_PER_RUN})</span>
            <textarea
              className="lab-samples"
              value={samplesText}
              onChange={(e) => setSamplesText(e.target.value)}
              placeholder={"I was charged twice this month\nThe export button does nothing\n…"}
            />
          </label>

          <div className="lab-row">
            <label className="field">
              <span>Model to test</span>
              <select
                value={modelId}
                onChange={(e) =>
                  setPickedId(e.target.value === recommendedModelId ? null : e.target.value)
                }
              >
                {MODELS.map((m: ModelSpec) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.id === recommendedModelId ? " (recommended)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Reply cap</span>
              <input
                type="number"
                min={16}
                max={1024}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value) || 300)}
              />
            </label>
          </div>

          <div className="lab-row">
            <label className="field">
              <span>Counts as a pass when</span>
              <select
                value={checkKind}
                onChange={(e) => setCheckKind(e.target.value as QualityCheck["kind"])}
              >
                <option value="json">the reply is valid JSON</option>
                <option value="contains">the reply contains…</option>
                <option value="regex">the reply matches a pattern…</option>
                <option value="manual">I judge each reply myself</option>
              </select>
            </label>
            {(checkKind === "contains" || checkKind === "regex") && (
              <label className="field">
                <span>{checkKind === "contains" ? "Required text" : "Pattern (regex)"}</span>
                <input
                  type="text"
                  value={checkValue}
                  onChange={(e) => setCheckValue(e.target.value)}
                />
              </label>
            )}
          </div>
        </section>

        <section className="lab-col" aria-labelledby="lab-run">
          <h3 id="lab-run">Run it in your own AI tool</h3>
          <p className="lab-col-note">
            The check is one Markdown file: your prompt, the inputs, and the rule. Paste it into
            Claude, ChatGPT, Cursor or anything you already pay for. It asks for one reply document
            back.
          </p>
          <div className="lab-actions">
            <button className="btn primary" disabled={!hasSamples} onClick={downloadPack}>
              Download the check
            </button>
            <button className="btn" disabled={!hasSamples} onClick={copyPack}>
              {copied ? "Copied" : "Copy to clipboard"}
            </button>
          </div>
          <p className="hint" aria-live="polite">
            {hasSamples
              ? `About ${fmtUSD(preview)} on your own account. Token Economist calls nothing and charges nothing.`
              : "Add at least one test input first."}
          </p>
          {error && (
            <p className="notice bad" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="lab-col" aria-labelledby="lab-paste">
          <h3 id="lab-paste">Paste the replies back</h3>
          <p className="lab-col-note">
            Paste the whole reply document. It's scored here, in your browser.
          </p>
          <label className="field">
            <span className="sr-only">Reply document</span>
            <textarea
              className="lab-paste"
              value={pasted}
              disabled={!hasSamples}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={
                hasSamples
                  ? "Paste the reply document your AI tool produced…"
                  : "Available once the check has a test input"
              }
            />
          </label>

          {pasted.trim().length > 0 && (
            <div
              className={`notice ${parsed.found === samples.length && !mismatched ? "good" : "warn"}`}
              role="status"
            >
              <strong>
                Found {parsed.found} of {samples.length}{" "}
                {samples.length === 1 ? "reply" : "replies"}.
              </strong>
              {mismatched && (
                <span>
                  {" "}
                  These replies were made for a different prompt or reply cap, so they'll be marked
                  stale.
                </span>
              )}
              {parsed.warnings.map((w, i) => (
                <span key={i} className="notice-line">
                  {w}
                </span>
              ))}
            </div>
          )}

          <button className="btn primary" disabled={parsed.found === 0} onClick={score}>
            Score {parsed.found > 0 ? `${parsed.found} ` : ""}
            {parsed.found === 1 ? "reply" : "replies"}
          </button>
          <p className="hint">
            A missing reply stays unreviewed; it never counts as a failure. Token counts are
            offline estimates, and your provider's dashboard has the billed numbers.
          </p>
        </section>
      </div>

      {import.meta.env.DEV && (
        <div className="lab-demo">
          <span>Demo data (dev only, labelled as demo):</span>
          {(["passed", "failed", "partial", "stale"] as const).map((k) => (
            <button key={k} className="btn small" onClick={() => seedDemo(k)}>
              {k}
            </button>
          ))}
          <button className="btn small" onClick={() => setRuns([])}>
            clear
          </button>
        </div>
      )}

      {runs.map((r) => {
        const st = summarizeRun(r);
        const stale = r.ranAgainst !== fingerprint;
        return (
          <div key={r.modelId} className="lab-result">
            <h3 className="lab-result-title">
              {nameOf(r.modelId)}:{" "}
              <span className="num">
                {st.passed} of {st.total} passed
              </span>
              <span className="lab-result-meta">
                {st.unreviewed > 0 ? `${st.unreviewed} unreviewed. ` : ""}
                {r.source === "demo" ? "Demo data, not real evidence." : "Replies you supplied."}
                {stale ? " Stale: the prompt or reply cap has changed since." : ""}
              </span>
            </h3>
            <div className="table-scroll">
              <table className="results-table">
                <thead>
                  <tr>
                    <th scope="col">Input</th>
                    <th scope="col">Reply</th>
                    <th scope="col">Est. tokens in / out</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {r.results.map((s, i) => (
                    <tr key={i}>
                      <td>{s.input.slice(0, 60)}</td>
                      <td className="out">{s.output.slice(0, 400)}</td>
                      <td className="num">
                        {s.inputTokens} / {s.outputTokens}
                      </td>
                      <td>
                        {s.pass === true && <span className="pass">Pass</span>}
                        {s.pass === false && <span className="fail">Fail</span>}
                        {s.pass === null && (
                          <span className="judge">
                            <button
                              className="btn small"
                              onClick={() => overrideResult(r.modelId, i, true)}
                            >
                              Pass
                            </button>
                            <button
                              className="btn small"
                              onClick={() => overrideResult(r.modelId, i, false)}
                            >
                              Fail
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
