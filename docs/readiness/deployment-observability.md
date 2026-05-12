# Deployment Observability

This repository's deploy-impact surface is real but narrow:

- the read-only dashboard deploy workflow in [`.github/workflows/deploy-dashboard-cloudflare.yml`](../../.github/workflows/deploy-dashboard-cloudflare.yml)
- the generated public payloads under [`dashboard/public/`](../../dashboard/public)
- the repo-local status and publish verification commands under [`package.json`](../../package.json)
- the optional read-only live dashboard runtime under [`src/cli/run-dashboard-public-live.mjs`](../../src/cli/run-dashboard-public-live.mjs)

There is no committed Slack integration, no committed deploy webhook, and no
runtime trade authority inside this observability path.

## What To Verify

Treat these as separate questions:

| Question                                                          | Real surface                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Did the dashboard build?                                          | `npm run dashboard:build`                                                                                  |
| Did the public truth payload refresh?                             | `npm run status:dashboard -- --commit-public` and `npm run verify:dashboard-publish`                       |
| Did the deploy workflow publish the verified payload?             | `.github/workflows/deploy-dashboard-cloudflare.yml` deploy job                                             |
| Did the deployed Pages endpoint serve the expected payload shape? | `https://${BOB_CLAW_CF_PAGES_PROJECT}.pages.dev/dashboard-status.json`                                     |
| If a read-only live origin is in use, is it healthy?              | `npm run dashboard:public:run`, `/api/live-status`, `/api/live-events`, `data/dashboard-live-runtime.json` |

Build success alone is not deploy verification. The workflow explicitly
separates them:

1. `npm run dashboard:build`
2. `npm run status:dashboard -- --commit-public`
3. `node src/cli/run-strategy-tick.mjs --all-strategies --json --quiet`
4. `npm run report:strategy-tick-slice -- --json --quiet --commit-public`
5. `npm run verify:dashboard-publish`
6. `npm run deploy:dashboard:cloudflare -- --skip-status`
7. `curl --fail --silent --show-error --location "https://${BOB_CLAW_CF_PAGES_PROJECT}.pages.dev/dashboard-status.json"`

## Repo-Local Observability Surfaces

### 1. Cloudflare Pages deploy workflow

Source of truth:

- [`.github/workflows/deploy-dashboard-cloudflare.yml`](../../.github/workflows/deploy-dashboard-cloudflare.yml)
- [`src/cli/deploy-dashboard-cloudflare.mjs`](../../src/cli/deploy-dashboard-cloudflare.mjs)

What it shows:

- GitHub Actions job logs for each deploy attempt
- the `dashboard-production` environment URL
- a final deployed-endpoint verification step against `dashboard-status.json`

This is the only committed production deploy path in the repo for the public
dashboard.

### 2. Public payload verification

Source of truth:

- [`src/cli/status-dashboard.mjs`](../../src/cli/status-dashboard.mjs)
- [`src/cli/verify-dashboard-publish.mjs`](../../src/cli/verify-dashboard-publish.mjs)
- [`dashboard/public/dashboard-status.json`](../../dashboard/public/dashboard-status.json)
- [`dashboard/public/strategy-tick-status.json`](../../dashboard/public/strategy-tick-status.json)
- [`dashboard/public/live-runtime.json`](../../dashboard/public/live-runtime.json)

Use these to verify that the publish payload exists and is structurally fresh
before any deploy is considered valid.

### 3. Read-only live dashboard runtime

Source of truth:

- [`src/cli/run-dashboard-public-live.mjs`](../../src/cli/run-dashboard-public-live.mjs)
- [`src/cli/deploy-dashboard-public-live.mjs`](../../src/cli/deploy-dashboard-public-live.mjs)
- [`src/dashboard/live-server.mjs`](../../src/dashboard/live-server.mjs)

Local runtime surfaces:

- `dashboardLocal=<origin>`
- `dashboardHealth=<origin>/healthz`
- `dashboardReady=<origin>/readyz`
- `dashboardPublic=<public tunnel URL>`
- `data/dashboard-live-runtime.json`

This is still read-only. It is not a signer, not a strategy executor, and not
a cap or payback authority.

### 4. PR validation surfaces

Source of truth:

- [`.github/workflows/auto-pr-validate.yml`](../../.github/workflows/auto-pr-validate.yml)

Observable outputs:

- `$GITHUB_STEP_SUMMARY` build-performance summary
- uploaded artifact `build-performance-tracking`

These are CI proof surfaces for the PR, not a substitute for deployed Pages
truth.

## Notifications

Committed notification code in this repo is Telegram-only and runtime-oriented:

- [`src/notify/telegram.mjs`](../../src/notify/telegram.mjs)
- [`src/cli/watch-gateway-updates.mjs`](../../src/cli/watch-gateway-updates.mjs)
- [`src/executor/signer/transaction-alerts.mjs`](../../src/executor/signer/transaction-alerts.mjs)
- [`src/executor/watchdog/runner.mjs`](../../src/executor/watchdog/runner.mjs)

Environment variable names:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Important limits:

- no committed Slack integration exists in source
- no deploy-specific webhook integration exists in source
- PR validation must not set live secrets or send deploy notifications
- `src/config/telegram.mjs` currently sets `TELEGRAM_ALERT_MODE = "transaction_only"`
  so non-transaction categories such as Gateway update alerts are suppressed
  even if the code path is exercised

For PR checks, keep Telegram env vars unset and rely on skipped/dry-run
behavior rather than sending messages.

## Read-Only Validation Commands

Use these during readiness or PR review without triggering a deploy:

```bash
node scripts/check-deployment-observability.mjs
npm run verify:dashboard-publish
node --test test/check-deployment-observability.test.mjs
```

Do not use `npm run deploy:dashboard:cloudflare`, `workflow_dispatch`, or any
notification-sending path as part of PR-only validation for this signal.
