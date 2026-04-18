# Current Status

Updated: 2026-04-18T01:11:30.039Z

## Start Here

- Read this file first in a shallow session.
- Main command: `npm run advance:canary`
- Decision-pack refresh: `npm run build:prelive-decision-pack`
- Queue preview: `npm run run:shadow-refresh-queue -- --limit=3`
- Batch preview: `npm run run:shadow-refresh-batch -- --limit=1`
- Evidence campaign preview: `npm run run:prelive-evidence-campaign`
- Safe status refresh: `npm run audit:overfit && npm run score:gateway -- --write && npm run status:dashboard`
- Payback preview: `npm run report:payback-status -- --json`
- Live baseline preview: `npm run report:live-baseline -- --json`
- V1 infra drills preview: `npm run report:v1-infra-drills -- --json`
- Pivot plan refresh: `npm run report:pivot-plan -- --write`
- Strategy snapshot refresh: `npm run report:strategy-snapshot -- --write`
- Deterministic candidate refresh: `npm run report:deterministic-strategy-candidates -- --write`
- Connected refresh pack: `npm run report:connected-refresh-package -- --write`
- Current-route pass report: `npm run report:current-route-prelive-pass -- --write`
- Connected pre-live pass: `npm run run:current-route-prelive-pass -- --execute`
- Execution runbook refresh: `npm run report:execution-runbook -- --write`
- Exact-route fork pack: `npm run report:exact-route-fork-package -- --write`
- Yield shadow book refresh: `npm run report:yield-shadow-book -- --write`
- Proxy coverage refresh: `npm run report:proxy-spread-coverage -- --write`
- Pre-live readiness refresh: `npm run report:prelive-readiness -- --write`
- Pre-live validation refresh: `npm run validate:prelive-readiness -- --write`
- Operational judgment refresh: `npm run report:operational-judgment-review -- --write`
- Review package refresh: `npm run build:prelive-review-package -- --write`
- Fork execution planning: `npm run plan:prelive-fork-execution -- --source=objective --write`

## One-page Execution Brief

- Status: live=`BLOCKED` shadow=`ALLOWED` next=`RUN_EXACT_GAS`
- Strategy pack: implemented=8 top=`stablecoin_entry_exit_loops` pivot=`gateway_base_btc_yield`
- Research board: candidates=6 top=`recursive_wrapped_btc_lending_loop` newTop=`recursive_wrapped_btc_lending_loop` nextNew=`collect_recursive_loop_observed_receipts`
- Deterministic builds: candidates=6 readyForDryRun=2 top=`recursive_wrapped_btc_lending_loop` next=`collect_recursive_loop_observed_receipts`
- Pivot headline: `gateway_base_btc_yield` capital pilot=$105.00 next=`build_deterministic_yield_shadow_book`
- Capital mode: per_strategy_caps defaultYieldFitsReference=n/a
- Yield paper lanes: pilot=$105.00 diversified=$205.00 default=$338.33
- Proxy lane: proxy=`wbtc` action=`expand_amount_ladder` quota=60
- Canary lane: route=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000` exactGas=`npm run estimate:gateway-gas -- --from="0x96262be63aa687563789225c2fe898c27a3b0ae4" --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000"`
- Validation: status=`blocked` nextStage=`shadow_replay` nextAction=`check_wallet_readiness`
- Live baseline: stage=`shadow_replay` refreshInputs=0 operator=0 technical=0 objective=2 next=`technical_ready_but_economic_blocked`
- Payback: scheduler=`carry` reason=`planned_payback_below_minimum` pending=`281 sats` next=`none`
- Connected refresh: status=`reevaluation_ready` required=0 next=`rescore_route`
- Refresh runner state: runs=14 preview=1 latest=`failed` remaining=4
- V1 infra drills: status=`passed` passed=5/5 next=`advance_v2_live_canaries`
- Connected pre-live pass: `npm run run:current-route-prelive-pass -- --execute`
- Current-route pass report: `npm run report:current-route-prelive-pass -- --write`
- Fork prep: exactPlan=`planned` planId=`0e5fcf68dab023c390ed`
- Exact-route fork split: status=`technical_ready_economic_blocked` technical=`submit_ready` economic=`blocked_insufficient_data`
- Judgment review: status=`guarded_blocked` issues=3 high=2
- Safe local command order:
-   1) `npm run report:strategy-snapshot -- --write`
-   2) `npm run report:connected-refresh-package -- --write`
-   3) `npm run report:execution-runbook -- --write`
-   4) `npm run report:exact-route-fork-package -- --write`
-   5) `npm run validate:prelive-readiness -- --write`
-   6) `npm run report:operational-judgment-review -- --write`
-   7) `npm run report:yield-shadow-book -- --write && npm run report:proxy-spread-coverage -- --write`
-   8) `npm run audit:overfit && npm run score:gateway -- --write && npm run status:dashboard`
-   9) `npm run report:payback-status -- --json`
-   10) `npm run write:session-handoff`
- Networked operator runtime only: `npm run quote:dex -- --chains=base,bsc,ethereum --include-stable-entry --route-limit=64 && npm run score:gateway -- --write && npm run report:btc-proxy-spreads && npm run report:proxy-spread-coverage -- --write`
- Decision lock: keep live execution blocked; treat all new samples as research until policy and anti-overfit gates clear.

