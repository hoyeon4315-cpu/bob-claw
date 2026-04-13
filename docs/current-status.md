# Current Status

Updated: 2026-04-13T21:20:00Z

## 🚨 Critical Finding

**31 live trades executed — ALL reverted (100% failure rate).**

Root cause: Odos aggregator routes through an oracle-based DEX (`0x1300cf84`) that provides phantom quotes (good off-chain prices that always revert on-chain due to stale `getBidAndAskPrice()`).

**Verification:**
| Routing mode | Profit (LBTC→cbBTC) |
|---|---|
| No filter (oracle DEX included) | +$6.16 (phantom, 100% revert) |
| Whitelist (safe AMMs only) | **-$0.39** (real, no arb edge) |

**Conclusion: No real triangular arbitrage edge exists on Base BTC derivatives with current market conditions.** The apparent profits were entirely artifacts of non-executable oracle pricing.

## Current Phase

- Phase: **EMERGENCY STOP** — all live trading halted
- Live trading: `BLOCKED` (emergency-stop.json active)
- Shadow trading: `ALLOWED` (whitelist-based monitoring active)
- Contract: `0xA16601ac5026FEda2DC2b087d50Dd133f48dfD09` (Base)
- Wallet: `0x96262bE63AA687563789225c2fE898c27a3b0AE4`
- Balance: ~0.00528 ETH (~$13.50)
- Total gas lost: ~$0.12 (31 reverted txs)

## Fix Applied

- `sourceBlacklist` → `sourceWhitelist` (24 proven AMMs)
- Commit: `53ac827` on `codex/treasury-risk-pipeline`
- Spread collector restarted with whitelist (5min interval, dry-run only)

## What Works

1. **Contract** — BalancerFlashArb.sol is correct (issue was routing, not contract)
2. **Pipeline** — trigger/collect/monitor scripts functional
3. **Whitelist routing** — eliminates phantom quotes
4. **Spread collector** — now collecting honest (executable) spread data

## What Doesn't Work

1. **Triangular arb profitability** — all 6 routes negative with safe DEXes
2. **Gateway cross-chain arb** — structurally impossible (LayerZero costs)
3. **Oracle DEX blacklist** — Odos doesn't match our blacklist names

## Next Steps (When User Returns)

1. **Monitor whitelist spreads** — wait for volatility events that create real spreads
2. **Euler V2 lending** — $900 USDC at 5-7% APY for passive yield ($0.12/day)
3. **Market conditions change** — BTC sharp moves can temporarily widen BTC derivative spreads
- Live execution: LIVE_EXECUTION_BLOCKED; audit=LIVE_BLOCKED (audit_blocks_live,stale_gas_snapshots)

## Best Route Right Now

- Route: `bob->base wBTC.OFT->wBTC.OFT`
- Route key: `bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000`
- txReady=true exactGasDone=true viableForPrep=false
- Input value: $7.10
- Prep funding estimate: $0.0000
- Net edge now: $-0.8107
- Objective score blocker: insufficient_data
- Next readiness check: `base->bob wBTC.OFT->wBTC.OFT` amount=`150000`
- Refresh status: ready to rerun the next wallet readiness check now

## Required Actions Before Exact Gas

- run exact gas for bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000

## Objective Verification

- This file does not execute validation by itself.
- Rerun `npm run check` before acting on code changes.
- Rerun `npm test` before acting on behavior assumptions.
- Candidate routes observed: 157
- txReady routes: 121
- viable prep routes: 0

## Shadow Roster

