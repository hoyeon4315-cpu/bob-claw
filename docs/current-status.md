# Current Status

Updated: 2026-04-11T21:52:54.166Z

## Start Here

- Read this file first in a shallow session.
- Main command: `npm run advance:canary`
- Safe status refresh: `npm run score:gateway -- --write && npm run status:dashboard`

## Current Phase

- Address: `0x96262be63aa687563789225c2fe898c27a3b0ae4`
- Phase: canary-prep gating before exact gas
- Decision: `BLOCKED_NO_VIABLE_PREP_ROUTE`
- Headline: Best prepared route still fails objective score review
- Live trading: `BLOCKED`
- Shadow trading: `ALLOWED`

## Progress Snapshot

- Completed so far: top canary route selected · tx payload captured · wallet readiness cleared · exact gas captured
- Remaining steps: refresh stale/missing inputs (gateway quote, exact gas, source gas, DEX quote, market) · clear objective blocker (reject_no_net_edge) · advance canary beyond BLOCKED_NO_VIABLE_PREP_ROUTE
- Manual canary review: NOT_READY_FOR_MANUAL_CANARY_REVIEW (reject_no_net_edge)
- Live execution: LIVE_EXECUTION_BLOCKED; audit=LIVE_BLOCKED (audit_blocks_live,stale_gas_snapshots)

## Best Route Right Now

- Route: `bob->base wBTC.OFT->wBTC.OFT`
- Route key: `bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000`
- txReady=true exactGasDone=true viableForPrep=true
- Input value: $7.37
- Prep funding estimate: $0.0000
- Net edge now: $-0.8567
- Objective score blocker: reject_no_net_edge (net edge $-0.8567)
- Next readiness check: `base->sonic wBTC.OFT->wBTC.OFT` amount=`10000`
- Refresh status: ready to rerun the next wallet readiness check now
- Next focus: rerun quotes, gas, or token prices only when market inputs change; wallet readiness is no longer the blocker

## Required Actions Before Exact Gas

- none

## Objective Verification

- This file does not execute validation by itself.
- Rerun `npm run check` before acting on code changes.
- Rerun `npm test` before acting on behavior assumptions.
- Candidate routes observed: 100
- txReady routes: 60
- viable prep routes: 5

## Profitability Summary

- Tested closed loops: 49
- Profitable closed loops: 0
- Loop-observable routes: 10
- Missing focus Gateway quotes: 0
- Profit verdict: measured no-edge universe (The currently measurable closed-loop universe has been tested and still sits well below the minimum profit gate.)
- Current canary route: reject_no_net_edge net=$-0.8520
- Closest route to policy: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` net=$-0.5906 gap=$0.8906 target=$0.3000
- Best stablecoin route tested: `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` amount=`4022463` readiness=`insufficient_data` net=$-1.3758
- Durable no-edge routes: 10

- Strategy note: BTC-family transfer by itself is usually loss-making after Gateway fee, gas, and slippage.
- Strategy note: the actionable target is a local executable BTC/stable dislocation that beats total movement cost.
- Strategy note: BTC accumulation from a long-term bullish view is directional inventory exposure, not arbitrage profit, so it must not unlock canary or live execution by itself.
- Strong-edge research: definite=0 multiLevel=0 missingDecay=0 singleLevel=0 noEdge=45 outliers=2
- DEX route universe: btcFamily=95 fullyMeasurable=30 singleGap=52 doubleGap=13
- DEX focus shortlist: loopObservable=10 partial=0 missingGatewayQuote=0
- Edge viability: measured=49 positive=0 policyReady=0 medianGap=$30.79
- Edge verdict: measured no-edge universe (The currently measurable closed-loop universe has been tested and still sits well below the minimum profit gate.)
- No-edge persistence: durable=10 belowPolicy=0 nearPolicy=0 positiveBelow=0
- Largest DEX coverage gap chain: `bitcoin` routeCount=23
- Best DEX focus route now: `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`loop_observable` gatewayQuotes=5 entryQuotes=5 exitQuotes=5 bestExec=$-0.4877
- DEX environment drift: monitored=62 staleLegs=161 unstableLegs=0 thinLiquidityLegs=0 singleSampleLegs=0
- Top DEX environment risk: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` class=`refresh_needed` staleLegs=3 unstableLegs=0 thinLiquidityLegs=0 singleSampleLegs=0
- Best research route now: `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`no_edge` profitableLevels=0/5 bestNet=$-0.4877
- Measured DEX+Gateway coverage: bothDexSupported=50 executable=57 measuredNet=49 exact=51 profitable=0
- Closest route to policy gate: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` net=$-0.5906 gapToPolicy=$0.8906 target=$0.3000
- Best persistence route now: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`durable_no_edge_route` measuredLevels=5 minGap=$0.8906 bestNet=$-0.5906
- Closest measured DEX+Gateway loop: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` netEdge=$-0.5906 amountGap=1.27% blockers=gateway_stale_src_gas_snapshot,gateway_exact_src_execution_gas_not_estimated,gateway_stale_dex_output_quote,non_positive_loop_net_edge
- Best stablecoin-related route now: `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` amount=`4022463` readiness=`insufficient_data` netEdge=$-1.3758
- Best closed stable->BTC->stable loop: none matched yet
- Closest loop blocker: amount gap 127.38% on `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` + `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Quote decay: 5s 0/83 · 15s 0/83 · 30s 0/83
- Chain price coverage: observed 6, stale 6, missing 3
- Quoteable chains observed: avalanche,base,bsc,ethereum,sonic,unichain
- Quoteable chains missing: none
- Non-quoteable chains: bera:DEX unsupported,bob:DEX unsupported,soneium:DEX unsupported
- Last canary advance: bob->base wBTC.OFT->wBTC.OFT (RUN_EXACT_GAS -> BLOCKED_NO_VIABLE_PREP_ROUTE; actions check-estimator-wallet, estimate-gateway-gas, score-gateway, status-dashboard)
- Route input freshness: quote stale (148.3m) · exactGas stale (148.2m) · srcGas stale (148.2m) · dex stale (148.2m) · btcFee not_needed · market stale (148.3m)
- Route input blockers: reject_no_net_edge
- Canary input watcher: refresh bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 inputs=gateway_quote,exact_gas,src_gas,dex_quote,market (current canary route inputs are stale)
- Gas refresh watcher: skip bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (gas freshness is not the active blocker)
- DEX refresh watcher: refresh route bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000; rescoring 1 wrapped-BTC route(s) (current canary route chain price is stale)
- Gateway coverage watcher: no fully measurable route shortlist yet
- Blocked-score watcher: skip bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (no new score inputs arrived)
- Quote-decay watcher: refresh bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (next decay window is due now; window 5s)
- estimator wallet checked routes: 5
- estimator skipped routes: 1
- skipped reasons: missing_tx_data:1

## Next Command Order After Funding

1. `npm run check:estimator-wallet -- --route-key="<routeKey>" --amount="<amount>"`
2. `npm run estimate:gateway-gas -- --from="0x96262be63aa687563789225c2fe898c27a3b0ae4" --route-key="<routeKey>" --amount="<amount>"`
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

