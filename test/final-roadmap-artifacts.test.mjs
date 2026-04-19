import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBtcOnlyE2eDryRun, summarizeBtcOnlyE2eDryRun } from "../src/strategy/btc-only-e2e-dry-run.mjs";
import { buildTinyLiveCanaryRollout, summarizeTinyLiveCanaryRollout } from "../src/strategy/tiny-live-canary-rollout.mjs";
import { buildFinalOperatorExplainer } from "../src/strategy/final-operator-explainer.mjs";
import { buildLiveOpsHandoff } from "../src/strategy/live-ops-handoff.mjs";

test("final roadmap artifacts explain blocked dry-run and canary state coherently", () => {
  const reviewPackage = {
    manualReviewCandidate: {
      routeKey: "bob->base",
      amount: "10000",
      tradeReadiness: "insufficient_data",
    },
    tinyCanaryAdmission: {
      decision: "NO_GO",
      status: "blocked",
      blockers: ["shadow_replay_not_ready", "stale_gateway_quote"],
      requirements: [
        { code: "candidate_selected", label: "candidate selected", status: "passed", blockers: [] },
        { code: "fresh_inputs", label: "fresh inputs", status: "blocked", blockers: ["stale_gateway_quote"] },
      ],
      candidate: { routeKey: "bob->base", amount: "10000" },
      constraints: { liveTradingPolicy: "BLOCKED" },
      nextActionCode: "clear_admission_blockers",
    },
    operatorChecklist: { completed: ["route selected"], remaining: ["refresh inputs"] },
  };
  const preliveValidation = {
    validationStatus: "blocked",
    currentStageId: "shadow_replay",
    readinessPct: 0,
    blockerCount: 10,
    nextActionCode: "refresh_gateway_quote",
    nextActionCommand: "npm run verify:gateway",
  };
  const connectedRefresh = {
    status: "network_refresh_required",
    requiredRefreshCount: 5,
    staleInputCount: 5,
    nextActionCode: "refresh_gateway_quote",
    nextActionCommand: "npm run verify:gateway",
    runnerExecuteCommand: "npm run run:connected-refresh-package -- --execute",
    fullCommandChain: "npm run verify:gateway",
  };
  const currentRoutePrelivePass = {
    runCount: 3,
    blockedCount: 3,
    provenCount: 0,
    latestStatus: "blocked_nonrefreshable_input",
    latestStopReason: "blocked_nonrefreshable_input",
    nextAction: { code: "hold_dex_quote" },
  };
  const operationalJudgmentReview = {
    status: "guarded_blocked",
    issueCount: 3,
    nextActionCode: "stale_inputs_can_distort_route_scoring",
    nextActionCommand: "npm run verify:gateway",
  };

  const dryRun = buildBtcOnlyE2eDryRun({
    reviewPackage,
    preliveValidation,
    connectedRefresh,
    currentRoutePrelivePass,
    operationalJudgmentReview,
    now: "2026-04-15T18:00:00.000Z",
  });
  assert.equal(dryRun.summary.topStuckPointId, "connected_refresh");
  assert.equal(dryRun.summary.blockedCount >= 3, true);
  assert.equal(dryRun.lane.priority, "secondary");
  assert.equal(dryRun.lane.status, "blocked");
  assert.equal(summarizeBtcOnlyE2eDryRun(dryRun).topStuckPoint.id, "connected_refresh");
  assert.equal(summarizeBtcOnlyE2eDryRun(dryRun).lane.priority, "secondary");

  const rollout = buildTinyLiveCanaryRollout({
    reviewPackage,
    preliveValidation,
    currentRoutePrelivePass,
    operationalJudgmentReview,
    now: "2026-04-15T18:00:00.000Z",
  });
  assert.equal(rollout.summary.decision, "NO_GO");
  assert.equal(summarizeTinyLiveCanaryRollout(rollout).topBlockedRequirement.code, "fresh_inputs");

  const handoff = buildLiveOpsHandoff({
    strategySnapshot: { currentSystem: { liveTrading: "BLOCKED", preliveStage: "shadow_replay" } },
    reviewPackage,
    preliveValidation,
    connectedRefresh,
    currentRoutePrelivePass,
    protocolMarketWatchers: { summary: { blockedCount: 4 } },
    btcOnlyE2eDryRun: dryRun,
    tinyLiveCanaryRollout: rollout,
    operationalJudgmentReview,
    now: "2026-04-15T18:00:00.000Z",
  });
  assert.equal(handoff.summary.primaryLanePromotionTarget, "first_live_promotion");
  assert.equal(handoff.summary.exactRouteLanePriority, "secondary");
  assert.equal(handoff.primaryLiveLane.id, "bob->base");
  assert.equal(handoff.blockedExactRouteLane.status, "blocked");
  assert.equal(handoff.blockedExactRouteLane.promotionTarget, "blocked_secondary_lane");
  assert.equal(handoff.summary.nextAction, "refresh_gateway_quote");
  assert.equal(handoff.actionChain[0], "npm run run:connected-refresh-package -- --execute");

  const explainer = buildFinalOperatorExplainer({
    strategySnapshot: { currentSystem: { liveTrading: "BLOCKED" } },
    phase3Validation: { summary: { validationCount: 5, passedCount: 0 } },
    allocatorCore: { summary: { candidateCount: 5, activeAllocationCount: 0 } },
    protocolMarketWatchers: { summary: { blockedCount: 4 } },
    btcOnlyE2eDryRun: dryRun,
    tinyLiveCanaryRollout: rollout,
    preliveValidation,
    liveOpsHandoff: handoff,
    now: "2026-04-15T18:00:00.000Z",
  });
  assert.equal(explainer.status, "blocked");
  assert.equal(explainer.simpleKoreanSummary.includes("라이브 진입 단계는 아닙니다"), true);
  assert.equal(explainer.simpleKoreanSummary.includes("1순위 live 승격 대상"), true);
  assert.equal(explainer.simpleKoreanSummary.includes("blocked secondary"), true);
  assert.equal(explainer.laneStatus.primaryLive.priority, "primary");
  assert.equal(explainer.laneStatus.exactRoute.priority, "secondary");
});

