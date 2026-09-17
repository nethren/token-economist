import { useMemo, useState } from "react";
import type { MeasureRun, ModelSpec, QualityCheck, SampleResult } from "../core/types";
import { MODELS } from "../core/models";
import {
  MAX_SAMPLES_PER_RUN,
  buildPastedRun,
  previewRunCost,
  runFingerprint,
} from "../core/measure";
import { renderCheckPack } from "../core/pack";
import { fmtUSD, summarizeRun } from "../core/card";

/**
 * Quality Lab — bring your own AI.
 *
 * The app exports a check pack, the user runs it in the tool they already pay
 * for, and the replies come back here to be scored locally. No key, no proxy,
 * no paid call from this app. Every run is labelled with where the evidence
 * came from, because "the user told us" and "we measured it" are not the same
 * claim.
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
  const [outputs, setOutputs] = useState<string[]>([]);
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

  const filled = outputs.filter((o) => o && o.trim().length > 0).length;
  const canScore = samples.length > 0 && filled > 0;

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

  const setOutput = (i: number, value: string) => {
    setOutputs((prev) => {
      const next = [...prev];
      while (next.length < samples.length) next.push("");
      next[i] = value;
      return next;
    });
  };

  const score = () => {
    setError("");
    const run = buildPastedRun({ model, prompt, samples, outputs, check, maxTokens });
    const kept = runs.filter((r) => r.modelId !== run.modelId);
    setRuns([...kept, run]);
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
        // The stale case deliberately carries a fingerprint from a different
        // configuration, which is what retires the stamp.
        ranAgainst:
          kind === "stale" ? "demo-other-configuration" : runFingerprint(prompt, maxTokens),
        source: "demo",
      },
    ]);
  };

  return (
    <div className="panel lab">
      <p className="lab-lead">
        Cost is predictable from tokens. Quality has to be observed. Export the check below, run it
        in the AI tool you already pay for, and paste the replies back — scoring happens here, on
        your machine.
      </p>
      <div className="lab-facts">
        <span>no API key, ever</span>
        <span>your tool, your account</span>
        <span>replies scored locally</span>
      </div>

      <div className="lab-step">1 · Set up the check</div>

      <div className="lab-row">
        <label className="field">
          <span>Model you will test</span>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {MODELS.map((m: ModelSpec) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.provider})
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

      <label className="field">
        <span>Test inputs (max {MAX_SAMPLES_PER_RUN}, one per line)</span>
        <textarea
          style={{ minHeight: 96 }}
          value={samplesText}
          onChange={(e) => setSamplesText(e.target.value)}
          placeholder={"I was charged twice this month\nAPI returns 500 on upload\n…"}
        />
      </label>

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

      <div className="cost-preview">
        Running this will cost about <strong>{fmtUSD(preview)}</strong> on your account, for{" "}
        {samples.length} {samples.length === 1 ? "sample" : "samples"} with replies capped at{" "}
        {maxTokens} tokens. Token Economist charges nothing and calls nothing.
      </div>

      <div className="lab-actions">
        <button className="btn primary" disabled={samples.length === 0} onClick={copyPack}>
          {copied ? "Copied" : "Copy check pack"}
        </button>
        <button className="btn" disabled={samples.length === 0} onClick={downloadPack}>
          Download .md
        </button>
      </div>
      <p className="hint">
        Paste it into Claude, ChatGPT, Cursor, or anything else. The pack carries the prompt, the
        samples, the reply cap, and the instructions.
      </p>
      {error && <div className="lab-error">{error}</div>}

      {samples.length > 0 && (
        <>
          <div className="lab-step">3 · Paste the replies back</div>
          {samples.map((s, i) => (
            <label className="field" key={i}>
              <span>
                Reply to sample {i + 1} <span className="hint">{s.slice(0, 60)}</span>
              </span>
              <textarea
                style={{ minHeight: 64 }}
                value={outputs[i] ?? ""}
                onChange={(e) => setOutput(i, e.target.value)}
                placeholder="Paste what the model replied…"
              />
            </label>
          ))}
          <button className="btn primary" disabled={!canScore} onClick={score}>
            Score {filled} {filled === 1 ? "reply" : "replies"}
          </button>
          <p className="hint">
            Blank boxes stay unreviewed rather than counting as failures. Token counts here are
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
        const stale = r.ranAgainst !== runFingerprint(prompt, maxTokens);
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
