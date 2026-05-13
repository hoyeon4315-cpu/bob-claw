import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAllChainAutopilotDashboardSlice,
  resolveUnresolvedRefillCount,
  resolveAllChainAutopilotReport,
} from "../src/status/all-chain-autopilot-slice.mjs";
import { buildCapitalSummarySlice } from "../src/status/capital-summary-slice.mjs";
import { buildFlowDashboardSlice } from "../src/status/flow-slice.mjs";
import { buildMerklActivePositions } from "../src/status/merkl-active-slice.mjs";
import { buildTreasuryHoldingsSlice } from "../src/status/treasury-holdings-slice.mjs";

test("all-chain autopilot dashboard slice keeps only public execution status", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-04-25T03:13:42.514Z",
    mode: "execute",
    status: "completed_with_blockers",
    blockedReason: null,
    chains: ["ethereum", "bob", "base"],
    summary: {
      officialChainCount: 11,
      refillJobCount: 14,
      autoRefillJobCount: 3,
      refillAttemptedCount: 1,
      refillExecutedCount: 0,
      canarySweep: {
        status: "completed",
        executedCount: 9,
        deliveredCount: 9,
        blockedCount: 24,
        chainsTouched: ["base", "ethereum", "base"],
      },
      merklCanary: { status: "blocked", blockedReason: "no_autopilot_candidate_ready" },
      portfolio: {
        status: "positions_opened",
        allocator: {
          deployments: [
            { opportunityId: "137", status: "position_opened", txHash: "0xabc" },
            { opportunityId: "skip", status: "blocked", txHash: null },
          ],
        },
      },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 8,
        successCount: 14,
        failedCount: 0,
        liveEligibleCount: 0,
        missingExecutorCount: 0,
      },
      payback: {
        status: "carry",
        reason: "planned_payback_below_minimum",
        pendingCarrySats: 601,
      },
    },
    refillExecutions: [
      {
        chain: "optimism",
        asset: "wBTC.OFT",
        selectedExecutionMethod: "lifi",
        previewBlockedReason: "lifi_quote_rejected",
        attempted: false,
        executed: false,
      },
    ],
  });

  assert.equal(slice.present, true);
  assert.equal(slice.officialChainCount, 11);
  assert.equal(slice.canary.deliveredCount, 9);
  assert.deepEqual(slice.canary.chainsTouched, ["base", "ethereum"]);
  assert.equal(slice.canaryLadder.enabled, true);
  assert.deepEqual(slice.canaryLadder.rungsUsd, [5, 10, 25, 50, 80]);
  assert.equal(slice.canaryLadder.maxAutoGraduatedUsd, 80);
  assert.equal(slice.canaryLadder.noTxSentNeutral, true);
  assert.equal(slice.portfolio.openedCount, 1);
  assert.equal(slice.payback.pendingCarrySats, 601);
  assert.equal(slice.execution.mode, "execute");
  assert.equal(slice.execution.attemptedLive, true);
  assert.equal(slice.execution.txBroadcastCount, 0);
  assert.equal(slice.execution.refillAttemptedCount, 1);
  assert.equal(slice.execution.strategyLiveEligibleCount, 0);
  assert.equal(slice.execution.noTxReason, "refill_routes_unresolved");
  assert.equal(slice.execution.readOnlyDashboard, true);
  assert.equal(slice.refill.blockedCount, 1);
  assert.equal(slice.refill.unresolvedCount, 1);
  assert.equal(slice.refill.blockers[0].taxonomy, null);
  assert.equal(
    slice.topBlockers.some((item) => item.reason === "lifi_quote_rejected"),
    true,
  );
  assert.equal(slice.nextAction, "resolve_refill_routes");
});

test("all-chain autopilot dashboard slice treats policy no-trade refill blockers as resolved watch state", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-05-13T19:03:55.668Z",
    mode: "execute",
    status: "completed_with_blockers",
    phase: "completed",
    summary: {
      officialChainCount: 11,
      refillJobCount: 4,
      autoRefillJobCount: 4,
      refillAttemptedCount: 3,
      refillExecutedCount: 0,
      canarySweep: { status: "completed", executedCount: 0, deliveredCount: 0, blockedCount: 0, chainsTouched: [] },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 0,
        successCount: 0,
        failedCount: 0,
        liveEligibleCount: 0,
        missingExecutorCount: 0,
      },
      payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 585 },
      portfolio: { status: "no_position_opened", allocator: { deployments: [] } },
    },
    refillExecutions: [
      {
        chain: "base",
        asset: "wBTC.OFT",
        executionBlockedReason: "expected_net_below_receipt_cost_p90_floor,strategy_per_day_cap_exceeded",
        selectedExecutionMethod: "cross_chain_bridge_lifi",
        attempted: true,
        executed: false,
      },
      {
        chain: "optimism",
        asset: "USDC",
        executionBlockedReason: "expected_net_below_receipt_cost_p90_floor",
        selectedExecutionMethod: "cross_chain_bridge_lifi",
        attempted: true,
        executed: false,
      },
      {
        chain: "optimism",
        asset: "wBTC.OFT",
        previewStatus: "deferred",
        previewBlockedReason: "routing_exhausted",
        routeDeferralReason: "bridge_route_unavailable_gateway_no_route_lifi_quote_rejected",
        routeDeferralAction: "defer_until_bridge_provider_supports_pair",
        selectedExecutionMethod: "cross_chain_bridge_lifi",
        attempted: false,
        executed: false,
      },
    ],
  });

  assert.equal(slice.refill.blockedCount, 3);
  assert.equal(slice.refill.unresolvedCount, 0);
  assert.equal(slice.execution.noTxReason, "no_live_eligible_strategy");
  assert.equal(slice.nextAction, "accrue_payback_until_minimum");
});

test("all-chain autopilot dashboard slice repairs stale signer failed refill blockers from step policy evidence", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-05-13T19:03:55.668Z",
    mode: "execute",
    status: "completed_with_blockers",
    phase: "completed",
    summary: {
      officialChainCount: 11,
      refillJobCount: 1,
      autoRefillJobCount: 1,
      refillAttemptedCount: 1,
      refillExecutedCount: 0,
      canarySweep: { status: "completed", executedCount: 0, deliveredCount: 0, blockedCount: 0, chainsTouched: [] },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 0,
        successCount: 0,
        failedCount: 0,
        liveEligibleCount: 0,
        missingExecutorCount: 0,
      },
      payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 585 },
      portfolio: { status: "no_position_opened", allocator: { deployments: [] } },
    },
    refillExecutions: [
      {
        jobId: "policy-blocked-refill",
        chain: "base",
        asset: "wBTC.OFT",
        executionBlockedReason: "signer_execution_failed",
        selectedExecutionMethod: "same_chain_token_to_token_swap",
        attempted: true,
        executed: false,
      },
    ],
    steps: [
      {
        name: "treasury_refill_execute:policy-blocked-refill",
        json: {
          execution: {
            stepResults: [
              {
                id: "approve_input_token",
                signerResult: {
                  status: "rejected",
                  policy: {
                    decision: "BLOCK",
                    blockers: ["expected_net_below_receipt_cost_p90_floor"],
                  },
                },
              },
            ],
          },
        },
      },
    ],
  });

  assert.equal(slice.refill.blockers[0].reason, "expected_net_below_receipt_cost_p90_floor");
  assert.equal(slice.refill.unresolvedCount, 0);
});

