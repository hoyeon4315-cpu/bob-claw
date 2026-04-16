# Current Status

Updated: 2026-04-16T01:04:53.005Z

## Start Here

- Read this file first in a shallow session.
- Main command: `npm run advance:canary`
- Decision-pack refresh: `npm run build:prelive-decision-pack`
- Queue preview: `npm run run:shadow-refresh-queue -- --limit=3`
- Batch preview: `npm run run:shadow-refresh-batch -- --limit=1`
- Evidence campaign preview: `npm run run:prelive-evidence-campaign`
- Safe status refresh: `npm run audit:overfit && npm run score:gateway -- --write && npm run status:dashboard`
- Pivot plan refresh: `npm run report:pivot-plan -- --write`
- Strategy snapshot refresh: `npm run report:strategy-snapshot -- --write`
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

- Status: live=`BLOCKED` shadow=`ALLOWED` next=`BLOCKED_NO_VIABLE_PREP_ROUTE`
- Strategy pack: implemented=8 top=`stablecoin_entry_exit_loops` pivot=`gateway_base_btc_yield`
- Pivot headline: `gateway_base_btc_yield` capital pilot=$105.00 next=`build_deterministic_yield_shadow_book`
- Budget lanes: active=$300.00 planning=$1000.00 defaultYieldFitsPlanning=yes
- Yield paper lanes: pilot=$105.00 diversified=$205.00 default=$338.33
- Proxy lane: proxy=`wbtc` action=`expand_amount_ladder` quota=60
- Canary lane: route=`avalanche->bera wBTC.OFT->wBTC.OFT` amount=`10000` exactGas=`npm run estimate:gateway-gas -- --from="0x96262be63aa687563789225c2fe898c27a3b0ae4" --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000"`
- Validation: status=`blocked` nextStage=`shadow_replay` nextAction=`refresh_gateway_quote`
- Connected refresh: status=`network_refresh_required` required=3 next=`refresh_gateway_quote`
- Refresh runner state: runs=9 preview=1 latest=`succeeded` remaining=0
- Connected pre-live pass: `npm run run:current-route-prelive-pass -- --execute`
- Current-route pass report: `npm run report:current-route-prelive-pass -- --write`
- Exact-route fork split: status=`missing_exact_route_plan` technical=`missing_plan` economic=`blocked_no_net_edge`
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
-   9) `npm run write:session-handoff`
- Networked operator runtime only: `npm run quote:dex -- --chains=base,bsc,ethereum --include-stable-entry --route-limit=64 && npm run score:gateway -- --write && npm run report:btc-proxy-spreads && npm run report:proxy-spread-coverage -- --write`
- Decision lock: keep live execution blocked; treat all new samples as research until policy and anti-overfit gates clear.

## Strategy Snapshot

- Strategy snapshot: implemented=8 candidates=0 activeBudget=$300.00 planningBudget=$1000.00
- Top implemented strategy: `stablecoin_entry_exit_loops` status=`measured_below_policy` reason=`amount_mismatch`
- Top pivot: `gateway_base_btc_yield` status=`pre_execution_blueprint` pilot=$105.00
- Strategy next action: `build_deterministic_yield_shadow_book`
- Capital expansion: active=$300.00 planning=$1000.00 planningTop=`btc_proxy_spreads`/`gateway_base_btc_yield` approvalRequired=true
- Strategy lane: `gateway_wrapped_btc_loops` status=`thin_coverage`
- Strategy lane: `btc_proxy_spreads` status=`thin_coverage` floor=$7.56
- Strategy lane: `stablecoin_entry_exit_loops` status=`measured_below_policy`

## Execution Runbook

- Runbook: currentStage=`shadow_replay` completed=0/4 blocked=4 reviewReady=false
- Runbook next action: `refresh_gateway_quote` command=`npm run verify:gateway -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000"`
- Stage: `shadow_replay` state=`blocked` status=`shadow_replay_blocked` blockers=audit:LIVE_BLOCKED,manual_canary_review_not_ready,no_policy_ready_measured_route
- Stage: `mechanical_simulation` state=`blocked` status=`mechanical_simulation_blocked` blockers=shadow_replay_not_ready,needs_49_more_successful_simulations
- Stage: `fork_execution` state=`blocked` status=`fork_execution_blocked` blockers=mechanical_simulation_not_ready,no_fork_execution_plan,needs_3_more_confirmed_fork_cycles
- Stage: `manual_canary_review` state=`blocked` status=`not_ready_for_manual_review` blockers=manual_review_stage_not_ready,shadow_replay_not_ready,mechanical_simulation_not_ready

