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

Current public dashboard URL:

```text
https://bob-claw-dashboard.pages.dev
```

This deploy flow uses a repo-local `.cloudflare/` state directory and does not depend on or modify your global Wrangler login.

## CI Auto-Deploy (T27)

GitHub Actions workflow `.github/workflows/dashboard-deploy.yml` runs on every push to `main` that touches `dashboard/**`, `src/dashboard/**`, or the deploy script. It performs:

1. `npm ci`
2. Layout + visual-regression tests (`mindmap-layout`, `logo-assets`, `dashboard-visual-regression`)
3. `node --check dashboard/public/app.js`
4. Full `npm test`
5. `node src/cli/deploy-dashboard-cloudflare.mjs` (only if every step above passes)

Required repo secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — scoped Pages:Edit + Account:Read
- `BOB_CLAW_CF_PAGES_PROJECT` — Pages project name
- `BOB_CLAW_CF_PRODUCTION_BRANCH` — optional, defaults to `main`

The workflow only ships static assets. It never touches signer keys, capital, or caps.

`workflow_dispatch` is enabled with a `skip_status` toggle to redeploy the existing `dashboard-status.json` without regenerating it.