test("all-chain autopilot dashboard slice exposes scoped refill blocker recovery details", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-05-09T12:00:00.000Z",
    mode: "execute",
    status: "completed_with_blockers",
    summary: {
      officialChainCount: 11,
      refillJobCount: 2,
      autoRefillJobCount: 2,
      refillAttemptedCount: 0,
      refillExecutedCount: 0,
      canarySweep: { status: "completed", executedCount: 0, deliveredCount: 0, blockedCount: 0, chainsTouched: [] },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 1,
        successCount: 1,
        failedCount: 0,
        liveEligibleCount: 1,
        missingExecutorCount: 0,
      },
      payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 601 },
      portfolio: { status: "blocked", allocator: { deployments: [] } },
    },
    refillExecutions: [
      {
        jobId: "job-a",
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "soneium",
        asset: "wBTC.OFT",
        targetAsset: "wBTC.OFT",
        sourceChain: "avalanche",
        sourceAsset: "0x0555",
        selectedExecutionMethod: "cross_chain_bridge_lifi",
        executorFamily: "lifi",
        routeFamily: "cross_chain_bridge_route",
        previewBlockedReason: "lifi_quote_rejected",
        blockerTaxonomy: "method_specific_failure_lock",
        blockerScope: {
          scopeType: "method",
          strategyId: "wrapped-btc-loop-base-moonwell",
          chain: "soneium",
          targetAsset: "wBTC.OFT",
          sourceAsset: "0x0555",
          selectedMethod: "cross_chain_bridge_lifi",
          executorFamily: "lifi",
          routeFamily: "cross_chain_bridge_route",
        },
        improvementType: "type_1_fixable_plumbing_blocker",
        waitingHelps: true,
        dryRunCommand: "npm run run:refill-job-stub -- --job-id=job-a --method=cross_chain_bridge_lifi --json",
        safeResetCommand: null,
        nextOperatorAction: "retry_after_route_provider_or_quote_state_changes",
        executed: false,
      },
    ],
  });

  assert.equal(slice.refill.unaffectedJobCount, 1);
  assert.equal(slice.refill.waitingHelps, true);
  assert.equal(slice.refill.affectedScopes[0].scopeType, "method");
  assert.equal(slice.refill.affectedScopes[0].selectedMethod, "cross_chain_bridge_lifi");
  assert.equal(slice.refill.blockers[0].improvementType, "type_1_fixable_plumbing_blocker");
  assert.deepEqual(slice.refill.dryRunCommands, [
    "npm run run:refill-job-stub -- --job-id=job-a --method=cross_chain_bridge_lifi --json",
  ]);
  assert.deepEqual(slice.refill.nextOperatorActions, ["retry_after_route_provider_or_quote_state_changes"]);
});

test("all-chain autopilot dashboard slice surfaces payback reserve restoration when refill blockers are cleared", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-04-25T03:13:42.514Z",
    mode: "execute",
    status: "completed_with_blockers",
    blockedReason: null,
    summary: {
      officialChainCount: 11,
      refillJobCount: 0,
      autoRefillJobCount: 0,
      refillAttemptedCount: 0,
      refillExecutedCount: 0,
      canarySweep: {
        status: "completed",
        executedCount: 0,
        deliveredCount: 0,
        blockedCount: 0,
        chainsTouched: [],
      },
      merklCanary: { status: null, blockedReason: null },
      portfolio: {
        status: "no_position_opened",
        allocator: {
          deployments: [],
        },
      },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 1,
        successCount: 1,
        failedCount: 0,
        liveEligibleCount: 1,
        missingExecutorCount: 0,
      },
      payback: {
        status: "defer",
        reason: "reserve_asset_missing",
        pendingCarrySats: 601,
        nextAction: "restore_profit_reserve_wbtc_oft",
      },
    },
    refillExecutions: [],
  });

  assert.equal(slice.payback.nextAction, "restore_profit_reserve_wbtc_oft");
  assert.equal(
    slice.topBlockers.some((item) => item.reason === "reserve_asset_missing"),
    true,
  );
  assert.equal(slice.nextAction, "restore_payback_reserve");
});

test("all-chain autopilot dashboard slice reports Merkl policy blocker after refill execution", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-05-08T01:18:28.763Z",
    mode: "execute",
    status: "completed_with_blockers",
    blockedReason: null,
    summary: {
      officialChainCount: 11,
      refillJobCount: 7,
      autoRefillJobCount: 6,
      refillAttemptedCount: 1,
      refillExecutedCount: 1,
      canarySweep: {
        status: "completed",
        executedCount: 0,
        deliveredCount: 0,
        blockedCount: 5,
        chainsTouched: ["ethereum", "base"],
      },
      merklCanary: {
        status: "blocked",
        blockedReason: "same_chain_unprofitable:need_$5_on_base",
        readyCount: 4,
        selectedCount: 4,
      },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 0,
        successCount: 624,
        failedCount: 118,
        liveEligibleCount: 0,
        missingExecutorCount: 0,
      },
      payback: {
        status: "carry",
        reason: "planned_payback_below_minimum",
        pendingCarrySats: 601,
      },
    },
    refillExecutions: [
      {
        chain: "bsc",
        asset: "USDC",
        executed: true,
        executionStatus: "delivered",
      },
    ],
  });

  assert.equal(slice.execution.txBroadcastCount, 1);
  assert.equal(slice.execution.noTxReason, null);
  assert.equal(slice.execution.merklCanaryReadyCount, 4);
  assert.equal(slice.execution.merklCanaryBlockedReason, "same_chain_unprofitable:need_$5_on_base");
  assert.equal(
    slice.topBlockers.some(
      (item) => item.source === "merkl_canary" && item.reason === "same_chain_unprofitable:need_$5_on_base",
    ),
    true,
  );
  assert.equal(
    slice.topBlockers.some((item) => item.reason === "no_live_eligible_strategy"),
    false,
  );
});

test("all-chain autopilot dashboard slice treats routing exhausted as manual backlog", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-04-27T02:50:15.364Z",
    mode: "execute",
    status: "completed_with_blockers",
    blockedReason: null,
    summary: {
      officialChainCount: 11,
      refillJobCount: 18,
      autoRefillJobCount: 1,
      refillAttemptedCount: 0,
      refillExecutedCount: 0,
      canarySweep: {
        status: "completed",
        executedCount: 11,
        deliveredCount: 11,
        blockedCount: 0,
        chainsTouched: ["base"],
      },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 10,
        successCount: 10,
        failedCount: 0,
        liveEligibleCount: 2,
        missingExecutorCount: 0,
      },
      payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 601 },
      portfolio: { status: "blocked", allocator: { deployments: [] } },
    },
    refillExecutions: [
      {
        chain: "ethereum",
        asset: "wBTC.OFT",
        selectedExecutionMethod: "cross_chain_bridge_lifi",
        previewBlockedReason: "routing_exhausted",
        attempted: false,
        executed: false,
      },
    ],
  });

  assert.equal(slice.refill.blockedCount, 1);
  assert.equal(slice.refill.unresolvedCount, 0);
  assert.equal(slice.refill.manualBacklogCount, 1);
  assert.equal(slice.nextAction, "accrue_payback_until_minimum");
});

test("all-chain autopilot dashboard slice treats LiFi native gas shortfall as deterministic backlog", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-05-05T10:28:00.000Z",
    mode: "preview",
    status: "completed_with_blockers",
    blockedReason: null,
    summary: {
      officialChainCount: 11,
      refillJobCount: 3,
      autoRefillJobCount: 3,
      refillAttemptedCount: 0,
      refillExecutedCount: 0,
      canarySweep: { status: "blocked", executedCount: 0, deliveredCount: 0, blockedCount: 0, chainsTouched: [] },
      strategyDispatch: {
        batchStatus: "preview",
        selectedCount: 0,
        successCount: 0,
        failedCount: 0,
        liveEligibleCount: 1,
        missingExecutorCount: 0,
      },
      payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 601 },
      portfolio: { status: "blocked", allocator: { deployments: [] } },
    },
    refillExecutions: [
      {
        chain: "base",
        asset: "wBTC.OFT",
        selectedExecutionMethod: "cross_chain_bridge_lifi",
        previewBlockedReason: "insufficient_native_balance_for_lifi_gas",
        attempted: false,
        executed: false,
      },
    ],
  });

  assert.equal(slice.refill.blockedCount, 1);
  assert.equal(slice.refill.unresolvedCount, 0);
  assert.equal(slice.refill.manualBacklogCount, 1);
  assert.equal(slice.refill.blockers[0].reason, "insufficient_native_balance_for_lifi_gas");
  assert.equal(slice.nextAction, "accrue_payback_until_minimum");
});