## Pre-live Validation

- Validation: status=`blocked` readiness=0% blockers=14 warnings=5
- Validation next step: stage=`shadow_replay` action=`refresh_gateway_quote` command=`npm run verify:gateway -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000"`
- Validation headline: topStrategy=`stablecoin_entry_exit_loops` topPivot=`gateway_base_btc_yield`

## Connected Refresh Package

- Connected refresh: status=`network_refresh_required` route=`avalanche->bera wBTC.OFT->wBTC.OFT` amount=`10000` required=3
- Refresh next step: action=`refresh_gateway_quote` command=`npm run verify:gateway -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000"`
- Refresh runner: preview=`npm run run:connected-refresh-package` execute=`npm run run:connected-refresh-package -- --execute`
- Refresh chain: `npm run verify:gateway -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000" && npm run estimate:gateway-gas -- --from="0x96262be63aa687563789225c2fe898c27a3b0ae4" --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run price:snapshot && npm run score:gateway -- --write --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run advance:canary && npm run build:prelive-review-package -- --write && npm run validate:prelive-readiness -- --write && npm run write:session-handoff`
- Refresh execution: runs=9 preview=1 success=9 partial=0 failed=0 latest=`succeeded`
- Refresh execution next: action=`hold_dex_quote`
- Current-route pre-live pass: runs=9 preview=1 readyForSigner=0 blocked=9 partial=0 failed=0 latest=`blocked_nonrefreshable_input`
- Current-route pass next: action=`hold_dex_quote`

## Exact-route Fork Package

- Exact-route fork package: status=`missing_exact_route_plan` planId=`n/a` route=`avalanche->bera wBTC.OFT->wBTC.OFT` amount=`10000`
- Fork readiness split: technical=`missing_plan` economic=`blocked_no_net_edge`
- Fork evidence: simulation=0/50 fork=0/3
- Fork next step: action=`refresh_gateway_quote` command=`npm run verify:gateway -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000"`

## Operational Judgment Review

- Operational judgment: status=`guarded_blocked` issues=3 high=2 medium=1
- Judgment next step: action=`stale_inputs_can_distort_route_scoring` command=`npm run verify:gateway -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000"`
- Judgment issue: `stale_inputs_can_distort_route_scoring` severity=`high` headline=Refresh stale decision inputs before trusting route scoring
- Judgment issue: `prelive_evidence_still_incomplete` severity=`high` headline=Pre-live evidence is still incomplete
- Judgment issue: `planning_budget_is_not_live_authorization` severity=`medium` headline=Planning budget does not change the live ring-fence

## Current Phase

- Address: `0x96262be63aa687563789225c2fe898c27a3b0ae4`
- Phase: canary-prep gating before exact gas
- Decision: `BLOCKED_NO_VIABLE_PREP_ROUTE`
- Headline: Best prepared route still fails objective score review
- Live trading: `BLOCKED`
- Shadow trading: `ALLOWED`

## Progress Snapshot

- Completed so far: top canary route selected · tx payload captured · wallet readiness cleared · exact gas captured
- Remaining steps: refresh stale/missing inputs (gateway quote, exact gas, market) · resolve blocked inputs (DEX quote) · clear objective blocker (reject_no_net_edge) · advance canary beyond BLOCKED_NO_VIABLE_PREP_ROUTE
- Manual canary review: NOT_READY_FOR_MANUAL_CANARY_REVIEW (reject_no_net_edge)
- Live execution: LIVE_EXECUTION_BLOCKED; audit=LIVE_BLOCKED (audit_blocks_live)

## Best Route Right Now