## Strategy Snapshot

- Strategy snapshot: implemented=8 candidates=0 capitalMode=per_strategy_caps
- Top implemented strategy: `stablecoin_entry_exit_loops` status=`measured_below_policy` reason=`amount_mismatch`
- Top pivot: `gateway_base_btc_yield` status=`pre_execution_blueprint` pilot=$105.00
- Research board: candidates=6 top=`recursive_wrapped_btc_lending_loop` newTop=`recursive_wrapped_btc_lending_loop` status=`dry_run_evidence_recorded` nextNew=`collect_recursive_loop_observed_receipts`
- Deterministic builds: candidates=6 readyForDryRun=2 receiptBacked=2 top=`recursive_wrapped_btc_lending_loop` next=`collect_recursive_loop_observed_receipts`
- Strategy next action: `build_deterministic_yield_shadow_book`
- Strategy lane: `gateway_wrapped_btc_loops` status=`analysis_only`
- Strategy lane: `btc_proxy_spreads` status=`thin_coverage` floor=$7.56
- Strategy lane: `stablecoin_entry_exit_loops` status=`measured_below_policy`

## V1 Infra Drills

- V1 infra drills: status=`passed` passed=5/5
- V1 next action: `advance_v2_live_canaries` command=`npm run report:tiny-live-canary-rollout -- --write`
- V1 top failed drill: none

## Execution Runbook

- Runbook: currentStage=`shadow_replay` completed=0/4 blocked=4 reviewReady=false
- Runbook next action: `check_wallet_readiness` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Exact-route fork plan: status=`planned` planId=`0e5fcf68dab023c390ed` submit=`npm run submit:prelive-fork-execution -- --plan-id="0e5fcf68dab023c390ed" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"`
- Stage: `shadow_replay` state=`blocked` status=`shadow_replay_blocked` blockers=audit:LIVE_BLOCKED,manual_canary_review_not_ready,no_policy_ready_measured_route
- Stage: `mechanical_simulation` state=`blocked` status=`mechanical_simulation_blocked` blockers=shadow_replay_not_ready,simulation_failures_present
- Stage: `fork_execution` state=`blocked` status=`fork_execution_blocked` blockers=mechanical_simulation_not_ready,needs_3_more_confirmed_fork_cycles
- Stage: `manual_canary_review` state=`blocked` status=`not_ready_for_manual_review` blockers=manual_review_stage_not_ready,shadow_replay_not_ready,mechanical_simulation_not_ready

## Pre-live Validation

- Validation: status=`blocked` readiness=0% blockers=10 warnings=4
- Validation next step: stage=`shadow_replay` action=`check_wallet_readiness` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Validation headline: topStrategy=`stablecoin_entry_exit_loops` topPivot=`gateway_base_btc_yield`

## Connected Refresh Package

- Connected refresh: status=`reevaluation_ready` route=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000` required=0
- Refresh next step: action=`rescore_route` command=`npm run score:gateway -- --write --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000"`
- Refresh runner: preview=`npm run run:connected-refresh-package` execute=`npm run run:connected-refresh-package -- --execute`
- Refresh chain: `npm run score:gateway -- --write --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" && npm run advance:canary && npm run build:prelive-review-package -- --write && npm run validate:prelive-readiness -- --write && npm run write:session-handoff`
- Refresh execution: runs=14 preview=1 success=10 partial=0 failed=4 latest=`failed`
- Refresh execution next: action=`refresh_exact_gas` command=`npm run estimate:gateway-gas -- --from="0x96262be63aa687563789225c2fe898c27a3b0ae4" --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000"`
- Current-route pre-live pass: runs=12 preview=1 readyForSigner=0 blocked=12 partial=0 failed=0 latest=`blocked_insufficient_data`
- Current-route pass next: action=`hold_negative_edge`

## Exact-route Fork Package

- Exact-route fork package: status=`technical_ready_economic_blocked` planId=`0e5fcf68dab023c390ed` route=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000`
- Fork readiness split: technical=`submit_ready` economic=`blocked_insufficient_data`
- Fork evidence: simulation=0/50 fork=0/3
- Fork next step: action=`hold_negative_edge`

## Operational Judgment Review

- Operational judgment: status=`guarded_blocked` issues=3 high=2 medium=1
- Judgment next step: action=`technical_ready_but_economic_blocked` command=`npm run score:gateway -- --write --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" && npm run advance:canary && npm run build:prelive-review-package -- --write && npm run validate:prelive-readiness -- --write && npm run write:session-handoff`
- Judgment issue: `technical_ready_but_economic_blocked` severity=`high` headline=Exact-route fork plan is technically ready but still economically blocked
- Judgment issue: `measured_leader_differs_from_current_canary` severity=`medium` headline=Measured leader and current canary route diverge
- Judgment issue: `prelive_evidence_still_incomplete` severity=`high` headline=Pre-live evidence is still incomplete