test("all-chain autopilot dashboard slice treats route-ready planned refills as backlog, not unresolved routes", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-05-04T18:31:47.947Z",
    mode: "execute",
    status: "completed_with_blockers",
    blockedReason: "kill_switch_armed",
    summary: {
      officialChainCount: 11,
      refillJobCount: 11,
      autoRefillJobCount: 9,
      refillAttemptedCount: 0,
      refillExecutedCount: 0,
      canarySweep: { status: "blocked", executedCount: 0, deliveredCount: 0, blockedCount: 0, chainsTouched: [] },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 8,
        successCount: 8,
        failedCount: 0,
        liveEligibleCount: 0,
        missingExecutorCount: 0,
      },
      payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 601 },
      portfolio: { status: "blocked", allocator: { deployments: [] } },
    },
    jobs: {
      summary: {
        manualReviewJobCount: 2,
      },
    },
    refillExecutions: [
      {
        chain: "base",
        asset: "wBTC.OFT",
        selectedExecutionMethod: "cross_chain_swap_via_btc_intermediate",
        previewStatus: "ready",
        attempted: false,
        executed: false,
      },
      {
        chain: "base",
        asset: "wBTC.OFT",
        selectedExecutionMethod: "cross_chain_bridge_or_swap",
        previewStatus: "ready",
        attempted: false,
        executed: false,
      },
    ],
  });

  assert.equal(slice.refill.blockedCount, 0);
  assert.equal(slice.refill.unresolvedCount, 0);
  assert.equal(slice.refill.manualBacklogCount, 2);
  assert.equal(slice.nextAction, "accrue_payback_until_minimum");
});

test("all-chain autopilot dashboard slice does not count preview-ready refill jobs as blockers", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-05-04T22:43:45.380Z",
    mode: "preview",
    status: "completed_with_blockers",
    blockedReason: null,
    summary: {
      officialChainCount: 11,
      refillJobCount: 2,
      autoRefillJobCount: 2,
      refillAttemptedCount: 0,
      refillExecutedCount: 0,
      canarySweep: { status: "blocked", executedCount: 0, deliveredCount: 0, blockedCount: 0, chainsTouched: [] },
      strategyDispatch: {
        batchStatus: "preview",
        selectedCount: 0,
        successCount: 0,
        failedCount: 0,
        liveEligibleCount: 0,
        missingExecutorCount: 0,
      },
      payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 601 },
      portfolio: { status: "blocked", allocator: { deployments: [] } },
    },
    refillExecutions: [
      {
        chain: "bob",
        asset: "ETH",
        selectedExecutionMethod: "cross_chain_bridge_or_swap",
        previewStatus: "ready",
        attempted: false,
        executed: false,
      },
      {
        chain: "ethereum",
        asset: "ETH",
        selectedExecutionMethod: "cross_chain_bridge_lifi",
        previewStatus: "ready",
        attempted: false,
        executed: false,
      },
    ],
  });

  assert.equal(slice.refill.blockedCount, 0);
  assert.equal(slice.refill.unresolvedCount, 0);
  assert.deepEqual(slice.refill.blockers, []);
});

test("all-chain autopilot unresolved refill count prefers fresher fully auto-queued capital-manager plans", () => {
  const report = {
    observedAt: "2026-05-04T23:32:21.602Z",
    refillExecutions: [
      {
        refillSource: "capital_manager",
        chain: "base",
        asset: "wBTC.OFT",
        selectedExecutionMethod: "cross_chain_bridge_or_swap",
        previewBlockedReason: "source_inventory_below_target_amount",
        executed: false,
      },
    ],
  };
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: report.observedAt,
    mode: "preview",
    status: "completed_with_blockers",
    blockedReason: null,
    summary: {
      officialChainCount: 11,
      refillJobCount: 1,
      autoRefillJobCount: 0,
      refillAttemptedCount: 0,
      refillExecutedCount: 0,
      canarySweep: { status: "blocked", executedCount: 0, deliveredCount: 0, blockedCount: 0, chainsTouched: [] },
      strategyDispatch: {
        batchStatus: "preview",
        selectedCount: 0,
        successCount: 0,
        failedCount: 0,
        liveEligibleCount: 0,
        missingExecutorCount: 0,
      },
      payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 601 },
      portfolio: { status: "blocked", allocator: { deployments: [] } },
    },
    refillExecutions: report.refillExecutions,
  });

  const unresolved = resolveUnresolvedRefillCount({
    report,
    slice,
    capitalManagerRefillJobsLatest: {
      observedAt: "2026-05-04T23:37:57.631Z",
      summary: {
        jobCount: 11,
        manualReviewJobCount: 0,
        autoQueuedJobCount: 11,
      },
    },
  });

  assert.equal(slice.refill.unresolvedCount, 1);
  assert.equal(unresolved, 0);
});

test("all-chain autopilot truth prefers latest completed report over running progress", () => {
  const resolved = resolveAllChainAutopilotReport(
    { observedAt: "2026-04-27T01:35:00.000Z", status: "running", phase: "refill_complete" },
    { observedAt: "2026-04-27T01:30:00.000Z", status: "completed", phase: "completed" },
  );
  assert.equal(resolved?.status, "completed");
  assert.equal(resolved?.phase, "completed");
});

test("all-chain autopilot truth prefers latest completed report over timed out latest error", () => {
  const resolved = resolveAllChainAutopilotReport(
    {
      observedAt: "2026-04-27T02:58:56.353Z",
      status: "error",
      phase: "completed",
      blockedReason: "Command timed out after 1200000ms",
    },
    { observedAt: "2026-04-27T02:50:15.364Z", status: "completed_with_blockers", phase: "completed" },
  );
  assert.equal(resolved?.status, "completed_with_blockers");
  assert.equal(resolved?.phase, "completed");
  assert.equal(resolved?.observedAt, "2026-04-27T02:50:15.364Z");
});

test("all-chain autopilot truth prefers newer running progress over stale completed error", () => {
  const resolved = resolveAllChainAutopilotReport(
    {
      observedAt: "2026-04-27T03:10:00.000Z",
      status: "running",
      phase: "refill_complete",
      summary: { refillExecutedCount: 1 },
    },
    {
      observedAt: "2026-04-27T02:50:15.364Z",
      status: "error",
      phase: "completed",
      blockedReason: "Command timed out after 1200000ms",
    },
  );
  assert.equal(resolved?.status, "running");
  assert.equal(resolved?.phase, "refill_complete");
  assert.equal(resolved?.summary?.refillExecutedCount, 1);
});

test("all-chain autopilot dashboard slice asks operator to wait while a run is active", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-05-06T18:20:00.000Z",
    mode: "execute",
    status: "running",
    phase: "refill_complete",
    blockedReason: null,
    summary: {
      officialChainCount: 11,
      refillJobCount: 2,
      autoRefillJobCount: 2,
      refillAttemptedCount: 1,
      refillExecutedCount: 1,
      canarySweep: { status: "running", executedCount: 1, deliveredCount: 1, blockedCount: 0, chainsTouched: ["base"] },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 1,
        successCount: 1,
        failedCount: 0,
        liveEligibleCount: 1,
        missingExecutorCount: 0,
      },
      payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 601 },
      portfolio: { status: "blocked", allocator: { deployments: [] } },
    },
    refillExecutions: [
      {
        chain: "base",
        asset: "cbBTC",
        selectedExecutionMethod: "same_chain_token_to_token_swap",
        previewBlockedReason: "max_consecutive_failures_reached",
        executed: false,
      },
    ],
  });

  assert.equal(slice.activeRun, true);
  assert.equal(slice.phase, "refill_complete");
  assert.equal(slice.nextAction, "await_all_chain_autopilot_completion");
});