- Route: `avalanche->bera wBTC.OFT->wBTC.OFT`
- Route key: `avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000`
- txReady=true exactGasDone=true viableForPrep=true
- Input value: $7.46
- Prep funding estimate: $0.0000
- Net edge now: $-0.5609
- Objective score blocker: reject_no_net_edge (net edge $-0.5609)
- Next readiness check: `sonic->base wBTC.OFT->wBTC.OFT` amount=`10000`
- Refresh status: ready to rerun the next wallet readiness check now
- Next focus: rerun quotes, gas, or token prices only when market inputs change; wallet readiness is no longer the blocker

## Required Actions Before Exact Gas

- none

## Objective Verification

- This file does not execute validation by itself.
- Rerun `npm run check` before acting on code changes.
- Rerun `npm test` before acting on behavior assumptions.
- Candidate routes observed: 172
- txReady routes: 122
- viable prep routes: 1

## Shadow Roster

- active_canary route=`avalanche->bera wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=true net=$-0.5609 prepFunding=$0.0000 blockers=none priority=high_quote_latency evidence=shadow:15 quotes:8/8 success:100.0% p95:8531ms fee:$0.5236 reasons:reject_effective_system_pnl:15,reject_treasury_execution_refill_cost:15,reject_no_net_edge:8,insufficient_data:7,stale_src_gas_snapshot:6
- tx_ready_shadow route=`avalanche->bob wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-0.7933 prepFunding=$0.0000 blockers=score:stale_src_gas_snapshot priority=evidence_accumulating evidence=shadow:13 quotes:3/3 success:100.0% p95:1579ms fee:$0.7564 reasons:exact_src_execution_gas_not_estimated:13,insufficient_data:13,reject_effective_system_pnl:13,reject_treasury_execution_refill_cost:13,stale_src_gas_snapshot:12
- tx_ready_shadow route=`bob->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-0.8457 prepFunding=$0.0000 blockers=score:stale_src_gas_snapshot priority=evidence_accumulating evidence=shadow:13 quotes:3/3 success:100.0% p95:1018ms fee:$0.8087 reasons:exact_src_execution_gas_not_estimated:13,insufficient_data:13,reject_effective_system_pnl:13,reject_treasury_execution_refill_cost:13,stale_src_gas_snapshot:10
- tx_ready_shadow route=`bob->sonic wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-0.8470 prepFunding=$0.0000 blockers=score:stale_src_gas_snapshot priority=evidence_accumulating evidence=shadow:13 quotes:3/3 success:100.0% p95:501ms fee:$0.8100 reasons:exact_src_execution_gas_not_estimated:13,insufficient_data:13,reject_effective_system_pnl:13,reject_treasury_execution_refill_cost:13,stale_src_gas_snapshot:9
- tx_ready_shadow route=`sonic->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=false net=$-0.5851 prepFunding=$0.0000 blockers=score:stale_src_gas_snapshot priority=evidence_accumulating evidence=shadow:8 quotes:2/2 success:100.0% p95:516ms fee:$0.5481 reasons:exact_src_execution_gas_not_estimated:8,insufficient_data:8,reject_effective_system_pnl:8,reject_treasury_execution_refill_cost:8,stale_src_gas_snapshot:6

## Shadow Actions

- active_canary route=`avalanche->bera wBTC.OFT->wBTC.OFT` next=wait_for_fresh_inputs reason=reject_no_net_edge
- tx_ready_shadow route=`avalanche->bob wBTC.OFT->wBTC.OFT` next=refresh_exact_gas reason=stale_src_gas_snapshot command=`npm run estimate:gateway-gas -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- tx_ready_shadow route=`bob->avalanche wBTC.OFT->wBTC.OFT` next=refresh_exact_gas reason=stale_src_gas_snapshot command=`npm run estimate:gateway-gas -- --route-key="bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- tx_ready_shadow route=`bob->sonic wBTC.OFT->wBTC.OFT` next=refresh_exact_gas reason=stale_src_gas_snapshot command=`npm run estimate:gateway-gas -- --route-key="bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->sonic:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- tx_ready_shadow route=`sonic->avalanche wBTC.OFT->wBTC.OFT` next=refresh_exact_gas reason=stale_src_gas_snapshot command=`npm run estimate:gateway-gas -- --route-key="sonic:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Refresh Queue