- active_canary route=`bob->base wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-0.8107 prepFunding=$0.0000 blockers=score:stale_src_gas_snapshot priority=evidence_accumulating evidence=shadow:34 quotes:17/17 success:100.0% p95:775ms fee:$0.7753 reasons:reject_effective_system_pnl:33,reject_treasury_execution_refill_cost:33,reject_no_net_edge:19,insufficient_data:15,stale_dex_output_quote:12
- tx_ready_shadow route=`avalanche->bera wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-0.5592 prepFunding=$0.0000 blockers=prep:wallet_not_checked,score:stale_src_gas_snapshot priority=thin_quote_samples evidence=shadow:2 quotes:1/1 success:100.0% p95:3598ms fee:$0.5238 reasons:exact_src_execution_gas_not_estimated:2,insufficient_data:2,reject_effective_system_pnl:2,reject_treasury_execution_refill_cost:2,stale_src_gas_snapshot:2
- tx_ready_shadow route=`avalanche->bob wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-0.7919 prepFunding=$0.0000 blockers=prep:wallet_not_checked,score:stale_src_gas_snapshot priority=evidence_accumulating evidence=shadow:8 quotes:2/2 success:100.0% p95:1579ms fee:$0.7565 reasons:exact_src_execution_gas_not_estimated:8,insufficient_data:8,reject_effective_system_pnl:8,reject_treasury_execution_refill_cost:8,stale_src_gas_snapshot:8
- tx_ready_shadow route=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000` txReady=true viableForPrep=false net=$-1.2730 prepFunding=$0.0000 blockers=prep:wallet_not_checked,score:stale_src_gas_snapshot,score:observe_only_ethereum_l1_phase_disabled priority=thin_quote_samples evidence=shadow:2 quotes:1/1 success:100.0% p95:796ms fee:$1.24 reasons:exact_src_execution_gas_not_estimated:2,reject_effective_system_pnl:2,reject_treasury_execution_refill_cost:2,stale_src_gas_snapshot:2,insufficient_data:1
- tx_ready_shadow route=`avalanche->soneium wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-0.6410 prepFunding=$0.0000 blockers=prep:wallet_not_checked,score:stale_src_gas_snapshot priority=thin_quote_samples evidence=shadow:2 quotes:1/1 success:100.0% p95:1009ms fee:$0.6056 reasons:exact_src_execution_gas_not_estimated:2,insufficient_data:2,reject_effective_system_pnl:2,reject_treasury_execution_refill_cost:2,stale_src_gas_snapshot:2

## Shadow Actions

- active_canary route=`bob->base wBTC.OFT->wBTC.OFT` next=refresh_exact_gas reason=stale_src_gas_snapshot command=`npm run estimate:gateway-gas -- --route-key="bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- tx_ready_shadow route=`avalanche->bera wBTC.OFT->wBTC.OFT` next=check_wallet_readiness reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- tx_ready_shadow route=`avalanche->bob wBTC.OFT->wBTC.OFT` next=check_wallet_readiness reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- tx_ready_shadow route=`avalanche->ethereum wBTC.OFT->WBTC` next=hold_policy_review reason=observe_only_ethereum_l1_phase_disabled
- tx_ready_shadow route=`avalanche->soneium wBTC.OFT->wBTC.OFT` next=check_wallet_readiness reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->soneium:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Refresh Queue

- rank=1 priority=100 scope=canary next=check_wallet_readiness reason=scheduled_readiness_check route=`base->bob wBTC.OFT->wBTC.OFT` amount=`150000` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="150000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=2 priority=90 scope=tx_ready_shadow next=check_wallet_readiness reason=wallet_not_checked route=`avalanche->bera wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=3 priority=90 scope=tx_ready_shadow next=check_wallet_readiness reason=wallet_not_checked route=`avalanche->bob wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=4 priority=89 scope=execution_review next=check_wallet_readiness reason=token route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=5 priority=88 scope=stable_loop next=expand_amount_ladder reason=amount_mismatch command=`npm run quote:dex -- --route-key="base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000" --include-stable-entry`
- rank=6 priority=86 scope=proxy_spread next=expand_amount_ladder reason=partial_amount_match proxyGroup=`wbtc` chains=avalanche,base,bsc,ethereum,sonic,unichain command=`npm run quote:dex -- --chains=avalanche,base,bsc,ethereum,sonic,unichain --include-stable-entry --route-limit=64`
- rank=7 priority=80 scope=active_canary next=refresh_exact_gas reason=stale_src_gas_snapshot route=`bob->base wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run estimate:gateway-gas -- --route-key="bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=8 priority=79 scope=strategy_discovery next=refresh_partial_loop_measurement reason=secondary_measured_loop route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run verify:gateway -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000" && npm run quote:dex -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --include-stable-entry && npm run score:gateway -- --write --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000"`

## Refresh Queue Execution

- Summary: runs=0 success=0 failed=0 preview=0 invalid=0 latest=none
- Recent executions: none

## Refresh Batch Loop

- Summary: runs=13 success=13 failed=0 blocked=0 invalid=0 latest=succeeded stopReason=none
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false

## Objective Plans