test("Merkl active positions aggregate open live-capital entries", () => {
  const slice = buildMerklActivePositions(
    [
      {
        event: "position_opened",
        status: "open",
        positionId: "p1",
        opportunityId: "a",
        chain: "base",
        protocolId: "yo",
        name: "USDC Vault on Base",
        amountUsd: 5.1,
        observedAt: "2026-04-25T01:00:00.000Z",
      },
      {
        event: "position_opened",
        status: "open",
        positionId: "p2",
        opportunityId: "a",
        chain: "base",
        protocolId: "yo",
        name: "USDC Vault on Base",
        amountUsd: 1.2,
        entryAprPct: 19.8,
        observedAt: "2026-04-25T02:00:00.000Z",
      },
      {
        event: "position_exit_confirmed",
        status: "closed",
        positionId: "p1",
        opportunityId: "a",
        chain: "base",
        protocolId: "yo",
        amountUsd: 5.1,
        observedAt: "2026-04-25T02:30:00.000Z",
      },
      {
        event: "position_closed",
        status: "closed",
        positionId: "p3",
        opportunityId: "b",
        chain: "ethereum",
        protocolId: "morpho",
        amountUsd: 10,
        observedAt: "2026-04-25T02:00:00.000Z",
      },
    ],
    {
      generatedAt: "2026-04-25T03:00:00.000Z",
    },
  );

  assert.equal(slice.activeCount, 1);
  assert.equal(slice.positionRecordCount, 1);
  assert.equal(slice.items[0].id, "merkl_a");
  assert.equal(slice.items[0].capUsd, 1.2);
  assert.equal(slice.items[0].aprPct, 19.8);
  assert.equal(slice.items[0].activePositionCount, 1);
  assert.deepEqual(slice.items[0].pair, ["usdc"]);
});

test("Merkl active positions prefer protocol mark value while preserving entry cap", () => {
  const slice = buildMerklActivePositions(
    [
      {
        event: "position_opened",
        status: "open",
        positionId: "p1",
        opportunityId: "a",
        chain: "base",
        protocolId: "yo",
        name: "USDC Vault on Base",
        amountUsd: 5.56,
        valueUsd: 5.015801,
        markUsd: 5.015801,
        markSource: "protocol_position_mark",
        markObservedAt: "2026-05-03T12:00:00.000Z",
        markFreshness: "fresh",
        markConfidence: "verified_current",
        observedAt: "2026-05-03T11:58:00.000Z",
      },
    ],
    {
      generatedAt: "2026-05-03T12:01:00.000Z",
    },
  );

  assert.equal(slice.activeCount, 1);
  assert.equal(slice.items[0].capUsd, 5.56);
  assert.equal(slice.items[0].valueUsd, 5.015801);
  assert.equal(slice.items[0].markUsd, 5.015801);
  assert.equal(slice.items[0].markedPositionCount, 1);
  assert.equal(slice.items[0].markSource, "protocol_position_mark");
  assert.equal(slice.items[0].markObservedAt, "2026-05-03T12:00:00.000Z");
  assert.equal(slice.items[0].markFreshness, "fresh");
  assert.equal(slice.items[0].markConfidence, "verified_current");
});

test("treasury holdings slice normalizes latest inventory into dashboard balances", () => {
  const slice = buildTreasuryHoldingsSlice(
    [
      {
        observedAt: "2026-04-25T01:00:00.000Z",
        summary: { estimatedWalletUsd: 1, activeChainCount: 1, supportedChainCount: 1 },
        native: [],
        tokens: [],
      },
      {
        observedAt: "2026-04-25T02:00:00.000Z",
        summary: {
          estimatedWalletUsd: 20.5,
          activeChainCount: 2,
          supportedChainCount: 3,
          nativeRefillRequiredCount: 1,
          tokenRefillRequiredCount: 2,
        },
        native: [{ chain: "base", asset: "ETH", actualDecimal: 0.01, estimatedUsd: 10, status: "ready" }],
        tokens: [{ chain: "base", ticker: "wBTC.OFT", actualDecimal: 0.0001, estimatedUsd: 7, status: "below_target" }],
      },
    ],
    { generatedAt: "2026-04-25T03:00:00.000Z" },
  );

  assert.equal(slice.pending, false);
  assert.equal(slice.totalUsd, 17);
  assert.equal(slice.activeChainCount, 2);
  assert.equal(slice.refillRequiredCount, 3);
  assert.deepEqual(
    slice.items.map((item) => item.sym),
    ["eth", "wbtc"],
  );
});

test("treasury holdings slice does not use generatedAt as material source freshness", () => {
  const slice = buildTreasuryHoldingsSlice(
    [
      {
        observedAt: "2026-04-25T02:00:00.000Z",
        summary: { estimatedWalletUsd: 20.5, activeChainCount: 1, supportedChainCount: 1 },
        native: [{ chain: "base", asset: "ETH", actualDecimal: 0.01, estimatedUsd: 10, status: "ready" }],
        tokens: [{ chain: "base", ticker: "wBTC.OFT", actualDecimal: 0.0001, estimatedUsd: 7, status: "below_target" }],
      },
    ],
    { generatedAt: "2026-04-25T03:00:00.000Z" },
  );

  assert.equal(slice.items[0].sourceObservedAt, "2026-04-25T02:00:00.000Z");
  assert.equal(slice.items[0].freshness, "stale");
});

test("capital summary treats unmarked deployed Merkl positions as verified minimum", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 205.5,
      itemizedSupportedWalletUsd: 205.5,
      fullWalletUsd: 244.75,
      fullWalletObservedAt: "2026-04-25T05:55:00.000Z",
      fullWalletProvider: "zerion",
      walletCoverage: "full_external",
      items: [{ sym: "usdc", usd: 100 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Deposit USDC to YO",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 96.25,
        },
        {
          opportunityId: "b",
          label: "Supply RLUSD on Euler",
          chain: "ethereum",
          protocol: "euler",
          pair: ["rlusd"],
          capUsd: 51.44,
        },
      ],
    },
    generatedAt: "2026-04-25T06:00:00.000Z",
  });

  assert.equal(slice.walletUsd, 205.5);
  assert.equal(slice.deployedUsd, 0);
  assert.equal(slice.accountedUsd, 205.5);
  assert.equal(slice.executorEstimatedTotalUsd, null);
  assert.equal(slice.totalUsd, 205.5);
  assert.equal(slice.totalUsdSource, "accounted_wallet_plus_positions");
  assert.equal(slice.walletSource, null);
  assert.equal(slice.walletObservedAt, null);
  assert.equal(slice.walletScanErrorCount, 0);
  assert.equal(slice.externalWalletUsd, null);
  assert.equal(slice.unclassifiedUsd, null);
  assert.equal(slice.itemizedSupportedWalletUsd, 205.5);
  assert.equal(slice.fullWalletUsd, 244.75);
  assert.equal(slice.fullWalletObservedAt, "2026-04-25T05:55:00.000Z");
  assert.equal(slice.fullWalletProvider, "zerion");
  assert.equal(slice.fullWalletStale, false);
  assert.equal(slice.walletCoverage, "full_external");
  assert.equal(slice.displayWalletUsd, 205.5);
  assert.equal(slice.displayTotalUsd, 205.5);
  assert.equal(slice.displayTotalUsdSource, "supported_wallet_plus_positions_external_reference");
  assert.equal(slice.currentWalletUsd, 205.5);
  assert.equal(slice.protocolDeployedUsd, 0);
  assert.equal(slice.currentTotalUsd, 205.5);
  assert.equal(slice.assetFormula, "current_wallet_plus_tracked_protocol_positions");
  assert.equal(slice.assetConfidence, "verified_minimum");
  assert.equal(slice.assetHeadline, "Verified minimum assets");
  assert.equal(slice.reconciliationState, "needs_protocol_position_marks");
  assert.equal(slice.activePositionCount, 2);
  assert.equal(slice.positionItems[0].usd, null);
  assert.equal(slice.positionItems[0].confidence, null);
  assert.deepEqual(
    slice.positionItems.map((item) => item.protocol),
    ["yo", "euler"],
  );
});