## Live Baseline

- Baseline: status=`blocked` stage=`shadow_replay` route=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000`
- Blocker counts: refreshInputs=0 operator=0 technical=0 objective=0 total=0
- Refresh blocker: none
- Operator blocker: none
- Technical blocker: none
- Objective blocker: none
- Baseline next action: category=`none` code=`none`

## Current Phase

- Address: `0x96262be63aa687563789225c2fe898c27a3b0ae4`
- Phase: canary-prep gating before exact gas
- Decision: `RUN_EXACT_GAS`
- Headline: Run exact gas estimate for the best prepared route
- Live trading: `BLOCKED`
- Shadow trading: `ALLOWED`

## Payback Readiness

- Scheduler: status=`carry` reason=`planned_payback_below_minimum` next=`none`
- Balances: pending=`281 sats` grossProfitPeriod=`281 sats` lifetimePaid=`0 sats`
- Last settled: none yet
- Preview command: `npm run report:payback-status -- --json`

## Progress Snapshot

- Completed so far: top canary route selected · tx payload captured · wallet readiness cleared
- Remaining steps: rerun exact gas for the top route · advance canary beyond RUN_EXACT_GAS
- Manual canary review: NOT_READY_FOR_MANUAL_CANARY_REVIEW (exact_src_execution_gas_not_estimated)
- Live execution: LIVE_EXECUTION_BLOCKED; audit=LIVE_BLOCKED (audit_blocks_live,stale_gas_snapshots)

## Best Route Right Now

- Route: `avalanche->ethereum wBTC.OFT->WBTC`
- Route key: `avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` amount=`10000`
- txReady=true exactGasDone=false viableForPrep=true
- Input value: $7.75
- Prep funding estimate: $0.0000
- Net edge now: $-1.2463
- Objective score blocker: insufficient_data
- Next readiness check: `unichain->bera wBTC.OFT->wBTC.OFT` amount=`10000`
- Refresh status: ready to rerun the next wallet readiness check now

## Required Actions Before Exact Gas

- run exact gas for avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 amount=10000

## Objective Verification

- This file does not execute validation by itself.
- Rerun `npm run check` before acting on code changes.
- Rerun `npm test` before acting on behavior assumptions.
- Candidate routes observed: 172
- txReady routes: 122
- viable prep routes: 1

## Shadow Roster

- active_canary route=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000` txReady=true viableForPrep=true net=$-1.2463 prepFunding=$0.0000 blockers=none priority=high_quote_latency evidence=shadow:24 quotes:11/11 success:100.0% p95:5382ms fee:$1.21 reasons:reject_effective_system_pnl:24,reject_treasury_execution_refill_cost:24,exact_src_execution_gas_not_estimated:21,insufficient_data:12
- tx_ready_shadow route=`avalanche->soneium wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-0.6456 prepFunding=$0.0000 blockers=score:stale_src_gas_snapshot priority=evidence_accumulating evidence=shadow:11 quotes:2/2 success:100.0% p95:1009ms fee:$0.6080 reasons:exact_src_execution_gas_not_estimated:11,insufficient_data:11,reject_effective_system_pnl:11,reject_treasury_execution_refill_cost:11,stale_src_gas_snapshot:10
- tx_ready_shadow route=`bsc->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-0.6133 prepFunding=$0.0000 blockers=prep:wallet_not_checked,score:stale_src_gas_snapshot priority=evidence_accumulating evidence=shadow:13 quotes:2/2 success:100.0% p95:448ms fee:$0.5757 reasons:exact_src_execution_gas_not_estimated:13,insufficient_data:13,reject_effective_system_pnl:13,reject_treasury_execution_refill_cost:13,stale_src_gas_snapshot:11
- tx_ready_shadow route=`bsc->base wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-1.1493 prepFunding=$0.0000 blockers=prep:wallet_not_checked,score:stale_src_gas_snapshot priority=evidence_accumulating evidence=shadow:12 quotes:2/2 success:100.0% p95:426ms fee:$1.11 reasons:exact_src_execution_gas_not_estimated:12,insufficient_data:12,reject_effective_system_pnl:12,reject_treasury_execution_refill_cost:12,stale_src_gas_snapshot:11
- tx_ready_shadow route=`bsc->ethereum wBTC.OFT->WBTC` amount=`10000` txReady=true viableForPrep=false net=$-1.1831 prepFunding=$0.0000 blockers=prep:wallet_not_checked,score:stale_src_gas_snapshot priority=evidence_accumulating evidence=shadow:12 quotes:2/2 success:100.0% p95:488ms fee:$1.15 reasons:exact_src_execution_gas_not_estimated:12,reject_effective_system_pnl:12,reject_treasury_execution_refill_cost:12,stale_src_gas_snapshot:11,insufficient_data:3

## Shadow Actions

- active_canary route=`avalanche->ethereum wBTC.OFT->WBTC` next=refresh_exact_gas reason=exact_src_execution_gas_not_estimated command=`npm run estimate:gateway-gas -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- tx_ready_shadow route=`avalanche->soneium wBTC.OFT->wBTC.OFT` next=refresh_exact_gas reason=stale_src_gas_snapshot command=`npm run estimate:gateway-gas -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->soneium:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- tx_ready_shadow route=`bsc->avalanche wBTC.OFT->wBTC.OFT` next=check_wallet_readiness reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="bsc:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- tx_ready_shadow route=`bsc->base wBTC.OFT->wBTC.OFT` next=check_wallet_readiness reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="bsc:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- tx_ready_shadow route=`bsc->ethereum wBTC.OFT->WBTC` next=check_wallet_readiness reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="bsc:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Refresh Queue

- rank=1 priority=100 scope=canary next=check_wallet_readiness reason=scheduled_readiness_check route=`unichain->bera wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=2 priority=90 scope=tx_ready_shadow next=check_wallet_readiness reason=wallet_not_checked route=`bsc->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="bsc:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=3 priority=90 scope=tx_ready_shadow next=check_wallet_readiness reason=wallet_not_checked route=`bsc->base wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="bsc:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=4 priority=89 scope=execution_review next=check_wallet_readiness reason=native route=`base->ethereum wBTC.OFT->WBTC` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=5 priority=88 scope=stable_loop next=expand_amount_ladder reason=amount_mismatch command=`npm run quote:dex -- --route-key="bsc:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d->bitcoin:0x0000000000000000000000000000000000000000" --include-stable-entry`
- rank=6 priority=86 scope=proxy_spread next=expand_amount_ladder reason=partial_amount_match proxyGroup=`wbtc` chains=base,bsc,ethereum command=`npm run quote:dex -- --chains=base,bsc,ethereum --include-stable-entry --route-limit=64`
- rank=7 priority=80 scope=active_canary next=refresh_exact_gas reason=exact_src_execution_gas_not_estimated route=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000` command=`npm run estimate:gateway-gas -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=8 priority=80 scope=tx_ready_shadow next=refresh_exact_gas reason=stale_src_gas_snapshot route=`avalanche->soneium wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run estimate:gateway-gas -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->soneium:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Refresh Queue Execution

- Summary: runs=0 success=0 failed=0 preview=0 invalid=0 latest=none
- Recent executions: none

## Refresh Batch Loop

- Summary: runs=28 success=28 failed=0 blocked=0 invalid=0 latest=succeeded stopReason=none
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=4 queueSuccess=4 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=4 queueSuccess=4 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false

## Objective Plans

- Execution review: route=`base->ethereum wBTC.OFT->WBTC` amount=`10000` status=`measured_hypothesis_under_review` next=`check_wallet_readiness` blockers=native,token,stale_src_gas_snapshot,exact_src_execution_gas_not_estimated,stale_dex_output_quote
- Execution review rationale: current canary is the only viable prep route; measured leader is not viable for prep yet; measured leader still needs exact gas; measured leader still needs wallet readiness checks; measured leader is still marked insufficient_data; measured leader still has score data gaps
- Execution review command: `npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Pivot Gate