- Execution review: route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` status=`measured_route_under_review` next=`check_wallet_readiness` blockers=token,stale_src_gas_snapshot,exact_src_execution_gas_not_estimated,stale_dex_output_quote
- Execution review rationale: measured leader is not viable for prep yet; measured leader still needs exact gas; measured leader still needs wallet readiness checks; measured leader is still marked insufficient_data; measured leader still has score data gaps
- Execution review command: `npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Discovery candidate: route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000` source=`secondary_measured_loop` status=`partial_loop_measurement` next=`refresh_partial_loop_measurement` reason=`secondary_measured_loop`
- Discovery command: `npm run verify:gateway -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000" && npm run quote:dex -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --include-stable-entry && npm run score:gateway -- --write --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000"`

## Pivot Gate

- Pivot decision: `keep_researching` Keep researching within the current BOB Gateway thesis
- Pivot status: `execution_review` currentCanary=`drop` measuredLeader=`continue`
- Pivot focus route: `base->avalanche wBTC.OFT->wBTC.OFT` amount=`10000`
- Pivot next action: `check_wallet_readiness` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Pre-live Readiness

- Current stage: `shadow_replay`
- Shadow replay: `shadow_replay_blocked` blockers=audit:LIVE_BLOCKED,manual_canary_review_not_ready audit=LIVE_BLOCKED policyReady=2
- Mechanical simulation: `mechanical_simulation_blocked` success=0/50 failures=0 blockers=shadow_replay_not_ready,needs_50_more_successful_simulations
- Fork execution: `fork_execution_blocked` planned=1 submitted=0 confirmed=0/3 failures=0 blockers=mechanical_simulation_not_ready,needs_3_more_confirmed_fork_cycles
- Execution audit: `complete` missingRecords=0 blockers=none
- Tiny live canary review: `tiny_canary_blocked` blockers=shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready livePolicy=`BLOCKED`
- Pre-live commands: `npm run run:prelive-evidence-campaign` or `npm run run:prelive-simulations -- --source=objective --write` && `npm run plan:prelive-fork-execution -- --source=objective --write` && `npm run report:prelive-readiness -- --write` && `npm run build:prelive-review-package -- --write` && `npm run status:dashboard`
- Latest fork plan: route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000` status=`planned` source=`objective_execution_review`
- Recent execution transition: kind=`fork_plan` status=`planned` route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000`
- Queue follow-up: rank=1 scope=canary label=`base->bob wBTC.OFT->wBTC.OFT` reason=scheduled_readiness_check command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="150000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Queue follow-up: rank=2 scope=tx_ready_shadow label=`avalanche->bera wBTC.OFT->wBTC.OFT` reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Queue follow-up: rank=3 scope=tx_ready_shadow label=`avalanche->bob wBTC.OFT->wBTC.OFT` reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Queue follow-up: rank=4 scope=execution_review label=`base->avalanche wBTC.OFT->wBTC.OFT` reason=token command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Tiny Live Review Package

- Summary: status=`not_ready_for_manual_review` review=`NOT_READY_FOR_MANUAL_CANARY_REVIEW` live=`LIVE_EXECUTION_BLOCKED` stage=`shadow_replay` blockers=manual_review_stage_not_ready,shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready,stale_src_gas_snapshot,stale_gateway_quote,stale_exact_gas,stale_src_gas,stale_dex_quote,stale_market
- Tiny canary admission: decision=`NO_GO` status=`blocked` blockers=manual_review_stage_not_ready,shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready,stale_src_gas_snapshot,stale_gateway_quote,stale_exact_gas,stale_src_gas,stale_dex_quote,stale_market next=`clear_admission_blockers`
- Admission remediation: status=`ready` ready=9 manual=1 blocked=0
- Admission remediation runner: `npm run run:admission-remediation -- --execute --limit=1`
- Admission next action: `refresh_gateway_quote` status=`ready` command=`npm run verify:gateway -- --route-key="bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000"`
- Admission remediation item: rank=1 status=`ready` code=`refresh_gateway_quote` reason=stale_gateway_quote command=`npm run verify:gateway -- --route-key="bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000"`
- Admission remediation item: rank=2 status=`ready` code=`refresh_exact_gas` reason=stale_exact_gas command=`npm run estimate:gateway-gas -- --route-key="bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Admission remediation item: rank=3 status=`ready` code=`refresh_src_gas` reason=stale_src_gas command=`npm run gas:snapshot`
- Manual review candidate: route=`bob->base wBTC.OFT->wBTC.OFT` amount=`10000` readiness=`insufficient_data` net=$-0.8107 prepFunding=$0.0000 txReady=true viableForPrep=false
- Candidate inputs: quote stale (967.3m) · exactGas stale (967.0m) · srcGas stale (997.2m) · dex stale (969.0m) · btcFee not_needed · market stale (967.7m)
- Admission constraints: livePolicy=`BLOCKED` ring=`300` dailyLoss=`5` walletFloor=`250` minProfit=`0.3` minEdge=`0.005`
- Candidate blockers: stale_src_gas_snapshot; score gaps stale_src_gas_snapshot,stale_dex_output_quote
- Candidate evidence: shadow=34 quotes=17/17 success=100.0% p95=775ms routeFailure=3.1%
- Measured leader review: route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` readiness=`insufficient_data` measured=$27.73 executable=$27.84 next=`check_wallet_readiness`
- Leader review rationale: measured leader is not viable for prep yet; measured leader still needs exact gas; measured leader still needs wallet readiness checks; measured leader is still marked insufficient_data; measured leader still has score data gaps | blockers: source token balance missing, source gas snapshot stale, exact execution gas pending, DEX output quote stale
- ETH-family profitability: routes=0 measured=0 profitable=0 verdict=`no_measured_loops`
- ETH-family recommendation: `no_multichain_eth_family_surface` command=`npm run scan:quote-surface -- --route-key="base:0x0000000000000000000000000000000000000000->bitcoin:0x0000000000000000000000000000000000000000" && npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard`
- Pivot gate: decision=`keep_researching` status=`execution_review` currentCanary=`drop` measuredLeader=`continue`
- Review checklist: completed=top canary route selected · tx payload captured · wallet readiness cleared · exact gas captured remaining=refresh stale/missing inputs (gateway quote, exact gas, source gas, DEX quote, market) · rerun exact gas for the top route · advance canary beyond BLOCKED_NO_VIABLE_PREP_ROUTE
- Review transition: kind=`fork_plan` status=`planned` route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000`
- Review follow-up: rank=1 scope=canary label=`base->bob wBTC.OFT->wBTC.OFT` reason=scheduled_readiness_check command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="150000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Review follow-up: rank=2 scope=tx_ready_shadow label=`avalanche->bera wBTC.OFT->wBTC.OFT` reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Review follow-up: rank=3 scope=tx_ready_shadow label=`avalanche->bob wBTC.OFT->wBTC.OFT` reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Guardrail: Mechanical simulation uses RPC estimation and eth_call only; it is not realized execution proof.
- Guardrail: Pre-live execution audit requires plan, submission, receipt, and journal records to stay in sync.
- Guardrail: Fork execution requires an external signer and never stores private keys in planner or dashboard code.
- Guardrail: liveTrading remains BLOCKED until architecture review and explicit canary approval.

