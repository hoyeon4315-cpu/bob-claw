import assert from "node:assert/strict";
import test from "node:test";

import { overlayAggressiveVelocityExecutionSurface } from "../src/cli/report-strategy-execution-surfaces.mjs";
import { attachAggressiveVelocityStatus } from "../src/cli/report-automation-health.mjs";
import { buildAggressiveVelocityStatus } from "../src/cli/report-aggressive-velocity-status.mjs";

test("execution surface overlay replaces generic aggressive blocker with current live admission blocker", () => {
  const report = {
    summary: {
      liveEligibleCount: 0,
    },
    strategies: [
      {
        id: "aggressive-velocity-v1",
        status: "candidate_for_validation",
        reason: "scan_dependent_live_eligibility",
        currentLiveEligible: false,
        fallbackReason: "candidate_scan_required",
        liveAdmissionBlockers: ["candidate_scan_required"],
        adviceCode: "candidate_scan_required",
        evidence: {},
      },
    ],
  };

  const aggressiveStatus = {
    strategyId: "aggressive-velocity-v1",
    status: "analysis_only",
    reason: "no_high_yield_candidates_selected",
    currentLiveEligible: false,
    liveAdmissionBlockers: ["no_high_yield_candidates_selected"],
    candidateLadder: {
      rawCandidateCount: 12,
      credibleExitCount: 1,
      velocityCandidateCount: 0,
      selectedCount: 0,
      bottleneckStage: "velocity",
    },
    selectionDiagnostics: { finalSelectedCount: 0 },
    rejectionEvidence: {
      topRejectedReasons: [{ reason: "unsupported_chain", count: 246 }],
    },
  };

  const updated = overlayAggressiveVelocityExecutionSurface(report, aggressiveStatus);
  const aggressive = updated.strategies[0];

  assert.equal(aggressive.status, "analysis_only");
  assert.equal(aggressive.reason, "no_high_yield_candidates_selected");
  assert.equal(aggressive.fallbackReason, "no_high_yield_candidates_selected");
  assert.deepEqual(aggressive.liveAdmissionBlockers, ["no_high_yield_candidates_selected"]);
  assert.equal(aggressive.adviceCode, "no_high_yield_candidates_selected");
  assert.equal(aggressive.evidence.candidateLadder.bottleneckStage, "velocity");
  assert.equal(aggressive.evidence.selectionDiagnostics.finalSelectedCount, 0);
  assert.equal(aggressive.evidence.rejectionEvidence.topRejectedReasons[0].reason, "unsupported_chain");
  assert.equal(
    updated.strategyDiagnostics.aggressiveVelocity.liveAdmissionBlockers[0],
    "no_high_yield_candidates_selected",
  );
  assert.equal(updated.strategyDiagnostics.aggressiveVelocity.candidateLadder.bottleneckStage, "velocity");
});

test("execution surface overlay adds aggressive diagnostics row when catalog omits it", () => {
  const report = {
    summary: {
      liveEligibleCount: 0,
    },
    strategies: [
      {
        id: "wrapped-btc-loop-base-moonwell",
        currentLiveEligible: false,
      },
    ],
  };

  const aggressiveStatus = {
    strategyId: "aggressive-velocity-v1",
    status: "analysis_only",
    reason: "no_high_yield_candidates_selected",
    liveCapable: true,
    currentLiveEligible: false,
    liveAdmissionBlockers: ["no_high_yield_candidates_selected"],
    selectedCount: 0,
    candidateLadder: {
      rawCandidateCount: 400,
      credibleExitCount: 7,
      velocityCandidateCount: 0,
      selectedCount: 0,
      bottleneckStage: "velocity",
    },
    selectionDiagnostics: { finalSelectedCount: 0 },
    rejectionEvidence: {
      scan: {
        velocityScoreRejectionSummary: {
          count: 7,
          minVelocityScore: 52,
          maxScore: 40,
        },
      },
    },
  };

  const updated = overlayAggressiveVelocityExecutionSurface(report, aggressiveStatus);
  const aggressive = updated.strategies.find((strategy) => strategy.id === "aggressive-velocity-v1");

  assert.equal(aggressive.status, "analysis_only");
  assert.equal(aggressive.currentLiveEligible, false);
  assert.equal(aggressive.evidence.candidateLadder.bottleneckStage, "velocity");
  assert.equal(aggressive.evidence.rejectionEvidence.scan.velocityScoreRejectionSummary.count, 7);
  assert.equal(updated.summary.liveEligibleCount, 0);
});

