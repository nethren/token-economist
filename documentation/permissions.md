# Permissions

## Identity model

Token Economist has no accounts, organizations, roles, claims, database, or
row-level security. It is a single-user browser application with no server
component. “User” means the person controlling the browser tab.

The application holds no provider credential, so there is no privileged
operation for a permission model to gate.

## Resource and operation matrix

Every visitor is the same principal, whether the app is running locally or from
a static deployment. That is the point of the design, not an oversight.

| Resource / operation | Any user | Notes |
|---|---:|---|
| Run offline estimate | Allowed | Pure local computation |
| Fetch public price list | Allowed | Fixed model-list URL; carries no user content |
| Create a prompt-bearing share link | Allowed after explicit click | Prompt travels in the URL fragment by design |
| Export a check pack | Allowed after explicit click | Copy or download; contains the prompt and samples |
| Paste replies and score them | Allowed | Scored offline; blank boxes stay unreviewed |
| Trigger a paid completion | Not possible | The app has no provider client and no key |
| Read a provider-key value | Not possible | No key is read, stored, or transmitted anywhere |

## Enforcement locations

- Run size, sample cap, and cost preview: `src/components/QualityLab.tsx`,
  `src/core/measure.ts`
- Check-pack contents and configuration binding: `src/core/pack.ts`
- Evidence status, staleness, and provenance labelling: `src/core/card.ts`
- Secret exclusion from version control: `.gitignore`

There are no database tables and no RLS/code-enforced row filters.
