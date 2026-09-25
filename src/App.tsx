import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./App.css";
import { MODELS } from "./core/models";
import {
  autoLoadPrices,
  fetchLivePrices,
  rememberPrices,
  PRICE_SOURCE_NAME,
} from "./core/livePrices";
import { countBaseTokens, wordsFromTokens } from "./core/tokenizer";
import { INPUT_SIZES, OUTPUT_SIZES } from "./core/sizes";
import { estimateAll } from "./core/estimate";
import { lintPrompt } from "./core/lint";
import { fmtBand, fmtUSD, recommend, renderCard } from "./core/card";
import { runFingerprint } from "./core/measure";
import {
  DEFAULT_ASSUMPTIONS,
  type LintAction,
  type LintFinding,
  type MeasureRun,
  type ScaleAssumptions,
} from "./core/types";
import { ModelTable } from "./components/ModelTable";
import { QualityLab } from "./components/QualityLab";
import { SizeField } from "./components/SizeField";
import { Receipt } from "./components/Receipt";
import { VerifyBadge } from "./components/Badge";
import { PRESETS, type FeaturePreset } from "./core/presets";
import { decodeShareState, encodeShareState } from "./core/share";

/** State restored from a shared permalink, if the URL carries one. */
const RESTORED = typeof window !== "undefined" ? decodeShareState(window.location.hash) : null;

/** What a first visit opens on: a worked example, labelled as one, so the
 *  answer is on screen before anyone has to type (DECISIONS.md D30). */
const FIRST_EXAMPLE = PRESETS.find((p) => p.id === "support-bot") ?? PRESETS[0];

const REPO_URL = "https://github.com/nethren/token-economist";
const PORTFOLIO_URL = "https://nethren.com/";

type Theme = "light" | "dark";
/** Holds only a theme the visitor picked with the toggle. Until then the page
 *  follows the system, live. (The old key, "token-econ.theme", was written on
 *  every first visit, so it cannot tell a choice from a default; D31.) */
const THEME_KEY = "token-econ.theme-choice";

function savedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

function initialTheme(): Theme {
  if (typeof document !== "undefined") {
    // public/theme.js has already resolved storage and the OS preference.
    const set = document.documentElement.getAttribute("data-theme");
    if (set === "light" || set === "dark") return set;
  }
  return "light";
}

type LabSeed = FeaturePreset["check"] | null;
type Snapshot = {
  featureName: string;
  prompt: string;
  assumptions: ScaleAssumptions;
  labSeed: LabSeed;
};

/** A small hover/focus target that reveals a plain-language explanation.
 *  Renders its own popover (the native title tooltip is slow and unstyleable)
 *  and stays keyboard reachable. `what` defines; `tip` gives a practical hint. */
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

/** A monthly volume is hard to picture; the daily rate it implies is not, and
 *  the mismatch is where an order-of-magnitude slip shows up. */