test("automation health attach helper exposes aggressive status diagnostics", () => {
  const report = {
    status: "attention_required",
    allChain: {
      strategyDispatch: {
        liveEligibleCount: 1,
      },
      topBlockers: [],
    },
    topBlockers: [],
  };
  const aggressiveStatus = {
    strategyId: "aggressive-velocity-v1",
    status: "shadow_ready",
    reason: "inventory_missing",
    currentLiveEligible: false,
    liveAdmissionBlockers: ["inventory_missing"],
    selectedCount: 1,
    totalQualified: 1,
    selectionDiagnostics: { scannerCandidateCount: 1 },
    rejectionEvidence: {
      topRejectedReasons: [{ reason: "unsupported_chain", count: 246 }],
    },
  };

  const updated = attachAggressiveVelocityStatus(report, aggressiveStatus);

  assert.equal(updated.allChain.strategyDispatch.liveEligibleCount, 1);
  assert.deepEqual(updated.allChain.topBlockers, []);
  assert.equal(updated.strategyDiagnostics.aggressiveVelocity.reason, "inventory_missing");
  assert.equal(updated.strategyDiagnostics.aggressiveVelocity.selectedCount, 1);
  assert.equal(
    updated.strategyDiagnostics.aggressiveVelocity.rejectionEvidence.topRejectedReasons[0].reason,
    "unsupported_chain",
  );
});

test("aggressive status exposes canonical candidate ladder and bottleneck stage", async () => {
  const status = await buildAggressiveVelocityStatus({
    buildLiveStateImpl: async () => ({
      currentLiveEligible: false,
      liveAdmissionBlockers: ["no_high_yield_candidates_selected"],
      rejectionEvidence: {
        scan: {
          velocityScoreRejectionSummary: {
            count: 1,
            minVelocityScore: 52,
            minExpectedNetBtcProfit: 0.00005,
            highQualityRequired: true,
            maxScore: 40,
            maxExpectedNetBtcProfit: 0.00001,
            qualityCounts: { low: 1 },
            topRejected: [
              {
                chain: "base",
                protocol: "aave",
                score: 40,
                minVelocityScore: 52,
                expectedNetBtcProfit: 0.00001,
                expectedNetProfitQuality: "low",
                exitFeasibilityScore: 65,
              },
            ],
          },
        },
      },
      strategist: {
        selectedCount: 0,
        totalQualified: 0,
        totalExpectedNetBtcProfit: 0,
        totalSimulatedRealizedNetBtc: 0,
        aggregateCaptureRate: 0,
        candidates: [],
        selectionDiagnostics: {
          scannerCandidateCount: 8,
          qualifiedCount: 3,
          shortlistedCount: 2,
          safeExitCount: 1,
          realizationQualifiedCount: 0,
          finalSelectedCount: 0,
        },
        rejectionEvidence: {
          scan: {
            rawCount: 12,
            stageCounts: {
              passedBaseFilters: 8,
              passedCredibleExit: 1,
              passedVelocityScore: 0,
              passedHighNetYield: 0,
              executableCandidates: 0,
              finalSelected: 0,
            },
            velocityScoreRejectionSummary: {
              count: 1,
              minVelocityScore: 52,
              minExpectedNetBtcProfit: 0.00005,
              highQualityRequired: true,
              maxScore: 40,
              maxExpectedNetBtcProfit: 0.00001,
              qualityCounts: { low: 1 },
              topRejected: [
                {
                  chain: "base",
                  protocol: "aave",
                  score: 40,
                  minVelocityScore: 52,
                  expectedNetBtcProfit: 0.00001,
                  expectedNetProfitQuality: "low",
                  exitFeasibilityScore: 65,
                },
              ],
            },
          },
          topRejectedReasons: [{ reason: "velocity_score_below_minimum", count: 1 }],
        },
      },
    }),
  });

  assert.equal(status.candidateLadder.rawCandidateCount, 12);
  assert.equal(status.candidateLadder.credibleExitCount, 1);
  assert.equal(status.candidateLadder.velocityCandidateCount, 0);
  assert.equal(status.candidateLadder.selectedCount, 0);
  assert.equal(status.candidateLadder.bottleneckStage, "velocity");
  assert.equal(status.bottleneckStage, "velocity");
  assert.equal(status.rejectionEvidence.scan.velocityScoreRejectionSummary.count, 1);
  assert.equal(status.rejectionEvidence.scan.velocityScoreRejectionSummary.maxScore, 40);
});
