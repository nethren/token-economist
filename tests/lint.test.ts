import { describe, expect, it } from "vitest";
import { lintPrompt } from "../src/core/lint";
import { MODELS, getModel } from "../src/core/models";
import { countBaseTokens } from "../src/core/tokenizer";
import { estimateAll } from "../src/core/estimate";
import { recommend } from "../src/core/card";
import { DEFAULT_ASSUMPTIONS } from "../src/core/types";
import { BLOATED_PROMPT, FAQ_DUMP_PROMPT } from "./fixtures";

/**
 * §7 "Suggestion usefulness": on a deliberately bloated prompt, the top
 * suggestion must produce a real, MEASURED token reduction — we apply the
 * machine-applicable fixes and re-tokenize; no self-reported savings allowed.
 */

const REF = getModel("claude-sonnet-5");
const A = { ...DEFAULT_ASSUMPTIONS, requestsPerMonth: 50_000 };

describe("linter on a deliberately bloated prompt", () => {
  const findings = lintPrompt(BLOATED_PROMPT, A, REF);

  it("detects every planted problem class", () => {
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain("duplicate-instructions");
    expect(rules).toContain("filler-phrases");
    expect(rules).toContain("oversized-few-shot");
    expect(rules).toContain("cache-static-prefix");
    expect(rules).toContain("missing-output-cap");
    expect(rules).toContain("stuffed-context");
    expect(rules).toContain("cheaper-tier");
  });

  it("every finding is quantified", () => {
    for (const f of findings) {
      expect(f.tokensSaved >= 0).toBe(true);
      // Each finding carries either a token saving or a monthly USD saving.
      expect(f.tokensSaved > 0 || (f.monthlySavingUSD?.point ?? 0) > 0).toBe(true);
      expect(f.detail.length).toBeGreaterThan(20);
    }
  });

  it("findings are ranked by monthly saving, descending", () => {
    const pts = findings.map((f) => f.monthlySavingUSD?.point ?? 0);
    for (let i = 1; i < pts.length; i++) {
      // allow ties / tokensSaved fallback ordering within $0.01
      expect(pts[i]).toBeLessThanOrEqual(pts[i - 1] + 0.01);
    }
  });

  it("applying the machine-applicable fixes yields a measured ≥15% reduction", () => {
    const before = countBaseTokens(BLOATED_PROMPT);
    let prompt = BLOATED_PROMPT;
    for (const f of findings) {
      if (f.apply) prompt = f.apply(prompt);
    }
    const after = countBaseTokens(prompt);
    const reduction = (before - after) / before;
    expect(after).toBeLessThan(before);
    expect(reduction).toBeGreaterThanOrEqual(0.15);
  });

  it("claimed token savings for applied fixes are honest (within 25%)", () => {
    for (const f of findings) {
      if (!f.apply) continue;
      const measured = countBaseTokens(BLOATED_PROMPT) - countBaseTokens(f.apply(BLOATED_PROMPT));
      expect(measured).toBeGreaterThan(0);
      // claimed within ±25% of measured — savings must not be inflated
      expect(Math.abs(f.tokensSaved - measured) / measured).toBeLessThanOrEqual(0.25);
    }
  });

  it("PROSE doc dumps (Q&A/FAQ paragraphs) trigger stuffed-context too", () => {
    // Regression for the PM-persona test: a realistic RAG prompt inlines docs
    // as prose paragraphs, not bullets/JSON — the detector must still fire,
    // and it must be the top token-saving finding.
    const f = lintPrompt(FAQ_DUMP_PROMPT, A, REF);
    const stuffed = f.find((x) => x.rule === "stuffed-context");
    expect(stuffed).toBeDefined();
    expect(stuffed!.detail).toContain("Q&A / FAQ");
    // and the applied fix must remove most of the prompt, measured
    const before = countBaseTokens(FAQ_DUMP_PROMPT);
    const after = countBaseTokens(stuffed!.apply!(FAQ_DUMP_PROMPT));
    expect((before - after) / before).toBeGreaterThan(0.7);
  });

  it("the cheaper-tier finding names the SAME model as the headline recommendation", () => {
    // The tool must never give two different answers to "which cheap model?"
    const rec = recommend(estimateAll(BLOATED_PROMPT, A, MODELS), [], true);
    const cheaperTier = findings.find((x) => x.rule === "cheaper-tier");
    expect(cheaperTier).toBeDefined();
    expect(cheaperTier!.title).toContain(rec!.estimate.model.displayName);
  });

  it("caching and output-cap findings carry one-click actions", () => {
    const cache = findings.find((x) => x.rule === "cache-static-prefix");
    const cap = findings.find((x) => x.rule === "missing-output-cap");
    expect(cache!.action).toEqual({ kind: "enable-caching" });
    expect(cap!.action?.kind).toBe("set-output-cap");
    if (cap!.action?.kind === "set-output-cap") {
      expect(cap!.action.tokens).toBeGreaterThan(0);
    }
  });

  it("a clean, tight prompt produces no high-severity text findings", () => {
    const clean =
      "Classify the support ticket into one of: billing, technical, account, sales, abuse, other.\n" +
      "Respond with JSON: {\"category\": string}.\n\nExample\nInput: \"I was double charged.\"\nOutput: {\"category\": \"billing\"}";
    const cleanFindings = lintPrompt(
      clean,
      { ...A, maxOutputTokens: 100, expectedOutputTokens: 30 },
      REF,
    );
    const textRules = cleanFindings.filter((f) =>
      ["duplicate-instructions", "oversized-few-shot", "stuffed-context", "whitespace-bloat"].includes(f.rule),
    );
    expect(textRules).toEqual([]);
  });
});
