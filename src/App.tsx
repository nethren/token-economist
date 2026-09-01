import { useDeferredValue, useEffect, useMemo, useState } from "react";
import "./App.css";
import { MODELS } from "./core/models";
import {
  autoLoadPrices,
  fetchLivePrices,
  rememberPrices,
  PRICE_SOURCE_NAME,
} from "./core/livePrices";
import { countBaseTokens, humanSize, wordsFromTokens } from "./core/tokenizer";
import { estimateAll } from "./core/estimate";
import { isSimpleTask, lintPrompt } from "./core/lint";
import { recommend, renderCard } from "./core/card";
import {
  DEFAULT_ASSUMPTIONS,
  type LintAction,
  type LintFinding,
  type MeasureRun,
  type ScaleAssumptions,
} from "./core/types";
import { ModelTable } from "./components/ModelTable";
import { QualityLab } from "./components/QualityLab";
import { Receipt } from "./components/Receipt";
import { PRESETS, type FeaturePreset } from "./core/presets";
import { decodeShareState, encodeShareState } from "./core/share";

/** State restored from a shared permalink, if the URL carries one. */
const RESTORED = typeof window !== "undefined" ? decodeShareState(window.location.hash) : null;

type Theme = "light" | "dark";
const THEME_KEY = "token-econ.theme";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** A small hover/focus target that reveals a plain-language explanation.
 *  Renders its own styled popover (instead of the slow, unstyleable native
 *  title tooltip) so it appears instantly, and stays keyboard reachable
 *  (tabIndex + focus) for non-mouse users. The copy is split into a short
 *  definition (`what`) and an optional one-line practical hint (`tip`). */
function InfoDot({ what, tip }: { what: string; tip?: string }) {
  return (
    <span className="info" tabIndex={0} role="note" aria-label={tip ? `${what} ${tip}` : what}>
      i
      <span className="info-bubble" role="tooltip">
        <span className="tip-what">{what}</span>
        {tip && <span className="tip-hint">{tip}</span>}
      </span>
    </span>
  );
}

function NumField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  hint,
  what,
  tip,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  min?: number;
  step?: number;
  hint?: string;
  what?: string;
  tip?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {what && <InfoDot what={what} tip={tip} />}
      </span>
      <input
        type="number"
        min={min}
        step={step}
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
      {hint && <div className="hint">{hint}</div>}
    </label>
  );
}

function SecHead({ n, title, lamp }: { n: number; title: string; lamp?: "ok" | "todo" }) {
  return (
    <div className="sec-head">
      <span className="sec-num" aria-hidden="true">
        {n}
      </span>
      <h2>{title}</h2>
      {lamp && <span className={`sec-lamp ${lamp}`} aria-hidden="true" />}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? (
        <svg key="moon" className="tt-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path
            d="M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg key="sun" className="tt-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4" />
          </g>
        </svg>
      )}
      <span>{dark ? "Light" : "Dark"}</span>
    </button>
  );
}

