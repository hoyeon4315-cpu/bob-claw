# Current Status

Updated: 2026-04-12T20:21:51.517Z

## Start Here

- Read this file first in a shallow session.
- Main command: `npm run advance:canary`
- Queue preview: `npm run run:shadow-refresh-queue -- --limit=3`
- Batch preview: `npm run run:shadow-refresh-batch -- --limit=1`
- Evidence campaign preview: `npm run run:prelive-evidence-campaign`
- Safe status refresh: `npm run audit:overfit && npm run score:gateway -- --write && npm run status:dashboard`
- Pre-live readiness refresh: `npm run report:prelive-readiness -- --write`
- Review package refresh: `npm run build:prelive-review-package -- --write`
- Fork execution planning: `npm run plan:prelive-fork-execution -- --source=objective --write`

## Current Phase

- Address: `0x96262be63aa687563789225c2fe898c27a3b0ae4`
- Phase: canary-prep gating before exact gas
- Decision: `BLOCKED_NO_VIABLE_PREP_ROUTE`
- Headline: Best prepared route still fails objective score review
- Live trading: `BLOCKED`
- Shadow trading: `ALLOWED`

## Progress Snapshot

- Completed so far: top canary route selected · tx payload captured · wallet readiness cleared · exact gas captured
- Remaining steps: refresh stale/missing inputs (source gas) · clear objective blocker (reject_no_net_edge) · advance canary beyond BLOCKED_NO_VIABLE_PREP_ROUTE
- Manual canary review: NOT_READY_FOR_MANUAL_CANARY_REVIEW (reject_no_net_edge)
- Live execution: LIVE_EXECUTION_BLOCKED; audit=LIVE_BLOCKED (audit_blocks_live)

## Best Route Right Now

- Route: `bob->base wBTC.OFT->wBTC.OFT`
- Route key: `bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000`
- txReady=true exactGasDone=true viableForPrep=true
- Input value: $7.13
- Prep funding estimate: $0.0000
- Net edge now: $-0.8153
- Objective score blocker: reject_no_net_edge (net edge $-0.8153)
- Next readiness check: `base->bob wBTC.OFT->wBTC.OFT` amount=`150000`
- Refresh status: ready to rerun the next wallet readiness check now
- Next focus: rerun quotes, gas, or token prices only when market inputs change; wallet readiness is no longer the blocker

## Required Actions Before Exact Gas

- none

## Objective Verification

- This file does not execute validation by itself.
- Rerun `npm run check` before acting on code changes.
- Rerun `npm test` before acting on behavior assumptions.
- Candidate routes observed: 157
- txReady routes: 121
- viable prep routes: 7

## Shadow Roster

- active_canary route=`bob->base wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=true net=$-0.8153 prepFunding=$0.0000 blockers=none priority=evidence_accumulating evidence=shadow:33 quotes:17/17 success:100.0% p95:775ms fee:$0.7798 reasons:reject_effective_system_pnl:33,reject_treasury_execution_refill_cost:33,reject_no_net_edge:19,insufficient_data:14,stale_dex_output_quote:11
- prep_candidate route=`ethereum->sonic WBTC->wBTC.OFT` amount=`10000` txReady=true viableForPrep=true net=$-0.7831 prepFunding=$0.0000 blockers=prep:wallet_not_checked priority=high_quote_latency evidence=shadow:7 quotes:3/3 success:100.0% p95:5969ms fee:$0.7651 reasons:exact_src_execution_gas_not_estimated:7,insufficient_data:7,reject_effective_system_pnl:7,reject_treasury_execution_refill_cost:5,stale_src_gas_snapshot:5
- prep_candidate route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` txReady=true viableForPrep=true net=$-0.5646 prepFunding=$7.11 blockers=prep:token priority=high_quote_latency evidence=shadow:16 quotes:2/2 success:100.0% p95:6159ms fee:$0.5290 reasons:exact_src_execution_gas_not_estimated:16,insufficient_data:16,reject_effective_system_pnl:16,treasury_bootstrap_native_required:16,stale_src_gas_snapshot:14
- prep_candidate route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`25000` txReady=true viableForPrep=true net=$-0.6518 prepFunding=$17.78 blockers=prep:token priority=thin_quote_samples evidence=shadow:8 quotes:1/1 success:100.0% p95:710ms fee:$0.5629 reasons:exact_src_execution_gas_not_estimated:8,insufficient_data:8,reject_effective_system_pnl:8,treasury_bootstrap_native_required:8,reject_treasury_execution_refill_cost:7
- prep_candidate route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`50000` txReady=true viableForPrep=true net=$-0.7399 prepFunding=$35.52 blockers=prep:token priority=thin_quote_samples evidence=shadow:8 quotes:1/1 success:100.0% p95:404ms fee:$0.5623 reasons:exact_src_execution_gas_not_estimated:8,insufficient_data:8,reject_effective_system_pnl:8,treasury_bootstrap_native_required:8,reject_treasury_execution_refill_cost:7

