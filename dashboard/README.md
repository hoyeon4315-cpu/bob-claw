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
