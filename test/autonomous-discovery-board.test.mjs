import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAutonomousDiscoveryBoard,
  buildAutonomousDiscoveryExecutionSummary,
  selectAutonomousDiscoveryOpportunities,
  summarizeAutonomousDiscoveryBoard,
} from "../src/strategy/autonomous-discovery-board.mjs";

test("autonomous discovery board prioritizes iterative keep candidates and composes route development", () => {
  const report = buildAutonomousDiscoveryBoard({
    deterministicStrategyCandidates: {
      candidates: [
        {
          id: "recursive_wrapped_btc_lending_loop",
          label: "Recursive wrapped-BTC lending loop",
          status: "candidate_for_design",
          deterministicStatus: "repo_auto_build_supported",
          readyForDryRun: true,
          blockers: [],
          missingEvidence: ["signer-backed observed receipt"],
          nextAction: {
            code: "record_recursive_loop_dry_run_receipt",
            command: "npm run run:recursive-lending-loop-dry-run -- --strategy=recursive_wrapped_btc_lending_loop --write",
          },
        },
      ],
    },
    destinationResearchQueue: {
      queue: [
        {
          templateId: "base:wrapped_btc_lending",
          chain: "base",
          familyId: "wrapped_btc_lending",
          label: "Base wrapped BTC lending",
          queueScore: 0.84,
          readinessScore: 0.8,
          economicsStatus: "missing_inputs",
          nextAction: "measure_numeric_economics",
          reason: "economic_inputs_missing",
          missingFields: ["estimatedNetBtc"],
          unmetPolicyInputs: [],
        },
      ],
    },
    destinationPromotionGate: {
      items: [
        {
          templateId: "base:wrapped_btc_lending",
          chain: "base",
          familyId: "wrapped_btc_lending",
          gate: { status: "promotable", blockers: [] },
          allocationGate: { status: "review_only", blockers: ["allocation_fields_incomplete"] },
        },
      ],
    },
    gatewayRoutes: [
      { srcChain: "bitcoin", srcToken: "native", dstChain: "base", dstToken: "wbtc.oft" },
      { srcChain: "base", srcToken: "wbtc.oft", dstChain: "bitcoin", dstToken: "native" },
      { srcChain: "ethereum", srcToken: "wbtc", dstChain: "base", dstToken: "wbtc.oft" },
    ],
    btcRouteUniverse: {
      familyRouteCount: 8,
      fullyMeasurableRouteCount: 2,
      singleProviderGapCount: 3,
      doubleProviderGapCount: 0,
      topGapChain: { chain: "bitcoin", routeCount: 3 },
      fullyMeasurableRoutes: [{ routeKey: "ethereum:wbtc->base:wbtc.oft" }],
      gapRoutes: [
        {
          routeKey: "bitcoin:native->base:wbtc.oft",
          classification: "single_provider_gap",
          blockers: ["dst_odos_chain_not_supported"],
        },
      ],
      blockerCounts: [{ key: "dst_odos_chain_not_supported", count: 3 }],
    },
    iterationRecords: [
      {
        opportunityId: "recursive_wrapped_btc_lending_loop",
        observedAt: "2026-04-25T12:00:00.000Z",
        executionStatus: "succeeded",
        outcomeSignal: "keep",
      },
      {
        opportunityId: "base:wrapped_btc_lending:route_development",
        observedAt: "2026-04-25T13:00:00.000Z",
        executionStatus: "failed",
        outcomeSignal: "discard",
      },
    ],
    now: "2026-04-26T12:00:00.000Z",
  });

  assert.equal(report.summary.opportunityCount, 5);
  assert.equal(report.summary.deterministicCount, 1);
  assert.equal(report.summary.destinationCount, 1);
  assert.equal(report.summary.routeGapCount, 2);
  assert.equal(report.summary.routeDevelopmentCount, 1);
  assert.equal(report.summary.topOpportunityId, "recursive_wrapped_btc_lending_loop");
  assert.equal(report.opportunities[0].researchLoop.recommendedDecision, "keep");
  assert.equal(report.opportunities[0].nextAction.code, "record_recursive_loop_dry_run_receipt");

  const routeDevelopment = report.opportunities.find((item) => item.id === "base:wrapped_btc_lending:route_development");
  assert.equal(routeDevelopment?.status, "composed_route_ready");
  assert.equal(routeDevelopment?.routeDevelopment?.missingLink, null);
  assert.equal(routeDevelopment?.routeDevelopment?.primitives.gateway.status, "ready");
  assert.equal(routeDevelopment?.routeDevelopment?.primitives.unwind.status, "ready");
  assert.equal(routeDevelopment?.nextAction?.code, "review_destination_allocation_plan");

  const selected = selectAutonomousDiscoveryOpportunities(report, { limit: 2 });
  assert.deepEqual(selected.map((item) => item.id), [
    "recursive_wrapped_btc_lending_loop",
    "base:wrapped_btc_lending:route_development",
  ]);

  const summary = summarizeAutonomousDiscoveryBoard(report);
  assert.equal(summary.topOpportunity.id, "recursive_wrapped_btc_lending_loop");
  assert.equal(summary.routeDevelopmentCount, 1);
  assert.equal(summary.nextAction.code, "record_recursive_loop_dry_run_receipt");
  assert.equal(summary.pnl.paper.status, "board_priority_surface_only");
});

