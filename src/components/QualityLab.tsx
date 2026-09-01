import { useEffect, useMemo, useState } from "react";
import type { MeasureRun, ModelSpec, QualityCheck, SampleResult } from "../core/types";
import { MODELS } from "../core/models";
import {
  MAX_MODELS_PER_RUN,
  MAX_SAMPLES_PER_RUN,
  getQualityLabStatus,
  previewRunCost,
  runMeasurement,
  type ResultCache,
} from "../core/measure";
import { fmtUSD } from "../core/card";

const localCache: ResultCache = {
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as SampleResult) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* cache is best-effort */
    }
  },
};

export function QualityLab({
  prompt,
  runs,
  setRuns,
}: {
  prompt: string;
  runs: MeasureRun[];
  setRuns: (r: MeasureRun[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(["claude-haiku-4-5"]);
  const [samplesText, setSamplesText] = useState("");
  const [checkKind, setCheckKind] = useState<QualityCheck["kind"]>("json");
  const [checkValue, setCheckValue] = useState("");
  const [maxTokens, setMaxTokens] = useState(300);
  const [service, setService] = useState<"checking" | "available" | "unavailable">("checking");
  const [configuredProviders, setConfiguredProviders] = useState<ModelSpec["provider"][]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    getQualityLabStatus()
      .then((status) => {
        if (!current) return;
        setConfiguredProviders(status.configuredProviders);
        setService("available");
      })
      .catch(() => {
        if (current) setService("unavailable");
      });
    return () => {
      current = false;
    };
  }, []);

  const samples = useMemo(
    () =>
      samplesText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, MAX_SAMPLES_PER_RUN),
    [samplesText],
  );

  const chosenModels = useMemo(
    () => selected.slice(0, MAX_MODELS_PER_RUN).map((id) => MODELS.find((m) => m.id === id)!),
    [selected],
  );

  const preview = useMemo(() => {
    let total = 0;
    for (const m of chosenModels) {
      total += previewRunCost(m, prompt, samples, maxTokens).totalUSD;
    }
    return total;
  }, [chosenModels, prompt, samples, maxTokens]);

  const providersNeeded = [...new Set(chosenModels.map((m) => m.provider))];
  const providersMissing = providersNeeded.filter((provider) => !configuredProviders.includes(provider));
  const check: QualityCheck = { kind: checkKind, value: checkValue || undefined };
  const ready =
    service === "available" &&
    samples.length > 0 &&
    chosenModels.length > 0 &&
    providersMissing.length === 0 &&
    !busy;

  const toggleModel = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-MAX_MODELS_PER_RUN),
    );
  };

  const run = async () => {
    setBusy(true);
    setError("");
    const newRuns: MeasureRun[] = [];
    try {
      for (const m of chosenModels) {
        setProgress(`Running ${m.displayName}…`);
        const r = await runMeasurement({
          model: m,
          prompt,
          samples,
          check,
          maxTokens,
          cache: localCache,
          onProgress: (done, total) => setProgress(`${m.displayName}: ${done}/${total} samples`),
        });
        newRuns.push(r);
      }
      // Replace runs for the same models, keep others.
      const kept = runs.filter((r) => !newRuns.some((n) => n.modelId === r.modelId));
      setRuns([...kept, ...newRuns]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const overrideResult = (modelId: string, idx: number, pass: boolean) => {
    setRuns(
      runs.map((r) =>
        r.modelId === modelId
          ? { ...r, results: r.results.map((s, i) => (i === idx ? { ...s, pass } : s)) }
          : r,
      ),
    );
  };

  return (
    <div className="panel lab">
      <p className="lab-lead">
        This opt-in step sends your prompt to a provider and bills its API. Real calls run only
        through the loopback-only local service.
      </p>
      <div className="lab-facts">
        <span>up to {MAX_SAMPLES_PER_RUN} samples × {MAX_MODELS_PER_RUN} models</span>
        <span>keys never enter the browser</span>
        <span>results cached, re-runs free</span>
      </div>

      {service === "checking" && <div className="lab-notice">Checking for the local Quality Lab service…</div>}
      {service === "unavailable" && (
        <div className="lab-notice">
          <strong>Quality Lab is local-only.</strong> This build cannot make paid calls. To enable
          them on your machine, configure <code>.env.local</code> and start{" "}
          <code>npm run dev:quality</code>.
        </div>
      )}
      {service === "available" && configuredProviders.length === 0 && (
        <div className="lab-notice">
          The local service is running, but no provider key is configured. Add one to{" "}
          <code>.env.local</code>, then restart <code>npm run dev:quality</code>.
        </div>
      )}

      <div className="field">
        <span>Models to try (max {MAX_MODELS_PER_RUN})</span>
        <div className="lab-models">
          {MODELS.map((m: ModelSpec) => (
            <label className="checkline" key={m.id}>
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                onChange={() => toggleModel(m.id)}
              />
              {m.displayName} <span className="hint">{m.provider}</span>
            </label>
          ))}
        </div>
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
          <select value={checkKind} onChange={(e) => setCheckKind(e.target.value as QualityCheck["kind"])}>
            <option value="json">reply is valid JSON</option>
            <option value="contains">reply contains…</option>
            <option value="regex">reply matches regex…</option>
            <option value="manual">I judge it myself</option>
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
      {(checkKind === "contains" || checkKind === "regex") && (
        <label className="field">
          <span>{checkKind === "contains" ? "Required text" : "Regex pattern"}</span>
          <input type="text" value={checkValue} onChange={(e) => setCheckValue(e.target.value)} />
        </label>
      )}

      <div className="cost-preview">
        Worst case <strong>{fmtUSD(preview)}</strong> for {samples.length}{" "}
        {samples.length === 1 ? "sample" : "samples"} × {chosenModels.length}{" "}
        {chosenModels.length === 1 ? "model" : "models"}, replies capped at {maxTokens} tokens.
      </div>

      <button className="btn spend" disabled={!ready} onClick={run}>
        {busy ? progress || "Running…" : `Run check · ${fmtUSD(preview)}`}
      </button>
      {service === "available" && providersMissing.length > 0 && samples.length > 0 && (
        <span className="hint">
          {" "}
          Add {providersMissing.map((provider) => `${provider.toUpperCase()} API key`).join(" and ")} to{" "}
          <code>.env.local</code>, then restart the local service.
        </span>
      )}
      {error && <div className="lab-error">{error}</div>}

      {runs.map((r) => {
        const judged = r.results.filter((s) => s.pass !== null);
        const passed = judged.filter((s) => s.pass).length;
        return (
          <div key={r.modelId}>
            <h3 style={{ marginTop: 18, fontSize: 14 }}>
              {r.modelId}: <span className="num">{passed}/{judged.length || r.results.length} passed</span>{" "}
              <span className="hint">
                {fmtUSD(r.totalCostUSD)} spent{r.results.some((s) => s.cached) ? ", some cached" : ""}
              </span>
            </h3>
            <table className="results-table">
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Tokens in/out</th>
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
                          <button className="btn small" onClick={() => overrideResult(r.modelId, i, true)}>
                            pass
                          </button>{" "}
                          <button className="btn small" onClick={() => overrideResult(r.modelId, i, false)}>
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
