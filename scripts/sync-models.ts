// Diff src/core/models.json against the public OpenRouter model list.
//
//   npm run models:sync                      # print the report, change nothing
//   npm run models:sync -- --write           # also update models.json
//   npm run models:sync -- --report out.md   # write the report to a file
//   npm run models:sync -- --input list.json # use a saved list (offline)
//
// The weekly .github/workflows/model-sync.yml runs this with --write and
// opens a PR. The only request is one GET of the public list: no key, no
// prompts, no Quality Lab data. Needs Node 23.6+ (runs TypeScript directly).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderReport, syncModels, type RawRegistry } from "../src/core/modelSync.ts";

const LIST_URL = "https://openrouter.ai/api/v1/models";
const REGISTRY_PATH = fileURLToPath(new URL("../src/core/models.json", import.meta.url));

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function loadList(): Promise<unknown> {
  const input = value("--input");
  if (input) return JSON.parse(await readFile(input, "utf8"));
  const res = await fetch(LIST_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${LIST_URL} responded ${res.status}`);
  return res.json();
}

const registry = JSON.parse(await readFile(REGISTRY_PATH, "utf8")) as RawRegistry;
const now = new Date();
const result = syncModels(registry, await loadList(), now);
const report = renderReport(result, now);

if (flag("--write") && result.changed) {
  await writeFile(REGISTRY_PATH, `${JSON.stringify(result.next, null, 2)}\n`);
}
const reportPath = value("--report");
if (reportPath) await writeFile(reportPath, report);
else console.log(report);

console.error(
  `model sync: ${result.priceChanges.length} price, ${result.limitChanges.length} limit, ` +
    `${result.retirementChanges.length} retirement change(s); ${result.gone.length} gone; ` +
    `${result.candidates.length} new candidate(s); registry ${result.changed ? (flag("--write") ? "updated" : "would change") : "unchanged"}.`,
);