test("autonomous discovery board classifies missing route links and execution summaries deterministically", () => {
  const report = buildAutonomousDiscoveryBoard({
    destinationResearchQueue: {
      queue: [
        {
          templateId: "sonic:wrapped_btc_lending",
          chain: "sonic",
          familyId: "wrapped_btc_lending",
          label: "Sonic wrapped BTC lending",
          queueScore: 0.55,
          readinessScore: 0.5,
          economicsStatus: "missing_inputs",
          nextAction: "collect_source_metadata",
          reason: "route_inventory_missing",
          missingFields: [],
          unmetPolicyInputs: ["operator_inputs_missing"],
        },
      ],
    },
    destinationPromotionGate: {
      items: [
        {
          templateId: "sonic:wrapped_btc_lending",
          chain: "sonic",
          familyId: "wrapped_btc_lending",
          gate: { status: "blocked", blockers: ["missing_market_registry"] },
          allocationGate: { status: "blocked", blockers: ["allocation_fields_incomplete"] },
        },
      ],
    },
    gatewayRoutes: [{ srcChain: "bitcoin", srcToken: "native", dstChain: "base", dstToken: "wbtc.oft" }],
    iterationRecords: [
      {
        opportunityId: "sonic:wrapped_btc_lending:route_development",
        observedAt: "2026-04-26T10:00:00.000Z",
        executionStatus: "invalid",
        outcomeSignal: "discard",
      },
      {
        opportunityId: "sonic:wrapped_btc_lending:route_development",
        observedAt: "2026-04-26T09:00:00.000Z",
        executionStatus: "failed",
        outcomeSignal: "discard",
      },
    ],
    now: "2026-04-26T12:00:00.000Z",
  });

  const routeDevelopment = report.opportunities.find((item) => item.id === "sonic:wrapped_btc_lending:route_development");
  assert.equal(routeDevelopment?.status, "gateway_route_missing");
  assert.equal(routeDevelopment?.routeDevelopment?.missingLink, "gateway_route_missing");
  assert.equal(routeDevelopment?.nextAction?.code, "scan_btc_quote_surface");
  assert.equal(routeDevelopment?.researchLoop?.recommendedDecision, "discard");
  assert.equal(routeDevelopment?.researchLoop?.consecutiveFailureCount, 2);

  const executionSummary = buildAutonomousDiscoveryExecutionSummary([
    {
      observedAt: "2026-04-26T10:00:00.000Z",
      opportunityId: "sonic:wrapped_btc_lending:route_development",
      lane: "route_development",
      type: "route_development",
      executionStatus: "invalid",
      outcomeSignal: "discard",
      steps: [],
      stepCount: 0,
    },
    {
      observedAt: "2026-04-26T11:00:00.000Z",
      opportunityId: "recursive_wrapped_btc_lending_loop",
      lane: "strategy",
      type: "deterministic_strategy",
      executionStatus: "succeeded",
      outcomeSignal: "keep",
      steps: [{ script: "run:recursive-lending-loop-dry-run" }],
      stepCount: 1,
    },
  ]);

  assert.equal(executionSummary.runCount, 2);
  assert.equal(executionSummary.successCount, 1);
  assert.equal(executionSummary.invalidCount, 1);
  assert.equal(executionSummary.keepCount, 1);
  assert.equal(executionSummary.discardCount, 1);
  assert.equal(executionSummary.latestOpportunityId, "recursive_wrapped_btc_lending_loop");
  assert.equal(executionSummary.pnl.realized.status, "execution_summary_has_no_realized_btc_pnl_aggregation");
});