## Shadow Actions

- active_canary route=`bob->base wBTC.OFT->wBTC.OFT` next=wait_for_fresh_inputs reason=reject_no_net_edge
- prep_candidate route=`ethereum->sonic WBTC->wBTC.OFT` next=check_wallet_readiness reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->sonic:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- prep_candidate route=`base->avalanche wBTC.OFT->wBTC.OFT` next=check_wallet_readiness reason=token command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- prep_candidate route=`base->avalanche wBTC.OFT->wBTC.OFT` next=check_wallet_readiness reason=token command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="25000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- prep_candidate route=`base->avalanche wBTC.OFT->wBTC.OFT` next=check_wallet_readiness reason=token command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="50000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Refresh Queue

- rank=1 priority=100 scope=canary next=check_wallet_readiness reason=scheduled_readiness_check route=`base->bob wBTC.OFT->wBTC.OFT` amount=`150000` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="150000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=2 priority=90 scope=prep_candidate next=check_wallet_readiness reason=token route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=3 priority=90 scope=prep_candidate next=check_wallet_readiness reason=token route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`25000` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="25000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=4 priority=90 scope=prep_candidate next=check_wallet_readiness reason=wallet_not_checked route=`ethereum->sonic WBTC->wBTC.OFT` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->sonic:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=5 priority=89 scope=execution_review next=check_wallet_readiness reason=token route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- rank=6 priority=88 scope=stable_loop next=expand_amount_ladder reason=amount_mismatch command=`npm run quote:dex -- --route-key="base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000" --include-stable-entry`
- rank=7 priority=86 scope=proxy_spread next=expand_amount_ladder reason=partial_amount_match proxyGroup=`wbtc` chains=avalanche,base,bsc,ethereum,sonic,unichain command=`npm run quote:dex -- --chains=avalanche,base,bsc,ethereum,sonic,unichain --include-stable-entry --route-limit=64`
- rank=8 priority=79 scope=strategy_discovery next=refresh_partial_loop_measurement reason=secondary_measured_loop route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` command=`npm run verify:gateway -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000" && npm run quote:dex -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --include-stable-entry && npm run score:gateway -- --write --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000"`

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

- Execution review: route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000` status=`measured_hypothesis_under_review` next=`check_wallet_readiness` blockers=token,stale_src_gas_snapshot,exact_src_execution_gas_not_estimated,stale_dex_output_quote
- Execution review rationale: current canary is the only viable prep route; measured leader is not viable for prep yet; measured leader still needs exact gas; measured leader still needs wallet readiness checks; measured leader is still marked insufficient_data; measured leader still has score data gaps
- Execution review command: `npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Discovery candidate: route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` source=`secondary_measured_loop` status=`partial_loop_measurement` next=`refresh_partial_loop_measurement` reason=`secondary_measured_loop`
- Discovery command: `npm run verify:gateway -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amounts="10000" && npm run quote:dex -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --include-stable-entry && npm run score:gateway -- --write --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000"`

## Pivot Gate

- Pivot decision: `stay_blocked` Stay blocked and keep collecting evidence before any canary promotion
- Pivot status: `stay_blocked` currentCanary=`observe_only` measuredLeader=`drop`
- Pivot focus route: `base->unichain wBTC.OFT->wBTC.OFT` amount=`10000`
- Pivot next action: none

## Pre-live Readiness