- rank=1 priority=100 scope=canary next=check_wallet_readiness reason=scheduled_readiness_check route=`sonic->base wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="sonic:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=2 priority=88 scope=stable_loop next=expand_amount_ladder reason=amount_mismatch command=`npm run quote:dex -- --route-key="bsc:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d->bitcoin:0x0000000000000000000000000000000000000000" --include-stable-entry`
- rank=3 priority=86 scope=proxy_spread next=expand_amount_ladder reason=partial_amount_match proxyGroup=`wbtc` chains=base,bsc,ethereum command=`npm run quote:dex -- --chains=base,bsc,ethereum --include-stable-entry --route-limit=64`
- rank=4 priority=80 scope=tx_ready_shadow next=refresh_exact_gas reason=stale_src_gas_snapshot route=`avalanche->bob wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run estimate:gateway-gas -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=5 priority=80 scope=tx_ready_shadow next=refresh_exact_gas reason=stale_src_gas_snapshot route=`bob->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run estimate:gateway-gas -- --route-key="bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=6 priority=80 scope=tx_ready_shadow next=refresh_exact_gas reason=stale_src_gas_snapshot route=`bob->sonic wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run estimate:gateway-gas -- --route-key="bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->sonic:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=7 priority=45 scope=canary next=advance_canary reason=canary_prep_blocked command=`npm run advance:canary`
- rank=8 priority=35 scope=route_performance next=report_route_performance reason=no_realized_enabled_routes command=`npm run report:route-performance -- --write`

## Refresh Queue Execution

- Summary: runs=0 success=0 failed=0 preview=0 invalid=0 latest=none
- Recent executions: none

## Refresh Batch Loop

- Summary: runs=20 success=20 failed=0 blocked=0 invalid=0 latest=succeeded stopReason=none
- Batch: mode=`execute` status=`succeeded` selected=3 queueSuccess=3 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=3 queueSuccess=3 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false
- Batch: mode=`execute` status=`succeeded` selected=1 queueSuccess=1 queueFailure=0 followUpFailure=0 stopReason=none breakerBlocked=false

## Objective Plans

- none

## Pivot Gate

- Pivot decision: `stay_blocked` Stay blocked and keep collecting evidence before any canary promotion
- Pivot status: `stay_blocked` currentCanary=`observe_only` measuredLeader=`n/a`
- Pivot focus route: `avalanche->bera wBTC.OFT->wBTC.OFT` amount=`10000`
- Pivot next action: none

## Pivot Plan

- Pivot budget: current=$300.00 note=Capital sizing is per-strategy: each strategy declares its own per-trade and daily caps; there is no project-wide loss cap by default.
- Top recommendation: `gateway_base_btc_yield` label=`Gateway-funded BTC yield on Base` status=`pre_execution_blueprint` reason=`external_reference_workflow_requires_deterministic_adaptation`
- Planning budgets: $300.00(active ring) | $1000.00(planning only)
- Capital guide: observedFloor=n/a researchPilot=$105.00 defaultSplit=$338.33
- Pivot next action: `build_deterministic_yield_shadow_book` build deterministic yield shadow book
- Alternate pivot: `stablecoin_entry_exit_loops` status=`research_only` label=`Stablecoin entry/exit loops`
- Alternate pivot: `btc_proxy_spreads` status=`blocked_current_surface` label=`BTC proxy spread arbitrage` observedFloor=$7.56

## Yield Shadow Book

- Yield book: status=`pre_execution_only` profiles=3 withinBudget=2 currentBudget=$300.00
- Top paper profile: `research_pilot` label=`Research pilot` status=`paper_ready_within_budget` capital=$105.00 paperDaily(5%)=$0.0137 paper30d(5%)=$0.4110
- Yield budget scenarios: $300.00 readyProfiles=2(active) | $1000.00 readyProfiles=3(planning)
- Yield next action: `build_deterministic_yield_shadow_book` build deterministic yield shadow book
- Yield profile: `diversified_single_sleeve` status=`paper_ready_within_budget` capital=$205.00 budgetGap=$0.0000
- Yield profile: `default_dual_sleeve` status=`budget_expansion_required` capital=$338.33 budgetGap=$38.33

## Proxy Coverage Plan