- Pivot decision: `stay_blocked` Stay blocked and keep collecting evidence before any canary promotion
- Pivot status: `stay_blocked` currentCanary=`observe_only` measuredLeader=`drop`
- Pivot focus route: `base->ethereum wBTC.OFT->WBTC` amount=`10000`
- Pivot next action: none

## Pivot Plan

- Pivot capital mode: per-strategy caps note=Capital sizing is per-strategy: each strategy declares its own per-trade and daily caps; there is no project-wide live budget by default.
- Top recommendation: `gateway_base_btc_yield` label=`Gateway-funded BTC yield on Base` status=`pre_execution_blueprint` reason=`external_reference_workflow_requires_deterministic_adaptation`
- Capital guide: observedFloor=n/a researchPilot=$105.00 defaultSplit=$338.33
- Pivot next action: `build_deterministic_yield_shadow_book` build deterministic yield shadow book
- Alternate pivot: `stablecoin_entry_exit_loops` status=`research_only` label=`Stablecoin entry/exit loops`
- Alternate pivot: `btc_proxy_spreads` status=`blocked_current_surface` label=`BTC proxy spread arbitrage` observedFloor=$7.56

## Yield Shadow Book

- Yield book: status=`pre_execution_only` profiles=3 withinReferenceCap=0
- Top paper profile: `research_pilot` label=`Research pilot` status=`paper_ready_strategy_cap_review` capital=$105.00 paperDaily(5%)=$0.0137 paper30d(5%)=$0.4110
- Yield next action: `build_deterministic_yield_shadow_book` build deterministic yield shadow book
- Yield profile: `diversified_single_sleeve` status=`paper_ready_strategy_cap_review` capital=$205.00 budgetGap=n/a
- Yield profile: `default_dual_sleeve` status=`paper_ready_strategy_cap_review` capital=$338.33 budgetGap=n/a

