import { buildYieldShadowBook, summarizeYieldShadowBook } from "../ledger/yield-shadow-book.mjs";
import { buildStrategyPivotPlan, summarizeStrategyPivotPlan } from "./pivot-plan.mjs";
import { buildProxySpreadCoveragePlan, summarizeProxySpreadCoveragePlan } from "./proxy-spread-coverage-plan.mjs";
import { summarizeAllocatorCore } from "./allocator-core.mjs";
import { buildCapitalExpansionReview, summarizeCapitalExpansionReview } from "./capital-expansion-review.mjs";
import { summarizeDeterministicStrategyCandidates } from "./deterministic-strategy-candidates.mjs";
import { summarizeLeverageAutoUnwindRuntimeReports } from "../defi/leverage-auto-unwind-runtime.mjs";
import { summarizePhase1Revalidation } from "./phase1-revalidation.mjs";
import { summarizePhase3StrategyValidation } from "./phase3-strategy-validation.mjs";
import { summarizeProtocolMarketWatchers } from "./protocol-market-watchers.mjs";
import { summarizeProtocolTrustTiers } from "./protocol-trust-tiers.mjs";
import { summarizeSecondaryStrategyScaffolds } from "./secondary-strategy-scaffolds.mjs";
import { summarizeStrategyResearchBoard } from "./strategy-research-board.mjs";
import { buildStrategyCatalog } from "./strategy-catalog.mjs";

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function countByStatus(items = []) {
  return (items || []).reduce((counts, item) => {
    const status = item?.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function statusPriority(status) {
  return {
    candidate_for_validation: 0,
    measured_below_policy: 1,
    thin_coverage: 2,
    blocked_by_policy: 3,
    research_only: 4,
    analysis_only: 5,
    unobserved: 6,
  }[status] ?? 7;
}

function evidenceGrade(entry = null, pivot = null) {
  if (pivot?.evidenceGrade) return pivot.evidenceGrade;
  const status = entry?.status || null;
  if (status === "candidate_for_validation" || status === "measured_below_policy") return "measured";
  if (status === "thin_coverage" || status === "research_only") return "research";
  if (status === "analysis_only") return "analysis";
  return "none";
}

function nextActionForEntry(entry = null, pivot = null) {
  if (pivot?.nextStep?.code || pivot?.nextStep?.command) {
    return {
      code: pivot.nextStep.code || null,
      label: pivot.nextStep.label || null,
      command: pivot.nextStep.command || null,
    };
  }
  const command = entry?.commands?.[0] || null;
  if (!command) return null;
  return {
    code: "refresh_strategy_surface",
    label: "refresh strategy surface",
    command,
  };
}

function entryOverfitRisks(entry = null, pivot = null) {
  const evidence = entry?.evidence || {};
  return unique([
    ...(pivot?.overfitRisks || []),
    evidence.overfitAssessment === "high_overfit_risk" ? "high_overfit_risk" : null,
    ...(evidence.overfitRisks || []),
  ]);
}

function implementedStrategyEntry({ entry = null, pivot = null, lane = null } = {}) {
  const nextAction = nextActionForEntry(entry, pivot);
  return {
    id: entry?.id || null,
    label: entry?.label || null,
    lane,
    status: entry?.status || null,
    reason: entry?.reason || null,
    evidenceGrade: evidenceGrade(entry, pivot),
    evidence: entry?.evidence || {},
    capitalGuidance: pivot?.capitalGuidance || null,
    budgetScenarios: pivot?.budgetScenarios || [],
    blockers: unique([entry?.reason || null, ...(pivot?.blockers || [])]),
    overfitRisks: entryOverfitRisks(entry, pivot),
    nextAction,
    commands: entry?.commands || [],
    preExecutionPlan: pivot?.preExecutionPlan || [],
    ethApplicability: entry?.ethApplicability || null,
  };
}

function pivotEntry(pivot = null) {
  const nextAction = nextActionForEntry(null, pivot);
  return {
    id: pivot?.id || null,
    label: pivot?.label || null,
    category: pivot?.category || null,
    status: pivot?.status || null,
    reason: pivot?.reason || null,
    evidenceGrade: pivot?.evidenceGrade || null,
    evidence: pivot?.evidence || {},
    capitalGuidance: pivot?.capitalGuidance || null,
    budgetScenarios: pivot?.budgetScenarios || [],
    blockers: pivot?.blockers || [],
    overfitRisks: pivot?.overfitRisks || [],
    nextAction,
    commands: pivot?.commands || [],
    preExecutionPlan: pivot?.preExecutionPlan || [],
  };
}

function bestImplementedStrategy(items = []) {
  return [...(items || [])].sort((left, right) => {
    const rankDiff = statusPriority(left?.status) - statusPriority(right?.status);
    if (rankDiff !== 0) return rankDiff;
    const leftHasAction = left?.nextAction?.command ? 0 : 1;
    const rightHasAction = right?.nextAction?.command ? 0 : 1;
    if (leftHasAction !== rightHasAction) return leftHasAction - rightHasAction;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  })[0] || null;
}

function planningBudgetUsd(budgetScenarios = []) {
  return (budgetScenarios || []).find((scenario) => scenario?.planningOnly)?.budgetUsd ?? null;
}

function topAction({ topPivot = null, topImplemented = null, proxyCoverageSummary = null } = {}) {
  if (topPivot?.nextAction?.code || topPivot?.nextAction?.command) {
    return {
      scope: "pivot",
      code: topPivot.nextAction.code || null,
      label: topPivot.nextAction.label || null,
      command: topPivot.nextAction.command || null,
    };
  }
  if (proxyCoverageSummary?.nextAction || proxyCoverageSummary?.nextCommand) {
    return {
      scope: "proxy_coverage",
      code: proxyCoverageSummary.nextAction || null,
      label: proxyCoverageSummary.nextPriority || proxyCoverageSummary.nextAction || null,
      command: proxyCoverageSummary.nextCommand || null,
    };
  }
  if (topImplemented?.nextAction?.code || topImplemented?.nextAction?.command) {
    return {
      scope: topImplemented.lane || "implemented_strategy",
      code: topImplemented.nextAction.code || null,
      label: topImplemented.nextAction.label || null,
      command: topImplemented.nextAction.command || null,
    };
  }
  return null;
}

function productCoverageStatusPriority(status = null) {
  return {
    missing_plan: 0,
    tracked_blocked: 1,
    tracked_in_progress: 2,
    tracked_ready: 3,
  }[status] ?? 4;
}

function buildProductCoverageItem({ id, label, status, reason = null, nextAction = null, evidence = null }) {
  return {
    id,
    label,
    status,
    reason,
    nextAction,
    evidence,
  };
}

export function buildProductPlanningCoverage({ dashboardStatus = null, strategySnapshot = null } = {}) {
  const milestoneValidation = strategySnapshot?.planningLayers?.milestoneValidationGates || null;
  const payback = dashboardStatus?.payback || null;
  const executorRuntime = dashboardStatus?.executorRuntime || null;
  const liveBaseline = dashboardStatus?.liveBaseline || null;
  const paybackMinimumProgress = payback?.scheduler?.minimumPaybackProgress || payback?.scheduler?.previewAfterDestination || null;
  const exactRouteTechnicalBlocker = liveBaseline?.blockers?.technical?.[0] || null;
  const paybackStatus =
    !payback
      ? "missing_plan"
      : payback?.lastPaybackSettledAt || (payback?.paidBackSatsLifetime ?? 0) > 0
        ? "tracked_ready"
        : payback?.scheduler?.status === "carry"
          ? "tracked_in_progress"
          : payback?.scheduler?.status === "blocked"
            ? "tracked_blocked"
            : "tracked_in_progress";
  const executorStatus =
    !executorRuntime
      ? "missing_plan"
      : executorRuntime.available && executorRuntime.runtimeStatus === "healthy" && executorRuntime.signerSocketPresent
        ? "tracked_ready"
        : "tracked_blocked";
  const exactRouteForkStatus =
    !liveBaseline
      ? "tracked_in_progress"
      : !exactRouteTechnicalBlocker
        ? "tracked_ready"
        : (exactRouteTechnicalBlocker.status || exactRouteTechnicalBlocker.code || "").includes("missing_plan")
          ? "missing_plan"
          : "tracked_blocked";
  const pillars = [
    milestoneValidation
      ? buildProductCoverageItem({
          id: "strategy_validation",
          label: "Strategy validation",
          status:
            milestoneValidation.overallStatus === "passed"
              ? "tracked_ready"
              : milestoneValidation.overallStatus === "in_progress"
                ? "tracked_in_progress"
                : "tracked_blocked",
          reason: milestoneValidation?.nextGate?.id || milestoneValidation?.overallStatus || null,
          nextAction: milestoneValidation?.nextAction || null,
          evidence: {
            passedCount: milestoneValidation.passedCount ?? 0,
            gateCount: milestoneValidation.gateCount ?? 0,
            blockedCount: milestoneValidation.blockedCount ?? 0,
            nextGateId: milestoneValidation.nextGate?.id || null,
          },
        })
      : null,
    buildProductCoverageItem({
      id: "payback_engine",
      label: "Payback engine",
      status: paybackStatus,
      reason: payback?.scheduler?.reason || payback?.scheduler?.status || null,
      nextAction: payback?.scheduler?.nextAction
        ? {
            code: payback.scheduler.nextAction,
            command: "npm run report:payback-status -- --json",
          }
        : null,
      evidence: payback
        ? {
            pendingSats: payback.accumulatorPendingSats ?? null,
            grossProfitSatsPeriod: payback.grossProfitSatsPeriod ?? null,
            paidBackSatsLifetime: payback.paidBackSatsLifetime ?? null,
            remainingSatsToMinimum: paybackMinimumProgress?.satsToMinimumPayback ?? null,
          }
        : null,
    }),
    buildProductCoverageItem({
      id: "executor_runtime",
      label: "Executor runtime",
      status: executorStatus,
      reason: executorRuntime?.runtimeStatus || executorRuntime?.signerStatus || null,
      nextAction: null,
      evidence: executorRuntime
        ? {
            available: executorRuntime.available === true,
            signerStatus: executorRuntime.signerStatus || null,
            watchdogStatus: executorRuntime.watchdog?.status || null,
          }
        : null,
    }),
    buildProductCoverageItem({
      id: "exact_route_fork_plan",
      label: "Exact-route fork plan",
      status: exactRouteForkStatus,
      reason: exactRouteTechnicalBlocker?.status || exactRouteTechnicalBlocker?.code || (liveBaseline ? null : "live_baseline_pending"),
      nextAction: liveBaseline?.nextAction || null,
      evidence: liveBaseline
        ? {
            stageId: liveBaseline.currentStageId || null,
            technicalBlockerCode: exactRouteTechnicalBlocker?.code || null,
            technicalBlockerStatus: exactRouteTechnicalBlocker?.status || null,
          }
        : null,
    }),
  ].filter(Boolean);
  const topGap =
    [...pillars].sort((left, right) => productCoverageStatusPriority(left?.status) - productCoverageStatusPriority(right?.status))[0] || null;
  return {
    pillarCount: pillars.length,
    readyCount: pillars.filter((item) => item.status === "tracked_ready").length,
    inProgressCount: pillars.filter((item) => item.status === "tracked_in_progress").length,
    blockedCount: pillars.filter((item) => item.status === "tracked_blocked").length,
    missingCount: pillars.filter((item) => item.status === "missing_plan").length,
    topGap: topGap
      ? {
          id: topGap.id || null,
          label: topGap.label || null,
          status: topGap.status || null,
          reason: topGap.reason || null,
        }
      : null,
    pillars,
  };
}

export function buildStrategySnapshot({
  dashboardStatus = null,
  state = {},
  triangleArtifacts = {},
  phase1Revalidation = null,
  phase3StrategyValidation = null,
  allocatorCore = null,
  protocolTrustTiers = null,
  protocolMarketWatchers = null,
  strategyResearchBoard = null,
  secondaryStrategyScaffolds = null,
  deterministicStrategyCandidates = null,
  leverageAutoUnwindRuntimeReports = [],
  now = null,
} = {}) {
  const generatedAt = now || dashboardStatus?.generatedAt || new Date().toISOString();
  const catalog = buildStrategyCatalog({
    dashboardStatus,
    state,
    triangleArtifacts,
    laneReclassification: phase1Revalidation?.laneReclassification || null,
  });
  const pivotPlan = buildStrategyPivotPlan({ dashboardStatus, state, triangleArtifacts });
  const yieldShadowBook = buildYieldShadowBook({ pivotPlan });
  const proxyCoveragePlan = buildProxySpreadCoveragePlan({
    proxySpreadSummary: dashboardStatus?.strategy?.btcProxySpreads || null,
    now: generatedAt,
  });
  const pivotPlanSummary = summarizeStrategyPivotPlan(pivotPlan);
  const yieldShadowSummary = summarizeYieldShadowBook(yieldShadowBook);
  const proxyCoverageSummary = summarizeProxySpreadCoveragePlan(proxyCoveragePlan);
  const pivotById = new Map((pivotPlan?.pivots || []).map((pivot) => [pivot.id, pivot]));

  const implementedStrategies = [
    ...(catalog?.btcFamilies || []).map((entry) =>
      implementedStrategyEntry({
        entry,
        pivot: pivotById.get(entry.id) || null,
        lane: "btc_family",
      }),
    ),
    ...(catalog?.ethBranches || []).map((entry) =>
      implementedStrategyEntry({
        entry,
        pivot: pivotById.get(entry.id) || null,
        lane: "eth_branch",
      }),
    ),
  ];
  const pivotOpportunities = (pivotPlan?.pivots || []).map((pivot) => pivotEntry(pivot));
  const topImplemented = bestImplementedStrategy(implementedStrategies);
  const topPivot = pivotOpportunities[0] || null;
  const nextAction = topAction({
    topPivot,
    topImplemented,
    proxyCoverageSummary,
  });
  const currentSystem = {
    liveTrading: dashboardStatus?.overall?.liveTrading || "BLOCKED",
    shadowTrading: dashboardStatus?.overall?.shadowTrading || null,
    preliveStage: dashboardStatus?.prelive?.currentStage || null,
    activeBudgetUsd: pivotPlanSummary?.currentBudgetUsd ?? null,
    budgetScenarios: pivotPlanSummary?.budgetScenarios || [],
    ethereumL1: pivotPlan?.currentSystem?.ethereumL1 || "allowed_when_positive_ev",
  };
  const capitalExpansionReview = buildCapitalExpansionReview({
    currentSystem,
    implementedStrategies,
    pivotOpportunities,
    yieldProfiles: yieldShadowBook?.profiles || [],
    budgetScenarios: currentSystem.budgetScenarios,
    now: generatedAt,
  });
  const capitalExpansionSummary = summarizeCapitalExpansionReview(capitalExpansionReview);
  const phase1RevalidationSummary = summarizePhase1Revalidation(phase1Revalidation || {});
  const phase3StrategyValidationSummary = summarizePhase3StrategyValidation(phase3StrategyValidation || null);
  const allocatorCoreSummary = summarizeAllocatorCore(allocatorCore || null);
  const protocolTrustTiersSummary = summarizeProtocolTrustTiers(protocolTrustTiers || null);
  const protocolMarketWatchersSummary = summarizeProtocolMarketWatchers(protocolMarketWatchers || null);
  const strategyResearchSummary = summarizeStrategyResearchBoard(strategyResearchBoard || null);
  const secondaryScaffoldsSummary = summarizeSecondaryStrategyScaffolds(secondaryStrategyScaffolds || null);
  const deterministicCandidatesSummary = summarizeDeterministicStrategyCandidates(deterministicStrategyCandidates || null);
  const leverageAutoUnwindRuntimeSummary = summarizeLeverageAutoUnwindRuntimeReports(leverageAutoUnwindRuntimeReports);
  const productCoverage = buildProductPlanningCoverage({
    dashboardStatus,
    strategySnapshot: {
      summary: {},
      planningLayers: {},
    },
  });

  return {
    schemaVersion: 1,
    generatedAt,
    currentSystem,
    catalogScope: catalog?.scope || null,
    summary: {
      implementedStrategyCount: implementedStrategies.length,
      btcFamilyCount: catalog?.btcFamilies?.length || 0,
      ethBranchCount: catalog?.ethBranches?.length || 0,
      pivotCount: pivotOpportunities.length,
      candidateForValidationCount: implementedStrategies.filter((item) => item.status === "candidate_for_validation").length,
      measuredBelowPolicyCount: implementedStrategies.filter((item) => item.status === "measured_below_policy").length,
      thinCoverageCount: implementedStrategies.filter((item) => item.status === "thin_coverage").length,
      blockedByPolicyCount: implementedStrategies.filter((item) => item.status === "blocked_by_policy").length,
      researchOnlyCount: implementedStrategies.filter((item) => item.status === "research_only").length,
      analysisOnlyCount: implementedStrategies.filter((item) => item.status === "analysis_only").length,
      unobservedCount: implementedStrategies.filter((item) => item.status === "unobserved").length,
      topImplementedStrategyId: topImplemented?.id || null,
      topPivotId: topPivot?.id || null,
      topAction: nextAction,
      planningBudgetUsd: planningBudgetUsd(pivotPlanSummary?.budgetScenarios || []),
      yieldTopProfileId: yieldShadowSummary?.topProfile?.id || null,
      proxyCoverageNextAction: proxyCoverageSummary?.nextAction || null,
      capitalExpansionActiveLaneBudgetUsd: capitalExpansionSummary?.activeLaneBudgetUsd ?? null,
      capitalExpansionPlanningLaneBudgetUsd: capitalExpansionSummary?.planningLaneBudgetUsd ?? null,
      capitalExpansionPlanningTopImplementedId: capitalExpansionSummary?.planningTopImplementedId || null,
      capitalExpansionPlanningTopPivotId: capitalExpansionSummary?.planningTopPivotId || null,
      phase1ClearsNewFloorCount: phase1RevalidationSummary?.clearsNewFloorCount ?? 0,
      phase1NeedsVarianceMeasurementCount: phase1RevalidationSummary?.needsVarianceMeasurementCount ?? 0,
      phase1CandidateForValidationCount: phase1RevalidationSummary?.candidateForValidationCount ?? 0,
      researchCandidateCount: strategyResearchSummary?.candidateCount ?? 0,
      researchTopCandidateId: strategyResearchSummary?.topCandidate?.id || null,
      secondaryScaffoldCount: secondaryScaffoldsSummary?.scaffoldCount ?? 0,
      secondaryTopScaffoldId: secondaryScaffoldsSummary?.topScaffold?.id || null,
      deterministicCandidateCount: deterministicCandidatesSummary?.candidateCount ?? 0,
      deterministicTopCandidateId: deterministicCandidatesSummary?.topCandidate?.id || null,
      deterministicReadyForDryRunCount: deterministicCandidatesSummary?.readyForDryRunCount ?? 0,
      deterministicReceiptBackedCount: deterministicCandidatesSummary?.receiptBackedCount ?? 0,
      phase3ValidationCount: phase3StrategyValidationSummary?.validationCount ?? 0,
      phase3PassedCount: phase3StrategyValidationSummary?.passedCount ?? 0,
      phase3TopBlockedId: phase3StrategyValidationSummary?.topBlocked?.id || null,
      allocatorCandidateCount: allocatorCoreSummary?.candidateCount ?? 0,
      allocatorTopPlanningCandidateId: allocatorCoreSummary?.topPlanningCandidate?.id || null,
      trustTierRecordedCount: protocolTrustTiersSummary?.recordedCount ?? 0,
      watcherBlockedCount: protocolMarketWatchersSummary?.blockedCount ?? 0,
      watcherTopBlockedId: protocolMarketWatchersSummary?.topBlocked?.id || null,
      leverageRuntimeCount: leverageAutoUnwindRuntimeSummary?.runtimeCount ?? 0,
      leverageRuntimeTopPriorityId: leverageAutoUnwindRuntimeSummary?.topPriority?.strategyId || null,
      productCoverageReadyCount: productCoverage?.readyCount ?? 0,
      productCoverageBlockedCount: productCoverage?.blockedCount ?? 0,
      productCoverageMissingCount: productCoverage?.missingCount ?? 0,
      productCoverageTopGapId: productCoverage?.topGap?.id || null,
    },
    implementedStatusCounts: countByStatus(implementedStrategies),
    pivotStatusCounts: countByStatus(pivotOpportunities),
    implementedStrategies,
    pivotOpportunities,
    planningLayers: {
      pivotPlan: pivotPlanSummary,
      yieldShadowBook: yieldShadowSummary,
      proxySpreadCoveragePlan: proxyCoverageSummary,
      capitalExpansionReview,
      phase1Revalidation: phase1RevalidationSummary,
      phase3StrategyValidation: phase3StrategyValidationSummary,
      allocatorCore: allocatorCoreSummary,
      protocolTrustTiers: protocolTrustTiersSummary,
      protocolMarketWatchers: protocolMarketWatchersSummary,
      leverageAutoUnwindRuntime: leverageAutoUnwindRuntimeSummary,
      strategyResearchBoard: strategyResearchSummary,
      secondaryStrategyScaffolds: secondaryScaffoldsSummary,
      deterministicStrategyCandidates: deterministicCandidatesSummary,
      productCoverage,
    },
    artifacts: {
      source: [
        { kind: "dashboard_status", path: "data/dashboard-status.json" },
        { kind: "strategy_pivot_plan", path: "data/strategy-pivot-plan.json" },
        { kind: "yield_shadow_book", path: "data/yield-shadow-book-latest.json" },
        { kind: "proxy_spread_coverage_plan", path: "data/proxy-spread-coverage-plan-latest.json" },
        { kind: "overfit_audit", path: "data/overfit-audit-latest.json" },
        { kind: "gas_slippage_variance", path: "data/gas-slippage-variance-latest.json" },
        { kind: "lane_reclassification", path: "data/lane-reclassification.json" },
        { kind: "phase3_strategy_validation", path: "data/phase3-strategy-validation.json" },
        { kind: "allocator_core", path: "data/allocator-core.json" },
        { kind: "protocol_trust_tiers", path: "data/protocol-trust-tiers.json" },
        { kind: "protocol_market_watchers", path: "data/protocol-market-watchers.json" },
        { kind: "wrapped_btc_loop_auto_unwind_runtime", path: "data/wrapped-btc-loop-base-moonwell-auto-unwind-runtime-latest.json" },
        { kind: "recursive_wrapped_btc_loop_auto_unwind_runtime", path: "data/recursive_wrapped_btc_lending_loop-auto-unwind-runtime-latest.json" },
        { kind: "strategy_research_board", path: "data/strategy-research-board.json" },
        { kind: "secondary_strategy_scaffolds", path: "data/secondary-strategy-scaffolds.json" },
        { kind: "deterministic_strategy_candidates", path: "data/deterministic-strategy-candidates.json" },
      ],
      generated: [{ kind: "strategy_snapshot", path: "data/strategy-snapshot.json" }],
    },
    notes: [
      "This snapshot preserves the implemented strategy families and planning layers in one machine-readable artifact.",
      "Live promotion depends on runtime gates, measured positive EV outside variance, and declared per-strategy caps rather than a repo-wide ring-fence.",
      "The capital expansion review reprioritizes active versus planning lanes without granting live authorization on its own.",
      "No strategy in this snapshot grants live execution permission while liveTrading stays BLOCKED.",
    ],
  };
}

export function summarizeStrategySnapshot(snapshot = null) {
  if (!snapshot) return null;
  const topImplemented =
    snapshot.implementedStrategies?.find((item) => item.id === snapshot.summary?.topImplementedStrategyId) ||
    snapshot.implementedStrategies?.[0] ||
    null;
  const topPivot =
    snapshot.pivotOpportunities?.find((item) => item.id === snapshot.summary?.topPivotId) ||
    snapshot.pivotOpportunities?.[0] ||
    null;
  return {
    generatedAt: snapshot.generatedAt || null,
    liveTrading: snapshot.currentSystem?.liveTrading || null,
    preliveStage: snapshot.currentSystem?.preliveStage || null,
    activeBudgetUsd: snapshot.currentSystem?.activeBudgetUsd ?? null,
    budgetScenarios: snapshot.currentSystem?.budgetScenarios || [],
    implementedStrategyCount: snapshot.summary?.implementedStrategyCount ?? 0,
    candidateForValidationCount: snapshot.summary?.candidateForValidationCount ?? 0,
    measuredBelowPolicyCount: snapshot.summary?.measuredBelowPolicyCount ?? 0,
    topImplementedStrategy: topImplemented
      ? {
          id: topImplemented.id || null,
          label: topImplemented.label || null,
          status: topImplemented.status || null,
          reason: topImplemented.reason || null,
        }
      : null,
    topPivot: topPivot
      ? {
          id: topPivot.id || null,
          label: topPivot.label || null,
          status: topPivot.status || null,
          researchPilotMinimumUsd: topPivot.capitalGuidance?.researchPilotMinimumUsd ?? null,
        }
      : null,
    topAction: snapshot.summary?.topAction || null,
    planningBudgetUsd: snapshot.summary?.planningBudgetUsd ?? null,
    yieldTopProfileId: snapshot.summary?.yieldTopProfileId || null,
    catalogScope: snapshot.catalogScope || null,
    proxyCoverageNextAction: snapshot.summary?.proxyCoverageNextAction || null,
    secondaryTopScaffoldId: snapshot.summary?.secondaryTopScaffoldId || null,
    allocatorTopPlanningCandidateId: snapshot.summary?.allocatorTopPlanningCandidateId || null,
    capitalExpansionReview: summarizeCapitalExpansionReview(snapshot.planningLayers?.capitalExpansionReview || null),
    phase1Revalidation: snapshot.planningLayers?.phase1Revalidation || null,
    phase3StrategyValidation: snapshot.planningLayers?.phase3StrategyValidation || null,
    allocatorCore: snapshot.planningLayers?.allocatorCore || null,
    protocolTrustTiers: snapshot.planningLayers?.protocolTrustTiers || null,
    protocolMarketWatchers: snapshot.planningLayers?.protocolMarketWatchers || null,
    leverageAutoUnwindRuntime: snapshot.planningLayers?.leverageAutoUnwindRuntime || null,
    researchBoard: snapshot.planningLayers?.strategyResearchBoard || null,
    secondaryStrategyScaffolds: snapshot.planningLayers?.secondaryStrategyScaffolds || null,
    deterministicCandidates: snapshot.planningLayers?.deterministicStrategyCandidates || null,
    milestoneValidationGates: snapshot.planningLayers?.milestoneValidationGates || null,
    productCoverage: snapshot.planningLayers?.productCoverage || null,
    productCoverageTopGapId: snapshot.summary?.productCoverageTopGapId || null,
    topSecondaryScaffold: snapshot.planningLayers?.secondaryStrategyScaffolds?.topScaffold || null,
    topAllocatorCandidate: snapshot.planningLayers?.allocatorCore?.topPlanningCandidate || null,
  };
}
