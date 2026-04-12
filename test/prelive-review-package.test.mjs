import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPreliveReviewPackage, summarizePreliveReviewPackage } from "../src/prelive/review-package.mjs";

test("prelive review package stays blocked while canary and prelive gates are not ready", () => {
  const reviewPackage = buildPreliveReviewPackage({
    dashboardStatus: {
      generatedAt: "2026-04-12T12:00:00.000Z",
      overall: {
        liveTrading: "BLOCKED",
        blockers: ["audit_blocks_live"],
      },
      shadowCycle: {
        canaryDecision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
        headline: "Best prepared route still fails objective score review",
        topRoute: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          amount: "10000",
          tradeReadiness: "reject_no_net_edge",
          netEdgeUsd: -0.84,
        },
        shadowRoster: {
          candidates: [
            {
              label: "bob->base wBTC.OFT->wBTC.OFT",
              amount: "10000",
              tradeReadiness: "reject_no_net_edge",
              netEdgeUsd: -0.84,
              prepFundingUsd: 0,
              viableForPrep: true,
              txReady: true,
              prepBlockers: [],
              scoreDisqualifiers: ["reject_no_net_edge"],
              evidence: {
                quoteSampleCount: 14,
                quoteFailureCount: 0,
                quoteAttemptCount: 14,
                quoteSuccessRate: 1,
                quoteLatencyP95Ms: 775,
                shadowObservationCount: 31,
                latestObservedEdgeUsd: -0.84,
                latestKnownCostUsd: 0.81,
                latestExecutionGasUsd: 0.12,
                latestRouteFailureRate: 0,
                latestTradeReadiness: "reject_no_net_edge",
                rejectionReasons: ["reject_no_net_edge"],
              },
            },
          ],
        },
        objectivePlans: {
          executionReview: {
            routeKey: "ethereum:0x2260->base:0x0555",
            routeLabel: "ethereum->base WBTC->wBTC.OFT",
            amount: "10000",
            selectionCode: "prefer_viable_prep_route_over_measured_hypothesis",
            selectionLabel: "keep viable prep route active",
            tradeReadiness: "insufficient_data",
            measuredNetUsd: 64.76,
            executableNetUsd: 64.99,
            blockerLabels: ["source gas snapshot stale"],
            reasonLabels: ["measured leader still needs wallet readiness checks"],
            nextActionCode: "check_wallet_readiness",
            nextActionLabel: "wallet readiness check",
            command: "npm run check:estimator-wallet -- --route-key=ethereum:0x2260->base:0x0555 --amount=10000",
            hypothesisGuard: "Positive measured edge is still a hypothesis until wallet, gas, and exact execution inputs are all fresh.",
          },
        },
      },
      prelive: {
        currentStage: "shadow_replay",
        liveTradingPolicy: "BLOCKED",
        notes: ["Mechanical simulation uses RPC estimation and eth_call only; it is not realized execution proof."],
        shadowReplay: {
          status: "shadow_replay_blocked",
          blockers: ["audit:LIVE_BLOCKED", "manual_canary_review_not_ready"],
          auditDecision: "LIVE_BLOCKED",
          policyReadyMeasuredRoutes: 1,
        },
        mechanicalSimulation: {
          status: "mechanical_simulation_blocked",
          blockers: ["shadow_replay_not_ready", "needs_50_more_successful_simulations"],
          successCount: 0,
          targetSuccessCount: 50,
          failureCount: 0,
        },
        forkExecution: {
          status: "fork_execution_blocked",
          blockers: ["mechanical_simulation_not_ready", "needs_3_more_confirmed_fork_cycles"],
          planCount: 1,
          submittedCount: 0,
          confirmedCount: 0,
          targetConfirmedCount: 3,
          failedCount: 0,
        },
        executionAudit: {
          status: "complete",
          blockers: [],
          missingRecordCount: 0,
          recentTransitions: [
            {
              observedAt: "2026-04-12T11:51:00.000Z",
              kind: "fork_plan",
              status: "planned",
              routeLabel: "ethereum->base WBTC->wBTC.OFT",
              amount: "10000",
            },
          ],
        },
        tinyLiveCanary: {
          ready: false,
          status: "tiny_canary_blocked",
          blockers: ["shadow_replay_not_ready", "mechanical_simulation_not_ready", "fork_execution_not_ready"],
        },
        nextActions: [
          {
            rank: 1,
            scope: "canary",
            label: "base->avalanche wBTC.OFT->wBTC.OFT",
            reason: "scheduled_readiness_check",
            command: "npm run check:estimator-wallet -- --route-key=base:0x0555->avalanche:0x0555 --amount=100000",
          },
        ],
      },
      canaryAdvance: {
        final: {
          decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
          headline: "Best prepared route still fails objective score review",
        },
      },
    },
    canaryInputs: {
      routeKey: "bob:0x0555->base:0x0555",
      routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
      amount: "10000",
      scoreTradeReadiness: "reject_no_net_edge",
      blockers: ["reject_no_net_edge"],
      scoreDataGaps: ["stale_dex_output_quote"],
      gatewayQuote: { state: "fresh", ageMinutes: 5 },
      exactGas: { state: "fresh", ageMinutes: 5 },
      srcGas: { state: "stale", ageMinutes: 65 },
      dexQuote: { state: "stale", ageMinutes: 65 },
      bitcoinFee: { state: "not_required", ageMinutes: null },
      marketSnapshot: { state: "fresh", ageMinutes: 6 },
    },
    canarySelectionGap: {
      selectionCode: "prefer_viable_prep_route_over_measured_hypothesis",
      selectionLabel: "keep viable prep route active",
      reasonLabels: ["measured leader still needs wallet readiness checks"],
      blockerLabels: ["source gas snapshot stale"],
      reviewPlan: {
        actionCodes: ["check_wallet_readiness", "refresh_exact_gas"],
        actionLabels: ["wallet readiness check", "exact gas estimate"],
      },
      hypothesisGuard: "Positive measured edge is still a hypothesis until wallet, gas, and exact execution inputs are all fresh.",
      measuredLeader: {
        routeKey: "ethereum:0x2260->base:0x0555",
        label: "ethereum->base WBTC->wBTC.OFT",
        amount: "10000",
        tradeReadiness: "insufficient_data",
        measuredNetUsd: 64.76,
        executableNetUsd: 64.99,
        viableForPrep: false,
        txReady: true,
        exactGasDone: false,
      },
    },
    nextStep: {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      headline: "Best prepared route still fails objective score review",
      reasons: ["reject_no_net_edge"],
      route: {
        routeKey: "bob:0x0555->base:0x0555",
        label: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        tradeReadiness: "reject_no_net_edge",
        viableForPrep: true,
        txReady: true,
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
  });

  assert.equal(reviewPackage.packageStatus, "not_ready_for_manual_review");
  assert.equal(reviewPackage.reviewDecision, "NOT_READY_FOR_MANUAL_CANARY_REVIEW");
  assert.equal(reviewPackage.manualReviewCandidate.routeKey, "bob:0x0555->base:0x0555");
  assert.equal(reviewPackage.manualReviewCandidate.evidence.shadowObservationCount, 31);
  assert.equal(reviewPackage.measuredLeaderReview.routeKey, "ethereum:0x2260->base:0x0555");
  assert.equal(reviewPackage.reviewBlockers.includes("shadow_replay_not_ready"), true);
  assert.equal(reviewPackage.operatorChecklist.remaining.some((item) => item.includes("clear objective blocker")), true);
  assert.equal(reviewPackage.antiOverfitCaveats.some((item) => item.includes("does not grant execution permission")), true);
});

test("prelive review package becomes review-ready once canary and prelive gates clear", () => {
  const reviewPackage = buildPreliveReviewPackage({
    dashboardStatus: {
      generatedAt: "2026-04-12T12:10:00.000Z",
      overall: {
        liveTrading: "BLOCKED",
        blockers: [],
      },
      shadowCycle: {
        canaryDecision: "REVIEW_CANARY_CANDIDATE",
        headline: "Route is prepared for manual canary review",
        topRoute: {
          label: "base->unichain wBTC.OFT->wBTC.OFT",
          amount: "25000",
          tradeReadiness: "shadow_candidate_review_only",
          netEdgeUsd: 1.24,
        },
        shadowRoster: {
          candidates: [
            {
              label: "base->unichain wBTC.OFT->wBTC.OFT",
              amount: "25000",
              tradeReadiness: "shadow_candidate_review_only",
              netEdgeUsd: 1.24,
              prepFundingUsd: 0,
              viableForPrep: true,
              txReady: true,
              prepBlockers: [],
              scoreDisqualifiers: [],
            },
          ],
        },
        objectivePlans: {},
      },
      prelive: {
        currentStage: "tiny_live_canary_review",
        liveTradingPolicy: "BLOCKED",
        notes: [],
        shadowReplay: {
          status: "ready_for_mechanical_simulation",
          blockers: [],
          auditDecision: "LIVE_CANARY_REVIEW_POSSIBLE",
          policyReadyMeasuredRoutes: 2,
        },
        mechanicalSimulation: {
          status: "mechanical_path_proven",
          blockers: [],
          successCount: 50,
          targetSuccessCount: 50,
          failureCount: 0,
        },
        forkExecution: {
          status: "fork_execution_proven",
          blockers: [],
          planCount: 3,
          submittedCount: 3,
          confirmedCount: 3,
          targetConfirmedCount: 3,
          failedCount: 0,
        },
        executionAudit: {
          status: "complete",
          blockers: [],
          missingRecordCount: 0,
          recentTransitions: [],
        },
        tinyLiveCanary: {
          ready: true,
          status: "review_only_canary_candidate",
          blockers: [],
        },
        nextActions: [],
      },
      canaryAdvance: {
        final: {
          decision: "REVIEW_CANARY_CANDIDATE",
          headline: "Route is prepared for manual canary review",
        },
      },
    },
    canaryInputs: {
      routeKey: "base:0x0555->unichain:0x0555",
      routeLabel: "base->unichain wBTC.OFT->wBTC.OFT",
      amount: "25000",
      scoreTradeReadiness: "shadow_candidate_review_only",
      blockers: [],
      scoreDataGaps: [],
      gatewayQuote: { state: "fresh", ageMinutes: 2 },
      exactGas: { state: "fresh", ageMinutes: 2 },
      srcGas: { state: "fresh", ageMinutes: 2 },
      dexQuote: { state: "fresh", ageMinutes: 2 },
      bitcoinFee: { state: "not_required", ageMinutes: null },
      marketSnapshot: { state: "fresh", ageMinutes: 2 },
    },
    nextStep: {
      decision: "REVIEW_CANARY_CANDIDATE",
      headline: "Route is prepared for manual canary review",
      reasons: [],
      route: {
        routeKey: "base:0x0555->unichain:0x0555",
        label: "base->unichain wBTC.OFT->wBTC.OFT",
        amount: "25000",
        tradeReadiness: "shadow_candidate_review_only",
        viableForPrep: true,
        txReady: true,
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
  });

  const summary = summarizePreliveReviewPackage(reviewPackage);

  assert.equal(reviewPackage.packageStatus, "ready_for_manual_review");
  assert.equal(reviewPackage.reviewDecision, "READY_FOR_MANUAL_CANARY_REVIEW");
  assert.deepEqual(reviewPackage.reviewBlockers, []);
  assert.equal(reviewPackage.manualReviewCandidate.routeLabel, "base->unichain wBTC.OFT->wBTC.OFT");
  assert.equal(summary.readyForManualReview, true);
  assert.equal(summary.packageStatus, "ready_for_manual_review");
  assert.equal(summary.simulationSuccessCount, 50);
  assert.equal(summary.forkConfirmedCount, 3);
});
