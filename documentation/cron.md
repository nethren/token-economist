# Scheduled work: weekly model sync

One scheduled job exists. It proposes registry updates as a pull request and
never changes the deployed app by itself (DECISIONS.md D34).

## Trigger and owner

- **Workflow:** `.github/workflows/model-sync.yml`
- **Schedule:** Mondays 06:17 UTC, plus manual **Run workflow** (`workflow_dispatch`).
- **Owner:** the repository owner, who reviews and merges the PR. Vercel deploys
  only from `main`, so nothing ships until the merge.

## What it does

1. Runs `node scripts/sync-models.ts --write`, which sends one GET to
   `https://openrouter.ai/api/v1/models` (public, no key) and diffs it against
   `src/core/models.json` using the pure `syncModels()` in
   `src/core/modelSync.ts`.
2. Writes only the machine-refreshable fields: input/output price, context
   window, max output, `pricesAsOf`, `verifyPricing`, `retiresOn`, plus the
   `candidatesSeenThrough` marker. Every changed price is marked
   `verifyPricing: true` until a person checks it against the provider's own
   table. `assertOnlyMachineFields()` throws if anything else moved.
3. Reports, without applying: new text models from Anthropic, OpenAI and
   Google, each with a suggested entry; curated models that vanished from the
   list; cache or batch multipliers that differ; and a max output above half
   the context window, which the list reports for some models where it is
   really echoing the context size.
4. If `models.json` changed, runs `npm run check` and force-pushes the branch
   `chore/model-sync`, then opens or updates one PR whose body is the report
   plus the check outcome. If nothing changed, it exits and opens no PR.

## Reviewing the PR

- **Prices:** compare with the official pages linked in the PR body, then
  clear `verifyPricing` on the rows that match.
- **New models:** paste the suggested entry into `models` and confirm the tier,
  `cacheMinTokens` and tokenizer handling. A new OpenAI generation needs its
  tokenizer checked against o200k (DECISIONS.md D2). Merging without adding a
  model just marks it as seen. Changing the curated set needs a DECISIONS.md
  entry.
- **Retiring or gone:** a model with `retiresOn` stays estimable and is
  flagged. Once it is gone, remove it from `models` and add
  `{ id, displayName, retiredOn, successorId }` to `retired`, so old share
  links name what replaced it.

## Permissions and data

- `GITHUB_TOKEN` with `contents: write` and `pull-requests: write`. There is no
  provider key, and none is needed.
- In the repository settings, **Actions → General → Allow GitHub Actions to
  create and approve pull requests** must be on, or the PR step fails.
- A PR opened with `GITHUB_TOKEN` does not trigger `ci.yml`. The job runs the
  same gate itself and writes the result at the top of the PR body. Pushing a
  commit to the branch by hand triggers normal CI.
- The request carries no prompt, feature name, Quality Lab data or user content.
  The job reads no secrets.

## Failure handling

- An unreachable list or a response that doesn't look like the model list
  (too few rows, or most curated slugs missing) fails the job before anything
  is written. No PR is opened and the registry is untouched.
- Failed checks still open the PR, marked FAILED, so the drift stays visible.

## Running it locally

```sh
npm run models:sync                       # print the report only
npm run models:sync -- --write            # also update models.json
npm run models:sync -- --input list.json  # use a saved copy of the list
```

Requires Node 23.6 or newer, which runs the TypeScript script directly.