test("capital summary uses wallet plus marked protocol positions as current total", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 267.79,
      walletCoverage: "partial_supported",
      items: [{ sym: "usdc", usd: 267.79 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Deposit USDC to YO",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 5.56,
          valueUsd: 5.015801,
          markSource: "protocol_position_mark",
          markFreshness: "fresh",
          markConfidence: "verified_current",
          markObservedAt: "2026-05-03T12:00:00.000Z",
        },
      ],
    },
    generatedAt: "2026-05-03T12:01:00.000Z",
  });

  assert.equal(slice.currentWalletUsd, 267.79);
  assert.equal(slice.protocolDeployedUsd, 5.02);
  assert.equal(slice.currentTotalUsd, 272.81);
  assert.equal(slice.verifiedMinimumUsd, 272.81);
  assert.equal(slice.assetConfidence, "verified_minimum");
  assert.equal(slice.assetHeadline, "Verified minimum assets");
  assert.equal(slice.assetFormula, "current_wallet_plus_marked_protocol_positions");
  assert.equal(slice.reconciliationState, "needs_full_wallet_coverage");
  assert.equal(slice.systemConfidence, "medium");
  assert.equal(slice.autoExecutionSafe, false);
  assert.equal(slice.invariantViolationCount, 1);
  assert.equal(slice.invariantViolations[0].code, "wallet_coverage_partial");
  assert.equal(slice.positionItems[0].usd, 5.015801);
  assert.equal(slice.positionItems[0].entryUsd, 5.56);
  assert.equal(slice.positionItems[0].markSource, "protocol_position_mark");
  assert.equal(slice.positionItems[0].freshness, "fresh");
  assert.equal(slice.positionItems[0].confidence, "verified_current");
  assert.equal(slice.positionItems[0].priceFreshness, "fresh");
  assert.deepEqual(slice.positionItems[0].priceSource, {
    name: "protocol_position_mark",
    type: "protocol_position_mark",
    observedAt: "2026-05-03T12:00:00.000Z",
    divergencePct: 0,
  });
});

test("capital summary surfaces trusted automation protocol tracking gaps without changing current total", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 250,
      walletCoverage: "full_rpc",
      items: [{ sym: "usdc", usd: 250 }],
      assetUniverse: {
        status: "closed",
        unknownTargetCount: 0,
      },
      unknownAssetBalanceCount: 0,
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Deposit USDC to YO",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 10,
          valueUsd: 10,
          markSource: "protocol_position_mark",
          markFreshness: "fresh",
          markConfidence: "verified_current",
          markObservedAt: "2026-05-03T12:00:00.000Z",
        },
      ],
    },
    executorEstimatedAssetValueUsd: 300,
    generatedAt: "2026-05-03T12:01:00.000Z",
  });

  assert.equal(slice.currentWalletUsd, 250);
  assert.equal(slice.protocolDeployedUsd, 10);
  assert.equal(slice.currentTotalUsd, 260);
  assert.equal(slice.executorEstimatedTotalUsd, 300);
  assert.equal(slice.executorEstimateDeltaUsd, 40);
  assert.equal(slice.protocolTrackingGapUsd, 40);
  assert.equal(slice.estimatedUntrackedProtocolUsd, 40);
  assert.equal(slice.estimatedProtocolDeployedUsd, 50);
  assert.equal(slice.estimatedCurrentTotalUsd, 300);
  assert.equal(slice.trackingGapSource, "automation_estimate_minus_verified_assets");
  assert.equal(slice.reconciliationGapUsd, 40);
  assert.equal(slice.autoExecutionSafe, false);
  assert.equal(
    slice.invariantViolations.some((item) => item.code === "reconciliation_gap"),
    true,
  );
  assert.equal(slice.assetClaimLabel, "Inferred");
});

test("capital summary keeps unknown asset universe gaps out of exact confidence", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 100,
      walletCoverage: "full_rpc",
      items: [{ sym: "usdc", usd: 100 }],
      assetUniverse: {
        status: "needs_review",
        unknownTargetCount: 1,
      },
      unknownAssetBalanceCount: 1,
      unknownAssetBalances: [{ chain: "base", token: "0x1234567890123456789012345678901234567890" }],
    },
    merklActivePositions: { items: [] },
    generatedAt: "2026-05-05T22:31:00.000Z",
  });

  assert.equal(slice.assetConfidence, "verified_minimum");
  assert.equal(slice.reconciliationState, "needs_reconciliation");
  assert.equal(slice.assetUniverseUnknownTargetCount, 1);
  assert.equal(slice.unknownAssetBalanceCount, 1);
  assert.equal(slice.autoExecutionSafe, false);
});

test("capital summary can reach verified_current when wallet coverage is full_rpc and no gaps remain", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 100,
      walletCoverage: "full_rpc",
      items: [{ sym: "usdc", usd: 100 }],
      assetUniverse: {
        status: "closed",
        unknownTargetCount: 0,
      },
      unknownAssetBalanceCount: 0,
    },
    merklActivePositions: { items: [] },
    generatedAt: "2026-05-05T22:31:00.000Z",
  });

  assert.equal(slice.assetConfidence, "verified_current");
  assert.equal(slice.reconciliationState, "reconciled");
  assert.equal(slice.currentTotalUsd, 100);
});

test("capital summary stays verified minimum when latest protocol mark diagnostics failed", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 267.79,
      walletCoverage: "partial_supported",
      items: [{ sym: "usdc", usd: 267.79 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Deposit USDC to YO",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 5.56,
          valueUsd: 5.015801,
          markSource: "protocol_position_mark",
          markFreshness: "fresh",
          markConfidence: "verified_current",
          markObservedAt: "2026-05-03T12:00:00.000Z",
        },
      ],
    },
    protocolPositionMarks: {
      confidence: "verified_minimum",
      failedPositionCount: 1,
      stalePositionCount: 0,
      expiredPositionCount: 0,
    },
    generatedAt: "2026-05-03T12:01:00.000Z",
  });

  assert.equal(slice.currentTotalUsd, 272.81);
  assert.equal(slice.assetConfidence, "verified_minimum");
  assert.equal(slice.assetFormula, "current_wallet_plus_tracked_protocol_positions");
  assert.equal(slice.reconciliationState, "needs_protocol_position_marks");
  assert.equal(slice.protocolMarkFailedCount, 1);
  assert.equal(slice.systemConfidence, "low");
  assert.equal(slice.autoExecutionSafe, false);
  assert.equal(slice.protocolMarkIssueCount, 1);
});

test("capital summary treats expired protocol marks as verified minimum", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 267.79,
      walletCoverage: "partial_supported",
      items: [{ sym: "usdc", usd: 267.79 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Deposit USDC to YO",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 5.56,
          valueUsd: 5.015801,
          markSource: "protocol_position_mark",
          markFreshness: "expired",
          markConfidence: "verified_minimum",
          markObservedAt: "2026-05-03T10:00:00.000Z",
        },
      ],
    },
    generatedAt: "2026-05-03T12:01:00.000Z",
  });

  assert.equal(slice.currentTotalUsd, 272.81);
  assert.equal(slice.verifiedMinimumUsd, 272.81);
  assert.equal(slice.protocolDeployedUsd, 5.02);
  assert.equal(slice.assetConfidence, "verified_minimum");
  assert.equal(slice.assetHeadline, "Verified minimum assets");
  assert.equal(slice.assetFormula, "current_wallet_plus_tracked_protocol_positions");
  assert.equal(slice.reconciliationState, "needs_protocol_position_marks");
  assert.equal(slice.unmarkedProtocolPositionCount, 1);
});

test("capital summary surfaces adapter gaps and recent signer settlement as reconciliation alerts", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 267.79,
      walletCoverage: "partial_supported",
      items: [{ sym: "usdc", usd: 267.79 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Deposit USDC to YO",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 5.56,
          valueUsd: 5.015801,
          markSource: "protocol_position_mark",
          markFreshness: "fresh",
          markConfidence: "verified_current",
          markObservedAt: "2026-05-03T12:00:00.000Z",
        },
      ],
    },
    protocolPositionMarks: {
      confidence: "verified_minimum",
      failedPositionCount: 1,
      stalePositionCount: 0,
      expiredPositionCount: 0,
      items: [
        {
          positionId: "p1",
          event: "position_marked",
          freshness: "fresh",
          confidence: "verified_current",
          valueUsd: 5.015801,
          observedAt: "2026-05-03T12:00:00.000Z",
        },
        {
          positionId: "p2",
          event: "position_mark_failed",
          freshness: "failed",
          confidence: "adapter_missing",
          failureKind: "no_reader_no_adapter",
          observedAt: "2026-05-03T12:00:30.000Z",
        },
      ],
    },
    signerAuditRecords: [
      {
        timestamp: "2026-05-03T12:00:45.000Z",
        lifecycle: { stage: "broadcasted" },
      },
    ],
    generatedAt: "2026-05-03T12:01:00.000Z",
  });

  assert.equal(slice.systemConfidence, "low");
  assert.equal(slice.autoExecutionSafe, false);
  assert.equal(slice.pendingSignerActionCount, 1);
  assert.equal(slice.adapterCoverageGapCount, 1);
  assert.equal(slice.currentProtocolMarkCount, 1);
  assert.equal(slice.protocolMarkCoverageState, "needs_adapter");
  assert.equal(slice.protocolMarkIssueCount, 1);
  assert.equal(slice.latestProtocolMarkObservedAt, "2026-05-03T12:00:30.000Z");
  assert.equal(
    slice.invariantViolations.some((item) => item.code === "adapter_coverage_gap"),
    true,
  );
  assert.equal(
    slice.invariantViolations.some((item) => item.code === "pending_signer_activity"),
    true,
  );
});