- Proxy coverage: overfit=`high_overfit_risk` plans=1 actionable=1 quota=60
- Next proxy target: proxy=`wbtc` action=`expand_amount_ladder` reason=`partial_amount_match` priority=`high` quota=60
- Proxy coverage command: `npm run quote:dex -- --chains=base,bsc,ethereum --include-stable-entry --route-limit=64 && npm run score:gateway -- --write && npm run report:btc-proxy-spreads && npm run report:proxy-spread-coverage -- --write`

## Pre-live Readiness

- Current stage: `shadow_replay`
- Shadow replay: `shadow_replay_blocked` blockers=audit:LIVE_BLOCKED,manual_canary_review_not_ready,no_policy_ready_measured_route,no_execution_review_route audit=LIVE_BLOCKED policyReady=0
- Mechanical simulation: `mechanical_simulation_blocked` success=1/50 failures=0 blockers=shadow_replay_not_ready,needs_49_more_successful_simulations
- Fork execution: `fork_execution_blocked` planned=0 submitted=0 confirmed=0/3 failures=0 blockers=mechanical_simulation_not_ready,no_fork_execution_plan,needs_3_more_confirmed_fork_cycles
- Execution audit: `complete` missingRecords=0 blockers=none
- Tiny live canary review: `tiny_canary_blocked` blockers=shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready livePolicy=`BLOCKED`
- Pre-live commands: `npm run run:prelive-evidence-campaign` or `npm run run:prelive-simulations -- --source=objective --write` && `npm run plan:prelive-fork-execution -- --source=objective --write` && `npm run report:prelive-readiness -- --write` && `npm run build:prelive-review-package -- --write` && `npm run status:dashboard`
- Queue follow-up: rank=1 scope=canary label=`sonic->base wBTC.OFT->wBTC.OFT` reason=scheduled_readiness_check command=`npm run check:estimator-wallet -- --route-key="sonic:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Queue follow-up: rank=2 scope=stable_loop label=`stable_loop` reason=amount_mismatch command=`npm run quote:dex -- --route-key="bsc:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d->bitcoin:0x0000000000000000000000000000000000000000" --include-stable-entry`
- Queue follow-up: rank=3 scope=proxy_spread label=`proxy_spread` reason=partial_amount_match command=`npm run quote:dex -- --chains=base,bsc,ethereum --include-stable-entry --route-limit=64`
- Queue follow-up: rank=4 scope=tx_ready_shadow label=`avalanche->bob wBTC.OFT->wBTC.OFT` reason=stale_src_gas_snapshot command=`npm run estimate:gateway-gas -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Tiny Live Review Package

