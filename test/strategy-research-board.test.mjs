import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLendingLoopResearchEntries } from "../src/strategy/lending-loop-research.mjs";
import { buildFlashFloorDecision } from "../src/strategy/flash-floor-decision.mjs";
import { buildStrategyResearchBoard, summarizeStrategyResearchBoard } from "../src/strategy/strategy-research-board.mjs";
import { buildStrategySnapshot, summarizeStrategySnapshot } from "../src/strategy/strategy-snapshot.mjs";
import { buildDefaultRecursiveLendingLoopConfig, buildRecursiveLendingLoopScaffold } from "../src/strategy/recursive-lending-loop-slice.mjs";
import { buildRecursiveLendingLoopReceiptGuide } from "../src/strategy/recursive-lending-loop-dry-run.mjs";

const recursiveWrappedReceiptCommand = buildRecursiveLendingLoopReceiptGuide({
  strategyId: "recursive_wrapped_btc_lending_loop",
}).sampleCommand;

function dashboardStatusFixture() {
  return {
    generatedAt: "2026-04-15T03:00:00.000Z",
    overall: { liveTrading: "ALLOWED", shadowTrading: "ALLOWED" },
    prelive: { currentStage: "shadow_replay" },
    strategy: {
      edgeViability: {
        measuredLoopCount: 1,
        positiveMeasuredCount: 1,
        policyReadyCount: 1,
        verdict: { code: "positive_outside_noise_floor" },
        bestMeasuredLoop: {
          routeKey: "bob:0xbtc->base:0xbtc",
          amount: "10000",
          measuredLoopNetUsd: 0.52,
        },
      },
      crossAssetArbitrage: { bestLoop: null, closestLoop: null },
      btcProxySpreads: {
        opportunityCount: 2,
        policyReadyCount: 0,
        overfitAssessment: "high_overfit_risk",
        overfitRisks: ["thin_buy_quote_coverage"],
        bestRebalanceOpportunity: {
          rebalanceRouteKey: "base:0xwbtc->bob:0xwbtc",
          amount: "10000",
          rebalanceAdjustedSpreadUsd: 0.08,
        },
      },
      ethProfitability: null,
      strategyTracks: { tracks: [] },
      objectivePlans: { discovery: null },
    },
  };
}

test("strategy research board ranks relaxed-policy follow-ups and snapshot exposes a compact summary", () => {
  const researchBoard = buildStrategyResearchBoard({
    laneReclassification: {
      lanes: [
        {
          id: "stablecoin_entry_exit_loops",
          statusNew: "measured_overfit_blocked",
          clearsNewFloor: true,
          passesOverfitGate: false,
          netPnlMeasuredUsd: 0.42,
          gasSlippageVarianceUsd: 0.12,
          remainingBlockers: ["thin_amount_diversity"],
        },
        {
          id: "btc_proxy_spreads",
          statusNew: "measured_inside_variance_floor",
          clearsNewFloor: false,
          passesOverfitGate: false,
          netPnlMeasuredUsd: 0.08,
          gasSlippageVarianceUsd: 0.11,
          remainingBlockers: ["thin_buy_quote_coverage"],
        },
      ],
    },
    nativeBtcOpportunitySurface: {
      families: [
        {
          id: "destination_wrapped_btc_rotation",
          label: "Wrapped BTC destination rotation",
          status: "live_route_supported_research_needed",
          liveRouteCount: 5,
          destinationChains: ["base", "arbitrum"],
          blockers: ["destination yield scoring missing"],
        },
      ],
    },
    lendingLoopResearchEntries: buildLendingLoopResearchEntries(),
    now: "2026-04-15T03:00:00.000Z",
  });

  assert.equal(researchBoard.summary.candidateCount, 5);
  assert.equal(researchBoard.summary.newCandidateCount, 3);
  assert.equal(researchBoard.summary.topCandidateId, "stablecoin_entry_exit_loop_revalidation");
  assert.equal(researchBoard.summary.topNewCandidateId, "recursive_wrapped_btc_lending_loop");
  assert.equal(researchBoard.candidates[0].status, "overfit_blocked_revalidation");
  const wrappedLoopCandidate = researchBoard.candidates.find((candidate) => candidate.id === "recursive_wrapped_btc_lending_loop");
  assert.equal(
    wrappedLoopCandidate.nextAction.command,
    "npm run report:recursive-lending-loop -- --strategy=recursive_wrapped_btc_lending_loop",
  );
  assert.equal(wrappedLoopCandidate.evidence.executionSurface, "deterministic_planning_executor");

  const summarizedBoard = summarizeStrategyResearchBoard(researchBoard);
  assert.equal(summarizedBoard.topCandidate.id, "stablecoin_entry_exit_loop_revalidation");
  assert.equal(summarizedBoard.topNewCandidate.id, "recursive_wrapped_btc_lending_loop");

  const snapshot = buildStrategySnapshot({
    dashboardStatus: dashboardStatusFixture(),
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    strategyResearchBoard: researchBoard,
    now: "2026-04-15T03:00:00.000Z",
  });
  const summarizedSnapshot = summarizeStrategySnapshot(snapshot);
  assert.equal(snapshot.summary.researchCandidateCount, 5);
  assert.equal(snapshot.summary.researchTopCandidateId, "stablecoin_entry_exit_loop_revalidation");
  assert.equal(summarizedSnapshot.researchBoard.topCandidate.id, "stablecoin_entry_exit_loop_revalidation");
  assert.equal(summarizedSnapshot.researchBoard.topNewCandidate.id, "recursive_wrapped_btc_lending_loop");
});