test("capital summary does not price failed protocol marks from entry cap", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 267.79,
      walletCoverage: "partial_supported",
      items: [{ sym: "usdc", usd: 267.79 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "pendle-direct",
          label: "pendle direct",
          chain: "base",
          protocol: "pendle",
          pair: ["usdc"],
          capUsd: 5,
          markFailureKind: "rpc_failed",
          markFailureMessage: "missing revert data",
          lastObservedAt: "2026-05-13T10:24:44.361Z",
        },
      ],
    },
    generatedAt: "2026-05-13T22:14:46.367Z",
  });

  assert.equal(slice.protocolDeployedUsd, 0);
  assert.equal(slice.currentTotalUsd, 267.79);
  assert.equal(slice.unmarkedProtocolPositionCount, 1);
  assert.equal(slice.positionItems[0].usd, null);
  assert.equal(slice.positionItems[0].entryUsd, 5);
  assert.equal(slice.positionItems[0].freshness, "failed");
  assert.equal(slice.positionItems[0].confidence, "adapter_missing");
  assert.equal(slice.positionItems[0].priceFreshness, "failed");
});

test("capital summary ignores pending signer stages once a final stage exists for the same intent", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 100,
      walletCoverage: "full_rpc",
      assetUniverse: { status: "closed", unknownTargetCount: 0 },
      items: [{ sym: "usdc", usd: 100 }],
    },
    signerAuditRecords: [
      {
        intentHash: "intent-1",
        timestamp: "2026-05-03T12:00:10.000Z",
        lifecycle: { stage: "broadcasted" },
      },
      {
        intentHash: "intent-1",
        timestamp: "2026-05-03T12:00:40.000Z",
        lifecycle: { stage: "confirmed" },
      },
    ],
    generatedAt: "2026-05-03T12:01:00.000Z",
  });

  assert.equal(slice.pendingSignerActionCount, 0);
  assert.equal(
    slice.invariantViolations.some((item) => item.code === "pending_signer_activity"),
    false,
  );
});

test("capital summary gives zero-value residual positions freshness metadata", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 100,
      walletCoverage: "full_rpc",
      assetUniverse: { status: "closed", unknownTargetCount: 0 },
      items: [{ sym: "usdc", usd: 100 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Residual YO",
          pair: ["usdc"],
          valueUsd: 0,
          lastObservedAt: "2026-05-03T12:00:00.000Z",
        },
      ],
    },
    generatedAt: "2026-05-03T12:01:00.000Z",
  });

  assert.equal(slice.positionItems[0].freshness, "fresh");
  assert.equal(slice.positionItems[0].confidence, "verified_current");
  assert.equal(slice.positionItems[0].priceFreshness, "fresh");
  assert.equal(slice.positionItems[0].priceDivergenceStatus, "ok");
});

test("capital summary treats unmarked protocol entries as a verified minimum", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 205.5,
      walletCoverage: "partial_supported",
      items: [{ sym: "usdc", usd: 205.5 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Deposit USDC to YO",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 5.56,
          valueUsd: 5.56,
        },
      ],
    },
    generatedAt: "2026-05-03T00:46:00.000Z",
  });

  assert.equal(slice.currentTotalUsd, 211.06);
  assert.equal(slice.assetConfidence, "verified_minimum");
  assert.equal(slice.assetHeadline, "Verified minimum assets");
  assert.equal(slice.assetFormula, "current_wallet_plus_tracked_protocol_positions");
  assert.equal(slice.reconciliationState, "needs_protocol_position_marks");
  assert.equal(slice.unmarkedProtocolPositionCount, 1);
});

test("capital summary ignores stale external wallet references for live wallet accounting", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 230.88,
      fullWalletUsd: 255.12,
      fullWalletStale: true,
      walletCoverage: "full_external_stale",
      scanErrorCount: 2,
      scanErrors: [
        { kind: "external_portfolio", provider: "zerion", message: "Zerion wallet portfolio request failed: 429" },
        { kind: "token", chain: "ethereum", token: "0x0555", message: "All RPC endpoints failed for chain: ethereum" },
      ],
      items: [{ sym: "usdc", usd: 230.88 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Deploy USDC",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 53.62,
        },
      ],
    },
    executorEstimatedAssetValueUsd: 469.01,
    generatedAt: "2026-04-27T00:00:00.000Z",
  });

  assert.equal(slice.accountedUsd, 230.88);
  assert.equal(slice.executorEstimatedTotalUsd, null);
  assert.equal(slice.capitalPlanRefillRequiredUsd, 469.01);
  assert.equal(slice.totalUsd, 230.88);
  assert.equal(slice.totalUsdSource, "accounted_wallet_plus_positions");
  assert.equal(slice.displayWalletUsd, 230.88);
  assert.equal(slice.displayTotalUsd, 230.88);
  assert.equal(slice.displayTotalUsdSource, "partial_supported_wallet_plus_positions");
  assert.equal(slice.currentWalletUsd, 230.88);
  assert.equal(slice.protocolDeployedUsd, 0);
  assert.equal(slice.currentTotalUsd, 230.88);
  assert.equal(slice.verifiedMinimumUsd, 230.88);
  assert.equal(slice.estimatedUntrackedProtocolUsd, null);
  assert.equal(slice.estimatedProtocolDeployedUsd, 0);
  assert.equal(slice.estimatedCurrentTotalUsd, 230.88);
  assert.equal(slice.estimatedAssetHeadline, "Verified minimum assets");
  assert.equal(slice.estimatedTotalUsdSource, "verified_wallet_plus_tracked_protocols");
  assert.equal(slice.assetFormula, "current_wallet_plus_tracked_protocol_positions");
  assert.equal(slice.walletCoverage, "partial_supported");
  assert.equal(slice.fullWalletUsd, null);
  assert.equal(slice.externalWalletUsd, null);
  assert.equal(slice.referenceFullWalletGapUsd, null);
  assert.equal(slice.executorEstimateDeltaUsd, null);
  assert.equal(slice.protocolTrackingGapUsd, null);
  assert.equal(slice.trackingGapUsd, null);
  assert.equal(slice.trackingGapSource, null);
  assert.equal(slice.accountingWarning, null);
  assert.equal(slice.walletScanErrorCount, 1);
  assert.deepEqual(
    slice.walletScanErrors.map((error) => error.provider || error.chain),
    ["ethereum"],
  );
});

test("capital summary marks current total as a verified minimum when reconciliation inputs disagree", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      source: "whole_wallet_inventory",
      observedAt: "2026-05-02T20:23:11.085Z",
      walletCoverage: "partial_supported",
      fullWalletUsd: null,
      fullWalletObservedAt: null,
      fullWalletStale: false,
      totalUsd: 213.23,
      scanErrorCount: 2,
      items: [
        { sym: "wbtc", name: "wBTC.OFT", chain: "avalanche", usd: 45.91 },
        { sym: "eth", name: "ETH", chain: "ethereum", usd: 19.55 },
      ],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "137",
          label: "Deposit USDC to YO",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 5.56,
        },
      ],
    },
    executorEstimatedAssetValueUsd: 454.56,
    generatedAt: "2026-05-02T20:30:00.000Z",
  });

  assert.equal(slice.currentTotalUsd, 213.23);
  assert.equal(slice.verifiedMinimumUsd, 213.23);
  assert.equal(slice.capitalPlanRefillRequiredUsd, 454.56);
  assert.equal(slice.estimatedUntrackedProtocolUsd, null);
  assert.equal(slice.estimatedProtocolDeployedUsd, 0);
  assert.equal(slice.estimatedCurrentTotalUsd, 213.23);
  assert.equal(slice.estimatedAssetHeadline, "Verified minimum assets");
  assert.equal(slice.estimatedTotalUsdSource, "verified_wallet_plus_tracked_protocols");
  assert.equal(slice.assetConfidence, "verified_minimum");
  assert.equal(slice.assetHeadline, "Verified minimum assets");
  assert.equal(slice.referenceFullWalletGapUsd, null);
  assert.equal(slice.planGapUsd, null);
  assert.equal(slice.protocolTrackingGapUsd, null);
  assert.equal(slice.trackingGapUsd, null);
  assert.equal(slice.trackingGapSource, null);
  assert.equal(slice.reconciliationState, "needs_reconciliation");
});