- Summary: status=`not_ready_for_manual_review` review=`NOT_READY_FOR_MANUAL_CANARY_REVIEW` live=`LIVE_EXECUTION_BLOCKED` stage=`shadow_replay` blockers=manual_review_stage_not_ready,shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready,reject_no_net_edge,stale_gateway_quote,stale_exact_gas,blocked_dex_quote,stale_market
- Tiny canary admission: decision=`NO_GO` status=`blocked` blockers=manual_review_stage_not_ready,shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready,reject_no_net_edge,stale_gateway_quote,stale_exact_gas,blocked_dex_quote,stale_market next=`clear_admission_blockers`
- Admission remediation: status=`ready` ready=4 manual=0 blocked=1
- Admission remediation runner: `npm run run:admission-remediation -- --execute --limit=1`
- Admission next action: `refresh_gateway_quote` status=`ready` command=`npm run verify:gateway -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000"`
- Admission remediation item: rank=1 status=`ready` code=`refresh_gateway_quote` reason=stale_gateway_quote command=`npm run verify:gateway -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000"`
- Admission remediation item: rank=2 status=`ready` code=`refresh_exact_gas` reason=stale_exact_gas command=`npm run estimate:gateway-gas -- --route-key="avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --from="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Admission remediation item: rank=3 status=`blocked` code=`hold_dexQuote` reason=blocked_dex_quote
- Manual review candidate: target=`avalanche->bera wBTC.OFT->wBTC.OFT` amount=`10000` readiness=`reject_no_net_edge` net=$-0.5609 prepFunding=$0.0000 txReady=true viableForPrep=true
- Candidate inputs: quote stale (360.3m) · exactGas stale (360.3m) · srcGas fresh (0.1m) · dex blocked · btcFee not_needed · market stale (360.2m)
- Admission constraints: livePolicy=`BLOCKED` ring=`n/a` dailyLoss=`n/a` walletFloor=`n/a` minProfit=`0` minEdge=`0`
- Candidate blockers: reject_no_net_edge
- Candidate evidence: shadow=15 quotes=8/8 success=100.0% p95=8531ms routeFailure=0.0%
- ETH-family profitability: routes=0 measured=0 profitable=0 verdict=`no_measured_loops`
- ETH-family recommendation: `no_multichain_eth_family_surface` command=`npm run scan:quote-surface -- --route-key="bitcoin:0x0000000000000000000000000000000000000000->base:0x0000000000000000000000000000000000000000" && npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard`
- Pivot gate: decision=`stay_blocked` status=`stay_blocked` currentCanary=`observe_only` measuredLeader=`n/a`
- Pivot review context: top=`gateway_base_btc_yield` status=`pre_execution_blueprint` budget=$300.00 next=`build_deterministic_yield_shadow_book`
- Pivot capital context: observedFloor=n/a researchPilot=$105.00 defaultSplit=$338.33
- Review checklist: completed=top canary route selected · tx payload captured · wallet readiness cleared · exact gas captured remaining=refresh stale/missing inputs (gateway quote, exact gas, market) · resolve blocked inputs (DEX quote) · clear objective blocker (reject_no_net_edge) · advance canary beyond BLOCKED_NO_VIABLE_PREP_ROUTE
- Review follow-up: rank=1 scope=canary label=`sonic->base wBTC.OFT->wBTC.OFT` reason=scheduled_readiness_check command=`npm run check:estimator-wallet -- --route-key="sonic:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Review follow-up: rank=2 scope=stable_loop label=`stable_loop` reason=amount_mismatch command=`npm run quote:dex -- --route-key="bsc:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d->bitcoin:0x0000000000000000000000000000000000000000" --include-stable-entry`
- Review follow-up: rank=3 scope=proxy_spread label=`proxy_spread` reason=partial_amount_match command=`npm run quote:dex -- --chains=base,bsc,ethereum --include-stable-entry --route-limit=64`
- Guardrail: Mechanical simulation uses RPC estimation and eth_call only; it is not realized execution proof.
- Guardrail: Pre-live execution audit requires plan, submission, receipt, and journal records to stay in sync.
- Guardrail: Fork execution requires an external signer and never stores private keys in planner or dashboard code.
- Guardrail: liveTrading remains BLOCKED until architecture review and explicit canary approval.

## Pre-live Evidence Campaign

- Summary: status=`ready` reviewPackage=`not_ready_for_manual_review` stage=`shadow_replay` ready=1 manual=0 blocked=4 done=0
- Evidence progress: simulations=1/50 forkConfirmed=0/3 refreshRuns=20
- Next campaign action: code=`execute_refresh_batch` status=`ready` reason=scheduled_readiness_check command=`npm run run:shadow-refresh-batch -- --execute --limit=1`
- Campaign action: code=`execute_refresh_batch` status=`ready` automated=true reason=scheduled_readiness_check command=`npm run run:shadow-refresh-batch -- --execute --limit=1`
- Campaign action: code=`collect_simulation_evidence` status=`blocked` automated=true reason=shadow_replay_not_ready
- Campaign action: code=`prepare_fork_cycle` status=`blocked` automated=true reason=mechanical_simulation_not_ready
- Campaign action: code=`submit_fork_cycle` status=`blocked` automated=false reason=fork_plan_required_first
- Campaign action: code=`reconcile_fork_cycle` status=`blocked` automated=false reason=fork_submission_required_first

## Profitability Summary

- Overfit audit: LIVE_BLOCKED · sample=shadow_observations · horizon=103.1h · buckets=26
- Overfit blockers: shadow time window, candidate amount diversity
- Overfit warnings: legacy records, gas snapshot failures
- Overfit runway: 64.9h remaining to 168h · 0 hourly buckets remaining to 24
- Overfit time ETA: shadow window 2026-04-18T12:00:56.658Z · bucket diversity 2026-04-16T01:04:50.334Z · earliest time-gate pass 2026-04-18T12:00:56.658Z

