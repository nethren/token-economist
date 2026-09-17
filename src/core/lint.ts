import type { Band, LintFinding, ModelSpec, ScaleAssumptions } from "./types";
import { countBaseTokens } from "./tokenizer";
import { estimateAll, estimateModel } from "./estimate";
import { MODELS } from "./models";
import { cheapestUsable } from "./card";

/**
 * Prompt-cost linter. Pure heuristics over the prompt text + assumptions —
 * free, deterministic, zero network. Every finding is quantified: tokens
 * saved (measured by re-tokenizing where an `apply` exists) and USD/month
 * at the stated assumptions on the reference model.
 */

/** USD/month band saved per base prompt token removed, for a model. */
function perPromptTokenMonthly(model: ModelSpec, a: ScaleAssumptions): Band {
  const N = Math.max(1, a.turnsPerConversation);
  const inPrice = model.inputPerMTok / 1e6;
  // If caching engages, a prefix token is mostly billed at cache-read rate.
  const cacheMult = a.useCaching
    ? a.cacheHitRate * model.cacheReadMult + (1 - a.cacheHitRate) * model.cacheWriteMult
    : 1;
  const batch = a.useBatch ? model.batchMult : 1;
  const per = inPrice * N * cacheMult * (1 + a.retryRate) * batch * a.requestsPerMonth;
  const c = model.calibration;
  return { low: per * c.low, point: per * c.point, high: per * c.high };
}