## Proxy Coverage Plan

- Proxy coverage: overfit=`high_overfit_risk` plans=1 actionable=1 quota=60
- Next proxy target: proxy=`wbtc` action=`expand_amount_ladder` reason=`partial_amount_match` priority=`high` quota=60
- Proxy coverage command: `npm run quote:dex -- --chains=base,bsc,ethereum --include-stable-entry --route-limit=64 && npm run score:gateway -- --write && npm run report:btc-proxy-spreads && npm run report:proxy-spread-coverage -- --write`

## Pre-live Readiness

- Current stage: `shadow_replay`
- Shadow replay: `shadow_replay_blocked` blockers=audit:LIVE_BLOCKED,manual_canary_review_not_ready,no_policy_ready_measured_route audit=LIVE_BLOCKED policyReady=0
- Mechanical simulation: `mechanical_simulation_blocked` success=50/50 failures=2 blockers=shadow_replay_not_ready,simulation_failures_present
- Fork execution: `fork_execution_blocked` planned=1 submitted=0 confirmed=0/3 failures=0 blockers=mechanical_simulation_not_ready,needs_3_more_confirmed_fork_cycles
- Execution audit: `complete` missingRecords=0 blockers=none
- Tiny live canary review: `tiny_canary_blocked` blockers=shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready livePolicy=`BLOCKED`
- Pre-live commands: `npm run run:prelive-evidence-campaign` or `npm run run:prelive-simulations -- --source=objective --write` && `npm run plan:prelive-fork-execution -- --source=objective --write` && `npm run report:prelive-readiness -- --write` && `npm run build:prelive-review-package -- --write` && `npm run status:dashboard`
- Latest simulation failure: insufficient_funds at 2026-04-17T21:11:59.325Z
- Latest fork plan: route=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000` status=`planned` source=`queue`
- Recent execution transition: kind=`fork_plan` status=`planned` route=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000`
- Queue follow-up: rank=1 scope=canary label=`unichain->bera wBTC.OFT->wBTC.OFT` reason=scheduled_readiness_check command=`npm run check:estimator-wallet -- --route-key="unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Queue follow-up: rank=2 scope=tx_ready_shadow label=`bsc->avalanche wBTC.OFT->wBTC.OFT` reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="bsc:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Queue follow-up: rank=3 scope=tx_ready_shadow label=`bsc->base wBTC.OFT->wBTC.OFT` reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="bsc:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Queue follow-up: rank=4 scope=execution_review label=`base->ethereum wBTC.OFT->WBTC` reason=native command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Tiny Live Review Package

- Summary: status=`not_ready_for_manual_review` review=`NOT_READY_FOR_MANUAL_CANARY_REVIEW` live=`LIVE_EXECUTION_BLOCKED` stage=`shadow_replay` blockers=manual_review_stage_not_ready,shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready,exact_src_execution_gas_not_estimated
- Tiny canary admission: decision=`NO_GO` status=`blocked` blockers=manual_review_stage_not_ready,shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready,exact_src_execution_gas_not_estimated next=`clear_admission_blockers`
- Admission remediation: status=`ready` ready=2 manual=1 blocked=0
- Admission remediation runner: `npm run run:admission-remediation -- --execute --limit=1`
- Admission next action: `check_wallet_readiness` status=`ready` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Admission remediation item: rank=1 status=`ready` code=`check_wallet_readiness` reason=manual_review_stage_not_ready command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Admission remediation item: rank=2 status=`ready` code=`execute_refresh_batch` reason=scheduled_readiness_check command=`npm run run:shadow-refresh-batch -- --execute --limit=1`
- Admission remediation item: rank=3 status=`manual` code=`submit_fork_cycle` reason=external_signer_required command=`npm run submit:prelive-fork-execution -- --plan-id="0e5fcf68dab023c390ed" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"`
- Manual review candidate: target=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000` readiness=`insufficient_data` net=$-1.2463 prepFunding=$0.0000 txReady=true viableForPrep=true
- Candidate inputs: quote fresh (26.3m) · exactGas fresh (26.2m) · srcGas fresh (26.2m) · dex fresh (25.9m) · btcFee not_needed · market fresh (0.5m)
- Admission constraints: livePolicy=`BLOCKED` strategyCaps=`per_strategy` dailyLoss=`n/a` walletFloor=`n/a` minProfit=`0` minEdge=`0`
- Candidate blockers: exact_src_execution_gas_not_estimated; score gaps exact_src_execution_gas_not_estimated
- Candidate evidence: shadow=24 quotes=11/11 success=100.0% p95=5382ms routeFailure=0.0%
- Measured leader review: route=`base->ethereum wBTC.OFT->WBTC` amount=`10000` readiness=`insufficient_data` measured=$-1.4570 executable=$-1.4574 next=`check_wallet_readiness`
- Leader review rationale: current canary is the only viable prep route; measured leader is not viable for prep yet; measured leader still needs exact gas; measured leader still needs wallet readiness checks; measured leader is still marked insufficient_data; measured leader still has score data gaps | blockers: native gas balance missing, source token balance missing, source gas snapshot stale, exact execution gas pending, DEX output quote stale
- ETH-family profitability: routes=0 measured=0 profitable=0 verdict=`no_measured_loops`
- ETH-family recommendation: `no_multichain_eth_family_surface` command=`npm run scan:quote-surface -- --route-key="ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->bitcoin:0x0000000000000000000000000000000000000000" && npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard`
- Pivot gate: decision=`stay_blocked` status=`stay_blocked` currentCanary=`observe_only` measuredLeader=`drop`
- Pivot review context: top=`gateway_base_btc_yield` status=`pre_execution_blueprint` next=`build_deterministic_yield_shadow_book`
- Pivot capital context: observedFloor=n/a researchPilot=$105.00 defaultSplit=$338.33
- Review checklist: completed=top canary route selected · tx payload captured · wallet readiness cleared remaining=rerun exact gas for the top route · advance canary beyond RUN_EXACT_GAS
- Review transition: kind=`fork_plan` status=`planned` route=`avalanche->ethereum wBTC.OFT->WBTC` amount=`10000`
- Review follow-up: rank=1 scope=canary label=`unichain->bera wBTC.OFT->wBTC.OFT` reason=scheduled_readiness_check command=`npm run check:estimator-wallet -- --route-key="unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Review follow-up: rank=2 scope=tx_ready_shadow label=`bsc->avalanche wBTC.OFT->wBTC.OFT` reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="bsc:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Review follow-up: rank=3 scope=tx_ready_shadow label=`bsc->base wBTC.OFT->wBTC.OFT` reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="bsc:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Guardrail: Mechanical simulation uses RPC estimation and eth_call only; it is not realized execution proof.
- Guardrail: Pre-live execution audit requires plan, submission, receipt, and journal records to stay in sync.
- Guardrail: Fork execution requires an external signer and never stores private keys in planner or dashboard code.
- Guardrail: liveTrading remains BLOCKED until architecture review and explicit canary approval.

