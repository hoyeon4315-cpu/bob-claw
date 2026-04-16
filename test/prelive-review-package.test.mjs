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
  assert.equal(reviewPackage.tinyCanaryAdmission.decision, "NO_GO");
  assert.equal(reviewPackage.tinyCanaryAdmission.blockers.includes("shadow_replay_not_ready"), true);
  assert.equal(reviewPackage.remediationPlan.overallStatus, "ready");
  assert.equal(reviewPackage.remediationPlan.runnerCommand, "npm run run:admission-remediation -- --execute --limit=1");
  assert.equal(reviewPackage.remediationPlan.nextAction.code, "refresh_src_gas");
  assert.equal(reviewPackage.remediationPlan.items.some((item) => item.code === "check_wallet_readiness"), true);
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
      strategy: {
        pivotPlan: {
          currentBudgetUsd: 300,
          budgetNote: "USD 300 is the configured safety budget and loss cap.",
          budgetScenarios: [
            { budgetUsd: 300, label: "current_live_ring", planningOnly: false },
            { budgetUsd: 1000, label: "planning_scenario_1000", planningOnly: true },
          ],
          topRecommendation: {
            id: "gateway_base_btc_yield",
            label: "Gateway-funded BTC yield on Base",
            status: "pre_execution_blueprint",
            researchPilotMinimumUsd: 105,
            defaultDualSleeveMinimumUsd: 338.33,
            nextActionCode: "build_deterministic_yield_shadow_book",
            nextActionLabel: "build deterministic yield shadow book",
          },
          pivots: [],
        },
        yieldShadowBook: {
          topProfile: {
            id: "research_pilot",
            capitalRequiredUsd: 105,
          },
        },
        proxySpreadCoveragePlan: {
          nextAction: "expand_amount_ladder",
          nextProxyGroup: "wbtc",
        },
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
    strategySnapshot: {
      implementedStrategyCount: 9,
      candidateForValidationCount: 0,
      topImplementedStrategy: {
        id: "stablecoin_entry_exit_loops",
      },
      topPivot: {
        id: "gateway_base_btc_yield",
      },
    },
    executionRunbook: {
      currentStageId: "tiny_live_canary_review",
      nextStageId: "manual_canary_review",
      nextActionCode: "manual_canary_review_only",
    },
    preliveValidation: {
      validationStatus: "ready_for_manual_review",
      nextActionCode: "manual_canary_review_only",
    },
  });

  const summary = summarizePreliveReviewPackage(reviewPackage);

  assert.equal(reviewPackage.packageStatus, "ready_for_manual_review");
  assert.equal(reviewPackage.reviewDecision, "READY_FOR_MANUAL_CANARY_REVIEW");
  assert.deepEqual(reviewPackage.reviewBlockers, []);
  assert.equal(reviewPackage.tinyCanaryAdmission.decision, "GO_FOR_MANUAL_APPROVAL");
  assert.equal(reviewPackage.tinyCanaryAdmission.constraints.dailyLossCapUsd, null);
  assert.equal(reviewPackage.manualReviewCandidate.routeLabel, "base->unichain wBTC.OFT->wBTC.OFT");
  assert.equal(summary.readyForManualReview, true);
  assert.equal(summary.packageStatus, "ready_for_manual_review");
  assert.equal(summary.tinyCanaryAdmissionDecision, "GO_FOR_MANUAL_APPROVAL");
  assert.equal(summary.remediationPlan.overallStatus, "clear");
  assert.equal(summary.remediationPlan.runnerCommand, "npm run run:admission-remediation -- --execute --limit=1");
  assert.equal(summary.simulationSuccessCount, 50);
  assert.equal(summary.forkConfirmedCount, 3);
  assert.equal(reviewPackage.pivotPlan.topRecommendation.id, "gateway_base_btc_yield");
  assert.equal(summary.pivotTopRecommendationId, "gateway_base_btc_yield");
  assert.equal(summary.pivotResearchPilotMinimumUsd, 105);
  assert.equal(summary.pivotPlanningBudgetScenarios.length, 2);
  assert.equal(summary.yieldTopProfileId, "research_pilot");
  assert.equal(summary.proxyCoverageNextProxyGroup, "wbtc");
  assert.equal(summary.strategySnapshotTopImplementedId, "stablecoin_entry_exit_loops");
  assert.equal(summary.executionRunbookNextActionCode, "manual_canary_review_only");
  assert.equal(summary.preliveValidationStatus, "ready_for_manual_review");
});