- Tested closed loops: 3
- Profitable closed loops: 0
- Loop-observable routes: 2
- Missing focus Gateway quotes: 0
- Profit verdict: no measured loops yet (No closed measured loop is available yet.)
- Current canary route: reject_no_net_edge net=$-0.5609
- Closest route to policy: none observed
- Best stablecoin route tested: `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` amount=`4022463` readiness=`insufficient_data` net=$-0.9274
- ETH-family routes: 0 family / 32 ETH-related gateway routes; measurable=0 loopObservable=0 stable=0
- ETH-family loops: measured=0 profitable=0 policyBlocked=56
- ETH-family loop verdict: no measured loops yet (No closed measured loop is available yet.)
- ETH-family recommendation: No chain-to-chain ETH family Gateway surface yet (Current ETH-related routes are still dominated by BTC<->ETH or Ethereum-L1 touchpoints, not pure ETH-on-ETH cross-chain loops.)
- Closest ETH-family route to policy: none observed
- Best ETH-family research route: `bitcoin:0x0000000000000000000000000000000000000000->base:0x0000000000000000000000000000000000000000` class=`unknown` readiness=`observe_only_slow_settlement` net=$-0.5350
- ETH-family next action: `watch_eth_family_surface` command=`npm run scan:quote-surface -- --route-key="bitcoin:0x0000000000000000000000000000000000000000->base:0x0000000000000000000000000000000000000000" && npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard`
- ETH-family overfit risks: thin_quote_samples,single_route_surface,narrow_amount_surface,single_amount_level_per_route,narrow_quote_time_coverage
- Durable no-edge routes: 1