## Pre-live Evidence Campaign

- Summary: status=`ready` reviewPackage=`not_ready_for_manual_review` stage=`shadow_replay` ready=1 manual=1 blocked=1 done=2
- Evidence progress: simulations=50/50 forkConfirmed=0/3 refreshRuns=28
- Next campaign action: code=`execute_refresh_batch` status=`ready` reason=scheduled_readiness_check command=`npm run run:shadow-refresh-batch -- --execute --limit=1`
- Campaign action: code=`execute_refresh_batch` status=`ready` automated=true reason=scheduled_readiness_check command=`npm run run:shadow-refresh-batch -- --execute --limit=1`
- Campaign action: code=`collect_simulation_evidence` status=`done` automated=true reason=simulation_target_reached
- Campaign action: code=`prepare_fork_cycle` status=`done` automated=true reason=fork_plan_already_open
- Campaign action: code=`submit_fork_cycle` status=`manual` automated=false reason=external_signer_required command=`npm run submit:prelive-fork-execution -- --plan-id="0e5fcf68dab023c390ed" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"`
- Campaign action: code=`reconcile_fork_cycle` status=`blocked` automated=false reason=fork_submission_required_first

## Profitability Summary

- Overfit audit: LIVE_BLOCKED · sample=shadow_observations · horizon=157.2h · buckets=39
- Overfit blockers: shadow time window, candidate amount diversity, fresh gas snapshots
- Overfit warnings: legacy records, gas snapshot failures
- Overfit runway: 10.8h remaining to 168h · 0 hourly buckets remaining to 24
- Overfit time ETA: shadow window 2026-04-18T12:00:56.658Z · bucket diversity 2026-04-18T01:11:29.624Z · earliest time-gate pass 2026-04-18T12:00:56.658Z