function scaleBand(b: Band, k: number): Band {
  return { low: b.low * k, point: b.point * k, high: b.high * k };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// ---------------------------------------------------------------- rules ----

function ruleDuplicateLines(prompt: string): { saved: number; dupes: string[]; apply: (p: string) => string } {
  const lines = prompt.split("\n");
  const seen = new Map<string, number>();
  const dupes: string[] = [];
  let saved = 0;
  for (const line of lines) {
    const n = norm(line);
    if (n.length < 30 || n.split(" ").length < 6) continue; // ignore short/structural lines
    const count = seen.get(n) ?? 0;
    seen.set(n, count + 1);
    if (count > 0) {
      dupes.push(line.trim());
      saved += countBaseTokens(line + "\n");
    }
  }
  const apply = (p: string) => {
    const ls = p.split("\n");
    const s = new Map<string, number>();
    return ls
      .filter((line) => {
        const n = norm(line);
        if (n.length < 30 || n.split(" ").length < 6) return true;
        const c = s.get(n) ?? 0;
        s.set(n, c + 1);
        return c === 0;
      })
      .join("\n");
  };
  return { saved, dupes, apply };
}

const FILLER: Array<[RegExp, string]> = [
  [/\bit is (?:very )?important to note that\s*/gi, ""],
  [/\bplease note that\s*/gi, ""],
  [/\bin order to\b/gi, "to"],
  [/\bplease ensure that you\s*/gi, ""],
  [/\bplease make sure (?:that you|to)\s*/gi, ""],
  [/\bmake sure that you\s*/gi, ""],
  [/\byou should always remember to\s*/gi, ""],
  [/\bas mentioned (?:above|before|previously),?\s*/gi, ""],
  [/\bplease be aware that\s*/gi, ""],
  [/\bkindly\s+/gi, ""],
  [/\bat this point in time\b/gi, "now"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bin the event that\b/gi, "if"],
];

function applyFiller(p: string): string {
  let out = p;
  for (const [re, rep] of FILLER) out = out.replace(re, rep);
  return out;
}

function ruleWhitespace(prompt: string): { saved: number; apply: (p: string) => string } {
  const apply = (p: string) =>
    p
      .replace(/[ \t]+$/gm, "") // trailing spaces
      .replace(/\n{3,}/g, "\n\n") // blank-line runs
      .replace(/^([-=_*#~])\1{5,}$/gm, "$1$1$1"); // long separator rules
  const saved = Math.max(0, countBaseTokens(prompt) - countBaseTokens(apply(prompt)));
  return { saved, apply };
}

interface ExampleBlock {
  start: number;
  end: number;
  tokens: number;
}

/** Find few-shot example blocks: fenced code blocks and Input:/Output: pairs
 *  following an "Example"-ish heading. Conservative by design. */
function findExampleBlocks(prompt: string): ExampleBlock[] {
  const blocks: ExampleBlock[] = [];
  const lines = prompt.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const isExampleHead = /^(#{1,6}\s*)?(example|sample|few[- ]?shot|demonstration)\b/i.test(
      line.trim(),
    );
    if (isExampleHead) {
      // Block runs until the next heading-like line or two consecutive blanks.
      let j = i + 1;
      let blanks = 0;
      while (j < lines.length) {
        const l = lines[j];
        if (/^(#{1,6}\s+\S|[A-Z][\w ]{2,40}:$)/.test(l.trim()) && !/^(input|output|user|assistant|response)[: ]/i.test(l.trim())) break;
        if (/^(#{1,6}\s*)?(example|sample)\b/i.test(l.trim())) break;
        blanks = l.trim() === "" ? blanks + 1 : 0;
        if (blanks >= 3) break;
        j++;
      }
      const text = lines.slice(i, j).join("\n");
      blocks.push({ start: i, end: j, tokens: countBaseTokens(text) });
      i = j;
    } else {
      i++;
    }
  }
  return blocks;
}

type DumpKind = "list" | "json" | "csv" | "qa" | "kv";

const DUMP_LABEL: Record<DumpKind, string> = {
  list: "list/inventory",
  json: "JSON blob",
  csv: "CSV/tabular blob",
  qa: "Q&A / FAQ dump",
  kv: "key-value reference dump",
};

/** Classify one line as reference-data-shaped, blank, or prose/instruction. */
function classifyLine(raw: string): DumpKind | "blank" | "" {
  const t = raw.trim();
  if (t === "") return "blank";
  if (/^[-*•]\s/.test(t) || /^\d+[.)]\s/.test(t)) return "list";
  if (/^\s*["{[]/.test(raw) || /[}\]],?\s*$/.test(t)) return "json";
  if (/^[QA]\s*\d*\s*[:.\-–]/i.test(t)) return "qa";
  if (/^[\w $/()#.-]{1,48}:\s+\S/.test(t)) return "kv";
  if ((t.match(/,/g)?.length ?? 0) >= 4 && t.length > 20) return "csv";
  return "";
}

/**
 * Data-dump regions that belong in retrieval, not the prompt: JSON blobs,
 * CSV runs, bullet inventories, AND prose-shaped reference material —
 * Q&A/FAQ entries and key-value docs. Blank lines don't break a run (real
 * doc dumps are paragraph-separated), but two consecutive prose lines do.
 */
function findDataDump(prompt: string): { tokens: number; kind: DumpKind; text: string } | null {
  const lines = prompt.split("\n");
  let best: { tokens: number; kind: DumpKind; text: string } | null = null;

  let start = -1; // index of first data line in the current run
  let end = -1; // index of last data line in the current run
  let dataCount = 0;
  const kindCounts = new Map<DumpKind, number>();
  let blankStreak = 0;

  const close = () => {
    if (dataCount >= 25 && start >= 0) {
      const text = lines.slice(start, end + 1).join("\n");
      const tokens = countBaseTokens(text);
      if (tokens >= 1200 && (!best || tokens > best.tokens)) {
        let dominant: DumpKind = "list";
        let max = 0;
        for (const [k, c] of kindCounts) {
          if (c > max) {
            max = c;
            dominant = k;
          }
        }
        best = { tokens, kind: dominant, text };
      }
    }
    start = -1;
    end = -1;
    dataCount = 0;
    kindCounts.clear();
    blankStreak = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const kind = classifyLine(lines[i]);
    if (kind === "blank") {
      blankStreak++;
      if (blankStreak > 2) close();
      continue;
    }
    if (kind === "") {
      close();
      continue;
    }
    if (start === -1) start = i;
    end = i;
    dataCount++;
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
    blankStreak = 0;
  }
  close();
  return best;
}

const RETRIEVAL_PLACEHOLDER =
  "{{relevant_entries}}  <!-- inject only the entries relevant to this request via retrieval -->";

/** Replace the largest detected data blob with a retrieval placeholder. */
function applyRetrieval(p: string): string {
  const d = findDataDump(p);
  if (!d) return p;
  return p.replace(d.text, RETRIEVAL_PLACEHOLDER);
}

/** Keep only the 2 largest example blocks; drop the rest. */
function applyTrimExamples(p: string): string {
  const blocks = findExampleBlocks(p);
  if (blocks.length <= 2) return p;
  const keep = new Set(
    [...blocks].sort((x, y) => y.tokens - x.tokens).slice(0, 2),
  );
  const lines = p.split("\n");
  const drop = new Set<number>();
  for (const b of blocks) {
    if (keep.has(b)) continue;
    for (let i = b.start; i < b.end; i++) drop.add(i);
  }
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

/**
 * Weak lexical hint that a prompt *mentions* a bounded classification or
 * extraction task.
 *
 * Every alternative is anchored on BOTH sides. Without a trailing boundary
 * each branch is a prefix search: `spell` matches "spelling", `moderat`
 * matches "moderately", and `label` matches "labelled" — so "a moderately
 * complex reasoning task" and "an essay about a labelled diagram" both read
 * as bounded classification work.
 *
 * This is a lexical hint, never evidence. It must not be used to claim that a
 * model can handle a task: only a measured check can support that, and the
 * recommendation copy deliberately makes no capability claim.
 */
const SIMPLE_TASK =
  /\b(classif(y|ies|ication)|categoriz(e|es|ing|ation)|extract(s|ing|ion)?|tag(s|ging)?|sentiment|translat(e|es|ing|ion)|reformat(s|ting)?|normaliz(e|es|ing|ation)|rout(e|es|ing)|triage|labell?(s|ing)?|dedupe|spell[-\s]?check(s|ing)?|moderat(e|es|ing|ion))\b/i;

/** Lexical hint only — see SIMPLE_TASK. Never a capability claim. */
export function isSimpleTask(prompt: string): boolean {
  return SIMPLE_TASK.test(prompt);
}

// ------------------------------------------------------------- entrypoint ----

export function lintPrompt(
  prompt: string,
  a: ScaleAssumptions,
  reference: ModelSpec,
  allModels: ModelSpec[] = MODELS,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const promptTokens = countBaseTokens(prompt);
  const perTok = perPromptTokenMonthly(reference, a);

  // 1. Duplicated instructions
  const dup = ruleDuplicateLines(prompt);
  if (dup.saved > 0) {
    findings.push({
      rule: "duplicate-instructions",
      title: "Duplicated instructions",
      severity: dup.saved > 100 ? "high" : "medium",
      detail:
        `${dup.dupes.length} line(s) repeat earlier instructions verbatim, e.g. ` +
        `"${dup.dupes[0].slice(0, 90)}${dup.dupes[0].length > 90 ? "…" : ""}". ` +
        `Repeating an instruction does not make the model follow it better; it bills every request.`,
      tokensSaved: dup.saved,
      monthlySavingUSD: scaleBand(perTok, dup.saved),
      apply: dup.apply,
    });
  }

  // 2. Filler phrasing
  const fillerSaved = Math.max(0, promptTokens - countBaseTokens(applyFiller(prompt)));
  if (fillerSaved >= 10) {
    findings.push({
      rule: "filler-phrases",
      title: "Verbose boilerplate phrasing",
      severity: "low",
      detail:
        `Politeness and filler constructions ("please ensure that", "it is important to note", ` +
        `"in order to") add ~${fillerSaved} tokens without changing behavior. Instructions can be imperative and terse.`,
      tokensSaved: fillerSaved,
      monthlySavingUSD: scaleBand(perTok, fillerSaved),
      apply: applyFiller,
    });
  }

  // 3. Whitespace / separator bloat
  const ws = ruleWhitespace(prompt);
  if (ws.saved >= 8) {
    findings.push({
      rule: "whitespace-bloat",
      title: "Whitespace and separator bloat",
      severity: "low",
      detail: `Blank-line runs, trailing spaces, and long separator rules cost ~${ws.saved} tokens per request.`,
      tokensSaved: ws.saved,
      monthlySavingUSD: scaleBand(perTok, ws.saved),
      apply: ws.apply,
    });
  }

  // 4. Oversized few-shot examples
  const examples = findExampleBlocks(prompt);
  if (examples.length > 2) {
    const extra = examples
      .slice()
      .sort((x, y) => y.tokens - x.tokens)
      .slice(2);
    const saved = extra.reduce((s, b) => s + b.tokens, 0);
    if (saved > 150) {
      findings.push({
        rule: "oversized-few-shot",
        title: `${examples.length} few-shot examples — 2 usually suffice`,
        severity: "medium",
        detail:
          `Found ${examples.length} example blocks totaling ` +
          `${examples.reduce((s, b) => s + b.tokens, 0)} tokens. For most tasks, quality plateaus after ` +
          `1–2 well-chosen examples on current models. Keeping the 2 largest-signal examples saves ~${saved} tokens/request.`,
        tokensSaved: saved,
        monthlySavingUSD: scaleBand(perTok, saved),
        apply: applyTrimExamples,
      });
    }
  }

  // 5. Cacheable static prefix — one-click action: enable the assumption.
  if (!a.useCaching && a.requestsPerMonth >= 1000) {
    const withCache = estimateModel(prompt, { ...a, useCaching: true }, reference);
    const without = estimateModel(prompt, a, reference);
    const saving: Band = {
      low: without.costPerMonth.low - withCache.costPerMonth.low,
      point: without.costPerMonth.point - withCache.costPerMonth.point,
      high: without.costPerMonth.high - withCache.costPerMonth.high,
    };
    const engages = withCache.promptTokens.point >= reference.cacheMinTokens;
    if (engages && saving.point > 1) {
      findings.push({
        rule: "cache-static-prefix",
        title: "Static prefix should use prompt caching",
        severity: saving.point > 50 ? "high" : "medium",
        detail:
          `The pasted prompt (~${without.promptTokens.point} ${reference.provider} tokens) is re-billed at full ` +
          `price on every request. With prompt caching (${Math.round(a.cacheHitRate * 100)}% hit rate), reads bill at ` +
          `${reference.cacheReadMult}× input price. Requires the prefix to be byte-stable (no timestamps/user data interpolated).`,
        tokensSaved: 0,
        monthlySavingUSD: saving,
        action: { kind: "enable-caching" },
      });
    }
  }

  // 6. Missing output cap — one-click action: set a sensible cap.
  if (a.maxOutputTokens == null) {
    const est = estimateModel(prompt, a, reference);
    const exposure = (est.costPerMonth.high - est.costPerMonth.point);
    const suggestedCap = a.expectedOutputTokens
      ? Math.ceil((a.expectedOutputTokens * 1.5) / 50) * 50
      : 300;
    findings.push({
      rule: "missing-output-cap",
      title: "No response length limit set",
      severity: "high",
      detail:
        `Output length is the least predictable cost driver and nothing bounds it. Set a max_tokens limit just ` +
        `above the expected response length (≈${suggestedCap} tokens here); this converts up to $${exposure.toFixed(2)}/month of upside ` +
        `uncertainty into a hard ceiling and protects against runaway generations.`,
      tokensSaved: 0,
      monthlySavingUSD: { low: 0, point: exposure * 0.5, high: exposure },
      action: { kind: "set-output-cap", tokens: suggestedCap },
    });
  }

  // 7. Stuffed context → retrieval
  const dump = findDataDump(prompt);
  if (dump) {
    const saved = Math.round(dump.tokens * 0.9);
    findings.push({
      rule: "stuffed-context",
      title: "Large reference block — retrieve instead of inlining",
      severity: "high",
      detail:
        `A ~${dump.tokens}-token ${DUMP_LABEL[dump.kind]} is inlined in the prompt and re-billed on every ` +
        `request, but each request only needs a fraction of it. Retrieving only the relevant entries per request ` +
        `(assume ~10% relevant) saves ~${saved} tokens/request. The applied fix swaps the block for a ` +
        `retrieval placeholder; the ~10% relevant share moves to per-request injected context.`,
      tokensSaved: saved,
      monthlySavingUSD: scaleBand(perTok, saved),
      apply: applyRetrieval,
    });
  }

  // 8. Cheaper tier likely sufficient — MUST name the same model the headline
  // recommendation names (single source of truth: cheapestUsable), so the
  // tool never gives two different "which cheap model?" answers.
  const outputSmall = (a.expectedOutputTokens ?? a.maxOutputTokens ?? 250) <= 400;
  if (reference.tier !== "economy" && SIMPLE_TASK.test(prompt) && outputSmall) {
    const cheapest = cheapestUsable(estimateAll(prompt, a, allModels));
    if (cheapest && cheapest.model.id !== reference.id) {
      const refEst = estimateModel(prompt, a, reference);
      const saving: Band = {
        low: refEst.costPerMonth.low - cheapest.costPerMonth.low,
        point: refEst.costPerMonth.point - cheapest.costPerMonth.point,
        high: refEst.costPerMonth.high - cheapest.costPerMonth.high,
      };
      if (saving.point > 1) {
        findings.push({
          rule: "cheaper-tier",
          title: `Task profile fits ${cheapest.model.displayName}`,
          severity: "medium",
          detail:
            `The prompt reads as a bounded classification/extraction-style task with short output — the profile ` +
            `the cheapest models handle well. Verify with a Quality Lab run (a few samples on both models) before ` +
            `committing; if ${cheapest.model.displayName} passes your check, this is the single largest saving available.`,
          tokensSaved: 0,
          monthlySavingUSD: saving,
        });
      }
    }
  }

  // 9. Unbounded conversation history
  if (a.turnsPerConversation >= 6) {
    const WINDOW = 4;
    const N = a.turnsPerConversation;
    const U = a.avgUserInputTokens;
    const O = a.expectedOutputTokens ?? 250;
    // History tokens beyond a sliding window of WINDOW turns, summed over the conversation.
    let excess = 0;
    for (let t = 1; t <= N; t++) {
      const hist = (t - 1) * (U + O);
      const windowed = Math.min(t - 1, WINDOW) * (U + O);
      excess += hist - windowed;
    }
    if (excess > 500) {
      const inPrice = reference.inputPerMTok / 1e6;
      const perConv = excess * inPrice * (1 + a.retryRate) * (a.useBatch ? reference.batchMult : 1);
      const monthly = perConv * a.requestsPerMonth;
      findings.push({
        rule: "unbounded-history",
        title: "Conversation history grows unbounded",
        severity: "medium",
        detail:
          `At ${N} turns/conversation, full history resend costs ~${Math.round(excess)} extra input tokens per ` +
          `conversation vs a ${WINDOW}-turn sliding window (or summarization/compaction of older turns).`,
        tokensSaved: Math.round(excess / N),
        monthlySavingUSD: { low: monthly * 0.8, point: monthly, high: monthly * 1.2 },
      });
    }
  }

  // Rank: monthly saving desc, then tokens saved.
  findings.sort(
    (x, y) =>
      (y.monthlySavingUSD?.point ?? 0) - (x.monthlySavingUSD?.point ?? 0) ||
      y.tokensSaved - x.tokensSaved,
  );
  return findings;
}
