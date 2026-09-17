import { describe, expect, it } from "vitest";
import { PASS_THRESHOLD, recommend, renderCard, summarizeRun } from "../src/core/card";
import { runFingerprint } from "../src/core/measure";
import { isSimpleTask } from "../src/core/lint";
import { estimateAll } from "../src/core/estimate";
import { MODELS, getModel } from "../src/core/models";
import { DEFAULT_ASSUMPTIONS, type MeasureRun, type QualityCheck } from "../src/core/types";
import { BLOATED_PROMPT } from "./fixtures";

/**
 * Regression matrix for the partial-review bug (TE-01) and the keyword
 * capability claim (TE-02).
 *
 * The original defect: pass rate divided by *reviewed* samples while the copy
 * printed the *total*, so one reviewed sample out of five certified a model
 * with "passed your check on all 5 samples". Its mirror image was just as
 * bad — an observed failure fell through to "No quality data yet", erasing
 * evidence that a model had been tested and lost.
 */

const run = (
  modelId: string,
  passes: (boolean | null)[],
  check: QualityCheck = { kind: "json" },
): MeasureRun => ({
  modelId,
  check,
  results: passes.map((p) => ({
    input: "x",
    output: p ? "{}" : "not json",
    pass: p,
    inputTokens: 100,
    outputTokens: 50,
    costUSD: 0.001,
    cached: false,
    latencyMs: 500,
  })),
  totalCostUSD: 0.005,
  ranAt: "2026-09-15T00:00:00Z",
  ranAgainst: "fp",
});

const estimates = estimateAll(BLOATED_PROMPT, DEFAULT_ASSUMPTIONS, MODELS);
const cheap = getModel("gpt-5-mini");

describe("TE-01 — quality status accounting", () => {
  it("counts total, reviewed, passed, failed and unreviewed separately", () => {
    expect(summarizeRun(run(cheap.id, [true, false, null, null, null]))).toMatchObject({
      total: 5,
      reviewed: 2,
      passed: 1,
      failed: 1,
      unreviewed: 3,
      complete: false,
    });
  });

  const matrix: Array<[string, (boolean | null)[], string, boolean]> = [
    ["five unreviewed", [null, null, null, null, null], "unreviewed", false],
    ["one pass, four unreviewed", [true, null, null, null, null], "incomplete", false],
    ["four passes, one unreviewed", [true, true, true, true, null], "incomplete", false],
    ["five passes", [true, true, true, true, true], "passed", true],
    ["four passes, one failure", [true, true, true, true, false], "passed", true],
    ["five failures", [false, false, false, false, false], "failed", false],
    ["one pass, one failure, three unreviewed", [true, false, null, null, null], "incomplete", false],
  ];

  for (const [name, passes, state, verified] of matrix) {
    it(`${name} → ${state}, verified=${verified}`, () => {
      expect(summarizeRun(run(cheap.id, passes)).state).toBe(state);
      expect(recommend(estimates, [run(cheap.id, passes)], "fp")!.verified).toBe(verified);
    });
  }

  it("no run at all is 'not tested', with no verified badge", () => {
    const rec = recommend(estimates, [], "fp");
    expect(rec!.verified).toBe(false);
    expect(rec!.status).toBeNull();
  });

  it("never describes a partially reviewed run as all N samples", () => {
    const rec = recommend(estimates, [run(cheap.id, [true, null, null, null, null])], "fp");
    expect(rec!.verified).toBe(false);
    expect(rec!.reason).not.toMatch(/all 5|5\/5/);
    expect(rec!.reason).toContain("1 of 5 samples reviewed");
  });

  it("reports an observed failure as a failure, never as missing data", () => {
    const rec = recommend(estimates, [run(cheap.id, [false, false, false, false, false])], "fp");
    expect(rec!.reason.toLowerCase()).not.toContain("no quality data");
    expect(rec!.reason).toContain("No tested model meets your check");
    expect(rec!.status!.state).toBe("failed");
  });

  it("names the check that was run instead of implying general accuracy", () => {
    const rec = recommend(estimates, [run(cheap.id, [true, true, true, true, true])], "fp");
    expect(rec!.reason).toContain("valid JSON");
    expect(rec!.reason).toContain("not a general accuracy guarantee");
  });

  it("preserves the 80% eligibility rule among fully reviewed runs", () => {
    expect(PASS_THRESHOLD).toBe(0.8);
    expect(summarizeRun(run(cheap.id, [true, true, true, true, false])).state).toBe("passed");
    expect(summarizeRun(run(cheap.id, [true, true, true, false, false])).state).toBe("failed");
  });

  it("keeps failures visible rather than discarding them to improve a score", () => {
    const rec = recommend(estimates, [run(cheap.id, [true, true, true, true, false])], "fp");
    expect(rec!.status!.failed).toBe(1);
    expect(rec!.reason).toContain("1 failed");
  });

  it("carries the sample counts on the recommendation so UI and card agree", () => {
    const rec = recommend(estimates, [run(cheap.id, [true, null, null, null, null])], "fp");
    expect(rec!.status).toMatchObject({ total: 5, reviewed: 1, passed: 1, unreviewed: 4 });
  });
});