- Tested closed loops: 3
- Profitable closed loops: 0
- Loop-observable routes: 2
- Missing focus Gateway quotes: 0
- Profit verdict: measured no-edge universe (The currently measurable closed-loop universe has been tested and still sits well below the minimum profit gate.)
- Current canary route: insufficient_data net=$-1.3660
- Closest route to policy: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` amount=`10000` net=$-1.4570 gap=$1.46 target=$0.0000
- Best stablecoin route tested: `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` amount=`250000000` readiness=`insufficient_data` net=$0.6615
- ETH-family routes: 0 family / 32 ETH-related gateway routes; measurable=0 loopObservable=0 stable=0
- ETH-family loops: measured=0 profitable=0 policyBlocked=0
- ETH-family loop verdict: no measured loops yet (No closed measured loop is available yet.)
- ETH-family recommendation: No chain-to-chain ETH family Gateway surface yet (Current ETH-related routes are still dominated by BTC<->ETH or Ethereum-L1 touchpoints, not pure ETH-on-ETH cross-chain loops.)
- Closest ETH-family route to policy: none observed
- Best ETH-family research route: `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->bitcoin:0x0000000000000000000000000000000000000000` class=`unknown` readiness=`insufficient_data` net=$-0.6469
- ETH-family next action: `watch_eth_family_surface` command=`npm run scan:quote-surface -- --route-key="ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->bitcoin:0x0000000000000000000000000000000000000000" && npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard`
- ETH-family overfit risks: thin_quote_samples,single_route_surface,narrow_amount_surface,single_amount_level_per_route,narrow_quote_time_coverage
- Measured leader under review: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` amount=`10000` measured=$-1.4570 readiness=`insufficient_data`
- Why it is not the canary: current canary is the only viable prep route; measured leader is not viable for prep yet; measured leader still needs exact gas; measured leader still needs wallet readiness checks; measured leader is still marked insufficient_data; measured leader still has score data gaps | blockers: native gas balance missing, source token balance missing, source gas snapshot stale, exact execution gas pending, DEX output quote stale
- Revalidation order for measured leader: wallet readiness check -> exact gas estimate -> DEX quote refresh -> selective route scoring -> status dashboard refresh
- Revalidation commands: npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" && npm run estimate:gateway-gas -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" && npm run quote:dex -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" && npm run score:gateway -- --write --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" --amount="10000" && npm run status:dashboard
- Durable no-edge routes: 1

