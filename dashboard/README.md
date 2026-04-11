# BOB Claw Dashboard

This dashboard is a mobile-first BTC flow map.

Read the context before changing UI or public status fields:

- `../docs/dashboard-context.md`

## Local Preview

```bash
npm run status:dashboard
npm run dashboard:serve
```

Open:

```text
http://localhost:8787
```

## Contract

The browser reads only:

```text
dashboard/public/dashboard-status.json
```

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

Set these environment variables first:

```bash
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
BOB_CLAW_CF_PAGES_PROJECT=...
```

Create the Pages project once:

```bash
npm run deploy:dashboard:cloudflare -- --create-project
```

Deploy updates to the same stable `pages.dev` address later:

```bash
npm run deploy:dashboard:cloudflare
```

This deploy flow uses a repo-local `.cloudflare/` state directory and does not depend on or modify your global Wrangler login.
