# Current Status

Updated: 2026-04-12T00:27:55.632Z

## Start Here

- Read this file first in a shallow session.
- Main command: `npm run advance:canary`
- Safe status refresh: `npm run audit:overfit && npm run score:gateway -- --write && npm run status:dashboard`

## Current Phase

- Address: `0x96262be63aa687563789225c2fe898c27a3b0ae4`
- Phase: canary-prep gating before exact gas
- Decision: `BLOCKED_NO_VIABLE_PREP_ROUTE`
- Headline: Best prepared route still fails objective score review
- Live trading: `BLOCKED`
- Shadow trading: `ALLOWED`

## Progress Snapshot

- Completed so far: top canary route selected · tx payload captured · wallet readiness cleared · exact gas captured
- Remaining steps: clear objective blocker (reject_no_net_edge) · advance canary beyond BLOCKED_NO_VIABLE_PREP_ROUTE
- Manual canary review: NOT_READY_FOR_MANUAL_CANARY_REVIEW (reject_no_net_edge)
- Live execution: LIVE_EXECUTION_BLOCKED; audit=LIVE_BLOCKED (audit_blocks_live)

## Best Route Right Now

- Route: `bob->base wBTC.OFT->wBTC.OFT`
- Route key: `bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000`
- txReady=true exactGasDone=true viableForPrep=true
- Input value: $7.33
- Prep funding estimate: $0.0000
- Net edge now: $-0.8473
- Objective score blocker: reject_no_net_edge (net edge $-0.8473)
- Next readiness check: `base->avalanche wBTC.OFT->wBTC.OFT` amount=`100000`
- Refresh status: ready to rerun the next wallet readiness check now
- Next focus: rerun quotes, gas, or token prices only when market inputs change; wallet readiness is no longer the blocker

## Required Actions Before Exact Gas

- none

## Objective Verification

- This file does not execute validation by itself.
- Rerun `npm run check` before acting on code changes.
- Rerun `npm test` before acting on behavior assumptions.
- Candidate routes observed: 156
- txReady routes: 119
- viable prep routes: 89

## Profitability Summary

- Overfit audit: LIVE_BLOCKED · sample=shadow_observations · horizon=12.4h · buckets=7
- Overfit blockers: shadow time window, time bucket diversity
- Overfit warnings: legacy records, gas snapshot failures
- Overfit runway: 155.6h remaining to 168h · 17 hourly buckets remaining to 24
- Overfit time ETA: shadow window 2026-04-18T12:00:56.658Z · bucket diversity 2026-04-12T17:00:00.000Z · earliest time-gate pass 2026-04-18T12:00:56.658Z

- Tested closed loops: 49
- Profitable closed loops: 6
- Loop-observable routes: 10
- Missing focus Gateway quotes: 0
- Profit verdict: policy-ready edge observed (At least one measured loop clears the minimum profit gate.)
- Current canary route: reject_no_net_edge net=$-0.8483
- Closest route to policy: `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` net=$64.77 gap=$0.0000 target=$0.3000
- Best stablecoin route tested: `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` amount=`4022463` readiness=`insufficient_data` net=$-1.3555
- Measured leader under review: `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` measured=$64.77 readiness=`insufficient_data`
- Why it is not the canary: current canary is the only viable prep route; measured leader is not viable for prep yet; measured leader still needs exact gas; measured leader still needs wallet readiness checks; measured leader is still marked insufficient_data; measured leader still has score data gaps | blockers: native gas balance missing, source token balance missing, allowance approval missing, source gas snapshot stale, exact execution gas pending, DEX output quote stale
- Revalidation order for measured leader: wallet readiness check -> exact gas estimate -> DEX quote refresh -> selective route scoring -> status dashboard refresh
- Revalidation commands: npm run check:estimator-wallet -- --route-key="ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run estimate:gateway-gas -- --route-key="ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run quote:dex -- --route-key="ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run score:gateway -- --write --route-key="ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run status:dashboard
- Hypothesis guard: Positive measured edge is still a hypothesis until wallet, gas, and exact execution inputs are all fresh.
- Durable no-edge routes: 6