test("strategy research board upgrades recursive loops when dry-run evidence is recorded", () => {
  const wrappedScaffold = buildRecursiveLendingLoopScaffold({
    strategyId: "recursive_wrapped_btc_lending_loop",
    strategyConfig: buildDefaultRecursiveLendingLoopConfig("recursive_wrapped_btc_lending_loop"),
    dryRunReceipts: [
      {
        strategyId: "recursive_wrapped_btc_lending_loop",
        executionMode: "simulated_dry_run",
        result: "passed",
        watcherStatus: "auto_unwind",
        observedAt: "2026-04-17T19:20:00.000Z",
      },
    ],
    now: "2026-04-17T19:20:00.000Z",
  });
  const researchBoard = buildStrategyResearchBoard({
    laneReclassification: { lanes: [] },
    lendingLoopResearchEntries: buildLendingLoopResearchEntries(),
    recursiveLoopSurfaces: {
      recursive_wrapped_btc_lending_loop: {
        scaffold: wrappedScaffold,
        dryRunSummary: wrappedScaffold.dryRunSummary,
      },
    },
    nativeBtcOpportunitySurface: null,
    now: "2026-04-17T19:20:00.000Z",
  });

  const wrappedLoopCandidate = researchBoard.candidates.find((candidate) => candidate.id === "recursive_wrapped_btc_lending_loop");
  assert.equal(wrappedLoopCandidate.status, "dry_run_evidence_recorded");
  assert.equal(wrappedLoopCandidate.nextAction.code, "collect_recursive_loop_observed_receipts");
  assert.equal(
    wrappedLoopCandidate.nextAction.command,
    recursiveWrappedReceiptCommand,
  );
  assert.equal(wrappedLoopCandidate.evidence.dryRunReceiptRecorded, true);
  assert.equal(wrappedLoopCandidate.evidence.dryRunPassedCount, 1);
});