## Pre-live Evidence Campaign

- Summary: status=`awaiting_manual` reviewPackage=`not_ready_for_manual_review` stage=`shadow_replay` ready=0 manual=1 blocked=3 done=1
- Evidence progress: simulations=0/50 forkConfirmed=0/3 refreshRuns=13
- Next campaign action: code=`execute_refresh_batch` status=`blocked` reason=shadow_replay_policy_gate
- Campaign action: code=`execute_refresh_batch` status=`blocked` automated=true reason=shadow_replay_policy_gate
- Campaign action: code=`collect_simulation_evidence` status=`blocked` automated=true reason=shadow_replay_not_ready
- Campaign action: code=`prepare_fork_cycle` status=`done` automated=true reason=fork_plan_already_open
- Campaign action: code=`submit_fork_cycle` status=`manual` automated=false reason=external_signer_required command=`npm run submit:prelive-fork-execution -- --plan-id="0d9a9ed7eb6040170ef7" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"`
- Campaign action: code=`reconcile_fork_cycle` status=`blocked` automated=false reason=fork_submission_required_first

## Profitability Summary

- Overfit audit: LIVE_BLOCKED · sample=shadow_observations · horizon=46.4h · buckets=12
- Overfit blockers: shadow time window, time bucket diversity, fresh gas snapshots
- Overfit warnings: legacy records, gas snapshot failures
- Overfit runway: 121.6h remaining to 168h · 12 hourly buckets remaining to 24
- Overfit time ETA: shadow window 2026-04-18T12:00:56.658Z · bucket diversity 2026-04-13T22:00:00.000Z · earliest time-gate pass 2026-04-18T12:00:56.658Z

