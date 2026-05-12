# Release Automation

BOB Claw release automation is intentionally narrow: it automates the dashboard
release path without changing live trading, signer, policy, caps, payback,
capital movement, or kill-switch behavior.

## What Runs Automatically

The `release-automation` GitHub Actions workflow runs a release dry-run on
pull requests that touch release automation files and on pushes to `main`.

The dry-run:

- installs dependencies with `npm ci`;
- validates `npm run release:dry-run -- --json`;
- runs `node --test test/release-dry-run.test.mjs`;
- runs `npm run check`;
- runs `npm test`;
- builds the dashboard artifact with `npm run dashboard:build`.

This path does not create tags, publish GitHub Releases, publish Docker images,
deploy Cloudflare Pages, start daemons, stop daemons, toggle the kill-switch, or
move funds.

## Dashboard Deployment

Dashboard deployment is available only through manual `workflow_dispatch` after
the workflow is present on `main`.

Required dispatch conditions:

- branch is `main`;
- workflow input `deploy_dashboard` is `true`;
- GitHub environment `cloudflare-pages-production` permits the job;
- secret `CLOUDFLARE_API_TOKEN` is present;
- repository variable `BOB_CLAW_CF_PAGES_PROJECT` is set, or it falls back to
  `bob-claw-dashboard`.

Optional:

- secret `CLOUDFLARE_ACCOUNT_ID`, when Cloudflare account auto-discovery is not
  appropriate.

The deploy job runs the existing repository deploy script:

```bash
npm run deploy:dashboard:cloudflare
```

That script builds `dashboard/public`, refreshes public status slices, runs
`verify-dashboard-publish`, and deploys through Wrangler using repo-local
Cloudflare state. Before invoking it, the workflow also refreshes the dashboard
status and strategy tick slices, then runs `npm run verify:dashboard-publish` so
stale publish data blocks deployment instead of being silently shipped. The
workflow runs `npm run verify:dashboard-publish` again after the deploy script
and fetches the remote
`/dashboard-status.json` from the configured Pages project to confirm the
deployed status endpoint is reachable.

## Release Notes Relationship

Open PR #22 (`codex/release-notes-automation`) adds release-notes preview
tooling. This release automation does not duplicate that work and does not add
semantic-release, changesets, release-please, tags, or GitHub Release publishing.
If PR #22 merges, the release dry-run can later include its release-notes preview
script as an additional check.

## Local Verification

Run the safe preflight locally:

```bash
npm run release:dry-run -- --json
node --test test/release-dry-run.test.mjs
```

Workflow YAML can be checked with `actionlint` when available. Without
`actionlint`, use a YAML parser check and the dry-run/test commands above.

## Safety Boundary

The release workflow must not call these runtime surfaces:

- `npm run executor:*`;
- `npm run live:*`;
- `npm run kill:on`, `npm run kill:off`, or `npm run kill:status`;
- `npm run executor:payback-scheduler*`;
- `npm run capital:*` execution paths;
- signer socket or key-loading paths.

Any future expansion from dashboard deployment to tags, GitHub Releases, Docker
publishing, or release-notes publishing should be a separate PR with its own
dry-run and explicit publish conditions.
