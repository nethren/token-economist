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
}: {
  featureName: string;
  prompt: string;
  runs: MeasureRun[];
  setRuns: (r: MeasureRun[]) => void;
  /** Owned by App: it is part of the configuration a result is valid for. */
  maxTokens: number;
  setMaxTokens: (n: number) => void;
}) {
  const [modelId, setModelId] = useState("claude-haiku-4-5");
  const [samplesText, setSamplesText] = useState("");
  const [checkKind, setCheckKind] = useState<QualityCheck["kind"]>("json");
  const [checkValue, setCheckValue] = useState("");
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

  const model = useMemo(() => MODELS.find((m) => m.id === modelId) ?? MODELS[0], [modelId]);
  const check: QualityCheck = { kind: checkKind, value: checkValue || undefined };
  const fingerprint = runFingerprint(prompt, maxTokens);

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

  return (
    <div className="panel lab">
      <p className="lab-lead">
        Cost is predictable from tokens. Quality has to be watched. Download the check, run it in
        the AI tool you already pay for, paste the reply back. Scoring happens here, on your
        machine.
      </p>
      <div className="lab-facts">
        <span>no API key, ever</span>
        <span>your tool, your account</span>
        <span>replies scored locally</span>
      </div>

      <div className="lab-step">1 · Describe the check</div>

      <label className="field">
        <span>Test inputs — one per line, up to {MAX_SAMPLES_PER_RUN}</span>
        <textarea
          style={{ minHeight: 84 }}
          value={samplesText}
          onChange={(e) => setSamplesText(e.target.value)}
          placeholder={"I was charged twice this month\nAPI returns 500 on upload\n…"}
        />
      </label>

      <div className="lab-row">
        <label className="field">
          <span>Model you will test</span>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {MODELS.map((m: ModelSpec) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field lab-cap">
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
            <option value="json">reply is valid JSON</option>
            <option value="contains">reply contains…</option>
            <option value="regex">reply matches regex…</option>
            <option value="manual">I judge it myself</option>
          </select>
        </label>
        {(checkKind === "contains" || checkKind === "regex") && (
          <label className="field">
            <span>{checkKind === "contains" ? "Required text" : "Regex pattern"}</span>
            <input type="text" value={checkValue} onChange={(e) => setCheckValue(e.target.value)} />
          </label>
        )}
      </div>

      <div className="lab-step">2 · Run it in your own AI tool</div>

      <div className="lab-actions">
        <button className="btn primary" disabled={samples.length === 0} onClick={downloadPack}>
          Download check
        </button>
        <button className="btn" disabled={samples.length === 0} onClick={copyPack}>
          {copied ? "Copied" : "Copy instead"}
        </button>
      </div>
      <p className="hint">
        {samples.length === 0
          ? "Add a test input above to build the check."
          : `Paste it into Claude, ChatGPT, Cursor — anything. It costs about ${fmtUSD(preview)} on your account. Token Economist charges nothing and calls nothing.`}
      </p>
      {error && <div className="lab-error">{error}</div>}

      {samples.length > 0 && (
        <>
          <div className="lab-step">3 · Paste the reply back</div>
          <label className="field">
            <textarea
              style={{ minHeight: 120 }}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"Paste the whole reply document your AI tool produced…"}
            />
          </label>

          {pasted.trim().length > 0 && (
            <div className={`lab-parse ${parsed.found === samples.length && !mismatched ? "ok" : "warn"}`}>
              <strong>
                Read {parsed.found} of {samples.length}{" "}
                {samples.length === 1 ? "reply" : "replies"}
              </strong>
              {mismatched && (
                <span>
                  {" "}
                  · this reply was made for a different prompt or reply cap, so it will be marked
                  stale
                </span>
              )}
              {parsed.warnings.map((w, i) => (
                <span key={i} className="lab-parse-note">
                  {w}
                </span>
              ))}
            </div>
          )}

          <button className="btn primary" disabled={parsed.found === 0} onClick={score}>
            Score {parsed.found} {parsed.found === 1 ? "reply" : "replies"}
          </button>
          <p className="hint">
            Missing replies stay unreviewed rather than counting as failures. Token counts are
            offline estimates; your provider dashboard has the billed truth.
          </p>
        </>
      )}

      {import.meta.env.DEV && (
        <div className="lab-demo">
          <span className="hint">Demo data (dev only, labelled as demo):</span>
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
          <div key={r.modelId}>
            <h3 style={{ marginTop: 18, fontSize: 14 }}>
              {r.modelId}:{" "}
              <span className="num">
                {st.passed}/{st.total} passed
              </span>{" "}
              <span className="hint">
                {st.unreviewed > 0 ? `${st.unreviewed} unreviewed · ` : ""}
                {r.source === "demo" ? "demo data, not real evidence" : "replies you supplied"}
                {stale ? " · stale, configuration changed" : ""}
              </span>
            </h3>
            <table className="results-table">
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Reply</th>
                  <th>Est. tokens in/out</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {r.results.map((s, i) => (
                  <tr key={i}>
                    <td>{s.input.slice(0, 60)}</td>
                    <td className="out">{s.output.slice(0, 400)}</td>
                    <td className="num">
                      {s.inputTokens}/{s.outputTokens}
                    </td>
                    <td>
                      {s.pass === true && <span className="pass">pass</span>}
                      {s.pass === false && <span className="fail">fail</span>}
                      {s.pass === null && (
                        <span>
                          <span className="pending">judge: </span>
                          <button
                            className="btn small"
                            onClick={() => overrideResult(r.modelId, i, true)}
                          >
                            pass
                          </button>{" "}
                          <button
                            className="btn small"
                            onClick={() => overrideResult(r.modelId, i, false)}
                          >
                            fail
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
