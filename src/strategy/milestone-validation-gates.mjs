import { buildDefaultRiskPolicy } from "../risk/policy.mjs";
import { buildExecutionRiskDecision, buildExecutionRiskState } from "../risk/execution-gate.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function countBy(items = [], selector) {
  return (items || []).reduce((counts, item) => {
    const key = selector(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function riskStateFixture(now = "2026-04-15T12:00:00.000Z") {
  return buildExecutionRiskState({
    now,
    inventory: { summary: { estimatedWalletUsd: 500 } },
    receiptRecords: [],
    executionEvents: [],
  });
}

function jobFixture(overrides = {}) {
  return {
    jobId: "milestone-validation-job",
    createdAt: "2026-04-15T11:55:00.000Z",
    requiresManualReview: false,
    fundingSource: {
      selectionStatus: "ready",
      requiresReserveState: false,
      requiresManualFunding: false,
      missingInputs: [],
    },
    systemEconomics: {
      tradeReadiness: "shadow_candidate_review_only",
      routeInputUsd: 10,
      routeNetEdgeUsd: 0.9,
      routeExecutableNetEdgeUsd: 0.9,
      effectiveSystemNetPnlUsd: 0.6,
    },
    ...overrides,
  };
}

function runtimeSafetyEvidence() {
  const riskPolicy = buildDefaultRiskPolicy();
  const checks = [
    {
      id: "strategy_cap_required",
      blockers: ["strategy_policy_missing", "strategy_per_trade_cap_missing"],
      decision: buildExecutionRiskDecision({
        job: jobFixture({ strategyId: "wrapped-btc-loop" }),
        riskState: riskStateFixture(),
        riskPolicy,
        mode: "live",
        now: "2026-04-15T12:00:00.000Z",
      }),
    },
    {
      id: "leverage_fields_required",
      blockers: ["leverage_policy_fields_missing"],
      decision: buildExecutionRiskDecision({
        job: jobFixture({
          strategyPolicy: {
            id: "wrapped-btc-loop",
            isLeverage: true,
            perTradeCapUsd: 25,
          },
        }),
        riskState: riskStateFixture(),
        riskPolicy,
        mode: "live",
        now: "2026-04-15T12:00:00.000Z",
      }),
    },
    {
      id: "health_factor_breach_blocks",
      blockers: ["health_factor_below_min", "liquidation_buffer_below_min"],
      decision: buildExecutionRiskDecision({
        job: jobFixture({
          strategyPolicy: {
            id: "wrapped-btc-loop",
            isLeverage: true,
            perTradeCapUsd: 25,
            healthFactorMin: 1.35,
            liquidationBufferPct: 12,
            unwindTriggerHealthFactor: 1.3,
            maxLoopIterations: 4,
            maxLtvPct: 62,
            currentHealthFactor: 1.29,
            currentLiquidationBufferPct: 9,
          },
        }),
        riskState: riskStateFixture(),
        riskPolicy,
        mode: "live",
        now: "2026-04-15T12:00:00.000Z",
      }),
    },
  ].map((check) => ({
    id: check.id,
    ok: check.blockers.every((blocker) => check.decision.blockers.includes(blocker)),
    expectedBlockers: check.blockers,
    observedBlockers: check.decision.blockers,
  }));

  return {
    checkCount: checks.length,
    passCount: checks.filter((item) => item.ok).length,
    checks,
  };
}

function buildGate({ id, label, status, blockers = [], warnings = [], nextAction = null, evidence = null, notes = [] }) {
  return {
    id,
    label,
    status,
    blockers: unique(blockers),
    warnings: unique(warnings),
    nextAction,
    evidence,
    notes,
  };
}

function phase1Gate({ phase1Revalidation = null, flashFloorDecision = null } = {}) {
  const blockers = unique([
    phase1Revalidation?.overfitDecision ? null : "overfit_audit_missing",
    (phase1Revalidation?.varianceRouteCount ?? 0) > 0 ? null : "variance_artifact_missing",
    (phase1Revalidation?.laneCount ?? 0) > 0 ? null : "lane_reclassification_missing",
    flashFloorDecision?.summary?.currentDecision ? null : "flash_floor_decision_missing",
  ]);
  const warnings = unique([
    phase1Revalidation?.globalOverfitPasses === false ? "global_overfit_gate_still_blocked" : null,
    (phase1Revalidation?.candidateForValidationCount ?? 0) <= 0 ? "no_lane_currently_ready_for_validation" : null,
    (phase1Revalidation?.blockedByContractFloorCount ?? 0) > 0 ? "contract_floor_still_blocks_some_lanes" : null,
  ]);
  return buildGate({
    id: "phase1_revalidation",
    label: "Phase 1 revalidation",
    status: blockers.length ? "blocked" : "passed",
    blockers,
    warnings,
    nextAction: blockers.length
      ? {
          code: "refresh_phase1_artifacts",
          command:
            "npm run audit:overfit -- --write && npm run report:gas-slippage-variance -- --write && npm run report:lane-reclassification -- --write && npm run report:flash-floor-decision -- --write",
        }
      : null,
    evidence: {
      overfitDecision: phase1Revalidation?.overfitDecision || null,
      varianceRouteCount: phase1Revalidation?.varianceRouteCount ?? 0,
      laneCount: phase1Revalidation?.laneCount ?? 0,
      candidateForValidationCount: phase1Revalidation?.candidateForValidationCount ?? 0,
      flashFloorDecision: flashFloorDecision?.summary?.currentDecision || null,
    },
  });
}

function researchGate({ strategyResearchBoard = null } = {}) {
  const candidateCount = strategyResearchBoard?.candidateCount ?? strategyResearchBoard?.summary?.candidateCount ?? 0;
  return buildGate({
    id: "relaxed_policy_research",
    label: "Relaxed-policy research",
    status: candidateCount > 0 ? "passed" : "blocked",
    blockers: candidateCount > 0 ? [] : ["strategy_research_board_missing"],
    warnings: candidateCount > 0 && !strategyResearchBoard?.topCandidate ? ["no_top_research_candidate_selected"] : [],
    nextAction:
      candidateCount > 0
        ? null
        : {
            code: "build_strategy_research_board",
            command: "npm run report:strategy-research-board -- --write",
          },
    evidence: {
      candidateCount,
      topCandidateId: strategyResearchBoard?.topCandidate?.id || strategyResearchBoard?.summary?.topCandidateId || null,
      nextActionCode: strategyResearchBoard?.nextAction?.code || strategyResearchBoard?.summary?.nextAction?.code || null,
    },
  });
}

function runtimeSafetyGate() {
  const evidence = runtimeSafetyEvidence();
  const blockers = evidence.checks.filter((item) => !item.ok).map((item) => `runtime_check_failed:${item.id}`);
  return buildGate({
    id: "runtime_safety",
    label: "Runtime safety",
    status: blockers.length ? "blocked" : "passed",
    blockers,
    nextAction: blockers.length
      ? {
          code: "repair_execution_gate",
          command: "node --test test/execution-risk-gate.test.mjs",
        }
      : null,
    evidence,
    notes: ["Synthetic live-path checks verify that cap, leverage-field, and breach guards all fail closed."],
  });
}

function wrappedBtcLoopGate({ wrappedBtcLendingLoopSlice = null, wrappedBtcLoopDryRun = null } = {}) {
  const dryRunRecorded = wrappedBtcLoopDryRun?.dryRunReceiptRecorded === true;
  const blockers = unique([
    wrappedBtcLendingLoopSlice ? null : "wrapped_btc_loop_slice_missing",
    wrappedBtcLendingLoopSlice?.validation?.ok === true ? null : "wrapped_btc_loop_config_invalid",
    ...(wrappedBtcLendingLoopSlice?.blockers || []).filter((blocker) => blocker !== "dry_run_unwind_not_recorded" || !dryRunRecorded),
  ]);
  const warnings = unique([
    wrappedBtcLendingLoopSlice?.pnl?.estimated?.status === "unavailable_until_protocol_adapter_and_rate_feed_exist"
      ? "estimated_pnl_not_connected"
      : null,
    wrappedBtcLendingLoopSlice?.pnl?.realized?.sampleCount > 0 ? null : "no_realized_loop_samples",
    dryRunRecorded && wrappedBtcLoopDryRun?.latestRun?.executionMode === "simulated_dry_run" ? "dry_run_receipt_is_simulated" : null,
  ]);
  const nextAction =
    blockers.length <= 0
      ? null
      : blockers.includes("protocol_adapter_not_built")
        ? {
            code: "wire_wrapped_btc_loop_adapter",
            command: null,
          }
        : blockers.includes("dry_run_unwind_not_recorded")
          ? {
          code: "run_wrapped_btc_loop_dry_run",
          command: "node src/cli/run-wrapped-btc-loop-dry-run.mjs --write",
        }
          : {
              code: "complete_wrapped_btc_loop_runtime",
              command: "npm run report:wrapped-btc-loop -- --write",
            };
  return buildGate({
    id: "wrapped_btc_loop_vertical_slice",
    label: "Wrapped-BTC loop vertical slice",
    status: blockers.length ? "blocked" : "passed",
    blockers,
    warnings,
    nextAction,
    evidence: wrappedBtcLendingLoopSlice
      ? {
          strategyId: wrappedBtcLendingLoopSlice.strategy?.id || null,
          protocol: wrappedBtcLendingLoopSlice.strategy?.protocol || null,
          readyForDryRun: wrappedBtcLendingLoopSlice.readiness?.readyForDryRun ?? null,
          readyForLive: wrappedBtcLendingLoopSlice.readiness?.readyForLive ?? null,
          loopedExposureMultiple: wrappedBtcLendingLoopSlice.entryPlan?.loopedExposureMultiple ?? null,
          projectedHealthFactor: wrappedBtcLendingLoopSlice.entryPlan?.projectedHealthFactor ?? null,
          dryRunReceiptRecorded: dryRunRecorded,
        }
      : null,
  });
}

function leverageWatcherGate({ wrappedBtcLendingLoopSlice = null, wrappedBtcLoopDryRun = null } = {}) {
  const dryRunRecorded = wrappedBtcLoopDryRun?.dryRunReceiptRecorded === true;
  const blockers = unique([
    wrappedBtcLendingLoopSlice ? null : "wrapped_btc_loop_slice_missing",
    wrappedBtcLendingLoopSlice?.watcherPlan?.checks?.length ? null : "watcher_plan_missing",
    wrappedBtcLendingLoopSlice?.unwindPlan?.dryRunRequired === true && !dryRunRecorded ? "dry_run_unwind_not_recorded" : null,
    ...(wrappedBtcLendingLoopSlice?.blockers || []).filter((blocker) =>
      ["watcher_runtime_not_wired", "emergency_unwind_executor_not_built"].includes(blocker),
    ),
  ]);
  const nextAction =
    blockers.length <= 0
      ? null
      : blockers.includes("dry_run_unwind_not_recorded")
        ? {
            code: "run_forced_unwind_dry_run",
            command: "node src/cli/run-wrapped-btc-loop-dry-run.mjs --write",
          }
        : {
            code: "wire_auto_unwind_runtime",
            command: null,
          };
  return buildGate({
    id: "leverage_watchers_and_unwind",
    label: "Leverage watchers and unwind",
    status: blockers.length ? "blocked" : "passed",
    blockers,
    nextAction,
    evidence: wrappedBtcLendingLoopSlice
      ? {
          watcherCheckCount: wrappedBtcLendingLoopSlice.watcherPlan?.checks?.length ?? 0,
          unwindDryRunRequired: wrappedBtcLendingLoopSlice.unwindPlan?.dryRunRequired ?? null,
          breachAction: wrappedBtcLendingLoopSlice.watcherPlan?.breachAction || null,
          dryRunReceiptRecorded: dryRunRecorded,
        }
      : null,
  });
}

function preliveGate({ preliveValidation = null } = {}) {
  const validationStatus = preliveValidation?.validationStatus || null;
  return buildGate({
    id: "prelive_readiness",
    label: "Prelive readiness",
    status: validationStatus === "ready_for_manual_review" ? "passed" : validationStatus === "blocked" ? "blocked" : "in_progress",
    blockers: preliveValidation?.blockers || [],
    warnings: preliveValidation?.warnings || [],
    nextAction: preliveValidation?.nextAction || null,
    evidence: preliveValidation
      ? {
          validationStatus,
          readinessPct: preliveValidation.readinessPct ?? 0,
          currentStageId: preliveValidation.currentStageId || null,
          blockerCount: preliveValidation.summary?.blockerCount ?? preliveValidation.blockers?.length ?? 0,
        }
      : null,
  });
}

export function buildMilestoneValidationGates({
  phase1Revalidation = null,
  strategyResearchBoard = null,
  flashFloorDecision = null,
  wrappedBtcLendingLoopSlice = null,
  wrappedBtcLoopDryRun = null,
  preliveValidation = null,
  now = null,
} = {}) {
  const gates = [
    phase1Gate({ phase1Revalidation, flashFloorDecision }),
    researchGate({ strategyResearchBoard }),
    runtimeSafetyGate(),
    wrappedBtcLoopGate({ wrappedBtcLendingLoopSlice, wrappedBtcLoopDryRun }),
    leverageWatcherGate({ wrappedBtcLendingLoopSlice, wrappedBtcLoopDryRun }),
    preliveGate({ preliveValidation }),
  ];
  const nextGate = gates.find((gate) => gate.status !== "passed") || null;
  const passedCount = gates.filter((gate) => gate.status === "passed").length;
  const blockedCount = gates.filter((gate) => gate.status === "blocked").length;
  const inProgressCount = gates.filter((gate) => gate.status === "in_progress").length;

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      gateCount: gates.length,
      passedCount,
      blockedCount,
      inProgressCount,
      warningCount: gates.reduce((sum, gate) => sum + gate.warnings.length, 0),
      overallStatus: blockedCount > 0 ? "blocked" : inProgressCount > 0 ? "in_progress" : "passed",
      nextGateId: nextGate?.id || null,
      nextAction: nextGate?.nextAction || null,
    },
    gates,
  };
}

export function summarizeMilestoneValidationGates(report = null) {
  if (!report) return null;
  const nextGate = report.gates?.find((gate) => gate.id === report.summary?.nextGateId) || report.gates?.find((gate) => gate.status !== "passed") || null;
  return {
    gateCount: report.summary?.gateCount ?? 0,
    passedCount: report.summary?.passedCount ?? 0,
    blockedCount: report.summary?.blockedCount ?? 0,
    inProgressCount: report.summary?.inProgressCount ?? 0,
    overallStatus: report.summary?.overallStatus || null,
    nextGate: nextGate
      ? {
          id: nextGate.id || null,
          label: nextGate.label || null,
          status: nextGate.status || null,
        }
      : null,
    nextAction: report.summary?.nextAction || null,
  };
}
