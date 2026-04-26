# BOB Claw Dashboard

This dashboard is a mobile-first BTC flow map.

Read the context before changing UI or public status fields:

- `../docs/dashboard-context.md`

## Local Preview

```bash
npm run dashboard:serve
```

Open:

```text
http://localhost:8787
```

For static-only preview of the generated snapshot:

```bash
npm run status:dashboard
npm run dashboard:serve:static
```

## Contract

The browser reads only public-safe status payloads:

```text
dashboard/public/dashboard-status.json
/api/live-status
/api/live-events
```

`/api/live-status` and `/api/live-events` are local read-only adapters over the same dashboard status builders. Cloudflare Pages still serves only the static files under `dashboard/public`.

Do not point the browser at raw JSONL files under `data/`.

## Before Finishing Edits

```bash
npm test
npm run check
node --check dashboard/public/app.js
npm run status:dashboard
```

Then verify mobile and desktop with Playwright as described in `docs/dashboard-context.md`.

## Cloudflare Pages

Use a dedicated Cloudflare account for this dashboard so other dashboards stay untouched.

Required:

```bash
CLOUDFLARE_API_TOKEN=...
```

Optional when auto-discovery is unambiguous:

```bash
CLOUDFLARE_ACCOUNT_ID=...
BOB_CLAW_CF_PAGES_PROJECT=...
```

The deploy script prefers explicit env values or flags when present. If they are omitted, it queries Cloudflare, auto-picks the stable `bob-claw-dashboard` Pages project when uniquely discoverable, and prints a preflight summary before deploying. If account or project selection is still ambiguous, it now prints candidate accounts/projects plus the exact env/flag to set.

Create the Pages project once when it does not exist yet:

```bash
npm run deploy:dashboard:cloudflare -- --create-project
```

Deploy updates to the stable public URL later:

```bash
npm run deploy:dashboard:cloudflare
```

Current public dashboard URL and stable Pages project:

```text
https://bob-claw-dashboard.pages.dev
```

This deploy flow uses a repo-local `.cloudflare/` state directory and does not depend on or modify your global Wrangler login.

## CI

No Cloudflare Pages auto-deploy workflow is present in this checkout. Run the deploy command manually.