test("prelive review package can promote wrapped loop as the primary live candidate when the route path is structurally blocked", () => {
  const reviewPackage = buildPreliveReviewPackage({
    dashboardStatus: {
      generatedAt: "2026-04-15T19:00:00.000Z",
      overall: {
        liveTrading: "BLOCKED",
        blockers: [],
      },
      shadowCycle: {
        canaryDecision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
        headline: "Current exact route is structurally blocked",
        topRoute: {
          label: "avalanche->bera wBTC.OFT->wBTC.OFT",
          amount: "10000",
          tradeReadiness: "reject_no_net_edge",
          netEdgeUsd: -0.4,
        },
      },
      prelive: {
        currentStage: "shadow_replay",
        liveTradingPolicy: "BLOCKED",
        tinyLiveCanary: {
          ready: false,
          blockers: ["shadow_replay_not_ready"],
        },
      },
    },
    canaryInputs: {
      routeKey: "avalanche:0x0555->bera:0x0555",
      routeLabel: "avalanche->bera wBTC.OFT->wBTC.OFT",
      amount: "10000",
      scoreTradeReadiness: "reject_no_net_edge",
      blockers: ["reject_no_net_edge"],
      gatewayQuote: { state: "fresh" },
      exactGas: { state: "fresh" },
      srcGas: { state: "fresh" },
      dexQuote: { state: "blocked" },
      bitcoinFee: { state: "not_required" },
      marketSnapshot: { state: "fresh" },
    },
    nextStep: {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      headline: "Current exact route is structurally blocked",
      reasons: ["reject_no_net_edge", "blocked_dex_quote"],
      route: {
        routeKey: "avalanche:0x0555->bera:0x0555",
        label: "avalanche->bera wBTC.OFT->wBTC.OFT",
        amount: "10000",
        tradeReadiness: "reject_no_net_edge",
      },
    },
    wrappedBtcLendingLoopSlice: {
      strategy: {
        id: "wrapped-btc-loop-base-moonwell",
        label: "Wrapped BTC lending loop (Base / Moonwell)",
        strategyType: "leverage_lending_loop",
        protocol: "moonwell",
        chain: "base",
        perTradeCapUsd: 300,
      },
      dryRunSummary: {
        dryRunReceiptRecorded: true,
        autoUnwindPassCount: 2,
      },
    },
    phase3Validation: {
      validations: [
        {
          id: "wrapped_btc_loop_validation",
          blockers: ["signer_backed_oos_receipts_missing"],
          evidence: { oosEvidenceStatus: "simulated_window_ready" },
          nextAction: { code: "collect_wrapped_btc_loop_oos_receipts", command: "npm run ingest:wrapped-btc-loop-receipt -- --write" },
        },
      ],
    },
    protocolMarketWatchers: {
      watchers: [
        {
          id: "wrapped_btc_loop_market_watch",
          blockers: ["signer_backed_oos_receipts_missing"],
          nextAction: { code: "collect_wrapped_btc_loop_oos_receipts", command: "npm run ingest:wrapped-btc-loop-receipt -- --write" },
        },
      ],
    },
  });
  const summary = summarizePreliveReviewPackage(reviewPackage);

  assert.equal(reviewPackage.primaryLiveCandidate.candidateType, "strategy");
  assert.equal(reviewPackage.primaryLiveCandidate.candidateId, "wrapped-btc-loop-base-moonwell");
  assert.equal(reviewPackage.tinyCanaryAdmission.candidate.candidateType, "strategy");
  assert.equal(reviewPackage.tinyCanaryAdmission.nextActionCode, "collect_wrapped_btc_loop_oos_receipts");
  assert.equal(reviewPackage.remediationPlan.nextAction.code, "collect_wrapped_btc_loop_oos_receipts");
  assert.equal(reviewPackage.remediationPlan.nextAction.command, "npm run ingest:wrapped-btc-loop-receipt -- --write");
  assert.equal(reviewPackage.remediationPlan.items.some((item) => item.code === "hold_dexQuote"), true);
  assert.equal(summary.candidateType, "strategy");
  assert.equal(summary.remediationPlan.nextAction.code, "collect_wrapped_btc_loop_oos_receipts");
  assert.equal(summary.remediationPlan.nextAction.command, "npm run ingest:wrapped-btc-loop-receipt -- --write");
  assert.equal(reviewPackage.readyForManualReview, false);
});