- Strategy note: BTC-family transfer by itself is usually loss-making after Gateway fee, gas, and slippage.
- Strategy note: the actionable target is a local executable BTC/stable dislocation that beats total movement cost.
- Strategy note: BTC accumulation from a long-term bullish view is directional inventory exposure, not arbitrage profit, so it must not unlock canary or live execution by itself.
- Strong-edge research: definite=0 multiLevel=0 missingDecay=0 singleLevel=0 noEdge=107 outliers=0
- DEX route universe: btcFamily=91 fullyMeasurable=30 singleGap=48 doubleGap=13
- DEX focus shortlist: loopObservable=2 partial=8 missingGatewayQuote=0
- Edge viability: measured=3 positive=0 policyReady=0 medianGap=$1.69
- Edge verdict: measured no-edge universe (The currently measurable closed-loop universe has been tested and still sits well below the minimum profit gate.)
- No-edge persistence: durable=1 belowPolicy=0 nearPolicy=0 positiveBelow=0
- Largest DEX coverage gap chain: `bitcoin` routeCount=19
- Best DEX focus route now: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` class=`loop_observable` gatewayQuotes=13 entryQuotes=9 exitQuotes=12 bestExec=$-1.4574
- DEX environment drift: monitored=38 staleLegs=53 unstableLegs=1 thinLiquidityLegs=0 singleSampleLegs=0
- Top DEX environment risk: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` amount=`10000` class=`refresh_needed` staleLegs=3 unstableLegs=0 thinLiquidityLegs=0 singleSampleLegs=0
- Best research route now: `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` class=`no_edge` profitableLevels=0/3 bestNet=$0.6267
- Measured DEX+Gateway coverage: bothDexSupported=71 executable=26 measuredNet=3 exact=6 profitable=0
- Closest route to policy gate: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` amount=`10000` net=$-1.4570 gapToPolicy=$1.46 target=$0.0000
- Best persistence route now: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` class=`durable_no_edge_route` measuredLevels=3 minGap=$1.46 bestNet=$-1.4570
- Closest measured DEX+Gateway loop: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` netEdge=$-1.4570 amountGap=2.06% blockers=entry_amount_mismatch,gateway_stale_src_gas_snapshot,gateway_exact_src_execution_gas_not_estimated,gateway_stale_dex_output_quote,non_positive_loop_net_edge
- Best stablecoin-related route now: `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` amount=`250000000` readiness=`insufficient_data` netEdge=$0.6615
- Best closed stable->BTC->stable loop: none matched yet
- Stable amount ladder: pair=`bsc:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d->bitcoin:0x0000000000000000000000000000000000000000` + `bitcoin:0x0000000000000000000000000000000000000000->base:0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189` entryLevels=2 exitLevels=5 exact=0 closestGap=40.31%
- Closest loop blocker: amount gap 4449.59% on `base:0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189->bitcoin:0x0000000000000000000000000000000000000000` + `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Proxy spread surface: buyQuotes=11 sellQuotes=27 opportunities=19 policyReady=0 overfit=high_overfit_risk
- Proxy coverage target: group=`wbtc` next=`expand_amount_ladder` reason=`partial_amount_match` buyLevels=7 sellLevels=16 matchedLevels=6
- Stable loop refresh command: `npm run quote:dex -- --route-key="bsc:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d->bitcoin:0x0000000000000000000000000000000000000000" --include-stable-entry`
- Proxy spread refresh command: `npm run quote:dex -- --chains=base,bsc,ethereum --include-stable-entry --route-limit=64`
- Strategy track stable_loop: label=`base:0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189->bitcoin:0x0000000000000000000000000000000000000000 + bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` status=`blocked_loop` next=`expand_amount_ladder` reason=`amount_mismatch`
- Strategy track proxy_spread: label=`ethereum->bsc WBTC/wBTC.OFT` status=`thin_coverage` next=`expand_amount_ladder` reason=`partial_amount_match`
- Strategy track eth_family_loop: label=`ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->bitcoin:0x0000000000000000000000000000000000000000` status=`unobserved` next=`watch_eth_family_surface` reason=`no_multichain_eth_family_surface` command=`npm run scan:quote-surface -- --route-key="ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->bitcoin:0x0000000000000000000000000000000000000000" && npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard`
- Quote decay: 5s 15/20 · 15s 15/20 · 30s 15/20
- Chain price coverage: observed 3, stale 2, missing 6
- Quoteable chains observed: base,bsc,ethereum
- Quoteable chains missing: avalanche:recent quote failed,sonic:recent quote failed,unichain:recent quote failed
- Non-quoteable chains: bera:DEX unsupported,bob:DEX unsupported,soneium:DEX unsupported
- BTC watchlist observed live: BTC, uniBTC, WBTC, wBTC.OFT
- BTC watchlist missing from live routes: FBTC, LBTC, solvBTC, SolvBTC.BBN, tBTC, xSolvBTC
- BTC watchlist unknown addresses: none
- Last canary advance: avalanche->ethereum wBTC.OFT->WBTC (RUN_EXACT_GAS -> RUN_EXACT_GAS; actions check-estimator-wallet, estimate-gateway-gas_failed)
- Route input freshness: quote fresh (26.3m) · exactGas fresh (26.2m) · srcGas fresh (26.2m) · dex fresh (25.9m) · btcFee not_needed · market fresh (0.5m)
- Route input blockers: exact_src_execution_gas_not_estimated; score gaps exact_src_execution_gas_not_estimated
- Canary input watcher: skip avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 amount=10000 (current canary route inputs are fresh)
- Gas refresh watcher: skip avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 amount=10000 (gas refresh not needed right now)
- DEX refresh watcher: refresh route avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 amount=10000; rescoring 1 wrapped-BTC route(s) (current canary route chain price is missing)
- Gateway coverage watcher: no fully measurable route shortlist yet
- Blocked-score watcher: skip avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 amount=10000 (blocked-score refresh not needed right now)
- Quote-decay watcher: refresh avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 amount=10000 (next decay window is due now; window 5s)
- estimator wallet checked routes: 79
- estimator skipped routes: 20
- skipped reasons: missing_tx_data:16,missing_tx_to:4

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
- `src/strategy/pivot-plan.mjs`
- `src/ledger/yield-shadow-book.mjs`
- `src/strategy/proxy-spread-coverage-plan.mjs`
- `src/cli/report-pivot-plan.mjs`
- `src/cli/report-payback-status.mjs`
- `src/cli/report-yield-shadow-book.mjs`
- `src/cli/report-proxy-spread-coverage-plan.mjs`
- `src/cli/run-prelive-simulations.mjs`
- `src/cli/report-prelive-readiness.mjs`
- `src/cli/build-prelive-review-package.mjs`
- `src/cli/run-prelive-evidence-campaign.mjs`
- `src/cli/plan-prelive-fork-execution.mjs`
- `src/cli/submit-prelive-fork-execution.mjs`
- `src/cli/reconcile-prelive-fork-execution.mjs`
- `src/strategy/objective-plans.mjs`
- `src/config/payback.mjs`
- `src/executor/payback/accumulator.mjs`
- `src/executor/payback/scheduler.mjs`
- `src/session/shadow-refresh-runner.mjs`
- `src/cli/run-shadow-refresh-queue.mjs`
- `src/session/shadow-refresh-batch.mjs`
- `src/cli/run-shadow-refresh-batch.mjs`
- `docs/current-status.md`

## Backup Note

- `.env` and `data/` stay out of git.
- This repo is safe to back up publicly only if you are comfortable exposing source; operational secrets are ignored by git.
- Prefer a private GitHub repo for backup.