test("flow dashboard slice exposes movement edges and policy rejection blockers", () => {
  const slice = buildFlowDashboardSlice({
    executionEvents: [
      {
        eventType: "execution_funding_outcome",
        settlementStatus: "delivered",
        strategyId: "gateway-btc-funding-transfer",
        observedAt: "2026-04-25T06:21:00.000Z",
        chain: "avalanche",
        asset: "wBTC.OFT",
        receiptIngest: {
          receiptRecord: {
            routeContext: {
              routeKey: "soneium:0x0555->avalanche:0x0555",
              srcChain: "soneium",
              dstChain: "avalanche",
              dstTicker: "wBTC.OFT",
              estimatedInputUsd: 46,
            },
          },
        },
      },
      {
        eventType: "execution_funding_outcome",
        settlementStatus: "delivered",
        strategyId: "lifi-bridge",
        observedAt: "2026-04-25T06:23:00.000Z",
        chain: "optimism",
        asset: "USDC",
        executionMethod: "cross_chain_bridge_lifi",
        receiptIngest: {
          receiptRecord: {
            routeContext: {
              routeKey: "base:usdc->optimism:usdc",
              srcChain: "base",
              dstChain: "optimism",
              dstTicker: "USDC",
              estimatedInputUsd: 12,
            },
            output: {
              asset: {
                ticker: "USDC",
                icon: "usdc",
              },
            },
          },
        },
      },
      {
        eventType: "execution_funding_outcome",
        settlementStatus: "delivered",
        strategyId: "gateway-btc-funding-transfer",
        observedAt: "2026-04-24T23:59:00.000Z",
        chain: "bsc",
        asset: "wBTC.OFT",
        receiptIngest: {
          receiptRecord: {
            routeContext: {
              routeKey: "bsc:0x0555->base:0x0555",
              srcChain: "bsc",
              dstChain: "base",
              dstTicker: "wBTC.OFT",
              estimatedInputUsd: 33,
            },
          },
        },
      },
    ],
    signerAuditRecords: [
      {
        timestamp: "2026-04-25T06:22:00.000Z",
        strategyId: "native-gas-refill",
        chain: "base",
        amountUsd: 21.92,
        policyVerdict: "rejected",
        intentHash: "intent-1",
        intentId: "intent-1",
        intent: {
          intentType: "dex_swap",
          metadata: {
            provider: "odos",
            assetSymbol: "ETH",
          },
        },
        lifecycle: {
          stage: "rejected",
          blockers: ["strategy_per_tx_cap_exceeded"],
        },
      },
      {
        timestamp: "2026-04-25T06:20:00.000Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "soneium",
        amountUsd: 46,
        policyVerdict: "approved",
        intentHash: "intent-2",
        intentId: "intent-2",
        intent: {
          intentType: "gateway_btc_transfer",
          metadata: {
            gatewayRouteKey: "soneium:0x0555->avalanche:0x0555",
          },
        },
        lifecycle: {
          stage: "confirmed",
          txHash: "0xabc",
        },
      },
    ],
    capitalSummary: { totalUsd: 999, currentTotalUsd: 354.5 },
    btcUsd: 100000,
    generatedAt: "2026-04-25T06:30:00.000Z",
  });

  const rejected = slice.recentActivities.find((activity) => activity.strategyId === "native-gas-refill");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.protocol, "odos");
  assert.equal(rejected.detail, "odos dex_swap");
  assert.deepEqual(rejected.blockers, ["strategy_per_tx_cap_exceeded"]);

  assert.ok(slice.recentMovements.length >= 1);
  const movement = slice.recentMovements.find(
    (item) => item.fromChainId === "soneium" && item.toChainId === "avalanche",
  );
  assert.ok(movement, "expected Soneium -> Avalanche movement");
  assert.equal(movement.kind, "gateway_bridge");
  assert.equal(movement.semanticLayer, "transport");
  assert.equal(movement.positionLike, false);
  assert.equal(movement.routeCategory, "gateway_transport");
  assert.equal(movement.routeProvider, "gateway");
  assert.equal(movement.viaGateway, true);
  assert.equal(movement.assetId, "wbtc");
  assert.equal(movement.toAssetId, "wbtc");
  assert.equal(movement.amountUsd, 46);
  const directMovement = slice.recentMovements.find(
    (item) => item.fromChainId === "base" && item.toChainId === "optimism",
  );
  assert.ok(directMovement, "expected Base -> Optimism direct movement");
  assert.equal(directMovement.kind, "direct_bridge");
  assert.equal(directMovement.semanticLayer, "transport");
  assert.equal(directMovement.positionLike, false);
  assert.equal(directMovement.routeCategory, "third_party_bridge");
  assert.equal(directMovement.routeProvider, "lifi");
  assert.equal(directMovement.viaGateway, false);
  assert.equal(directMovement.assetId, "usdc");
  assert.equal(slice.movementSummary.totalCount, 2);
  assert.equal(slice.movementSummary.deliveredCount, 2);
  assert.equal(slice.movementSummary.pendingCount, 0);
  assert.deepEqual(slice.movementSummary.byStatus, [{ status: "delivered", count: 2 }]);
  assert.equal(
    slice.recentMovements.some((item) => item.fromChainId === "bsc" && item.toChainId === "base"),
    false,
    "expected movement older than 6h to be excluded from recent movement animation",
  );
});

test("flow dashboard slice keeps recent cross-chain route plans visible when blocked before broadcast", () => {
  const slice = buildFlowDashboardSlice({
    executionEvents: [
      {
        observedAt: "2026-04-25T06:24:00.000Z",
        eventType: "execution_attempt_blocked",
        status: "blocked",
        jobId: "job-route-plan",
        chain: "soneium",
        asset: "wBTC.OFT",
        executionMethod: "cross_chain_bridge_or_swap",
        fundingSource: {
          method: "cross_chain_bridge_or_swap",
          source: {
            chain: "base",
            ticker: "wBTC.OFT",
            estimatedUsd: 61.5,
          },
        },
        riskDecision: {
          metrics: {
            exposureUsd: 45.25,
            strategyId: "merkl_portfolio_stable_carry_refill",
          },
        },
      },
    ],
    generatedAt: "2026-04-25T06:30:00.000Z",
  });

  assert.equal(slice.recentMovements.length, 1);
  assert.equal(slice.recentMovements[0].fromChainId, "base");
  assert.equal(slice.recentMovements[0].toChainId, "soneium");
  assert.equal(slice.recentMovements[0].assetId, "wbtc");
  assert.equal(slice.recentMovements[0].status, "blocked");
  assert.equal(slice.recentMovements[0].projected, true);
  assert.equal(slice.recentMovements[0].routeProvider, "gateway");
  assert.equal(slice.recentMovements[0].amountUsd, 45.25);
  assert.equal(slice.movementSummary.totalCount, 1);
  assert.equal(slice.movementSummary.blockedCount, 1);
  assert.deepEqual(slice.movementSummary.byReason, [{ reason: "blocked", count: 1 }]);
});

