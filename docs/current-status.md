# Current Status

Updated: 2026-04-11T01:48:28.476Z

## Start Here

- Read this file first in a shallow session.
- Main command: `npm run advance:canary`
- Safe status refresh: `npm run score:gateway -- --write && npm run status:dashboard`

## Current Phase

- Phase: canary-prep gating before exact gas
- Decision: `RERUN_SCORING`
- Headline: Rerun route scoring with exact gas
- Live trading: `BLOCKED`
- Shadow trading: `ALLOWED`

## Best Route Right Now

- Route: `bob->base wBTC.OFT->wBTC.OFT`
- Route key: `bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000`
- txReady=true exactGasDone=true viableForPrep=true
- Input value: $7.31
- Prep funding estimate: $0.0000
- Net edge now: $-0.8322

## Required Actions Before Exact Gas

- rerun scoring for bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000

## Objective Verification

- This file does not execute validation by itself.
- Rerun `npm run check` before acting on code changes.
- Rerun `npm test` before acting on behavior assumptions.
- Candidate routes observed: 46
- txReady routes: 1
- viable prep routes: 1
- estimator wallet checked routes: 1
- estimator skipped routes: 0
- skipped reasons: none

## Next Command Order After Funding

1. `npm run check:estimator-wallet -- --route-key="<routeKey>" --amount="<amount>"`
2. `npm run estimate:gateway-gas -- --from="$BOB_CLAW_ESTIMATE_FROM" --route-key="<routeKey>" --amount="<amount>"`
3. `npm run score:gateway -- --write`
4. `npm run status:dashboard`
5. `npm run advance:canary`

## Important Files

- `src/cli/advance-canary.mjs`
- `src/cli/plan-canary-next-step.mjs`
- `src/cli/plan-canary-routes.mjs`
- `src/cli/plan-estimator-wallet.mjs`
- `src/estimator/canary-next-step.mjs`
- `src/estimator/canary-route-plan.mjs`
- `src/estimator/funding-plan.mjs`
- `docs/current-status.md`

## Backup Note

- `.env` and `data/` stay out of git.
- This repo is safe to back up publicly only if you are comfortable exposing source; operational secrets are ignored by git.
- Prefer a private GitHub repo for backup.