test("live ops handoff separates wrapped-loop primary lane from blocked exact-route lane", () => {
  const handoff = buildLiveOpsHandoff({
    strategySnapshot: { currentSystem: { liveTrading: "BLOCKED", preliveStage: "shadow_replay" } },
    reviewPackage: {
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
        tradeReadiness: "strategy_evidence_blocked",
        blockerReasons: ["signer_backed_oos_receipts_missing"],
        nextAction: {
          code: "collect_wrapped_btc_loop_oos_receipts",
          command: "npm run ingest:wrapped-btc-loop-receipt -- --write",
        },
      },
    },
    preliveValidation: {
      nextActionCode: "collect_wrapped_btc_loop_oos_receipts",
      nextActionCommand: "npm run ingest:wrapped-btc-loop-receipt -- --write",
      exactRouteForkTechnicalStatus: "missing_plan",
      exactRouteForkEconomicStatus: "blocked_no_net_edge",
    },
    currentRoutePrelivePass: {
      provenCount: 0,
      latestStopReason: "blocked_nonrefreshable_input",
      nextAction: { code: "hold_dex_quote", command: null },
    },
    btcOnlyE2eDryRun: {
      summary: {
        blockedCount: 4,
        topStuckPointId: "connected_refresh",
        nextAction: { code: "hold_dex_quote", command: null },
      },
      candidate: {
        routeKey: "avalanche:btc->bera:btc",
        routeLabel: "avalanche->bera wBTC.OFT->wBTC.OFT",
      },
      lane: {
        id: "btc_exact_route",
        label: "BTC exact-route lane",
        priority: "secondary",
        status: "blocked",
      },
    },
    tinyLiveCanaryRollout: {
      summary: {
        decision: "NO_GO",
        nextAction: {
          code: "collect_wrapped_btc_loop_oos_receipts",
          command: "npm run ingest:wrapped-btc-loop-receipt -- --write",
        },
      },
    },
  });

  assert.equal(handoff.summary.primaryLaneId, "wrapped-btc-loop-base-moonwell");
  assert.equal(handoff.summary.primaryLanePromotionTarget, "first_live_promotion");
  assert.equal(handoff.summary.primaryLaneStatus, "strategy_evidence_blocked");
  assert.equal(handoff.summary.exactRouteLaneStatus, "blocked");
  assert.equal(handoff.summary.exactRouteLanePriority, "secondary");
  assert.deepEqual(handoff.blockedExactRouteLane.blockerReasons, ["blocked_nonrefreshable_input", "blocked_no_net_edge"]);
  assert.equal(handoff.summary.nextAction, "collect_wrapped_btc_loop_oos_receipts");
  assert.equal(handoff.actionChain[0], "npm run ingest:wrapped-btc-loop-receipt -- --write");
  assert.equal(handoff.receiptIngestionGuide.minPassedSignerBackedRuns, 2);
  assert.equal(handoff.receiptIngestionGuide.requiredFields.includes("entryTxHashes"), true);
  assert.equal(handoff.receiptIngestionGuide.sampleCommand.includes("--execution-mode=signer_backed_receipt"), true);
});