- Strategy note: BTC-family transfer by itself is usually loss-making after Gateway fee, gas, and slippage.
- Strategy note: the actionable target is a local executable BTC/stable dislocation that beats total movement cost.
- Strategy note: BTC accumulation from a long-term bullish view is directional inventory exposure, not arbitrage profit, so it must not unlock canary or live execution by itself.
- Strong-edge research: definite=0 multiLevel=0 missingDecay=0 singleLevel=0 noEdge=82 outliers=0
- DEX route universe: btcFamily=91 fullyMeasurable=30 singleGap=48 doubleGap=13
- DEX focus shortlist: loopObservable=2 partial=8 missingGatewayQuote=0
- Edge viability: measured=0 positive=0 policyReady=0 medianGap=n/a
- Edge verdict: no measured loops yet (No closed measured loop is available yet.)
- No-edge persistence: durable=1 belowPolicy=0 nearPolicy=0 positiveBelow=0
- Largest DEX coverage gap chain: `bitcoin` routeCount=19
- Best DEX focus route now: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` class=`loop_observable` gatewayQuotes=13 entryQuotes=9 exitQuotes=12 bestExec=$-1.3180
- DEX environment drift: monitored=36 staleLegs=52 unstableLegs=0 thinLiquidityLegs=0 singleSampleLegs=0
- Top DEX environment risk: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` amount=`10000` class=`refresh_needed` staleLegs=3 unstableLegs=0 thinLiquidityLegs=0 singleSampleLegs=0
- Best research route now: `bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`no_edge` profitableLevels=0/6 bestNet=$-0.2012
- Measured DEX+Gateway coverage: bothDexSupported=71 executable=25 measuredNet=3 exact=6 profitable=0
- Closest route to policy gate: none observed
- Best persistence route now: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` class=`durable_no_edge_route` measuredLevels=3 minGap=n/a bestNet=$-1.4401
- Closest measured DEX+Gateway loop: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` netEdge=$-1.4401 amountGap=2.06% blockers=entry_amount_mismatch,gateway_stale_src_gas_snapshot,gateway_exact_src_execution_gas_not_estimated,gateway_observe_only_ethereum_l1_phase_disabled,non_positive_loop_net_edge
- Best stablecoin-related route now: `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` amount=`4022463` readiness=`insufficient_data` netEdge=$-0.9274
- Best closed stable->BTC->stable loop: none matched yet
- Stable amount ladder: pair=`bsc:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d->bitcoin:0x0000000000000000000000000000000000000000` + `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` entryLevels=2 exitLevels=4 exact=0 closestGap=40.31%
- Closest loop blocker: amount gap 4447.52% on `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` + `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Proxy spread surface: buyQuotes=11 sellQuotes=27 opportunities=19 policyReady=0 overfit=high_overfit_risk
- Proxy coverage target: group=`wbtc` next=`expand_amount_ladder` reason=`partial_amount_match` buyLevels=7 sellLevels=16 matchedLevels=6
- Stable loop refresh command: `npm run quote:dex -- --route-key="bsc:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d->bitcoin:0x0000000000000000000000000000000000000000" --include-stable-entry`
- Proxy spread refresh command: `npm run quote:dex -- --chains=base,bsc,ethereum --include-stable-entry --route-limit=64`
- Strategy track stable_loop: label=`base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000 + bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` status=`blocked_loop` next=`expand_amount_ladder` reason=`amount_mismatch`
- Strategy track proxy_spread: label=`ethereum->bsc WBTC/wBTC.OFT` status=`thin_coverage` next=`expand_amount_ladder` reason=`partial_amount_match`
- Strategy track eth_family_loop: label=`bitcoin:0x0000000000000000000000000000000000000000->base:0x0000000000000000000000000000000000000000` status=`unobserved` next=`watch_eth_family_surface` reason=`no_multichain_eth_family_surface` command=`npm run scan:quote-surface -- --route-key="bitcoin:0x0000000000000000000000000000000000000000->base:0x0000000000000000000000000000000000000000" && npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard`
- Quote decay: 5s 13/18 · 15s 13/18 · 30s 13/18
- Chain price coverage: observed 3, stale 3, missing 6
- Quoteable chains observed: base,bsc,ethereum
- Quoteable chains missing: avalanche:recent quote failed,sonic:recent quote failed,unichain:recent quote failed
- Non-quoteable chains: bera:DEX unsupported,bob:DEX unsupported,soneium:DEX unsupported
- BTC watchlist observed live: BTC, uniBTC, WBTC, wBTC.OFT
- BTC watchlist missing from live routes: FBTC, LBTC, solvBTC, SolvBTC.BBN, tBTC, xSolvBTC
- BTC watchlist unknown addresses: none
- Last canary advance: avalanche->bera wBTC.OFT->wBTC.OFT (BLOCKED_NO_VIABLE_PREP_ROUTE -> BLOCKED_NO_VIABLE_PREP_ROUTE; actions no_actions)
- Route input freshness: quote stale (360.3m) · exactGas stale (360.3m) · srcGas fresh (0.1m) · dex blocked · btcFee not_needed · market stale (360.2m)
- Route input blockers: reject_no_net_edge
- Canary input watcher: refresh avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 inputs=gateway_quote,exact_gas,market (current canary route inputs are stale)
- Gas refresh watcher: skip avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (gas freshness is not the active blocker)
- DEX refresh watcher: refresh route avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000; rescoring 1 wrapped-BTC route(s) (current canary route chain price is missing)
- Gateway coverage watcher: no fully measurable route shortlist yet
- Blocked-score watcher: rerun touching avalanche,bera; avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (new market inputs arrived after the score snapshot; source gas snapshot)
- Quote-decay watcher: refresh avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (next decay window is due now; window 5s)
- estimator wallet checked routes: 49
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
- `src/strategy/pivot-plan.mjs`
- `src/ledger/yield-shadow-book.mjs`
- `src/strategy/proxy-spread-coverage-plan.mjs`
- `src/cli/report-pivot-plan.mjs`
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
- `src/session/shadow-refresh-runner.mjs`
- `src/cli/run-shadow-refresh-queue.mjs`
- `src/session/shadow-refresh-batch.mjs`
- `src/cli/run-shadow-refresh-batch.mjs`
- `docs/current-status.md`

## Backup Note

- `.env` and `data/` stay out of git.
- This repo is safe to back up publicly only if you are comfortable exposing source; operational secrets are ignored by git.
- Prefer a private GitHub repo for backup.

