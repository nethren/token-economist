/**
 * Model sync: diff the curated registry (`models.json`) against the public
 * OpenRouter model list and propose a reviewed update (DECISIONS.md D34).
 *
 * This module never runs in the browser. `scripts/sync-models.ts` calls it
 * from a weekly GitHub Action, which opens a pull request; nothing changes in
 * the app until a person merges that PR.
 *
 * What it may write is fixed by MACHINE_FIELDS: prices, context window, max
 * output, the price date and verify flag, and the provider's announced
 * retirement date. Identity — which models are in the set, their tier,
 * tokenizer handling, cache minimum, successors — is curated by a person, so
 * new and vanished models are reported with a suggested entry, never added
 * or removed. `syncModels` asserts that boundary on its own output.
 *
 * Prices follow the same rule as the app's live check (D39, D41): a price
 * checked against the provider within STALE_PRICE_DAYS is kept, and the
 * list's different figure is only reported. The list's price is written only
 * where the bundled one is stale or was never checked (`verifyPricing`).
 *
 * Pure: (registry, payload, now) in, (next registry, report) out. The only
 * network call is the CLI's single GET of the public list, which carries no
 * user data.
 */

import { STALE_PRICE_DAYS, priceAgeDays } from "./priceAge.ts";

export const SYNC_PROVIDERS = ["anthropic", "openai", "google"] as const;

/** The only per-model keys a sync may change. */
export const MACHINE_FIELDS = [
  "inputPerMTok",
  "outputPerMTok",
  "contextWindow",
  "maxOutput",
  "pricesAsOf",
  "verifyPricing",
  "retiresOn",
] as const;

/** Raw registry entry as stored in models.json. */
export interface RawModel {
  id: string;
  provider: string;
  displayName: string;
  tier: string;
  openrouterSlug: string;
  cacheMinTokens: number;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadMult: number;
  cacheWriteMult: number;
  batchMult: number;
  contextWindow: number;
  maxOutput: number;
  pricesAsOf: string;
  verifyPricing?: boolean;
  retiresOn?: string;
  notes?: string;
  /** Curated: an announced price change (D39). The sync never writes it. */
  scheduledPrice?: { from: string; inputPerMTok: number; outputPerMTok: number };
}

export interface RawRegistry {
  defaultReferenceId: string;
  /** ISO timestamp: list rows created up to here have already been reported. */
  candidatesSeenThrough: string;
  models: RawModel[];
  retired: Array<{ id: string; displayName: string; retiredOn: string; successorId: string }>;
}

export interface FieldChange {
  id: string;
  displayName: string;
  field: string;
  from: number | string | null;
  to: number | string | null;
}

export interface Candidate {
  slug: string;
  name: string;
  created: string;
  inputPerMTok: number;
  outputPerMTok: number;
  contextWindow: number;
  maxOutput: number | null;
  /** Ready to paste into models.json once the reviewer confirms each field. */
  suggestedEntry: RawModel;
  /** The current model the tier and cache minimum were copied from. */
  suggestedFrom: string | null;
}

export interface SyncResult {
  next: RawRegistry;
  changed: boolean;
  rowsRead: number;
  /** The list's price was written: the bundled one was stale or unverified. */
  priceChanges: FieldChange[];
  /** The list differs from a current official price, which was kept. */
  priceDiffers: FieldChange[];
  limitChanges: FieldChange[];
  retirementChanges: FieldChange[];
  /** Curated models whose slug is no longer in the list. */
  gone: Array<{ id: string; displayName: string; slug: string }>;
  candidates: Candidate[];
  /** Differences the sync does not apply (cache/batch multipliers). */
  toCheck: FieldChange[];
  seenThroughBefore: string;
}

type Row = Record<string, unknown>;

/** USD/MTok from OpenRouter's per-token string, rounded to strip float noise. */
function perMTok(v: unknown): number | null {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

function positiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

function isoDay(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const day = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) ? day : null;
}