- Current stage: `shadow_replay`
- Shadow replay: `shadow_replay_blocked` blockers=audit:LIVE_BLOCKED,manual_canary_review_not_ready,no_policy_ready_measured_route audit=LIVE_BLOCKED policyReady=0
- Mechanical simulation: `mechanical_simulation_blocked` success=0/50 failures=0 blockers=shadow_replay_not_ready,needs_50_more_successful_simulations
- Fork execution: `fork_execution_blocked` planned=1 submitted=0 confirmed=0/3 failures=0 blockers=mechanical_simulation_not_ready,needs_3_more_confirmed_fork_cycles
- Execution audit: `complete` missingRecords=0 blockers=none
- Tiny live canary review: `tiny_canary_blocked` blockers=shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready livePolicy=`BLOCKED`
- Pre-live commands: `npm run run:prelive-evidence-campaign` or `npm run run:prelive-simulations -- --source=objective --write` && `npm run plan:prelive-fork-execution -- --source=objective --write` && `npm run report:prelive-readiness -- --write` && `npm run build:prelive-review-package -- --write` && `npm run status:dashboard`
- Latest fork plan: route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000` status=`planned` source=`objective_execution_review`
- Recent execution transition: kind=`fork_plan` status=`planned` route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000`
- Queue follow-up: rank=1 scope=canary label=`base->bob wBTC.OFT->wBTC.OFT` reason=scheduled_readiness_check command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="150000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Queue follow-up: rank=2 scope=prep_candidate label=`base->avalanche wBTC.OFT->wBTC.OFT` reason=token command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Queue follow-up: rank=3 scope=prep_candidate label=`base->avalanche wBTC.OFT->wBTC.OFT` reason=token command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="25000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Queue follow-up: rank=4 scope=prep_candidate label=`ethereum->sonic WBTC->wBTC.OFT` reason=wallet_not_checked command=`npm run check:estimator-wallet -- --route-key="ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->sonic:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`

## Tiny Live Review Package

- Summary: status=`not_ready_for_manual_review` review=`NOT_READY_FOR_MANUAL_CANARY_REVIEW` live=`LIVE_EXECUTION_BLOCKED` stage=`shadow_replay` blockers=manual_review_stage_not_ready,shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready,reject_no_net_edge,stale_src_gas
- Tiny canary admission: decision=`NO_GO` status=`blocked` blockers=manual_review_stage_not_ready,shadow_replay_not_ready,mechanical_simulation_not_ready,fork_execution_not_ready,reject_no_net_edge,stale_src_gas next=`clear_admission_blockers`
- Admission remediation: status=`ready` ready=3 manual=1 blocked=0
- Admission remediation runner: `npm run run:admission-remediation -- --execute --limit=1`
- Admission next action: `refresh_src_gas` status=`ready` command=`npm run gas:snapshot`
- Admission remediation item: rank=1 status=`ready` code=`refresh_src_gas` reason=stale_src_gas command=`npm run gas:snapshot`
- Admission remediation item: rank=2 status=`ready` code=`check_wallet_readiness` reason=manual_review_stage_not_ready command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Admission remediation item: rank=3 status=`ready` code=`execute_refresh_batch` reason=scheduled_readiness_check command=`npm run run:shadow-refresh-batch -- --execute --limit=1`
- Manual review candidate: route=`bob->base wBTC.OFT->wBTC.OFT` amount=`10000` readiness=`reject_no_net_edge` net=$-0.8153 prepFunding=$0.0000 txReady=true viableForPrep=true
- Candidate inputs: quote fresh (0.3m) · exactGas fresh (0.0m) · srcGas stale (30.2m) · dex fresh (1.9m) · btcFee not_needed · market fresh (0.6m)
- Admission constraints: livePolicy=`BLOCKED` ring=`300` dailyLoss=`5` walletFloor=`250` minProfit=`0.3` minEdge=`0.005`
- Candidate blockers: reject_no_net_edge
- Candidate evidence: shadow=33 quotes=17/17 success=100.0% p95=775ms routeFailure=3.2%
- Measured leader review: route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000` readiness=`insufficient_data` measured=$-0.5361 executable=$-0.2896 next=`check_wallet_readiness`
- Leader review rationale: current canary is the only viable prep route; measured leader is not viable for prep yet; measured leader still needs exact gas; measured leader still needs wallet readiness checks; measured leader is still marked insufficient_data; measured leader still has score data gaps | blockers: source token balance missing, source gas snapshot stale, exact execution gas pending, DEX output quote stale
- Pivot gate: decision=`stay_blocked` status=`stay_blocked` currentCanary=`observe_only` measuredLeader=`drop`
- Review checklist: completed=top canary route selected · tx payload captured · wallet readiness cleared · exact gas captured remaining=refresh stale/missing inputs (source gas) · clear objective blocker (reject_no_net_edge) · advance canary beyond BLOCKED_NO_VIABLE_PREP_ROUTE
- Review transition: kind=`fork_plan` status=`planned` route=`base->unichain wBTC.OFT->wBTC.OFT` amount=`10000`
- Review follow-up: rank=1 scope=canary label=`base->bob wBTC.OFT->wBTC.OFT` reason=scheduled_readiness_check command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="150000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Review follow-up: rank=2 scope=prep_candidate label=`base->avalanche wBTC.OFT->wBTC.OFT` reason=token command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Review follow-up: rank=3 scope=prep_candidate label=`base->avalanche wBTC.OFT->wBTC.OFT` reason=token command=`npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="25000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"`
- Guardrail: Mechanical simulation uses RPC estimation and eth_call only; it is not realized execution proof.
- Guardrail: Pre-live execution audit requires plan, submission, receipt, and journal records to stay in sync.
- Guardrail: Fork execution requires an external signer and never stores private keys in planner or dashboard code.
- Guardrail: liveTrading remains BLOCKED until architecture review and explicit canary approval.

## Pre-live Evidence Campaign

- Summary: status=`ready` reviewPackage=`not_ready_for_manual_review` stage=`shadow_replay` ready=1 manual=1 blocked=2 done=1
- Evidence progress: simulations=0/50 forkConfirmed=0/3 refreshRuns=13
- Next campaign action: code=`execute_refresh_batch` status=`ready` reason=scheduled_readiness_check command=`npm run run:shadow-refresh-batch -- --execute --limit=1`
- Campaign action: code=`execute_refresh_batch` status=`ready` automated=true reason=scheduled_readiness_check command=`npm run run:shadow-refresh-batch -- --execute --limit=1`
- Campaign action: code=`collect_simulation_evidence` status=`blocked` automated=true reason=shadow_replay_not_ready
- Campaign action: code=`prepare_fork_cycle` status=`done` automated=true reason=fork_plan_already_open
- Campaign action: code=`submit_fork_cycle` status=`manual` automated=false reason=external_signer_required command=`npm run submit:prelive-fork-execution -- --plan-id="0d9a9ed7eb6040170ef7" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"`
- Campaign action: code=`reconcile_fork_cycle` status=`blocked` automated=false reason=fork_submission_required_first

