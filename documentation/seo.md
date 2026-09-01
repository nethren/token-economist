# SEO and public routes

Token Economist is a single public SPA route intended to be indexable when
deployed statically.

| Route | Needs SEO | Data exposed |
|---|---:|---|
| `/` | Yes | Static product title, bundled application assets, and user-entered data rendered only in that user’s browser |
| `/#<share-state>` | Same document | The fragment is client-side state and is not sent to the server |

`index.html` provides a static title and viewport metadata. There is no
dynamic metadata, server rendering, bot-specific route, JSON-LD, or
user-controlled HTML injection. React renders user content as text.

Before a hosted portfolio demo, add a canonical URL, description, Open Graph
image, and social metadata for the final deployment domain. Those additions
must remain static; prompt/share-fragment content must never enter metadata.