function rowsOf(payload: unknown): Row[] {
  const data = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data.filter((r) => typeof (r as Row)?.id === "string") as Row[]) : [];
}

function isTextModel(r: Row): boolean {
  const arch = (r.architecture ?? {}) as { input_modalities?: unknown; output_modalities?: unknown };
  const out = Array.isArray(arch.output_modalities) ? arch.output_modalities : [];
  const inp = Array.isArray(arch.input_modalities) ? arch.input_modalities : [];
  return out.length === 1 && out[0] === "text" && inp.includes("text");
}

function displayNameOf(r: Row): string {
  const name = typeof r.name === "string" ? r.name : String(r.id);
  return name.replace(/^[^:]{1,40}:\s*/, "");
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * Compute the proposed registry and the review report. Throws when the
 * payload does not look like the model list (too few rows, or most curated
 * slugs absent) so a broken response fails the job instead of reporting
 * every model as gone.
 */
export function syncModels(registry: RawRegistry, payload: unknown, now: Date): SyncResult {
  const today = now.toISOString().slice(0, 10);
  const rows = rowsOf(payload);
  const bySlug = new Map(rows.map((r) => [r.id as string, r]));
  const present = registry.models.filter((m) => bySlug.has(m.openrouterSlug)).length;
  if (rows.length < 20 || present < Math.ceil(registry.models.length / 2)) {
    throw new Error(
      `Model list looks wrong: ${rows.length} rows, ${present}/${registry.models.length} curated models found. Nothing written.`,
    );
  }

  const next: RawRegistry = structuredClone(registry);
  const priceChanges: FieldChange[] = [];
  const priceDiffers: FieldChange[] = [];
  const limitChanges: FieldChange[] = [];
  const retirementChanges: FieldChange[] = [];
  const toCheck: FieldChange[] = [];
  const gone: SyncResult["gone"] = [];

  for (const m of next.models) {
    const row = bySlug.get(m.openrouterSlug);
    const note = (list: FieldChange[], field: string, from: FieldChange["from"], to: FieldChange["to"]) =>
      list.push({ id: m.id, displayName: m.displayName, field, from, to });
    if (!row) {
      gone.push({ id: m.id, displayName: m.displayName, slug: m.openrouterSlug });
      continue;
    }
    const pricing = (row.pricing ?? {}) as Row;
    const input = perMTok(pricing.prompt);
    const output = perMTok(pricing.completion);
    // Compare with the price the app charges today: an announced change
    // whose date has come replaces the bundled one (pricesOn in models.ts).
    const s = m.scheduledPrice;
    const due = s !== undefined && today >= s.from;
    const inUse = due ? s : m;
    if (input !== null && output !== null && (!near(input, inUse.inputPerMTok) || !near(output, inUse.outputPerMTok))) {
      // A current official price wins over the aggregator (D39, D41). So does
      // an announced price in effect: it is curated, and the app applies it
      // over the bundled one, so writing the bundled one would change nothing.
      const official = due || (!m.verifyPricing && priceAgeDays(m.pricesAsOf, today) <= STALE_PRICE_DAYS);
      const into = official ? priceDiffers : priceChanges;
      if (!near(input, inUse.inputPerMTok)) note(into, "inputPerMTok", inUse.inputPerMTok, input);
      if (!near(output, inUse.outputPerMTok)) note(into, "outputPerMTok", inUse.outputPerMTok, output);
      if (!official) {
        m.inputPerMTok = input;
        m.outputPerMTok = output;
        m.pricesAsOf = today;
        // Observed on an aggregator, not read from the provider's own table.
        m.verifyPricing = true;
      }
    }

    const top = (row.top_provider ?? {}) as Row;
    const ctx = positiveInt(top.context_length) ?? positiveInt(row.context_length);
    if (ctx !== null && ctx !== m.contextWindow) {
      note(limitChanges, "contextWindow", m.contextWindow, ctx);
      m.contextWindow = ctx;
    }
    const maxOut = positiveInt(top.max_completion_tokens);
    // A reply cap above half the context window is the list echoing the
    // context size (seen on Gemini 4 rows: 943,718 of 1,048,576, where Google
    // documents 64K). Report it for a person to check; never apply it.
    if (maxOut !== null && maxOut !== m.maxOutput && maxOut > m.contextWindow / 2) {
      note(toCheck, "maxOutput", m.maxOutput, maxOut);
    } else if (maxOut !== null && maxOut !== m.maxOutput) {
      note(limitChanges, "maxOutput", m.maxOutput, maxOut);
      m.maxOutput = maxOut;
    }

    const retires = isoDay(row.expiration_date);
    if (retires !== (m.retiresOn ?? null)) {
      note(retirementChanges, "retiresOn", m.retiresOn ?? null, retires);
      if (retires === null) delete m.retiresOn;
      else m.retiresOn = retires;
    }

    // Reported, never applied: OpenRouter's cache-write and batch figures
    // don't always mean what the registry's multipliers mean (Google bills
    // cache storage separately), so a person checks the provider docs.
    const cacheRead = perMTok(pricing.input_cache_read);
    if (cacheRead !== null && input !== null) {
      const mult = Math.round((cacheRead / input) * 1000) / 1000;
      if (Math.abs(mult - m.cacheReadMult) > 0.005) note(toCheck, "cacheReadMult", m.cacheReadMult, mult);
    }
    const batchRow = bySlug.get(`${m.openrouterSlug}:batch`);
    const batchIn = perMTok(((batchRow?.pricing ?? {}) as Row).prompt);
    if (batchIn !== null && input !== null) {
      const mult = Math.round((batchIn / input) * 1000) / 1000;
      if (Math.abs(mult - m.batchMult) > 0.005) note(toCheck, "batchMult", m.batchMult, mult);
    }
  }

  // New models: text-in/text-out rows from the curated providers, created
  // after the last report, not already curated, and not a :variant.
  const seenThroughBefore = registry.candidatesSeenThrough;
  const seenMs = Date.parse(seenThroughBefore);
  const curated = new Set(registry.models.map((m) => m.openrouterSlug));
  const providers = new Set<string>(SYNC_PROVIDERS);
  const fresh = rows.filter((r) => {
    const slug = r.id as string;
    const created = typeof r.created === "number" ? r.created * 1000 : NaN;
    return (
      providers.has(slug.split("/")[0]) &&
      !slug.includes(":") &&
      !curated.has(slug) &&
      Number.isFinite(created) &&
      created > (Number.isFinite(seenMs) ? seenMs : 0) &&
      isTextModel(r)
    );
  });

  const candidates: Candidate[] = [];
  for (const r of fresh) {
    const pricing = (r.pricing ?? {}) as Row;
    const input = perMTok(pricing.prompt);
    const output = perMTok(pricing.completion);
    const top = (r.top_provider ?? {}) as Row;
    const ctx = positiveInt(top.context_length) ?? positiveInt(r.context_length);
    if (input === null || output === null || ctx === null) continue;
    const slug = r.id as string;
    const provider = slug.split("/")[0];
    // Closest-priced current model from the same provider lends its tier and
    // cache minimum as a starting point. The reviewer decides.
    const peers = registry.models.filter((m) => m.provider === provider);
    const peer = peers.reduce<RawModel | null>(
      (best, m) =>
        best === null || Math.abs(Math.log(m.outputPerMTok / output)) < Math.abs(Math.log(best.outputPerMTok / output))
          ? m
          : best,
      null,
    );
    const maxOut = positiveInt(top.max_completion_tokens);
    candidates.push({
      slug,
      name: displayNameOf(r),
      created: new Date((r.created as number) * 1000).toISOString().slice(0, 10),
      inputPerMTok: input,
      outputPerMTok: output,
      contextWindow: ctx,
      maxOutput: maxOut,
      suggestedFrom: peer?.displayName ?? null,
      suggestedEntry: {
        id: slug.split("/")[1],
        provider,
        displayName: displayNameOf(r),
        tier: peer?.tier ?? "workhorse",
        openrouterSlug: slug,
        cacheMinTokens: peer?.cacheMinTokens ?? 1024,
        inputPerMTok: input,
        outputPerMTok: output,
        cacheReadMult: peer?.cacheReadMult ?? 0.1,
        cacheWriteMult: peer?.cacheWriteMult ?? 1,
        batchMult: peer?.batchMult ?? 0.5,
        contextWindow: ctx,
        maxOutput: maxOut ?? Math.min(ctx, 64_000),
        pricesAsOf: today,
        verifyPricing: true,
        ...(isoDay(r.expiration_date) ? { retiresOn: isoDay(r.expiration_date)! } : {}),
      },
    });
  }
  candidates.sort((a, b) => a.slug.split("/")[0].localeCompare(b.slug.split("/")[0]) || b.created.localeCompare(a.created));

  // Reported once: the PR that lists them moves the marker past them.
  if (fresh.length > 0) {
    const newest = Math.max(...fresh.map((r) => r.created as number));
    next.candidatesSeenThrough = new Date(newest * 1000).toISOString();
  }

  assertOnlyMachineFields(registry, next);
  return {
    next,
    changed: JSON.stringify(next) !== JSON.stringify(registry),
    rowsRead: rows.length,
    priceChanges,
    priceDiffers,
    limitChanges,
    retirementChanges,
    gone,
    candidates,
    toCheck,
    seenThroughBefore,
  };
}

/** The boundary, checked rather than trusted: a sync that touched a curated
 *  field (or added/removed a model) is a bug, so it throws. */
export function assertOnlyMachineFields(before: RawRegistry, after: RawRegistry): void {
  const machine = new Set<string>(MACHINE_FIELDS);
  const strip = (m: RawModel) =>
    JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => !machine.has(k)).sort()));
  if (before.models.length !== after.models.length) throw new Error("Sync changed the curated model set");
  before.models.forEach((m, i) => {
    if (strip(m) !== strip(after.models[i])) throw new Error(`Sync changed a curated field on ${m.id}`);
  });
  const rest = (r: RawRegistry) => JSON.stringify({ ...r, models: null, candidatesSeenThrough: null });
  if (rest(before) !== rest(after)) throw new Error("Sync changed a curated registry field");
}