- Tested closed loops: 50
- Profitable closed loops: 1
- Loop-observable routes: 10
- Missing focus Gateway quotes: 0
- Profit verdict: policy-ready edge observed (At least one measured loop clears the minimum profit gate.)
- Current canary route: insufficient_data net=$27.59
- Closest route to policy: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` net=$27.73 gap=$0.0000 target=$0.3000
- Best stablecoin route tested: `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` amount=`200000` readiness=`observe_only_slow_settlement` net=$-0.4120
- ETH-family routes: 0 family / 32 ETH-related gateway routes; measurable=0 loopObservable=0 stable=0
- ETH-family loops: measured=0 profitable=0 policyBlocked=56
- ETH-family loop verdict: no measured loops yet (No closed measured loop is available yet.)
- ETH-family recommendation: No chain-to-chain ETH family Gateway surface yet (Current ETH-related routes are still dominated by BTC<->ETH or Ethereum-L1 touchpoints, not pure ETH-on-ETH cross-chain loops.)
- Closest ETH-family route to policy: none observed
- Best ETH-family research route: `base:0x0000000000000000000000000000000000000000->bitcoin:0x0000000000000000000000000000000000000000` class=`unknown` readiness=`insufficient_data` net=$-1.3457
- ETH-family next action: `watch_eth_family_surface` command=`npm run scan:quote-surface -- --route-key="base:0x0000000000000000000000000000000000000000->bitcoin:0x0000000000000000000000000000000000000000" && npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard`
- ETH-family overfit risks: thin_quote_samples,single_route_surface,narrow_amount_surface,single_amount_level_per_route,narrow_quote_time_coverage
- Measured leader under review: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` measured=$27.73 readiness=`insufficient_data`
- Why it is not the canary: measured leader is not viable for prep yet; measured leader still needs exact gas; measured leader still needs wallet readiness checks; measured leader is still marked insufficient_data; measured leader still has score data gaps | blockers: source token balance missing, source gas snapshot stale, exact execution gas pending, DEX output quote stale
- Revalidation order for measured leader: wallet readiness check -> exact gas estimate -> DEX quote refresh -> selective route scoring -> status dashboard refresh
- Revalidation commands: npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run estimate:gateway-gas -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run quote:dex -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run score:gateway -- --write --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run status:dashboard
- Hypothesis guard: Positive measured edge is still a hypothesis until wallet, gas, and exact execution inputs are all fresh.
- Durable no-edge routes: 9

