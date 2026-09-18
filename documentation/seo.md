# SEO and public routes

Token Economist is a single public SPA route intended to be indexable when
deployed statically.

| Route | Needs SEO | Data exposed |
|---|---:|---|
| `/` | Yes | Static product title, bundled application assets, and user-entered data rendered only in that user’s browser |
| `/#<share-state>` | Same document | The fragment is client-side state and is not sent to the server |

`index.html` provides the static title, description, canonical URL, Open Graph,
and social-card metadata for `https://tokenecon.nethren.com/`. The social image
is a static product screenshot copied into `public/`; prompt and share-fragment
content never enters metadata.

There is no dynamic metadata, server rendering, bot-specific route, JSON-LD,
or user-controlled HTML injection. React renders user content as text.
