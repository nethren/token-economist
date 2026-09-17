import type { ModelSpec, QualityCheck } from "./types";
import { checkName, fmtUSD } from "./card";
import { HARD_MAX_TOKENS, MAX_SAMPLES_PER_RUN, previewRunCost, runFingerprint } from "./measure";

/**
 * The check pack: a Markdown brief the user runs in whatever AI tool they
 * already pay for.
 *
 * This is how quality gets measured without the app ever holding a key,
 * calling a provider, or spending the user's money behind their back. The pack
 * carries the configuration fingerprint, so a pack generated for one prompt
 * cannot quietly certify a different one.
 */
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

  const lines: string[] = [];
  lines.push(`# Quality check — ${opts.featureName || "Untitled AI feature"}`);
  lines.push("");
  lines.push(
    `Run this in whatever AI tool you already use, then paste each reply back into Token Economist. It scores them on your machine.`,
  );
  lines.push("");
  lines.push(`- **Model to test:** ${opts.model.displayName} (${opts.model.provider})`);
  lines.push(`- **Reply cap:** ${cap} tokens`);
  lines.push(`- **Counts as a pass:** ${checkName(opts.check)}`);
  lines.push(`- **Estimated cost on your account:** about ${fmtUSD(cost)} for ${samples.length} ${samples.length === 1 ? "sample" : "samples"}`);
  lines.push(`- **Configuration id:** \`${runFingerprint(opts.prompt, opts.maxTokens)}\``);
  lines.push("");
  lines.push(`## How to run it`);
  lines.push("");
  lines.push(`1. Open a fresh conversation so nothing else is in context.`);
  lines.push(`2. Use the system prompt below exactly as written. Do not add instructions of your own, and do not fix or improve it — the point is to measure the prompt you are about to ship.`);
  lines.push(`3. Send each sample as the user message. Start a new conversation for each one so earlier samples cannot influence later replies.`);
  lines.push(`4. Keep each reply under ${cap} tokens.`);
  lines.push(`5. Copy each reply back into the matching box in Token Economist, in order.`);
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
  lines.push(`## Notes`);
  lines.push("");
  lines.push(
    `The configuration id ties this pack to the prompt and reply cap it was generated from. Edit either one and the result is marked stale rather than counted, because evidence only applies to the configuration it was collected against.`,
  );
  lines.push("");
  lines.push(
    `Token Economist never sends your prompt anywhere. It scores the replies you paste back locally, using the same offline tokenizer that produced the cost estimate.`,
  );
  lines.push("");
  return lines.join("\n");
}