## Profitability Summary

- Overfit audit: LIVE_BLOCKED · sample=shadow_observations · horizon=32.3h · buckets=11
- Overfit blockers: shadow time window, time bucket diversity
- Overfit warnings: legacy records, gas snapshot failures
- Overfit runway: 135.7h remaining to 168h · 13 hourly buckets remaining to 24
- Overfit time ETA: shadow window 2026-04-18T12:00:56.658Z · bucket diversity 2026-04-13T09:00:00.000Z · earliest time-gate pass 2026-04-18T12:00:56.658Z

- Tested closed loops: 50
- Profitable closed loops: 0
- Loop-observable routes: 10
- Missing focus Gateway quotes: 0
- Profit verdict: measured no-edge universe (The currently measurable closed-loop universe has been tested and still sits well below the minimum profit gate.)
- Current canary route: reject_no_net_edge net=$-0.8128
- Closest route to policy: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` net=$-0.5361 gap=$0.8361 target=$0.3000
- Best stablecoin route tested: `bitcoin:0x0000000000000000000000000000000000000000->bsc:0x55d398326f99059fF775485246999027B3197955` amount=`10000` readiness=`insufficient_data` net=$-1.3775
- Measured leader under review: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` measured=$-0.5361 readiness=`insufficient_data`
- Why it is not the canary: current canary is the only viable prep route; measured leader is not viable for prep yet; measured leader still needs exact gas; measured leader still needs wallet readiness checks; measured leader is still marked insufficient_data; measured leader still has score data gaps | blockers: source token balance missing, source gas snapshot stale, exact execution gas pending, DEX output quote stale
- Revalidation order for measured leader: wallet readiness check -> exact gas estimate -> DEX quote refresh -> selective route scoring -> status dashboard refresh
- Revalidation commands: npm run check:estimator-wallet -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run estimate:gateway-gas -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run quote:dex -- --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run score:gateway -- --write --route-key="base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" --amount="10000" && npm run status:dashboard
- Durable no-edge routes: 10

