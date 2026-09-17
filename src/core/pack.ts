import type { ModelSpec, QualityCheck } from "./types";
import { checkName, fmtUSD } from "./card";
import { HARD_MAX_TOKENS, MAX_SAMPLES_PER_RUN, previewRunCost, runFingerprint } from "./measure";

/**
 * The check pack: one Markdown document out, one Markdown document back.
 *
 * This is how quality gets measured without the app ever holding a key,
 * calling a provider, or spending the user's money behind their back. The pack
 * asks for replies in a fixed shape so the whole result can be pasted back in
 * one go, and it carries the configuration fingerprint so a pack made for one
 * prompt cannot quietly certify a different one.
 */

/** The heading the reply document uses, and the parser looks for. */
const REPLY_HEADING = (n: number) => `## Reply ${n}`;

export function renderCheckPack(opts: {
  featureName: string;
  prompt: string;
  model: ModelSpec;
  samples: string[];
  check: QualityCheck;
  maxTokens: number;
}): string {
  const samples = opts.samples.slice(0, MAX_SAMPLES_PER_RUN);
  const cap = Math.min(opts.maxTokens, HARD_MAX_TOKENS);
  const cost = previewRunCost(opts.model, opts.prompt, samples, opts.maxTokens).totalUSD;
  const fingerprint = runFingerprint(opts.prompt, opts.maxTokens);

  const lines: string[] = [];
  lines.push(`# Quality check — ${opts.featureName || "Untitled AI feature"}`);
  lines.push("");
  lines.push(
    `Paste this whole file into the AI tool you already pay for. Follow it exactly, then copy the reply document it produces back into Token Economist.`,
  );
  lines.push("");
  lines.push(`- **Model to test:** ${opts.model.displayName} (${opts.model.provider})`);
  lines.push(`- **Reply cap:** ${cap} tokens each`);
  lines.push(`- **Counts as a pass:** ${checkName(opts.check)}`);
  lines.push(`- **Estimated cost on your account:** about ${fmtUSD(cost)}`);
  lines.push(`- **Configuration id:** \`${fingerprint}\``);
  lines.push("");

  lines.push(`## Instructions`);
  lines.push("");
  lines.push(
    `Answer each of the ${samples.length} samples below using the system prompt exactly as written. Use it verbatim — do not improve it, do not add rules of your own, and do not explain what you are doing. The point is to measure the prompt as it will ship.`,
  );
  lines.push("");
  lines.push(`Keep each answer under ${cap} tokens. Answer each sample independently, as if the others had not been asked.`);
  lines.push("");

  lines.push(`## System prompt`);
  lines.push("");
  lines.push("```text");
  lines.push(opts.prompt.trim() || "(empty prompt)");
  lines.push("```");
  lines.push("");

  lines.push(`## Samples`);
  lines.push("");
  samples.forEach((sample, i) => {
    lines.push(`### Sample ${i + 1}`);
    lines.push("");
    lines.push("```text");
    lines.push(sample);
    lines.push("```");
    lines.push("");
  });

  lines.push(`## What to send back`);
  lines.push("");
  lines.push(`Reply with one document in exactly this shape, and nothing else:`);
  lines.push("");
  lines.push("```markdown");
  lines.push(`Configuration id: ${fingerprint}`);
  lines.push("");
  samples.forEach((_, i) => {
    lines.push(REPLY_HEADING(i + 1));
    lines.push(`(your answer to sample ${i + 1}, exactly as the model would return it)`);
    lines.push("");
  });
  lines.push("```");
  lines.push("");
  lines.push(
    `No commentary, no summary, no scoring. Token Economist scores the answers itself, on the reader's machine, and the configuration id tells it which prompt they belong to.`,
  );
  lines.push("");
  return lines.join("\n");
}

// ------------------------------------------------------------ parsing back ---

export interface ParsedReplies {
  /** Index-aligned to the samples. An absent reply is an empty string. */
  replies: string[];
  /** How many replies actually arrived. */
  found: number;
  /** The configuration id the document declares, if it kept one. */
  configId: string | null;
  /** Things worth telling the user before they score. */
  warnings: string[];
}

const HEADING = /^[ \t]*(?:#{1,6}[ \t]*)?(?:reply|sample|output|answer)[ \t]*#?[ \t]*(\d+)[ \t]*[:.)\]]?[ \t]*$/gim;
const CONFIG_ID = /configuration id[:\s]*[`"']?([A-Za-z0-9_-]+)[`"']?/i;

/** Remove one code fence wrapping the entire block, if that is all there is. */
function unfence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : t;
}

/**
 * Pull the replies back out of whatever the user pasted.
 *
 * Deliberately forgiving: an AI tool will not reproduce the requested shape
 * byte for byte every time, and making the user fix its formatting would put
 * the friction back that this whole flow removes. Anything it cannot place is
 * reported rather than guessed at, because a reply filed against the wrong
 * sample is worse than a missing one.
 */
export function parseReplyPack(text: string, expected: number): ParsedReplies {
  const replies: string[] = Array.from({ length: expected }, () => "");
  const warnings: string[] = [];
  const body = unfence(text ?? "");

  if (!body) return { replies, found: 0, configId: null, warnings };

  const configId = body.match(CONFIG_ID)?.[1] ?? null;

  // Pass 1: numbered headings, the shape the pack asks for.
  HEADING.lastIndex = 0;
  const marks: Array<{ n: number; start: number; end: number }> = [];
  for (let m = HEADING.exec(body); m !== null; m = HEADING.exec(body)) {
    marks.push({ n: Number(m[1]), start: m.index, end: m.index + m[0].length });
  }

  if (marks.length > 0) {
    const seen = new Set<number>();
    marks.forEach((mark, i) => {
      const stop = i + 1 < marks.length ? marks[i + 1].start : body.length;
      const value = unfence(body.slice(mark.end, stop));
      if (mark.n < 1 || mark.n > expected) {
        warnings.push(`Ignored a reply numbered ${mark.n}; there are only ${expected} samples.`);
        return;
      }
      if (seen.has(mark.n)) {
        warnings.push(`Sample ${mark.n} appears more than once. Kept the first.`);
        return;
      }
      seen.add(mark.n);
      replies[mark.n - 1] = value;
    });
  } else if (expected === 1) {
    // One sample, no headings: the whole paste is the reply.
    replies[0] = body;
  } else {
    // Last resort: horizontal rules, which tools often use as separators.
    const chunks = body
      .split(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m)
      .map((c) => unfence(c))
      .filter(Boolean);
    if (chunks.length === expected) {
      chunks.forEach((c, i) => (replies[i] = c));
      warnings.push(`No "## Reply N" headings found; read the ${expected} sections in order.`);
    } else {
      warnings.push(
        `Could not find "## Reply 1", "## Reply 2" … in what you pasted. Copy the whole reply document, or ask your AI tool to use those headings.`,
      );
    }
  }

  const found = replies.filter((r) => r.trim().length > 0).length;
  if (found > 0 && found < expected) {
    warnings.push(`${expected - found} of ${expected} replies are missing. Those samples stay unreviewed.`);
  }
  return { replies, found, configId, warnings };
}