const OFFICIAL_PRICING = [
  "Anthropic: https://platform.claude.com/docs/en/about-claude/pricing",
  "OpenAI: https://developers.openai.com/api/docs/models",
  "Google: https://ai.google.dev/gemini-api/docs/pricing",
];

const fmt = (v: number | string | null) => (v === null ? "—" : typeof v === "number" ? String(v) : v);

function changeTable(rows: FieldChange[]): string[] {
  return [
    "| Model | Field | Bundled | Public list |",
    "|---|---|---|---|",
    ...rows.map((c) => `| ${c.displayName} | \`${c.field}\` | ${fmt(c.from)} | ${fmt(c.to)} |`),
  ];
}

/** The pull request body. Plain Markdown, deterministic for a given result. */
export function renderReport(r: SyncResult, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const L: string[] = [];
  L.push(`## Model sync — ${today}`);
  L.push("");
  L.push(
    `Diffed \`src/core/models.json\` against the public OpenRouter model list (\`GET https://openrouter.ai/api/v1/models\`, no key, no user data; ${r.rowsRead} rows). Nothing reaches the app until this PR is merged.`,
  );
  L.push("");

  L.push("### Applied to the registry");
  L.push("");
  if (r.priceChanges.length + r.limitChanges.length + r.retirementChanges.length === 0) {
    L.push("No price, limit or retirement changes.");
    L.push("");
  }
  if (r.priceChanges.length > 0) {
    L.push(
      `**Prices** — the bundled price was over ${STALE_PRICE_DAYS} days old or never checked with the provider, so the list's is used. \`pricesAsOf\` moved to today and \`verifyPricing\` set until checked against the provider's own table.`,
    );
    L.push("");
    L.push(...changeTable(r.priceChanges), "");
  }
  if (r.limitChanges.length > 0) {
    L.push("**Context window and max output**");
    L.push("");
    L.push(...changeTable(r.limitChanges), "");
  }
  if (r.retirementChanges.length > 0) {
    L.push("**Retirement dates** — the model stays estimable and is flagged in the table and on the card.");
    L.push("");
    L.push(...changeTable(r.retirementChanges), "");
  }

  L.push("### Needs a decision (not applied)");
  L.push("");
  if (r.gone.length + r.candidates.length + r.toCheck.length + r.priceDiffers.length === 0) {
    L.push("Nothing.");
    L.push("");
  }
  if (r.priceDiffers.length > 0) {
    L.push(
      `**Official price kept; the public list differs.** These prices were checked against the provider within ${STALE_PRICE_DAYS} days, so they stay, and the site shows the list's figure beside them. If the provider really changed the price, edit it and \`pricesAsOf\` by hand.`,
    );
    L.push("");
    L.push(...changeTable(r.priceDiffers), "");
  }
  if (r.gone.length > 0) {
    L.push("**Gone from the public list.** Remove from `models`, add to `retired` with a `successorId` so old share links say what replaced them:");
    L.push("");
    for (const g of r.gone) L.push(`- ${g.displayName} (\`${g.id}\`, slug \`${g.slug}\`)`);
    L.push("");
  }
  if (r.candidates.length > 0) {
    L.push(
      `**New models since ${r.seenThroughBefore.slice(0, 10)}.** To include one, paste its entry into \`models\` and confirm the tier, the cache minimum and (for OpenAI) the tokenizer. Tier and cache minimum are copied from the closest-priced current model and are only a starting point. Merging without adding any just marks them as seen.`,
    );
    L.push("");
    L.push("| Model | Slug | Listed | $/1M in/out | Context | Suggested tier |");
    L.push("|---|---|---|---|---|---|");
    for (const c of r.candidates) {
      L.push(
        `| ${c.name} | \`${c.slug}\` | ${c.created} | $${c.inputPerMTok}/$${c.outputPerMTok} | ${c.contextWindow.toLocaleString("en-US")} | ${c.suggestedEntry.tier}${c.suggestedFrom ? ` (like ${c.suggestedFrom})` : ""} |`,
      );
    }
    L.push("");
    L.push("<details><summary>Suggested entries</summary>");
    L.push("");
    L.push("```json");
    L.push(JSON.stringify(r.candidates.map((c) => c.suggestedEntry), null, 2));
    L.push("```");
    L.push("");
    L.push("</details>");
    L.push("");
  }
  if (r.toCheck.length > 0) {
    L.push("**Values that differ from the public list but look unreliable there.** Not applied: check the provider's docs and edit by hand if they moved.");
    L.push("");
    L.push(...changeTable(r.toCheck), "");
  }

  L.push("### Review checklist");
  L.push("");
  L.push("- [ ] Changed prices match the provider's official table; clear `verifyPricing` on the ones that do.");
  L.push("- [ ] Any added model has the right tier, cache minimum and calibration (new OpenAI generations: confirm the o200k tokenizer, DECISIONS.md D2).");
  L.push("- [ ] Retiring or gone models have a successor chosen before their date.");
  L.push("- [ ] Added a DECISIONS.md entry if the curated set changed.");
  L.push("");
  L.push(`Official pricing: ${OFFICIAL_PRICING.join(" · ")}`);
  L.push("");
  return L.join("\n");
}