- Strategy note: BTC-family transfer by itself is usually loss-making after Gateway fee, gas, and slippage.
- Strategy note: the actionable target is a local executable BTC/stable dislocation that beats total movement cost.
- Strategy note: BTC accumulation from a long-term bullish view is directional inventory exposure, not arbitrage profit, so it must not unlock canary or live execution by itself.
- Strong-edge research: definite=0 multiLevel=0 missingDecay=0 singleLevel=0 noEdge=105 outliers=0
- DEX route universe: btcFamily=91 fullyMeasurable=30 singleGap=48 doubleGap=13
- DEX focus shortlist: loopObservable=10 partial=0 missingGatewayQuote=0
- Edge viability: measured=50 positive=0 policyReady=0 medianGap=$25.27
- Edge verdict: measured no-edge universe (The currently measurable closed-loop universe has been tested and still sits well below the minimum profit gate.)
- No-edge persistence: durable=10 belowPolicy=0 nearPolicy=0 positiveBelow=0
- Largest DEX coverage gap chain: `bitcoin` routeCount=19
- Best DEX focus route now: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`loop_observable` gatewayQuotes=6 entryQuotes=13 exitQuotes=15 bestExec=$0.5392
- DEX environment drift: monitored=91 staleLegs=150 unstableLegs=32 thinLiquidityLegs=1 singleSampleLegs=8
- Top DEX environment risk: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->avalanche:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`100000` class=`refresh_needed` staleLegs=3 unstableLegs=0 thinLiquidityLegs=0 singleSampleLegs=0
- Best research route now: `sonic:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bera:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`no_edge` profitableLevels=0/1 bestNet=$-0.5416
- Measured DEX+Gateway coverage: bothDexSupported=70 executable=73 measuredNet=50 exact=51 profitable=0
- Closest route to policy gate: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` amount=`10000` net=$-0.5361 gapToPolicy=$0.8361 target=$0.3000
- Best persistence route now: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` class=`durable_no_edge_route` measuredLevels=5 minGap=$0.8361 bestNet=$-0.5361
- Closest measured DEX+Gateway loop: `base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->unichain:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` netEdge=$-0.5361 amountGap=1.27% blockers=gateway_stale_src_gas_snapshot,gateway_exact_src_execution_gas_not_estimated,gateway_stale_dex_output_quote,non_positive_loop_net_edge
- Best stablecoin-related route now: `bitcoin:0x0000000000000000000000000000000000000000->bsc:0x55d398326f99059fF775485246999027B3197955` amount=`10000` readiness=`insufficient_data` netEdge=$-1.3775
- Best closed stable->BTC->stable loop: none matched yet
- Stable amount ladder: pair=`base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` + `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` entryLevels=1 exitLevels=4 exact=0 closestGap=127.38%
- Closest loop blocker: amount gap 4447.52% on `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000` + `bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Proxy spread surface: buyQuotes=15 sellQuotes=51 opportunities=75 policyReady=0 overfit=moderate_overfit_risk
- Proxy coverage target: group=`wbtc` next=`expand_amount_ladder` reason=`partial_amount_match` buyLevels=6 sellLevels=21 matchedLevels=6
- Stable loop refresh command: `npm run quote:dex -- --route-key="base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000" --include-stable-entry`
- Proxy spread refresh command: `npm run quote:dex -- --chains=avalanche,base,bsc,ethereum,sonic,unichain --include-stable-entry --route-limit=64`
- Objective discovery plan: route=`base->avalanche wBTC.OFT->wBTC.OFT` amount=`10000` next=`refresh_partial_loop_measurement` reason=`secondary_measured_loop`
- Strategy track stable_loop: label=`base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000 + bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` status=`blocked_loop` next=`expand_amount_ladder` reason=`amount_mismatch`
- Strategy track proxy_spread: label=`ethereum->unichain WBTC/wBTC.OFT` status=`thin_coverage` next=`expand_amount_ladder` reason=`partial_amount_match`
- Quote decay: 5s 7/10 · 15s 7/10 · 30s 7/10
- Chain price coverage: observed 6, stale 0, missing 3
- Quoteable chains observed: avalanche,base,bsc,ethereum,sonic,unichain
- Quoteable chains missing: none
- Non-quoteable chains: bera:DEX unsupported,bob:DEX unsupported,soneium:DEX unsupported
- BTC watchlist observed live: BTC, uniBTC, WBTC, wBTC.OFT
- BTC watchlist missing from live routes: FBTC, LBTC, solvBTC, SolvBTC.BBN, tBTC, xSolvBTC
- BTC watchlist unknown addresses: base:0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189
- Last canary advance: bob->base wBTC.OFT->wBTC.OFT (BLOCKED_NO_VIABLE_PREP_ROUTE -> BLOCKED_NO_VIABLE_PREP_ROUTE; actions no_actions)
- Route input freshness: quote fresh (0.3m) · exactGas fresh (0.0m) · srcGas stale (30.2m) · dex fresh (1.9m) · btcFee not_needed · market fresh (0.6m)
- Route input blockers: reject_no_net_edge
- Canary input watcher: refresh bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 inputs=exact_gas (current canary route inputs are stale)
- Gas refresh watcher: skip bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (gas freshness is not the active blocker)
- DEX refresh watcher: skip avalanche,base,bsc,ethereum,sonic,unichain; rescoring 1 wrapped-BTC route(s) (observed chain prices are fresh)
- Gateway coverage watcher: no fully measurable route shortlist yet
- Blocked-score watcher: rerun touching bob,base; bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c amount=10000 (new market inputs arrived after the score snapshot; exact gas, gateway quote, source price, destination price)
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