- Strategy note: BTC-family transfer by itself is usually loss-making after Gateway fee, gas, and slippage.
- Strategy note: the actionable target is a local executable BTC/stable dislocation that beats total movement cost.
- Strategy note: BTC accumulation from a long-term bullish view is directional inventory exposure, not arbitrage profit, so it must not unlock canary or live execution by itself.
- Strong-edge research: definite=0 multiLevel=0 missingDecay=0 singleLevel=0 noEdge=70 outliers=2
- DEX route universe: btcFamily=93 fullyMeasurable=30 singleGap=50 doubleGap=13
- DEX focus shortlist: loopObservable=10 partial=0 missingGatewayQuote=0
- Edge viability: measured=49 positive=6 policyReady=6 medianGap=$20.02
- Edge verdict: policy-ready edge observed (At least one measured loop clears the minimum profit gate.)
- No-edge persistence: durable=6 belowPolicy=0 nearPolicy=0 positiveBelow=0
- Largest DEX coverage gap chain: `bitcoin` routeCount=21
- Best DEX focus route now: `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`loop_observable` gatewayQuotes=9 entryQuotes=8 exitQuotes=7 bestExec=$64.97
- DEX environment drift: monitored=89 staleLegs=181 unstableLegs=3 thinLiquidityLegs=0 singleSampleLegs=0
- Top DEX environment risk: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`150000` class=`refresh_needed` staleLegs=3 unstableLegs=0 thinLiquidityLegs=0 singleSampleLegs=0
- Best research route now: `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`no_edge` profitableLevels=0/5 bestNet=$64.97
- Measured DEX+Gateway coverage: bothDexSupported=62 executable=73 measuredNet=49 exact=56 profitable=6
- Closest route to policy gate: `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` net=$64.77 gapToPolicy=$0.0000 target=$0.3000
- Best persistence route now: `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`policy_ready_route` measuredLevels=5 minGap=$0.0000 bestNet=$64.77
- Best measured DEX+Gateway loop: `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` netEdge=$64.77 amountGap=1.77%
- Best stablecoin-related route now: `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` amount=`4022463` readiness=`insufficient_data` netEdge=$-1.3555
- Best closed stable->BTC->stable loop: none matched yet
- Closest loop blocker: amount gap 127.38% on `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` + `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Quote decay: 5s 3/4 · 15s 3/4 · 30s 3/4
- Chain price coverage: observed 6, stale 0, missing 3
- Quoteable chains observed: avalanche,base,bsc,ethereum,sonic,unichain
- Quoteable chains missing: none
- Non-quoteable chains: bera:DEX unsupported,bob:DEX unsupported,soneium:DEX unsupported
- BTC watchlist observed live: BTC, solvBTC, uniBTC, WBTC, wBTC.OFT
- BTC watchlist missing from live routes: FBTC, LBTC, SolvBTC.BBN, tBTC, xSolvBTC
- BTC watchlist unknown addresses: none
- Last canary advance: bob->base wBTC.OFT->wBTC.OFT (BLOCKED_NO_VIABLE_PREP_ROUTE -> BLOCKED_NO_VIABLE_PREP_ROUTE; actions no_actions)
- Route input freshness: quote fresh (10.4m) · exactGas fresh (28.6m) · srcGas fresh (9.9m) · dex fresh (12.1m) · btcFee not_needed · market fresh (2.6m)
- Route input blockers: reject_no_net_edge
- Canary input watcher: skip bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (current canary route inputs are fresh)
- Gas refresh watcher: skip bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (gas freshness is not the active blocker)
- DEX refresh watcher: skip avalanche,base,bsc,ethereum,sonic,unichain; rescoring 1 wrapped-BTC route(s) (observed chain prices are fresh)
- Gateway coverage watcher: no fully measurable route shortlist yet
- Blocked-score watcher: skip bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (no new score inputs arrived)
- Quote-decay watcher: refresh bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (next decay window is due now; window 5s)
- estimator wallet checked routes: 14
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