test("tiny live canary rollout keeps manual approval as next action after blockers clear", () => {
  const rollout = buildTinyLiveCanaryRollout({
    reviewPackage: {
      tinyCanaryAdmission: {
        decision: "GO_FOR_MANUAL_APPROVAL",
        status: "manual_approval_required",
        blockers: [],
        nextActionCode: "manual_approval_required",
        requirements: [
          { code: "candidate_selected", label: "candidate selected", status: "passed", blockers: [] },
          { code: "prelive_evidence_complete", label: "prelive evidence complete", status: "passed", blockers: [] },
          { code: "manual_approval_required", label: "manual approval required", status: "required", blockers: [] },
        ],
        candidate: {
          candidateType: "strategy",
          candidateId: "wrapped-btc-loop-base-moonwell",
        },
      },
    },
    preliveValidation: {
      validationStatus: "ready_for_manual_review",
      currentStageId: "tiny_live_canary_review",
      nextActionCode: "token",
      nextActionCommand: "npm run check:estimator-wallet -- --route-key=base:btc->ethereum:btc --amount=25000",
    },
    now: "2026-04-19T00:00:00.000Z",
  });

  assert.equal(rollout.summary.decision, "GO_FOR_MANUAL_APPROVAL");
  assert.equal(rollout.summary.blockerCount, 0);
  assert.equal(rollout.summary.nextAction.code, "manual_approval_required");
  assert.equal(rollout.summary.nextAction.command, null);
  assert.equal(summarizeTinyLiveCanaryRollout(rollout).nextAction.code, "manual_approval_required");
});

test("tiny live canary rollout keeps auto-execute policy as next action after policy clears", () => {
  const rollout = buildTinyLiveCanaryRollout({
    reviewPackage: {
      tinyCanaryAdmission: {
        decision: "GO_FOR_AUTO_EXECUTE",
        status: "auto_execute_policy_ready",
        blockers: [],
        nextActionCode: "auto_execute_policy_ready",
        requirements: [
          { code: "candidate_selected", label: "candidate selected", status: "passed", blockers: [] },
          { code: "prelive_evidence_complete", label: "prelive evidence complete", status: "passed", blockers: [] },
          { code: "auto_execute_policy_ready", label: "auto-execute policy ready", status: "passed", blockers: [] },
        ],
        candidate: {
          candidateType: "strategy",
          candidateId: "wrapped-btc-loop-base-moonwell",
        },
      },
    },
    preliveValidation: {
      validationStatus: "ready_for_manual_review",
      currentStageId: "tiny_live_canary_review",
      nextActionCode: "token",
      nextActionCommand: "npm run check:estimator-wallet -- --route-key=base:btc->ethereum:btc --amount=25000",
    },
    now: "2026-04-19T00:00:00.000Z",
  });

  assert.equal(rollout.summary.decision, "GO_FOR_AUTO_EXECUTE");
  assert.equal(rollout.summary.status, "auto_execute_policy_ready");
  assert.equal(rollout.summary.blockerCount, 0);
  assert.equal(rollout.summary.nextAction.code, "auto_execute_policy_ready");
  assert.equal(rollout.summary.nextAction.command, null);
  assert.equal(summarizeTinyLiveCanaryRollout(rollout).nextAction.code, "auto_execute_policy_ready");
});