test("flow dashboard slice collapses repeated movement states by route", () => {
  const routeContext = {
    routeKey: "bsc:0x0555->avalanche:0x0555",
    srcChain: "bsc",
    dstChain: "avalanche",
    dstTicker: "wBTC.OFT",
    estimatedInputUsd: 34.5,
  };
  const slice = buildFlowDashboardSlice({
    executionEvents: [
      {
        eventType: "execution_funding_outcome",
        settlementStatus: "delivered",
        strategyId: "gateway-btc-funding-transfer",
        observedAt: "2026-05-02T20:14:45.351Z",
        chain: "avalanche",
        asset: "wBTC.OFT",
        jobId: "same-route-delivered",
        receiptIngest: { receiptRecord: { routeContext } },
      },
    ],
    signerAuditRecords: [
      {
        timestamp: "2026-05-02T20:14:17.536Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "bsc",
        amountUsd: 34.5,
        policyVerdict: "approved",
        intentHash: "same-route-confirmed",
        intentId: "same-route-confirmed",
        intent: {
          intentType: "gateway_btc_transfer",
          metadata: { gatewayRouteKey: routeContext.routeKey },
        },
        lifecycle: {
          stage: "confirmed",
          txHash: "0xabc",
        },
      },
      {
        timestamp: "2026-05-02T20:13:30.000Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "bsc",
        amountUsd: 34.5,
        policyVerdict: "approved",
        intentHash: "same-route-broadcasted",
        intentId: "same-route-broadcasted",
        intent: {
          intentType: "gateway_btc_transfer",
          metadata: { gatewayRouteKey: routeContext.routeKey },
        },
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xdef",
        },
      },
    ],
    generatedAt: "2026-05-02T20:30:00.000Z",
  });

  assert.equal(slice.recentMovements.length, 1);
  assert.equal(slice.recentMovements[0].fromChainId, "bsc");
  assert.equal(slice.recentMovements[0].toChainId, "avalanche");
  assert.equal(slice.recentMovements[0].status, "delivered");
  assert.equal(slice.recentMovements[0].routeProvider, "gateway");
  assert.equal(slice.recentMovements[0].viaGateway, true);
});

test("flow dashboard movement asset prefers delivered route output over refill target label", () => {
  const slice = buildFlowDashboardSlice({
    executionEvents: [
      {
        eventType: "execution_funding_outcome",
        settlementStatus: "delivered",
        strategyId: "gateway-btc-funding-transfer",
        observedAt: "2026-05-02T21:14:07.275Z",
        chain: "base",
        asset: "ETH",
        executionMethod: "cross_chain_bridge_or_swap",
        jobId: "1640d4140f9febab6a24",
        amountUsd: 20.8,
        receiptIngest: {
          receiptRecord: {
            routeContext: {
              routeKey:
                "bsc:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
              srcChain: "bsc",
              dstChain: "base",
              estimatedInputUsd: 20.8,
            },
            output: {
              asset: {
                ticker: "wBTC.OFT",
                icon: "wbtc",
              },
            },
          },
        },
      },
    ],
    generatedAt: "2026-05-02T21:20:00.000Z",
  });

  assert.equal(slice.recentMovements.length, 1);
  assert.equal(slice.recentMovements[0].fromChainId, "bsc");
  assert.equal(slice.recentMovements[0].toChainId, "base");
  assert.equal(slice.recentMovements[0].assetId, "wbtc");
  assert.equal(slice.recentMovements[0].toAssetId, "wbtc");
  assert.equal(slice.recentMovements[0].routeProvider, "gateway");
});

test("flow dashboard slice compacts live activities and leverage hints for the flow tab", () => {
  const slice = buildFlowDashboardSlice({
    executionEvents: [
      {
        eventType: "execution_funding_outcome",
        settlementStatus: "delivered",
        strategyId: "wrapped-btc-loop-base-moonwell",
        observedAt: "2026-04-25T06:10:00.000Z",
        chain: "base",
        asset: "cbBTC",
        amountUsd: 42.5,
        txHashes: ["0xabc"],
      },
    ],
    merklPositionEvents: [
      {
        event: "position_opened",
        status: "open",
        opportunityId: "y1",
        strategyId: "gateway_native_asset_conversion_sleeve",
        chain: "base",
        protocolId: "yo",
        name: "YO USDC",
        amountUsd: 12.25,
        observedAt: "2026-04-25T06:05:00.000Z",
        entryTxHash: "0xdef",
      },
    ],
    signerAuditRecords: [
      {
        timestamp: "2026-04-25T06:20:00.000Z",
        strategyId: "gateway_native_asset_conversion_sleeve",
        chain: "ethereum",
        amountUsd: 25,
        policyVerdict: "approved",
        intentHash: "intent-1",
        intentId: "intent-1",
        intent: {
          intentType: "erc4626_deposit",
          metadata: {
            protocol: "morpho",
            assetSymbol: "USDT",
          },
        },
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xfeed",
        },
        broadcast: {
          txHash: "0xfeed",
        },
      },
    ],
    payback: {
      grossProfitSatsPeriod: 200000,
      carry: { pendingSats: 150000 },
      paidBackSatsLifetime: 50000,
      lastPaybackSettledAt: "2026-04-25T05:30:00.000Z",
      lastPaybackSettledSats: 25000,
    },
    capitalSummary: { totalUsd: 354.5 },
    btcUsd: 100000,
    wrappedBtcLendingLoopSlice: {
      strategy: {
        id: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        protocol: "moonwell",
        targetHealthFactor: 1.8,
        healthFactorMin: 1.35,
        liquidationBufferPct: 14.5,
      },
      entryPlan: {
        projectedHealthFactor: 1.92,
        projectedLiquidationBufferPct: 18.2,
      },
    },
    generatedAt: "2026-04-25T06:30:00.000Z",
  });

  assert.equal(slice.metrics.assetValueUsd, 354.5);
  assert.equal(slice.metrics.grossProfitUsdPeriod, 200);
  assert.equal(slice.metrics.pendingCarryUsd, 150);
  assert.equal(slice.metrics.paidBackUsdLifetime, 50);
  assert.equal(slice.recentActivities.length, 4);
  assert.equal(slice.recentActivities[0].kind, "transaction");
  assert.equal(slice.recentActivities[0].status, "broadcasted");
  assert.equal(slice.recentActivities[0].finalAssetId, "USDT");
  assert.equal(slice.recentActivities[1].kind, "execution");
  assert.equal(slice.recentActivities[1].finalAssetId, "cbBTC");
  assert.equal(slice.recentActivities[2].kind, "position");
  assert.equal(slice.recentActivities[3].kind, "payback");
  assert.equal(slice.recentActivities[3].finalAssetId, "btc");
  assert.equal(slice.strategyRiskById["wrapped-btc-loop-base-moonwell"].projectedHealthFactor, 1.92);
  assert.equal(slice.strategyRiskById["wrapped-btc-loop-base-moonwell"].projectedLiquidationBufferPct, 18.2);
});

test("flow dashboard slice exposes live estimated yield in sats from active APR positions", () => {
  const slice = buildFlowDashboardSlice({
    payback: {
      grossProfitSatsPeriod: 0,
      carry: { pendingSats: 0 },
      paidBackSatsLifetime: 0,
    },
    capitalSummary: { totalUsd: 500 },
    btcUsd: 100000,
    merklActivePositions: {
      items: [
        {
          id: "merkl_yield",
          label: "YO USDC",
          chain: "base",
          protocol: "yo",
          capUsd: 365,
          aprPct: 10,
          lastObservedAt: "2026-04-24T06:30:00.000Z",
        },
      ],
    },
    generatedAt: "2026-04-25T06:30:00.000Z",
  });

  assert.equal(slice.liveYield.status, "active");
  assert.equal(slice.liveYield.positionCount, 1);
  assert.equal(slice.liveYield.weightedAprPct, 10);
  assert.equal(slice.liveYield.estimatedYieldUsd, 0.1);
  assert.equal(slice.liveYield.estimatedYieldSats, 100);
  assert.equal(slice.metrics.liveEstimatedYieldSats, 100);
  assert.equal(slice.metrics.liveEstimatedYieldUsd, 0.1);
  assert.equal(slice.metrics.liveYieldAprPct, 10);
  assert.equal(slice.metrics.liveYieldPositionCount, 1);
});

test("flow dashboard asset metric does not treat refill shortfall as wallet assets", () => {
  const slice = buildFlowDashboardSlice({
    capitalSummary: {
      totalUsd: 219.49,
      currentTotalUsd: 219.49,
      estimatedCurrentTotalUsd: 219.49,
      capitalPlanRefillRequiredUsd: 497.31,
    },
    generatedAt: "2026-05-03T00:00:00.000Z",
  });

  assert.equal(slice.metrics.assetValueUsd, 219.49);
});