export default function App() {
  const [featureName, setFeatureName] = useState(RESTORED?.featureName ?? "");
  const [prompt, setPrompt] = useState(RESTORED?.prompt ?? "");
  const [assumptions, setAssumptions] = useState<ScaleAssumptions>(
    RESTORED?.assumptions ?? DEFAULT_ASSUMPTIONS,
  );
  const [runs, setRuns] = useState<MeasureRun[]>([]);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [models, setModels] = useState(MODELS);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [priceStatus, setPriceStatus] = useState<
    | { kind: "loading" }
    | { kind: "snapshot"; note?: string }
    | { kind: "live"; fetchedAt: string; updated: number; missing: string[]; via: "network" | "cache" }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode: toggle still works for the session */
    }
  }, [theme]);

  // Keep prices current without user action: on load, apply the cached live
  // prices (≤6h old) or fetch fresh ones; offline falls back to the last
  // known prices, then the bundled snapshot. Never touches the prompt.
  useEffect(() => {
    let cancelled = false;
    autoLoadPrices(MODELS, localStorage).then((r) => {
      if (cancelled) return;
      if (r === null) {
        setPriceStatus({ kind: "snapshot", note: "couldn't reach the live price list" });
      } else {
        setModels(r.models);
        setPriceStatus({
          kind: "live",
          fetchedAt: r.fetchedAt,
          updated: r.updated.length,
          missing: r.missing,
          via: r.via,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const deferredPrompt = useDeferredValue(prompt);
  const hasPrompt = deferredPrompt.trim().length > 0;
  const set = <K extends keyof ScaleAssumptions>(k: K, v: ScaleAssumptions[K]) =>
    setAssumptions((a) => ({ ...a, [k]: v }));

  const baseTokens = useMemo(() => countBaseTokens(deferredPrompt), [deferredPrompt]);

  const estimates = useMemo(
    () => estimateAll(deferredPrompt, assumptions, models),
    [deferredPrompt, assumptions, models],
  );

  const recommendation = useMemo(
    () => recommend(estimates, runs, isSimpleTask(deferredPrompt)),
    [estimates, runs, deferredPrompt],
  );

  // Savings are priced against the model the tool actually recommends — the
  // number the user will pay — instead of asking them to pick a reference.
  const referenceModel = recommendation?.estimate.model ?? models[0];

  const findings = useMemo(
    () => lintPrompt(deferredPrompt, assumptions, referenceModel, models),
    [deferredPrompt, assumptions, referenceModel, models],
  );

  const card = useMemo(
    () =>
      renderCard({
        featureName,
        prompt: deferredPrompt,
        estimates,
        assumptions,
        findings,
        runs,
        recommendation,
      }),
    [featureName, deferredPrompt, estimates, assumptions, findings, runs, recommendation],
  );

  const applyFix = (f: LintFinding) => {
    if (f.apply) setPrompt(f.apply(prompt));
  };

  const applyAction = (action: LintAction) => {
    switch (action.kind) {
      case "enable-caching":
        set("useCaching", true);
        break;
      case "set-output-cap":
        set("maxOutputTokens", action.tokens);
        break;
    }
  };

  const applyPreset = (p: FeaturePreset) => {
    setFeatureName(p.featureName);
    setPrompt(p.prompt);
    setAssumptions(p.assumptions);
  };

  /** Manual force-refresh (skips the cache). Downloads a public price
   *  table; the prompt never leaves the tab — the deterministic engine just
   *  receives an updated model registry as input. */
  const updatePrices = async () => {
    setPriceStatus({ kind: "loading" });
    try {
      const r = await fetchLivePrices(MODELS);
      rememberPrices(localStorage, r, Date.now());
      setModels(r.models);
      setPriceStatus({
        kind: "live",
        fetchedAt: r.fetchedAt,
        updated: r.updated.length,
        missing: r.missing,
        via: "network",
      });
    } catch (err) {
      setPriceStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "could not reach the price list",
      });
    }
  };

  const copyCard = async () => {
    await navigator.clipboard.writeText(card);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  /** Put the whole decision in the URL fragment (never sent to any server)
   *  and copy it — a decision someone can open, not just read. */
  const copyShareLink = async () => {
    const hash = encodeShareState({
      featureName,
      prompt,
      assumptions,
      referenceId: referenceModel.id,
    });
    history.replaceState(null, "", `#${hash}`);
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${hash}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1800);
  };

  const verified = recommendation?.verified ?? false;

  return (
    <div className="app">
      <header className="appbar">
        <div className="brand">
          <svg className="mark" viewBox="0 0 28 28" aria-hidden="true">
            <rect x="1" y="1" width="26" height="26" rx="7" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
            <rect x="7" y="13" width="14" height="2.5" rx="1.25" fill="currentColor" opacity="0.4" />
            <rect x="13" y="8.5" width="2.5" height="11" rx="1.25" fill="var(--accent)" />
          </svg>
          <div className="brand-text">
            <h1>Token Economist</h1>
            <span className="tagline">know the cost before you build it</span>
          </div>
        </div>
        <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
      </header>

      <div className="layout">
        {/* --------------------------------------------------- controls */}
        <aside className="controls">
          <section className="ctrl-sec">
            <SecHead n={1} title="The prompt" />
            <div className="presetbar" role="group" aria-label="Feature templates">
              <span className="presetbar-label">Start from a template</span>
              <div className="preset-chips">
                {PRESETS.map((p) => (
                  <button key={p.id} className="chip" title={p.blurb} onClick={() => applyPreset(p)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Feature name</span>
              <input
                type="text"
                value={featureName}
                onChange={(e) => setFeatureName(e.target.value)}
                placeholder="e.g. Support ticket classifier"
              />
            </label>
            <label className="field">
              <span>Prompt as it will ship</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                spellCheck={false}
                placeholder="Paste the system prompt, instructions, and any examples you plan to ship…"
              />
            </label>
            <div className="tokmeter">
              <span title="Counted offline with the o200k tokenizer. Other providers' counts are estimated with calibration bands, which is why costs are ranges.">
                <strong className="num">{baseTokens.toLocaleString("en-US")}</strong> tokens{" "}
                {humanSize(baseTokens)}
              </span>
              <span>measured offline · never uploaded</span>
            </div>
          </section>

          <section className="ctrl-sec">
            <SecHead n={2} title="Scale" />
            <div className="assume-grid">
              <NumField
                label="Conversations / month"
                value={assumptions.requestsPerMonth}
                onChange={(n) => set("requestsPerMonth", n ?? 0)}
                step={1000}
                what="Separate requests your feature handles each month."
                tip="One user asking one thing = one. A rough order of magnitude is enough."
              />
              <NumField
                label="Turns / conversation"
                value={assumptions.turnsPerConversation}
                onChange={(n) => set("turnsPerConversation", Math.max(1, n ?? 1))}
                min={1}
                what="Back-and-forth exchanges in one conversation."
                tip="A one-shot task is 1; a short chat, 3–5. Each turn re-sends the earlier ones."
              />
              <NumField
                label="User tokens / turn"
                value={assumptions.avgUserInputTokens}
                onChange={(n) => set("avgUserInputTokens", n ?? 0)}
                step={50}
                hint={`≈ ${wordsFromTokens(assumptions.avgUserInputTokens)} words`}
                what="Text you send the model each turn."
                tip="A token ≈ ¾ of a word. 150 tokens ≈ 110 words."
              />
              <NumField
                label="Expected reply tokens"
                value={assumptions.expectedOutputTokens}
                onChange={(n) => set("expectedOutputTokens", n)}
                hint={
                  assumptions.expectedOutputTokens != null
                    ? `≈ ${wordsFromTokens(assumptions.expectedOutputTokens)} words`
                    : "blank = unknown (flagged)"
                }
                what="How long you expect each reply to be."
                tip="This drives cost the most. Leave blank if unsure; we'll flag it."
              />
              <NumField
                label="Reply limit (max_tokens)"
                value={assumptions.maxOutputTokens}
                onChange={(n) => set("maxOutputTokens", n)}
                hint="blank = uncapped (flagged)"
                what="A hard ceiling on any single reply's length."
                tip="Caps your worst case. Leave blank if none is set; we'll flag it."
              />
              <NumField
                label="Retry rate %"
                value={Math.round(assumptions.retryRate * 100)}
                onChange={(n) => set("retryRate", (n ?? 0) / 100)}
                what="Requests you send again after a failure or bad answer."
                tip="Each retry bills again. 3% is a safe default."
              />
              <NumField
                label="Tool calls / turn"
                value={assumptions.toolCallsPerTurn}
                onChange={(n) => set("toolCallsPerTurn", n ?? 0)}
                what="Tools the model uses per turn: search, lookups, functions."
                tip="Each result adds text to read. Use 0 for no tools."
              />
              <NumField
                label="Tokens / tool call"
                value={assumptions.tokensPerToolCall}
                onChange={(n) => set("tokensPerToolCall", n ?? 0)}
                step={100}
                what="Text each tool result adds back to the conversation."
                tip="A lookup is small; a whole document is large. For RAG, model retrieved context here."
              />
              <NumField
                label="Thinking tokens / turn"
                value={assumptions.reasoningTokensPerTurn}
                onChange={(n) => set("reasoningTokensPerTurn", Math.max(0, n ?? 0))}
                step={500}
                what="Hidden tokens a thinking model spends before it answers. Billed as output, never shown."
                tip="0 for non-thinking models. Agentic workloads often burn 1–5k per turn."
              />
              <label className="checkline switch wide">
                <input
                  type="checkbox"
                  checked={assumptions.useCaching}
                  onChange={(e) => set("useCaching", e.target.checked)}
                />
                <span className="switch-track" aria-hidden="true" />
                Prompt caching on the static prefix
                <InfoDot
                  what="Reuse a fixed prompt prefix at a steep discount instead of re-sending it."
                  tip="Turn on when your instructions stay the same across requests."
                />
              </label>
              {assumptions.useCaching && (
                <NumField
                  label="Cache hit rate %"
                  value={Math.round(assumptions.cacheHitRate * 100)}
                  onChange={(n) => set("cacheHitRate", Math.min(100, Math.max(0, n ?? 0)) / 100)}
                  what="Eligible requests that actually reuse the cache."
                  tip="Steady traffic keeps it warm; sporadic traffic lets it expire."
                />
              )}
              <label className="checkline switch wide">
                <input
                  type="checkbox"
                  checked={assumptions.useBatch}
                  onChange={(e) => set("useBatch", e.target.checked)}
                />
                <span className="switch-track" aria-hidden="true" />
                Batch API (non-interactive, −50%)
                <InfoDot
                  what="Submit work in bulk, get results within hours, for half price."
                  tip="Good for overnight jobs. Not for live chat."
                />
              </label>
            </div>
            {recommendation && recommendation.estimate.assumptionNotes.length > 0 && (
              <ul className="notes-list">
                {recommendation.estimate.assumptionNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="ctrl-sec" id="quality">
            <SecHead n={3} title="Quality check" lamp={verified ? "ok" : "todo"} />
            <div className={`labstatus ${verified ? "ok" : "todo"}`}>
              {verified ? (
                <>Passed. The recommendation now carries a verified stamp.</>
              ) : runs.length > 0 ? (
                <>Your check ran, but nothing has passed enough samples yet. The pick stays unverified.</>
              ) : (
                <>
                  Optional, and a few cents. You can compute cost, but you have to watch quality: the
                  pick stays <em>unverified</em> until a model passes your own check.
                </>
              )}
            </div>
            <QualityLab prompt={deferredPrompt} runs={runs} setRuns={setRuns} />
          </section>

          <div className="pricebar">
            {priceStatus.kind === "loading" && (
              <span className="pricebar-note">checking today's prices…</span>
            )}
            {priceStatus.kind === "snapshot" && (
              <span className="pricebar-note">
                {priceStatus.note !== undefined ? `${priceStatus.note}, ` : ""}using bundled price
                snapshot
              </span>
            )}
            {priceStatus.kind === "live" && (
              <span className="pricebar-note live">
                prices auto-updated · {PRICE_SOURCE_NAME} · {priceStatus.fetchedAt}
                {priceStatus.via === "cache" ? " (cached)" : ""}
                {priceStatus.missing.length > 0 &&
                  ` · kept snapshot: ${priceStatus.missing.join(", ")}`}
              </span>
            )}
            {priceStatus.kind === "error" && (
              <span className="pricebar-note error">
                price refresh failed ({priceStatus.message}). Keeping the last prices.
              </span>
            )}
            <button
              className="chip"
              onClick={updatePrices}
              disabled={priceStatus.kind === "loading"}
              title={`Downloads today's prices from ${PRICE_SOURCE_NAME} (a public price list). Your prompt is never sent — price refresh is the only automatic network call; the Quality Lab is the only one that ever carries your prompt, and only when you run it.`}
            >
              refresh
            </button>
          </div>
        </aside>

        {/* --------------------------------------------------- results */}
        <main className="results">
          <Receipt
            hasPrompt={hasPrompt}
            recommendation={recommendation}
            estimates={estimates}
            findings={findings}
            runs={runs}
            requestsPerMonth={assumptions.requestsPerMonth}
            onApply={applyFix}
            onAction={applyAction}
          />

          {hasPrompt && (
            <>
              <div className="results-actions">
                <button className="btn primary" onClick={copyCard}>
                  Copy as Markdown
                </button>
                {copied && <span className="copied">copied ✓</span>}
                <button
                  className="btn"
                  onClick={copyShareLink}
                  title="Encodes the prompt + assumptions in the URL fragment — shared with the link's recipient, never sent to a server."
                >
                  Copy share link
                </button>
                {linkCopied && <span className="copied">link copied ✓</span>}
              </div>

              <details className="more">
                <summary>Full comparison table: ranges, $/1M, per conversation</summary>
                <ModelTable estimates={estimates} recommendation={recommendation} tableOnly />
              </details>

              <details className="more">
                <summary>Raw Markdown card (what "Copy as Markdown" copies)</summary>
                <pre className="cardpre">{card}</pre>
              </details>
            </>
          )}

          <footer className="foot">
            <div className="trust">
              <span>Ranges, not quotes</span>
              <span>Cost path never calls a model</span>
              <span>Prompt stays in your tab</span>
            </div>
            <p>
              Your prompt only leaves the tab when you run a quality check. Prices auto-refresh from a
              public list; the eval suite (npm run eval) proves the cost path never touches the
              network.
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
