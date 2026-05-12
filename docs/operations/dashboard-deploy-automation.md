# Dashboard Deploy Automation

This repository deploys the read-only dashboard to Cloudflare Pages through
`.github/workflows/deploy-dashboard-cloudflare.yml`.

The workflow uses the existing deploy path instead of a fake release or no-op
job:

1. `npm run dashboard:build`
2. `npm run status:dashboard -- --commit-public`
3. `node src/cli/run-strategy-tick.mjs --all-strategies --json --quiet`
4. `npm run report:strategy-tick-slice -- --json --quiet --commit-public`
5. `npm run verify:dashboard-publish`
6. `npm run deploy:dashboard:cloudflare -- --skip-status`
7. `curl --fail https://<project>.pages.dev/dashboard-status.json`

It never starts signer daemons, runtime trading loops, the payback scheduler,
capital movers, kill-switch toggles, or any live execution command. The deploy
surface is the static/read-only `dashboard/public` Cloudflare Pages site.
The strategy tick command is intentionally report-only; do not add `--execute`
to this workflow.

## Schedule

The workflow is configured for:

- `workflow_dispatch` for operator-controlled deploys.
- A twice-weekly schedule on Monday and Thursday at `03:17 UTC`.
- `main` branch deploys when dashboard deploy source files change.

This gives Deployment Frequency a real automation surface without requiring
this PR to run a production deploy before merge.

## Required GitHub Configuration

- Secret: `CLOUDFLARE_API_TOKEN`
- Optional secret: `CLOUDFLARE_ACCOUNT_ID`
- Variable: `BOB_CLAW_CF_PAGES_PROJECT`, default `bob-claw-dashboard`
- Variable: `BOB_CLAW_CF_PRODUCTION_BRANCH`, default `main`
- Optional variable: `BOB_CLAW_DASHBOARD_LIVE_ORIGIN`
- Environment: `dashboard-production`

If the repository has ambiguous Cloudflare account access,
`CLOUDFLARE_ACCOUNT_ID` should be set so `src/cli/deploy-dashboard-cloudflare.mjs`
can select the correct Pages account deterministically.

## Deployment Frequency Evidence Commands

Use these commands when re-evaluating the Agent Readiness Deployment Frequency
signal:

```bash
gh release list --limit 30
ls .github/workflows/ | grep -i deploy
gh run list --workflow=deploy-dashboard-cloudflare.yml --limit 30
```

Count only successful release or deploy workflow runs. PR validation runs,
failed runs, build-only checks, and local dashboard builds are not deployments.
