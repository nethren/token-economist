# Deployment — Vercel static site

Token Economist deploys as a static Vite application. The production app has
no server, database, account system, runtime secret, provider credential or
paid model path. The selected public origin is
`https://tokenecon.nethren.com/`.

## Release gate

Use Node 20, 22 or 24 and run:

```sh
npm ci --ignore-scripts
npm run check
```

`npm run check` runs lint, 104 deterministic tests, the production build and a
bundle scan that rejects paid-provider hostnames and key identifiers. The five
guarded live calibration tests remain opt-in and are not part of deployment.

## Vercel setup

Use the owner's existing Vercel Hobby team and create a `token-economist`
project from the independent GitHub repository. `vercel.json` selects Vite,
runs the complete release gate and publishes `dist`.

No environment variables belong in Preview or Production. The browser makes
one allowed public request to OpenRouter for model prices; prompts, samples and
quality evidence never enter that request. The security policy permits that
origin and the inline width styles used by the charts, while blocking frames,
plugins and all other network destinations.

Deploy and verify a preview before promoting a production build.

## Preview checks

1. Confirm the title, favicon, canonical URL and social metadata.
2. Load the default estimator and confirm the decision receipt renders.
3. Change a prompt and a volume assumption; confirm costs and findings update.
4. Confirm live price refresh succeeds. Then block the request and confirm the
   dated bundled snapshot remains usable.
5. Export a Quality Lab check pack, paste a representative reply document and
   confirm the evidence state updates without a server request.
6. Copy a share link, open it in a fresh browser context and confirm the URL
   fragment restores the scenario without sending the fragment to the host.
7. Check desktop and 390 px layouts, keyboard navigation and reduced motion.
8. Confirm the response headers from `vercel.json` are present.

## Custom domain and DNS

Attach `tokenecon.nethren.com` to the Vercel project. Vercel will return the
exact CNAME target for the project. In Cloudflare, create only the requested
DNS-only CNAME for `tokenecon`; do not change the zone apex, APIFit or other
portfolio records. Verify Vercel domain ownership, TLS issuance and the final
HTTPS response before treating the deployment as ready.

## Rollback

Keep the preceding verified Vercel deployment available. If the production
page fails to load, the security policy blocks a required feature, or a core
estimate/share/check-pack flow breaks, promote the preceding deployment and
re-run the smoke checks. DNS should remain pointed at Vercel during an ordinary
application rollback.

## Known operating limit

The bundled offline tokenizer makes the initial JavaScript about 1.12 MB gzip.
Measure it on the preview over a real connection. Slow first interaction is a
reason to pause production and split or defer tokenizer loading; it does not
change the privacy boundary.
