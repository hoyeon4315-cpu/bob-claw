# Current Status

Updated: 2026-04-11T00:14:06.144Z

## Start Here

- Read this file first in a shallow session.
- Main command: `npm run advance:canary`
- Safe status refresh: `npm run score:gateway -- --write && npm run status:dashboard`

## Current Phase

- Phase: canary-prep gating before exact gas
- Decision: `FUND_AND_APPROVE_WALLET`
- Headline: Fund and approve the estimator wallet before exact gas
- Live trading: `BLOCKED`
- Shadow trading: `ALLOWED`

## Best Route Right Now

- Route: `bob->base wBTC.OFT->wBTC.OFT`
- Route key: `bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000`
- txReady=true exactGasDone=false viableForPrep=true
- Input value: $7.34
- Prep funding estimate: $8.11
- Net edge now: $-0.8355

## Required Actions Before Exact Gas

- fund 0.000353300213 ETH on bob
- fund 0.0001 wBTC.OFT on bob
- approve 0.0001 wBTC.OFT for spender 0x0555E30da8f98308EdB960aa94C0Db47230d2B9c on bob

## Objective Verification

- This file does not execute validation by itself.
- Rerun `npm run check` before acting on code changes.
- Rerun `npm test` before acting on behavior assumptions.
- Candidate routes observed: 46
- txReady routes: 1
- viable prep routes: 1
- estimator wallet checked routes: 1
- estimator skipped routes: 7
- skipped reasons: missing_tx_data:7

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