test("strategy research board marks signer-backed recursive loop receipts as validation-ready", () => {
  const wrappedScaffold = buildRecursiveLendingLoopScaffold({
    strategyId: "recursive_wrapped_btc_lending_loop",
    strategyConfig: buildDefaultRecursiveLendingLoopConfig("recursive_wrapped_btc_lending_loop"),
    dryRunReceipts: [
      {
        strategyId: "recursive_wrapped_btc_lending_loop",
        executionMode: "signer_backed_receipt",
        result: "passed",
        watcherStatus: "auto_unwind",
        observedAt: "2026-04-18T10:00:00.000Z",
      },
    ],
    now: "2026-04-18T10:00:00.000Z",
  });
  const researchBoard = buildStrategyResearchBoard({
    laneReclassification: { lanes: [] },
    lendingLoopResearchEntries: buildLendingLoopResearchEntries(),
    recursiveLoopSurfaces: {
      recursive_wrapped_btc_lending_loop: {
        scaffold: wrappedScaffold,
        dryRunSummary: wrappedScaffold.dryRunSummary,
      },
    },
    nativeBtcOpportunitySurface: null,
    now: "2026-04-18T10:00:00.000Z",
  });

  const wrappedLoopCandidate = researchBoard.candidates.find((candidate) => candidate.id === "recursive_wrapped_btc_lending_loop");
  assert.equal(wrappedLoopCandidate.status, "receipt_backed_validation_ready");
  assert.equal(wrappedLoopCandidate.nextAction.code, "review_recursive_loop_observed_receipts");
  assert.equal(wrappedLoopCandidate.evidence.signerBackedRunCount, 1);
  assert.deepEqual(wrappedLoopCandidate.missingEvidence, []);
  assert.equal(researchBoard.summary.statusCounts.receipt_backed_validation_ready, 1);
});

test("strategy research board includes Karpathy-style auto research candidates from promotion intents", () => {
  const researchBoard = buildStrategyResearchBoard({
    laneReclassification: { lanes: [] },
    lendingLoopResearchEntries: [],
    nativeBtcOpportunitySurface: null,
    autoResearchSummary: {
      generatedAt: "2026-04-26T18:00:00.000Z",
      candidates: [
        {
          candidateName: "agent_mean_reversion_base",
          track: "A",
          passed: true,
          blockers: [],
        },
        {
          candidateName: "factor_slow_momentum",
          track: "B",
          passed: false,
          blockers: ["insufficient_sample_periods"],
        },
      ],
    },
    autoResearchPromotionIntents: [
      {
        ts: "2026-04-26T18:00:00.000Z",
        action: "request_committed_canary_promotion",
        track: "A",
        candidateName: "agent_mean_reversion_base",
      },
    ],
    now: "2026-04-26T18:05:00.000Z",
  });

  const passedCandidate = researchBoard.candidates.find((candidate) => candidate.id === "agent_mean_reversion_base");
  const blockedCandidate = researchBoard.candidates.find((candidate) => candidate.id === "factor_slow_momentum");

  assert.equal(passedCandidate.status, "candidate_for_validation");
  assert.equal(passedCandidate.evidence.source, "karpathy_auto_research");
  assert.equal(passedCandidate.evidence.promotionIntentAt, "2026-04-26T18:00:00.000Z");
  assert.equal(passedCandidate.nextAction.code, "review_auto_research_promotion_intent");

  assert.equal(blockedCandidate.status, "research_backlog");
  assert.deepEqual(blockedCandidate.missingEvidence, ["insufficient_sample_periods"]);
});

test("flash floor decision reports owner setter availability and deploy-time 0.30 USDC default", () => {
  const report = buildFlashFloorDecision({
    contractSource: `
      uint256 public minProfitUsdc; // absolute minimum in USDC (6 decimals), e.g., 300000 = $0.30
      function setMinProfit(uint256 _usdc) external onlyOwner {
        minProfitUsdc = _usdc;
      }
    `,
    deploymentCommands: ["cast send --constructor-args 300000", "forge create --constructor-args 300000"],
    laneReclassification: {
      lanes: [
        {
          id: "triangular_flash_btc",
          statusNew: "blocked_by_contract_floor",
          passesOverfitGate: true,
          netPnlMeasuredUsd: 0.18,
          gasSlippageVarianceUsd: 0.05,
          remainingBlockers: ["contract_level_flash_floor"],
          statusReasonCode: "contract_floor_blocks_flash",
        },
      ],
    },
    strategySnapshot: {
      implementedStrategies: [{ id: "triangular_flash_btc", status: "measured_below_policy" }],
    },
    now: "2026-04-15T03:00:00.000Z",
  });

  assert.equal(report.contract.ownerSetterAvailable, true);
  assert.equal(report.contract.sourceMinProfitUsd, 0.3);
  assert.equal(report.summary.currentDecision, "contract_floor_is_active_blocker");
  assert.equal(report.summary.setterWouldHelp, true);
  assert.equal(report.summary.recommendation, "lower_floor_via_owner_setter_after_confirming measured positive EV");
});