describe("TE-02 — no capability claim from a keyword match", () => {
  const spelling = estimateAll(
    "Check every citation and fix spelling errors.",
    DEFAULT_ASSUMPTIONS,
    MODELS,
  );
  const characters = estimateAll(
    "Check every citation and fix character errors.",
    DEFAULT_ASSUMPTIONS,
    MODELS,
  );

  it("gives the spelling/characters pair identical evidence-status language", () => {
    const a = recommend(spelling, [], "fp")!.reason;
    const b = recommend(characters, [], "fp")!.reason;
    // Costs may differ by a token; the evidence language must not.
    expect(a.replace(/\$[\d.,]+/g, "$X")).toBe(b.replace(/\$[\d.,]+/g, "$X"));
    expect(a).toContain("Lowest estimated cost to test");
    expect(a).toContain("Quality has not been tested");
  });

  it("makes no task-complexity claim before any test has run", () => {
    const rec = recommend(estimates, [], "fp")!.reason.toLowerCase();
    expect(rec).not.toContain("should handle it");
    expect(rec).not.toContain("bounded task");
  });

  it("anchors the lexical hint on both sides of every alternative", () => {
    // Prefix matches that previously flipped the classification.
    expect(isSimpleTask("Check every citation and fix spelling errors.")).toBe(false);
    expect(isSimpleTask("This is a moderately complex multi-step reasoning task.")).toBe(false);
    expect(isSimpleTask("Write a long essay describing a labelled anatomical diagram.")).toBe(false);
    // Genuine mentions still register.
    expect(isSimpleTask("Classify each ticket into exactly one category.")).toBe(true);
    expect(isSimpleTask("Run content moderation on the comment.")).toBe(true);
    expect(isSimpleTask("Spell-check the paragraph.")).toBe(true);
  });
});

describe("staleness — evidence belongs to the configuration it measured", () => {
  const passing = (fp: string): MeasureRun => ({
    ...run(cheap.id, [true, true, true, true, true]),
    ranAgainst: fp,
  });

  it("a passing run verifies only against the configuration it ran on", () => {
    expect(recommend(estimates, [passing("fp")], "fp")!.verified).toBe(true);
    expect(recommend(estimates, [passing("fp")], "edited")!.verified).toBe(false);
  });

  it("reports stale evidence as stale, not as a pass, a failure, or missing data", () => {
    const rec = recommend(estimates, [passing("old")], "new");
    expect(rec!.status!.state).toBe("stale");
    expect(rec!.reason).toContain("stale");
    expect(rec!.reason.toLowerCase()).not.toContain("no quality data");
    expect(rec!.reason.toLowerCase()).not.toContain("meeting your check");
  });

  it("a failing run also stops applying once the configuration changes", () => {
    const failed = { ...run(cheap.id, [false, false, false, false, false]), ranAgainst: "old" };
    expect(recommend(estimates, [failed], "new")!.status!.state).toBe("stale");
  });

  it("the fingerprint moves when the prompt or the reply cap moves", () => {
    expect(runFingerprint("a prompt", 300)).toBe(runFingerprint("a prompt", 300));
    expect(runFingerprint("a prompt", 300)).not.toBe(runFingerprint("a prompt!", 300));
    expect(runFingerprint("a prompt", 300)).not.toBe(runFingerprint("a prompt", 400));
  });

  it("the card marks a stale run instead of counting it as evidence", () => {
    const card = renderCard({
      featureName: "Ticket classifier",
      prompt: BLOATED_PROMPT,
      estimates,
      assumptions: DEFAULT_ASSUMPTIONS,
      findings: [],
      runs: [passing("old")],
      recommendation: recommend(estimates, [passing("old")], "new"),
      currentFingerprint: "new",
      generatedAt: "2026-09-17",
    });
    expect(card).toContain("STALE");
    expect(card).toContain("does not apply here");
  });
});