- Strategy note: BTC-family transfer by itself is usually loss-making after Gateway fee, gas, and slippage.
- Strategy note: the actionable target is a local executable BTC/stable dislocation that beats total movement cost.
- Strategy note: BTC accumulation from a long-term bullish view is directional inventory exposure, not arbitrage profit, so it must not unlock canary or live execution by itself.
- Strong-edge research: definite=0 multiLevel=0 missingDecay=0 singleLevel=0 noEdge=80 outliers=0
- DEX route universe: btcFamily=91 fullyMeasurable=30 singleGap=48 doubleGap=13
- DEX focus shortlist: loopObservable=10 partial=0 missingGatewayQuote=0
- Edge viability: measured=20 positive=2 policyReady=2 medianGap=$30.69
- Edge verdict: policy-ready edge observed (At least one measured loop clears the minimum profit gate.)
- No-edge persistence: durable=9 belowPolicy=0 nearPolicy=0 positiveBelow=0
- Largest DEX coverage gap chain: `bitcoin` routeCount=19
- Best DEX focus route now: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`loop_observable` gatewayQuotes=6 entryQuotes=13 exitQuotes=15 bestExec=$27.84
- DEX environment drift: monitored=91 staleLegs=196 unstableLegs=0 thinLiquidityLegs=0 singleSampleLegs=0
- Top DEX environment risk: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` class=`refresh_needed` staleLegs=3 unstableLegs=0 thinLiquidityLegs=0 singleSampleLegs=0
- Best research route now: `bitcoin:0x0000000000000000000000000000000000000000->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`no_edge` profitableLevels=0/5 bestNet=$133.80
- Measured DEX+Gateway coverage: bothDexSupported=70 executable=74 measuredNet=50 exact=51 profitable=1
- Closest route to policy gate: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` net=$27.73 gapToPolicy=$0.0000 target=$0.3000
- Best persistence route now: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`policy_ready_route` measuredLevels=5 minGap=$0.0000 bestNet=$27.73
- Best measured DEX+Gateway loop: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` netEdge=$27.73 amountGap=1.66%
- Best stablecoin-related route now: `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` amount=`200000` readiness=`observe_only_slow_settlement` netEdge=$-0.4120
- Best closed stable->BTC->stable loop: none matched yet
- Stable amount ladder: pair=`base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` + `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` entryLevels=1 exitLevels=4 exact=0 closestGap=127.38%
- Closest loop blocker: amount gap 4447.52% on `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` + `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Proxy spread surface: buyQuotes=15 sellQuotes=51 opportunities=75 policyReady=0 overfit=moderate_overfit_risk
- Proxy coverage target: group=`wbtc` next=`expand_amount_ladder` reason=`partial_amount_match` buyLevels=6 sellLevels=21 matchedLevels=6
- Stable loop refresh command: `npm run quote:dex -- --route-key="base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000" --include-stable-entry`
- Proxy spread refresh command: `npm run quote:dex -- --chains=avalanche,base,bsc,ethereum,sonic,unichain --include-stable-entry --route-limit=64`
- Objective discovery plan: route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000` next=`refresh_partial_loop_measurement` reason=`secondary_measured_loop`
- Strategy track stable_loop: label=`base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000 + bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` status=`blocked_loop` next=`expand_amount_ladder` reason=`amount_mismatch`
- Strategy track proxy_spread: label=`ethereum->unichain WBTC/wBTC.OFT` status=`thin_coverage` next=`expand_amount_ladder` reason=`partial_amount_match`
- Strategy track eth_family_loop: label=`base:0x0000000000000000000000000000000000000000->bitcoin:0x0000000000000000000000000000000000000000` status=`unobserved` next=`watch_eth_family_surface` reason=`no_multichain_eth_family_surface` command=`npm run scan:quote-surface -- --route-key="base:0x0000000000000000000000000000000000000000->bitcoin:0x0000000000000000000000000000000000000000" && npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard`
- Quote decay: 5s 7/10 · 15s 7/10 · 30s 7/10
- Chain price coverage: observed 6, stale 6, missing 3
- Quoteable chains observed: avalanche,base,bsc,ethereum,sonic,unichain
- Quoteable chains missing: none
- Non-quoteable chains: bera:DEX unsupported,bob:DEX unsupported,soneium:DEX unsupported
- BTC watchlist observed live: BTC, uniBTC, WBTC, wBTC.OFT
- BTC watchlist missing from live routes: FBTC, LBTC, solvBTC, SolvBTC.BBN, tBTC, xSolvBTC
- BTC watchlist unknown addresses: base:0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189
- Last canary advance: bob->base wBTC.OFT->wBTC.OFT (BLOCKED_NO_VIABLE_PREP_ROUTE -> BLOCKED_NO_VIABLE_PREP_ROUTE; actions no_actions)
- Route input freshness: quote stale (967.3m) · exactGas stale (967.0m) · srcGas stale (997.2m) · dex stale (969.0m) · btcFee not_needed · market stale (967.7m)
- Route input blockers: stale_src_gas_snapshot; score gaps stale_src_gas_snapshot,stale_dex_output_quote
- Canary input watcher: refresh bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 inputs=gateway_quote,exact_gas,src_gas,dex_quote,market (current canary route inputs are stale)
- Gas refresh watcher: skip bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (gas refresh not needed right now)
- DEX refresh watcher: refresh route bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000; rescoring 1 wrapped-BTC route(s) (current canary route chain price is stale)
- Gateway coverage watcher: no fully measurable route shortlist yet
- Blocked-score watcher: skip bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (blocked-score refresh not needed right now)
- Quote-decay watcher: refresh bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (next decay window is due now; window 5s)
- estimator wallet checked routes: 37
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
- `src/prelive/execution-sim.mjs`
- `src/prelive/fork-execution.mjs`
- `src/prelive/readiness.mjs`
- `src/prelive/review-package.mjs`
- `src/prelive/evidence-campaign.mjs`
- `src/cli/run-prelive-simulations.mjs`
- `src/cli/report-prelive-readiness.mjs`
- `src/cli/build-prelive-review-package.mjs`
- `src/cli/run-prelive-evidence-campaign.mjs`
- `src/cli/plan-prelive-fork-execution.mjs`
- `src/cli/submit-prelive-fork-execution.mjs`
- `src/cli/reconcile-prelive-fork-execution.mjs`
- `src/strategy/objective-plans.mjs`
- `src/session/shadow-refresh-runner.mjs`
- `src/cli/run-shadow-refresh-queue.mjs`
- `src/session/shadow-refresh-batch.mjs`
- `src/cli/run-shadow-refresh-batch.mjs`
- `docs/current-status.md`

## Backup Note

- `.env` and `data/` stay out of git.
- This repo is safe to back up publicly only if you are comfortable exposing source; operational secrets are ignored by git.
- Prefer a private GitHub repo for backup.