test("prelive review package carries ETH profitability as observe-only review context", () => {
  const reviewPackage = buildPreliveReviewPackage({
    dashboardStatus: {
      generatedAt: "2026-04-12T12:00:00.000Z",
      overall: {
        liveTrading: "BLOCKED",
        blockers: [],
      },
      strategy: {
        ethProfitability: {
          gatewayRouteCount: 3,
          routeCount: 1,
          measuredClosedLoopCount: 1,
          profitableClosedLoopCount: 0,
          loopObservableRouteCount: 1,
          stableRouteCount: 1,
          policyBlockedCount: 1,
          verdictCode: "positive_but_below_policy",
          verdictLabel: "positive but still below policy",
          verdictDetail: "Measured loops are still below policy.",
          recommendationCode: "collect_more_eth_evidence",
          recommendationLabel: "Collect more ETH evidence first",
          recommendationDetail: "Sample breadth is still too thin.",
          bestMeasuredRoute: {
            routeKey: "base:0x0->ethereum:0x0",
            amount: "10000",
            netUsd: -0.12,
            gapToPolicyUsd: 0.42,
            targetUsd: 0.3,
          },
          closestPolicyRoute: {
            routeKey: "base:0x0->ethereum:0x0",
            amount: "10000",
            netUsd: -0.12,
            gapToPolicyUsd: 0.42,
            targetUsd: 0.3,
          },
          bestResearchRoute: {
            routeKey: "base:0x0->ethereum:0x0",
            amount: "10000",
            classification: "loop_observable",
            tradeReadiness: "observe_only_ethereum_l1_phase_disabled",
            netUsd: -0.04,
          },
          followUpActionCode: "collect_eth_family_evidence",
          followUpActionLabel: "collect ETH family evidence",
          followUpCommand: "npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard",
          overfitRisks: ["thin_quote_samples"],
        },
      },
      shadowCycle: {
        objectivePlans: {},
        shadowRoster: {
          candidates: [],
        },
      },
      prelive: {
        currentStage: "shadow_replay",
        liveTradingPolicy: "BLOCKED",
        notes: [],
        shadowReplay: {
          status: "shadow_replay_blocked",
          blockers: ["audit:LIVE_BLOCKED"],
          auditDecision: "LIVE_BLOCKED",
          policyReadyMeasuredRoutes: 0,
        },
        mechanicalSimulation: {
          status: "mechanical_simulation_blocked",
          blockers: ["shadow_replay_not_ready"],
          successCount: 0,
          targetSuccessCount: 50,
          failureCount: 0,
        },
        forkExecution: {
          status: "fork_execution_blocked",
          blockers: ["mechanical_simulation_not_ready"],
          planCount: 0,
          submittedCount: 0,
          confirmedCount: 0,
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
          ready: false,
          status: "tiny_canary_blocked",
          blockers: ["shadow_replay_not_ready"],
        },
        nextActions: [],
      },
      canaryAdvance: {
        final: {
          decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
          headline: "Review-only",
        },
      },
    },
  });

  const summary = summarizePreliveReviewPackage(reviewPackage);

  assert.equal(reviewPackage.ethFamilyProfitability.recommendationCode, "collect_more_eth_evidence");
  assert.equal(reviewPackage.ethFamilyProfitability.routeCount, 1);
  assert.equal(reviewPackage.ethFamilyProfitability.followUpActionCode, "collect_eth_family_evidence");
  assert.equal(summary.ethFamilyVerdictCode, "positive_but_below_policy");
  assert.equal(summary.ethFamilyRecommendationCode, "collect_more_eth_evidence");
  assert.equal(summary.ethFamilyRouteCount, 1);
});