function perDayHint(perMonth: number): string {
  if (perMonth <= 0) return "";
  const perDay = perMonth / 30;
  if (perDay < 1) return `about ${Math.round(perMonth / 4.3)} a week`;
  return `about ${Math.round(perDay).toLocaleString("en-US")} a day`;
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
        inputMode="numeric"
        min={min}
        step={step}
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Numbered because the steps are a real sequence: the decision is made in
 *  this order. */
function StepHead({ n, title, id, aside }: { n: number; title: string; id: string; aside?: ReactNode }) {
  return (
    <div className="step-head">
      <span className="step-n" aria-hidden="true">
        {n}
      </span>
      <h2 id={id}>{title}</h2>
      {aside && <div className="step-aside">{aside}</div>}
    </div>
  );
}

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="7" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <path d="M7 10.75 q3.5 -2.5 7 0 t7 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.45" />
      <path d="M7 17.25 q3.5 -2.5 7 0 t7 0" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button className="icon-btn" onClick={onToggle} aria-label={label} title={label}>
      {dark ? (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4" />
          </g>
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path
            d="M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M4.5 2.5h5v5M9.5 2.5 3 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [featureName, setFeatureName] = useState(RESTORED?.featureName ?? FIRST_EXAMPLE.featureName);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [formSeq, setFormSeq] = useState(0);
  const [prompt, setPrompt] = useState(RESTORED?.prompt ?? FIRST_EXAMPLE.prompt);
  const [assumptions, setAssumptions] = useState<ScaleAssumptions>(
    RESTORED?.assumptions ?? FIRST_EXAMPLE.assumptions,
  );
  const [runs, setRuns] = useState<MeasureRun[]>([]);
  // The quality check's starting inputs follow the loaded example; a shared
  // link or a blank start begins with none.
  const [labSeed, setLabSeed] = useState<LabSeed>(RESTORED ? null : FIRST_EXAMPLE.check);
  // Lives here rather than inside the Lab because it is part of the
  // configuration a quality result is valid for.
  const [labMaxTokens, setLabMaxTokens] = useState(300);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [models, setModels] = useState(MODELS);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [toast, setToast] = useState<{ id: number; text: string; undo?: Snapshot } | null>(null);
  const [verdictEl, setVerdictEl] = useState<HTMLDivElement | null>(null);
  const [verdictInView, setVerdictInView] = useState(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [priceStatus, setPriceStatus] = useState<
    | { kind: "loading" }
    | { kind: "snapshot"; note?: string }
    | { kind: "live"; fetchedAt: string; updated: number; missing: string[]; via: "network" | "cache" }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Follow the system (e.g. an evening switch to dark) until the visitor
  // makes a choice of their own with the toggle.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (savedTheme() === null) setTheme(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode: the toggle still works for this session */
    }
    setTheme(next);
  };

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

  // The answer follows the reader: once the verdict scrolls out of view, a
  // compact copy appears in the header (desktop) or a bottom bar (phone).
  useEffect(() => {
    if (!verdictEl) {
      setVerdictInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setVerdictInView(entry.isIntersecting), {
      rootMargin: "-64px 0px 0px 0px",
    });
    io.observe(verdictEl);
    return () => io.disconnect();
  }, [verdictEl]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const deferredPrompt = useDeferredValue(prompt);
  const hasPrompt = deferredPrompt.trim().length > 0;
  const set = <K extends keyof ScaleAssumptions>(k: K, v: ScaleAssumptions[K]) =>
    setAssumptions((a) => ({ ...a, [k]: v }));

  const baseTokens = useMemo(() => countBaseTokens(deferredPrompt), [deferredPrompt]);

  const estimates = useMemo(
    () => estimateAll(deferredPrompt, assumptions, models),
    [deferredPrompt, assumptions, models],
  );

  // A quality result only describes the prompt and reply cap it was measured
  // against. Runs are checked against this, so editing the prompt retires the
  // evidence instead of letting it certify something it never saw.
  const fingerprint = useMemo(
    () => runFingerprint(deferredPrompt, labMaxTokens),
    [deferredPrompt, labMaxTokens],
  );

  const recommendation = useMemo(
    () => recommend(estimates, runs, fingerprint),
    [estimates, runs, fingerprint],
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
        currentFingerprint: fingerprint,
      }),
    [
      featureName,
      deferredPrompt,
      estimates,
      assumptions,
      findings,
      runs,
      recommendation,
      fingerprint,
    ],
  );

  const activeExample = PRESETS.find((p) => p.prompt === prompt) ?? null;

  const snapshot = (): Snapshot => ({ featureName, prompt, assumptions, labSeed });

  const restore = (s: Snapshot) => {
    setFeatureName(s.featureName);
    setPrompt(s.prompt);
    setAssumptions(s.assumptions);
    setLabSeed(s.labSeed);
    setFormSeq((n) => n + 1);
    setToast(null);
  };

  const offerUndo = (text: string, before: Snapshot) =>
    setToast({ id: Date.now(), text, undo: before });

  const applyFix = (f: LintFinding) => {
    if (!f.apply) return;
    const before = snapshot();
    setPrompt(f.apply(prompt));
    offerUndo(`Applied “${f.title}” to your prompt.`, before);
  };

  const applyAction = (action: LintAction) => {
    // Both of these live in the advanced panel. Changing a control the user
    // cannot see would look like the number moved on its own, so open it.
    setAdvancedOpen(true);
    const before = snapshot();
    switch (action.kind) {
      case "enable-caching":
        set("useCaching", true);
        offerUndo("Turned on prompt caching.", before);
        break;
      case "set-output-cap":
        set("maxOutputTokens", action.tokens);
        offerUndo(`Capped replies at ${action.tokens} tokens.`, before);
        break;
    }
  };

  const applyPreset = (p: FeaturePreset) => {
    // Switching between examples loses nothing; replacing the user's own
    // prompt does, so that one is offered back.
    const ownWork = prompt.trim() !== "" && !PRESETS.some((x) => x.prompt === prompt);
    const before = snapshot();
    setFeatureName(p.featureName);
    setPrompt(p.prompt);
    setAssumptions(p.assumptions);
    setLabSeed(p.check);
    // Remounts the size fields, so a template's values show as the named size
    // they are rather than staying in whichever entry mode was open.
    setFormSeq((n) => n + 1);
    if (ownWork) offerUndo(`Loaded the ${p.name.toLowerCase()} example in place of your prompt.`, before);
  };

  const startBlank = () => {
    const before = snapshot();
    setFeatureName("");
    setPrompt("");
    setAssumptions(DEFAULT_ASSUMPTIONS);
    setLabSeed(null);
    setFormSeq((n) => n + 1);
    offerUndo("Cleared the example.", before);
    promptRef.current?.focus();
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
    setCopyError("");
    try {
      await navigator.clipboard.writeText(card);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError('Copy was blocked. Open “The Markdown card” below to select and copy the text.');
    }
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
    setCopyError("");
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${hash}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      setCopyError('Copy was blocked. The share link is now in your address bar; copy it from there. It includes your prompt.');
    }
  };

  const verified = recommendation?.verified ?? false;
  const qStatus = recommendation?.status ?? null;
  const showPeek = hasPrompt && recommendation !== null && !verdictInView;

  const exampleButtons = (
    <div className="examples" role="group" aria-label="Examples">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          className="chip"
          aria-pressed={activeExample?.id === p.id}
          title={p.blurb}
          onClick={() => applyPreset(p)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );

  const priceNote = (
    <p className="price-note">
      {priceStatus.kind === "loading" && "Checking today's prices…"}
      {priceStatus.kind === "snapshot" &&
        `Using the bundled price snapshot${priceStatus.note ? ` (${priceStatus.note})` : ""}.`}
      {priceStatus.kind === "live" && (
        <>
          Prices from {PRICE_SOURCE_NAME}, checked {priceStatus.fetchedAt}
          {priceStatus.via === "cache" ? " (cached)" : ""}.
          {priceStatus.missing.length > 0 &&
            ` Snapshot prices for ${priceStatus.missing.join(", ")}.`}
        </>
      )}
      {priceStatus.kind === "error" &&
        `Price refresh failed (${priceStatus.message}). Using the last known prices.`}{" "}
      <button
        className="link-btn"
        onClick={updatePrices}
        disabled={priceStatus.kind === "loading"}
        title={`Downloads today's public price list from ${PRICE_SOURCE_NAME}. Your prompt is never sent. This is the only network call the app makes.`}
      >
        Refresh prices
      </button>
    </p>
  );

  return (
    <div className="app" id="top">
      <a className="skip-link" href="#result">
        Skip to the estimate
      </a>

      <header className="appbar">
        <a className="wordmark" href="#top" aria-label="Token Economist, back to top">
          <Mark />
          <span className="wordmark-text">
            <span>Token</span>
            <b>Economist</b>
          </span>
        </a>

        {recommendation && (
          <div className="peek" data-show={showPeek} inert={!showPeek}>
            <span className="peek-model">{recommendation.estimate.model.displayName}</span>
            <span className="peek-cost num">
              {fmtUSD(recommendation.estimate.costPerMonth.point)}
              <small>/mo</small>
            </span>
            <span className="peek-range num">
              likely {fmtBand(recommendation.estimate.costPerMonth.low, recommendation.estimate.costPerMonth.high)}
            </span>
            <VerifyBadge verified={verified} compact />
            <a className="peek-go" href="#result">
              See estimate
            </a>
          </div>
        )}

        <nav className="appnav" aria-label="Site">
          <a href="#how">How it works</a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub <ExternalIcon />
          </a>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </nav>
      </header>

      <main>
        <section className="intro" aria-labelledby="intro-title">
          <h1 id="intro-title">What will this AI feature cost to run?</h1>
          <p className="intro-lede">
            Paste the prompt you plan to ship and a rough idea of usage. You get a monthly cost
            range on seven models, what drives it, and what to cut, before anyone writes code. Your
            prompt never leaves this page.
          </p>
          {activeExample && !RESTORED && (
            <p className="example-note">
              You're looking at the <strong>{activeExample.name.toLowerCase()}</strong> example.{" "}
              {activeExample.draftNote ? `${activeExample.draftNote} ` : ""}Change anything, or{" "}
              <button className="link-btn" onClick={startBlank}>
                start with a blank prompt
              </button>
              .
            </p>
          )}
        </section>

        <div className="workspace">
          <section className="inputs" aria-label="Inputs">
            <div className="step" aria-labelledby="step-prompt">
              <StepHead n={1} id="step-prompt" title="Your prompt" />
              <div className="field">
                <span>Start from an example</span>
                {exampleButtons}
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
                <span>The prompt as it will ship</span>
                <textarea
                  ref={promptRef}
                  className="prompt-box"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  spellCheck={false}
                  placeholder="Paste the system prompt, instructions and any examples you plan to ship…"
                />
              </label>
              <p className="tokmeter">
                <span title="Counted in your browser with the o200k tokenizer. Other providers are estimated with calibration bands, which is why costs are ranges.">
                  <strong className="num">{baseTokens.toLocaleString("en-US")}</strong> tokens, about{" "}
                  {wordsFromTokens(baseTokens).toLocaleString("en-US")} words
                </span>
                <span>Counted on this device, never uploaded</span>
              </p>
            </div>

            <div className="step" aria-labelledby="step-usage">
              <StepHead n={2} id="step-usage" title="Usage" />
              <div className="assume-grid">
                <NumField
                  label="Conversations a month"
                  value={assumptions.requestsPerMonth}
                  onChange={(n) => set("requestsPerMonth", n ?? 0)}
                  step={1000}
                  hint={perDayHint(assumptions.requestsPerMonth)}
                  what="Separate conversations or requests your feature handles each month."
                  tip="People who'll use it × how often each. A rough order of magnitude is enough."
                />
                <NumField
                  label="Turns per conversation"
                  value={assumptions.turnsPerConversation}
                  onChange={(n) => set("turnsPerConversation", Math.max(1, n ?? 1))}
                  min={1}
                  hint={
                    assumptions.turnsPerConversation === 1
                      ? "one question, one answer"
                      : "each turn re-sends the earlier ones"
                  }
                  what="Back-and-forth exchanges in one conversation."
                  tip="A one-shot task is 1; a short chat, 3–5."
                />
                <SizeField
                  key={`in-${formSeq}`}
                  label="What users send each turn"
                  value={assumptions.avgUserInputTokens}
                  onChange={(n) => set("avgUserInputTokens", n ?? 0)}
                  options={INPUT_SIZES}
                  sampleLabel="Paste a typical user message and it's counted exactly…"
                  what="The text going in each turn: the user's message, plus anything you attach."
                  tip="Pick the closest size, or paste a real one to measure it."
                />
                <SizeField
                  key={`out-${formSeq}`}
                  label="How long each reply is"
                  value={assumptions.expectedOutputTokens}
                  onChange={(n) => set("expectedOutputTokens", n)}
                  options={OUTPUT_SIZES}
                  unknownLabel="Not sure yet"
                  sampleLabel="Paste a reply you'd be happy with and it's counted exactly…"
                  what="How much the model writes back each turn."
                  tip="This drives cost more than anything else. Measure one if you can."
                />
              </div>

              {/* Everything below moves the number less than the four above, and
                  most features leave it at the default. It stays one click away
                  and opens itself when a suggestion changes something inside. */}
              <details
                className="disclosure"
                open={advancedOpen}
                onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
              >
                <summary>Retries, tools, thinking, caching and batch</summary>
                <div className="assume-grid">
                  <NumField
                    label="Reply limit (max_tokens)"
                    value={assumptions.maxOutputTokens}
                    onChange={(n) => set("maxOutputTokens", n)}
                    hint="blank means no limit, which is flagged"
                    what="A hard ceiling on any single reply's length."
                    tip="Caps your worst case. Leave blank if none is set; it will be flagged."
                  />
                  <NumField
                    label="Retry rate %"
                    value={Math.round(assumptions.retryRate * 100)}
                    onChange={(n) => set("retryRate", (n ?? 0) / 100)}
                    what="Requests you send again after a failure or bad answer."
                    tip="Each retry bills again. 3% is a safe default."
                  />
                  <NumField
                    label="Tool calls per turn"
                    value={assumptions.toolCallsPerTurn}
                    onChange={(n) => set("toolCallsPerTurn", n ?? 0)}
                    what="Tools the model uses per turn: search, lookups, functions."
                    tip="Each result adds text to read. Use 0 for no tools."
                  />
                  <NumField
                    label="Tokens per tool call"
                    value={assumptions.tokensPerToolCall}
                    onChange={(n) => set("tokensPerToolCall", n ?? 0)}
                    step={100}
                    what="Text each tool result adds back to the conversation."
                    tip="A lookup is small; a whole document is large. For RAG, model retrieved passages here."
                  />
                  <NumField
                    label="Thinking tokens per turn"
                    value={assumptions.reasoningTokensPerTurn}
                    onChange={(n) => set("reasoningTokensPerTurn", Math.max(0, n ?? 0))}
                    step={500}
                    what="Hidden tokens a thinking model spends before it answers. Billed as output, never shown."
                    tip="0 for non-thinking models. Agent workloads often use 1–5k per turn."
                  />
                  <label className="switch wide">
                    <input
                      type="checkbox"
                      checked={assumptions.useCaching}
                      onChange={(e) => set("useCaching", e.target.checked)}
                    />
                    <span className="switch-track" aria-hidden="true" />
                    <span>Prompt caching on the fixed part of the prompt</span>
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
                  <label className="switch wide">
                    <input
                      type="checkbox"
                      checked={assumptions.useBatch}
                      onChange={(e) => set("useBatch", e.target.checked)}
                    />
                    <span className="switch-track" aria-hidden="true" />
                    <span>Batch API: results within hours, half price</span>
                    <InfoDot
                      what="Submit work in bulk, get results within hours, for half price."
                      tip="Good for overnight jobs. Not for live chat."
                    />
                  </label>
                </div>
              </details>

              {recommendation && recommendation.estimate.assumptionNotes.length > 0 && (
                <ul className="notes-list">
                  {recommendation.estimate.assumptionNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="result" id="result" aria-label="Estimate" tabIndex={-1}>
            <Receipt
              hasPrompt={hasPrompt}
              recommendation={recommendation}
              estimates={estimates}
              findings={findings}
              requestsPerMonth={assumptions.requestsPerMonth}
              featureName={featureName}
              onApply={applyFix}
              onAction={applyAction}
              verdictRef={setVerdictEl}
              emptyActions={exampleButtons}
              priceNote={priceNote}
            >
              <div className="share-row">
                <button className="btn primary" onClick={copyCard}>
                  {copied ? "Copied" : "Copy as Markdown"}
                </button>
                <button
                  className="btn"
                  onClick={copyShareLink}
                  title="Puts the prompt and assumptions in the link's #fragment. Whoever opens it sees them; no server does."
                >
                  {linkCopied ? "Link copied" : "Copy share link"}
                </button>
                <span className="share-note">
                  For the PRD or ticket. The link includes your prompt.
                </span>
              </div>
              {copyError && (
                <p className="notice bad" role="alert">
                  {copyError}
                </p>
              )}
            </Receipt>
          </section>
        </div>

        {hasPrompt && (
          <section className="quality" id="quality" aria-labelledby="quality-title" tabIndex={-1}>
            <StepHead
              n={3}
              id="quality-title"
              title="Check quality before you commit"
              aside={recommendation ? <VerifyBadge verified={verified} /> : null}
            />
            <p className="quality-status" aria-live="polite">
              {verified && qStatus && (
                <>
                  {qStatus.passed} of {qStatus.total} passed your {qStatus.checkName} check, so the
                  recommendation is marked quality-checked. That covers this check only.
                </>
              )}
              {!verified && qStatus?.state === "stale" &&
                "Your last result came from a different prompt or reply cap. Run the check again to count it."}
              {!verified && qStatus?.state === "failed" &&
                `${qStatus.passed} of ${qStatus.total} passed your ${qStatus.checkName} check. The recommendation stays unverified; try the step-up model.`}
              {!verified &&
                qStatus &&
                (qStatus.state === "incomplete" || qStatus.state === "unreviewed") &&
                `${qStatus.reviewed} of ${qStatus.total} replies judged. Judge the other ${qStatus.unreviewed} before this counts.`}
              {!qStatus &&
                "Cost can be calculated; quality has to be observed. The cheapest model stays unverified until it passes a check you define, run in the AI tool you already use. This app never calls a model."}
            </p>
            <QualityLab
              key={`lab-${formSeq}`}
              seed={labSeed}
              featureName={featureName}
              prompt={deferredPrompt}
              runs={runs}
              setRuns={setRuns}
              maxTokens={labMaxTokens}
              setMaxTokens={setLabMaxTokens}
              recommendedModelId={recommendation?.estimate.model.id ?? null}
            />
          </section>
        )}

        {hasPrompt && (
          <section className="details" aria-label="Full detail">
            <details className="disclosure">
              <summary>Full comparison: ranges, price per million tokens, cost per conversation</summary>
              <div className="table-scroll">
                <ModelTable estimates={estimates} recommendation={recommendation} tableOnly />
              </div>
            </details>
            <details className="disclosure">
              <summary>The Markdown card (what “Copy as Markdown” copies)</summary>
              <pre className="cardpre">{card}</pre>
            </details>
          </section>
        )}

        <section className="how" id="how" aria-labelledby="how-title" tabIndex={-1}>
          <div className="how-side">
            <h2 id="how-title">How it works</h2>
            <p>
              A portfolio project by{" "}
              <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">
                Nethren
              </a>
              . Open source under MIT.
            </p>
            <p className="how-links">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                View the code on GitHub <ExternalIcon />
              </a>
              <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">
                Back to my portfolio <ExternalIcon />
              </a>
            </p>
          </div>
          <div className="how-body">
            <div>
              <h3>Why I built it</h3>
              <p>A price per million tokens doesn’t tell a PM what a feature will cost. I built Token Economist to make that decision possible while writing the spec, with the assumptions visible.</p>
            </div>
            <div>
              <h3>Try the workflow</h3>
              <p>Pick a template, adjust usage and reply length, then compare monthly ranges across seven models. Review suggested prompt savings and copy the cost card into a PRD or ticket.</p>
            </div>
            <div>
              <h3>The product decision</h3>
              <p>Cost can be calculated; quality needs evidence. The cheapest option stays unverified until you check it. Export up to five samples, run them in your own AI tool and paste the replies back for local scoring. Editing the prompt makes earlier evidence stale.</p>
            </div>
            <div>
              <h3>Under the hood</h3>
              <p>Built with React, TypeScript and Vite. An offline tokenizer and deterministic cost model account for conversation history, retries, caching and tools. Vitest checks the calculations and evidence rules. Provider differences and unknown reply lengths appear as ranges.</p>
              <p>Prompts stay in your browser. Only the public price list is fetched; a dated snapshot works offline. Quality results are self-reported, and share links contain the prompt only when you choose to create one.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <span>Token Economist. Ranges, not quotes: the same inputs always give the same numbers.</span>
        <span>
          Built by{" "}
          <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">
            Nethren
          </a>
        </span>
      </footer>

      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button className="toast-action" onClick={() => restore(toast.undo!)}>
              Undo
            </button>
          )}
          <button className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
