import { buildDefaultRiskPolicy } from "../risk/policy.mjs";
import { buildDefaultTreasuryPolicy } from "../treasury/policy.mjs";
import { referenceBudgetUsd } from "../treasury/policy.mjs";
import { buildStrategyCatalog } from "./strategy-catalog.mjs";

const YIELD_BLUEPRINT_REFERENCE = Object.freeze({
  id: "gateway_base_btc_yield",
  label: "Gateway-funded BTC yield on Base",
  source: {
    type: "github_readme",
    repo: "bob-collective/btc-yield-bot",
    url: "https://github.com/bob-collective/btc-yield-bot",
    capturedAt: "2026-04-13",
  },
  defaults: {
    profitThresholdUsd: 500,
    rebalanceIntervalHours: 6,
    usdcSplitPercent: 70,
    minSwapAmountUsd: 100,
    maxVaultAllocationPercent: 50,
    minVaultTvlUsd: 100000,
    gasReserveUsdc: 5,
  },
  notes: [
    "The public reference uses an LLM/agent runtime and Base smart wallet automation.",
    "BOB Claw must adapt that flow to deterministic policy rules before any execution path exists.",
    "The reference proves workflow shape, not profitability or safety under this repo's rules.",
  ],
});

const DEFAULT_PLANNING_BUDGETS_USD = Object.freeze([]);

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function requiredProfitUsd(notionalUsd, riskPolicy) {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return finite(riskPolicy.minNetProfitUsd);
  return Math.max(riskPolicy.minNetProfitUsd, notionalUsd * riskPolicy.minNetProfitPct);
}

function buildObservedCapitalGuidance({
  observedNotionalUsd = null,
  observedNetUsd = null,
  observedNetPct = null,
  riskPolicy,
  confidence = "low",
  caveat = null,
} = {}) {
  if (!Number.isFinite(observedNotionalUsd)) {
    return {
      mode: "unavailable",
      confidence: "none",
      caveat: caveat || "No standardized trade notional is available.",
    };
  }
  const resolvedNetPct =
    finite(observedNetPct) ?? (Number.isFinite(observedNetUsd) && observedNotionalUsd > 0 ? observedNetUsd / observedNotionalUsd : null);
  const requiredUsd = requiredProfitUsd(observedNotionalUsd, riskPolicy);
  const meetsUsdGate = Number.isFinite(observedNetUsd) && observedNetUsd >= requiredUsd;
  const meetsPctGate = Number.isFinite(resolvedNetPct) && resolvedNetPct >= riskPolicy.minNetProfitPct;
  const policyClear = meetsUsdGate && meetsPctGate;
  return {
    mode: "observed_trade_notional",
    confidence,
    observedNotionalUsd: round(observedNotionalUsd),
    observedNetUsd: round(observedNetUsd),
    observedNetPct: round(resolvedNetPct, 6),
    requiredProfitUsd: round(requiredUsd),
    minimumCapitalUsd: round(observedNotionalUsd),
    policyClear,
    caveat,
  };
}

function buildBudgetFit(minimumCapitalUsd, budgetUsd) {
  if (!Number.isFinite(minimumCapitalUsd) || !Number.isFinite(budgetUsd)) return null;
  return {
    minimumCapitalUsd: round(minimumCapitalUsd),
    fitsCurrentBudget: minimumCapitalUsd <= budgetUsd,
    budgetGapUsd: round(Math.max(0, minimumCapitalUsd - budgetUsd)),
  };
}

function buildBudgetScenarioFit(minimumCapitalUsd, budgetUsd) {
  if (!Number.isFinite(minimumCapitalUsd) || !Number.isFinite(budgetUsd)) return null;
  return {
    capitalRequiredUsd: round(minimumCapitalUsd),
    fitsBudget: minimumCapitalUsd <= budgetUsd,
    budgetGapUsd: round(Math.max(0, minimumCapitalUsd - budgetUsd)),
  };
}

function normalizeBudgetScenarios(activeBudgetUsd, referenceBudgetsUsd = DEFAULT_PLANNING_BUDGETS_USD) {
  const activeBudget = finite(activeBudgetUsd);
  const budgets = unique([activeBudget, ...(referenceBudgetsUsd || [])].map((value) => finite(value)).filter(Number.isFinite))
    .sort((left, right) => left - right);
  return budgets.map((budgetUsd) => ({
    budgetUsd: round(budgetUsd),
    label: Number.isFinite(activeBudget) && budgetUsd === activeBudget ? "active_cap_current" : `reference_cap_${Math.round(budgetUsd)}`,
    planningOnly: Number.isFinite(activeBudget) ? budgetUsd !== activeBudget : true,
  }));
}

function buildPivotBudgetScenarios(pivot = null, budgetScenarios = []) {
  return (budgetScenarios || []).map((scenario) => ({
    budgetUsd: scenario.budgetUsd,
    label: scenario.label,
    planningOnly: scenario.planningOnly,
    observedTradeFloor: buildBudgetScenarioFit(pivot?.capitalGuidance?.minimumCapitalUsd, scenario.budgetUsd),
    researchPilot: buildBudgetScenarioFit(pivot?.capitalGuidance?.researchPilotMinimumUsd, scenario.budgetUsd),
    diversifiedSingleSleeve: buildBudgetScenarioFit(pivot?.capitalGuidance?.diversifiedSingleSleeveMinimumUsd, scenario.budgetUsd),
    defaultDualSleeve: buildBudgetScenarioFit(pivot?.capitalGuidance?.defaultDualSleeveMinimumUsd, scenario.budgetUsd),
  }));
}

function describeNoCapital(reason) {
  return {
    mode: "unavailable",
    confidence: "none",
    caveat: reason,
  };
}

function catalogEntry(catalog, id) {
  return [...(catalog?.btcFamilies || []), ...(catalog?.ethBranches || [])].find((entry) => entry.id === id) || null;
}

function buildChainQuoteCommand(chains = []) {
  const normalized = unique(chains).join(",");
  if (!normalized) return null;
  return `npm run quote:dex -- --chains=${normalized} --include-stable-entry --route-limit=64`;
}

function buildPolicyContext({ dashboardStatus = null, riskPolicy, treasuryPolicy } = {}) {
  return {
    liveTrading: dashboardStatus?.overall?.liveTrading || "BLOCKED",
    preliveStage: dashboardStatus?.prelive?.currentStage || null,
    activeBudgetUsd: round(treasuryPolicy.capital.activeBudgetUsd),
    referenceBudgetUsd: round(referenceBudgetUsd(treasuryPolicy)),
    projectLossCapUsd: riskPolicy.projectLossCapUsd == null ? null : round(riskPolicy.projectLossCapUsd),
    dailyLossCapUsd: riskPolicy.dailyLossCapUsd == null ? null : round(riskPolicy.dailyLossCapUsd),
    minNetProfitUsd: round(riskPolicy.minNetProfitUsd),
    minNetProfitPct: round(riskPolicy.minNetProfitPct, 6),
    canaryWalletFloorUsd: riskPolicy.canaryWalletFloorUsd == null ? null : round(riskPolicy.canaryWalletFloorUsd),
    activeChains: treasuryPolicy.activeChains || [],
    ethereumL1: "allowed_when_positive_ev",
  };
}

function buildGatewayLoopsPivot({ strategy = null, catalog = null, riskPolicy, budgetUsd }) {
  const entry = catalogEntry(catalog, "gateway_wrapped_btc_loops");
  const edgeViability = strategy?.edgeViability || null;
  const edgeResearch = strategy?.edgeResearch || null;
  const discovery = strategy?.objectivePlans?.discovery || null;
  const reason = edgeViability?.verdict?.code || entry?.reason || "no_measured_closed_loop";
  const status =
    (edgeViability?.policyReadyCount || 0) > 0
      ? "candidate_for_validation"
      : (edgeResearch?.multiLevelCandidateCount || 0) > 0 || (edgeResearch?.definiteEdgeCandidateCount || 0) > 0
        ? "research_only"
        : "blocked_current_surface";
  const blockers = unique([
    reason,
    edgeResearch?.bestCandidate?.classification,
    discovery?.reason,
    (edgeResearch?.bestCandidate?.decay?.allCovered ?? true) ? null : "missing_decay_coverage",
    (edgeResearch?.bestCandidate?.decay?.allSurvived ?? true) ? null : "missing_decay_survival",
  ]);
  const commands = unique([...(entry?.commands || []), discovery?.command || null]);
  return {
    id: "gateway_wrapped_btc_loops",
    label: entry?.label || "Gateway wrapped-BTC loops",
    category: "closed_loop_arb",
    evidenceGrade: (edgeViability?.measuredLoopCount || 0) > 0 ? "measured" : (edgeResearch?.routeCount || 0) > 0 ? "research" : "none",
    status,
    reason,
    capitalGuidance: describeNoCapital("No exact closed-loop trade notional currently clears policy."),
    budgetFit: null,
    evidence: {
      measuredLoopCount: edgeViability?.measuredLoopCount || 0,
      policyReadyCount: edgeViability?.policyReadyCount || 0,
      positiveMeasuredCount: edgeViability?.positiveMeasuredCount || 0,
      bestResearchRoute: edgeResearch?.bestCandidate?.routeKey || null,
      bestResearchNetUsd: round(edgeResearch?.bestCandidate?.bestNetEdgeUsd),
      bestResearchNetPct: round(edgeResearch?.bestCandidate?.bestNetEdgePct, 6),
    },
    blockers,
    overfitRisks: unique([
      (edgeResearch?.bestCandidate?.decay?.allCovered ?? true) ? null : "decay_window_gaps",
      (edgeResearch?.bestCandidate?.decay?.allSurvived ?? true) ? null : "decay_survival_unproven",
    ]),
    nextStep: discovery
      ? {
          code: discovery.nextActionCode || null,
          label: discovery.nextActionLabel || null,
          command: discovery.command || null,
        }
      : null,
    commands,
    preExecutionPlan: [
      "Keep this family in shadow mode until an exact closed loop exists with measured notional, failure-rate control, and decay survival.",
      "Do not infer that more capital fixes this family unless a real measured loop appears first.",
    ],
  };
}

function buildStableLoopPivot({ strategy = null, catalog = null, riskPolicy, budgetUsd }) {
  const entry = catalogEntry(catalog, "stablecoin_entry_exit_loops");
  const summary = strategy?.crossAssetArbitrage || null;
  const closest = summary?.closestLoop || null;
  const best = summary?.bestLoop || null;
  const amountMismatch = Number.isFinite(closest?.amountGapPct) && closest.amountGapPct > (summary?.amountTolerancePct || 0.02);
  let capitalGuidance = describeNoCapital("No exact matched stable/BTC loop clears policy.");
  if (best?.exactAmountMatch && best?.closedLoop && Number.isFinite(best?.loopNetEdgeUsd) && Number.isFinite(best?.startInputUsd)) {
    capitalGuidance = buildObservedCapitalGuidance({
      observedNotionalUsd: best.startInputUsd,
      observedNetUsd: best.loopNetEdgeUsd,
      riskPolicy,
      confidence: "medium",
    });
  } else if (closest) {
    capitalGuidance = {
      mode: "invalidated_measurement",
      confidence: "low",
      caveat: amountMismatch
        ? "Observed loop is dominated by amount mismatch, so the apparent edge is not a valid capital floor."
        : "Observed loop is missing exact closed-loop validation.",
      observedEntryUsd: round(closest.startInputUsd),
      unmatchedExitUsd: round(closest.finalOutputUsd),
      observedLoopNetUsd: round(closest.loopNetEdgeUsd),
      amountGapPct: round(closest.amountGapPct, 6),
    };
  }
  const blockers = unique([
    entry?.reason,
    amountMismatch ? "amount_mismatch" : null,
    ...(closest?.blockers || []),
    ...((summary?.bestAmountLadderPair?.blockerCounts || []).slice(0, 4).map((item) => item.blocker)),
  ]);
  return {
    id: "stablecoin_entry_exit_loops",
    label: entry?.label || "Stablecoin entry/exit loops",
    category: "inventory_conversion",
    evidenceGrade: closest ? "partial_measurement" : "none",
    status:
      summary?.profitableClosedLoopCount > 0
        ? "candidate_for_validation"
        : closest
          ? "research_only"
          : "blocked_current_surface",
    reason: entry?.reason || (closest ? "partial_stable_loop_measurement" : "no_stable_loop_surface"),
    capitalGuidance,
    budgetFit: best?.exactAmountMatch && best?.closedLoop ? buildBudgetFit(best?.startInputUsd, budgetUsd) : null,
    evidence: {
      entryCount: summary?.entryCount || 0,
      exitCount: summary?.exitCount || 0,
      exactAssetPairCount: summary?.exactAssetPairCount || 0,
      matchedLoopCount: summary?.matchedLoopCount || 0,
      profitableClosedLoopCount: summary?.profitableClosedLoopCount || 0,
      closestLoopNetUsd: round(closest?.loopNetEdgeUsd),
      closestLoopEntryUsd: round(closest?.startInputUsd),
    },
    blockers,
    overfitRisks: unique([
      amountMismatch ? "amount_ladder_mismatch" : null,
      (summary?.matchedLoopCount || 0) === 0 && (summary?.exactAssetPairCount || 0) > 0 ? "no_exact_closed_loop" : null,
      (summary?.entryCount || 0) <= 1 || (summary?.exitCount || 0) <= 1 ? "thin_surface" : null,
    ]),
    nextStep: null,
    commands: entry?.commands || [],
    preExecutionPlan: [
      "Close the amount ladder mismatch before treating any apparent net edge as real.",
      "Require exact asset closure, quote freshness, and settlement-risk review before promoting this family.",
    ],
  };
}

function buildProxySpreadPivot({ strategy = null, catalog = null, riskPolicy, budgetUsd }) {
  const entry = catalogEntry(catalog, "btc_proxy_spreads");
  const summary = strategy?.btcProxySpreads || null;
  const best = summary?.bestRebalanceOpportunity || summary?.bestRawOpportunity || null;
  const capitalGuidance = best
    ? buildObservedCapitalGuidance({
        observedNotionalUsd: best.buyStableCostUsd,
        observedNetUsd: best.rebalanceAdjustedSpreadUsd ?? best.rawSpreadUsd,
        observedNetPct: best.rebalanceAdjustedSpreadPct ?? best.rawSpreadPct,
        riskPolicy,
        confidence: summary?.overfitAssessment === "coverage_ok" ? "medium" : "low",
        caveat:
          summary?.overfitAssessment && summary.overfitAssessment !== "coverage_ok"
            ? `Current surface is flagged ${summary.overfitAssessment}.`
            : null,
      })
    : describeNoCapital("No proxy spread opportunity has a standardized trade notional yet.");
  const policyBlocked = (best?.blockers || []).length > 0 || (summary?.overfitAssessment && summary.overfitAssessment !== "coverage_ok");
  const status =
    (summary?.policyReadyCount || 0) > 0 && !policyBlocked
      ? "candidate_for_validation"
      : (summary?.policyReadyCount || 0) > 0 || (summary?.rebalancePositiveCount || 0) > 0
        ? "blocked_policy_or_overfit"
        : "blocked_current_surface";
  const nextCoverageTarget = summary?.nextCoverageTarget || null;
  const nextCoverageCommand = buildChainQuoteCommand([...(nextCoverageTarget?.buyChains || []), ...(nextCoverageTarget?.sellChains || [])]);
  return {
    id: "btc_proxy_spreads",
    label: entry?.label || "BTC proxy spread arbitrage",
    category: "inventory_rebalance_arb",
    evidenceGrade: best ? "measured" : "none",
    status,
    reason: entry?.reason || (summary?.policyReadyCount > 0 ? "policy_ready_but_blocked" : "no_proxy_edge"),
    capitalGuidance,
    budgetFit: buildBudgetFit(best?.buyStableCostUsd, budgetUsd),
    evidence: {
      opportunityCount: summary?.opportunityCount || 0,
      rawPositiveCount: summary?.rawPositiveCount || 0,
      rebalancePositiveCount: summary?.rebalancePositiveCount || 0,
      policyReadyCount: summary?.policyReadyCount || 0,
      bestProxyTicker: best?.proxyTicker || null,
      bestAdjustedNetUsd: round(best?.rebalanceAdjustedSpreadUsd),
      bestAdjustedNetPct: round(best?.rebalanceAdjustedSpreadPct, 6),
      bestObservedNotionalUsd: round(best?.buyStableCostUsd),
    },
    blockers: unique([entry?.reason, ...(summary?.overfitRisks || []), ...(best?.blockers || [])]),
    overfitRisks: summary?.overfitRisks || [],
    nextStep: nextCoverageTarget
      ? {
          code: nextCoverageTarget.nextAction || null,
          label: nextCoverageTarget.nextAction || nextCoverageTarget.reason || null,
          command: nextCoverageCommand,
        }
      : null,
    commands: unique([...(entry?.commands || []), nextCoverageCommand]),
    preExecutionPlan: [
      "Do not promote this family while ETH L1 policy blocks the rebalance path or while the surface is stale.",
      "Require fresh multi-chain amount ladders and a non-high overfit assessment before any pre-execution review.",
    ],
  };
}

function buildTrianglePivot({ catalog = null, budgetUsd }) {
  const entry = catalogEntry(catalog, "triangular_flash_btc");
  const sampleCount = entry?.evidence?.sampleCount || 0;
  return {
    id: "triangular_flash_btc",
    label: entry?.label || "BTC triangular / flash arbitrage",
    category: "same_chain_flash_arb",
    evidenceGrade: sampleCount > 0 ? "measured" : "none",
    status:
      entry?.status === "candidate_for_validation"
        ? "candidate_for_validation"
        : entry?.status === "measured_below_policy"
          ? "blocked_current_surface"
          : "research_only",
    reason: entry?.reason || "triangle_profile_unobserved",
    capitalGuidance: describeNoCapital("Triangle datasets do not yet expose a standardized capital notional for sizing."),
    budgetFit: null,
    evidence: {
      sampleCount,
      bestRoute: entry?.evidence?.bestRoute || null,
      bestNetPct: round(entry?.evidence?.bestNetPct, 6),
    },
    blockers: unique([entry?.reason, sampleCount > 0 ? "needs_standardized_notional" : null]),
    overfitRisks: sampleCount > 0 ? [] : ["no_recent_samples"],
    nextStep: null,
    commands: entry?.commands || [],
    preExecutionPlan: [
      "Treat flash profitability as stale until the latest flash-aware dataset is non-negative and notional-aware.",
      "Do not infer required capital from percent-only triangle summaries.",
    ],
  };
}

function buildYieldBlueprintPivot({ riskPolicy, treasuryPolicy, budgetUsd, allowlistedDestinationExists = false, yieldFeedIntegrated = false }) {
  const defaults = YIELD_BLUEPRINT_REFERENCE.defaults;
  const splitFraction = defaults.usdcSplitPercent / 100;
  const inverseFraction = 1 - splitFraction;
  const researchPilotMinimumUsd = defaults.minSwapAmountUsd + defaults.gasReserveUsdc;
  const diversifiedSingleSleeveMinimumUsd =
    Math.ceil(100 / defaults.maxVaultAllocationPercent) * defaults.minSwapAmountUsd + defaults.gasReserveUsdc;
  const defaultDualSleeveMinimumUsd =
    Math.max(defaults.minSwapAmountUsd / splitFraction, defaults.minSwapAmountUsd / inverseFraction) + defaults.gasReserveUsdc;
  return {
    id: YIELD_BLUEPRINT_REFERENCE.id,
    label: YIELD_BLUEPRINT_REFERENCE.label,
    category: "yield_action",
    evidenceGrade: "external_reference",
    status: "pre_execution_blueprint",
    reason: "external_reference_workflow_requires_deterministic_adaptation",
    capitalGuidance: {
      mode: "external_reference_profile",
      confidence: "external_reference_only",
      researchPilotMinimumUsd: round(researchPilotMinimumUsd),
      diversifiedSingleSleeveMinimumUsd: round(diversifiedSingleSleeveMinimumUsd),
      defaultDualSleeveMinimumUsd: round(defaultDualSleeveMinimumUsd),
      budgetFit: {
        researchPilotFits: Number.isFinite(budgetUsd) ? researchPilotMinimumUsd <= budgetUsd : null,
        diversifiedSingleSleeveFits: Number.isFinite(budgetUsd) ? diversifiedSingleSleeveMinimumUsd <= budgetUsd : null,
        defaultDualSleeveFits: Number.isFinite(budgetUsd) ? defaultDualSleeveMinimumUsd <= budgetUsd : null,
      },
      assumptions: [
        "Research pilot assumes one deployable sleeve plus gas reserve.",
        "Diversified single-sleeve floor enforces the 50% max vault allocation from the public reference.",
        "Default dual-sleeve floor enforces both the 70/30 split and the per-vault cap from the public reference.",
      ],
    },
    budgetFit: buildBudgetFit(diversifiedSingleSleeveMinimumUsd, budgetUsd),
    evidence: {
      source: YIELD_BLUEPRINT_REFERENCE.source,
      defaults,
      notes: YIELD_BLUEPRINT_REFERENCE.notes,
      compatibility: {
        originalUsesLlmDecisioning: true,
        allowedInBobClawExecutionPath: false,
        requiredAdaptation: "deterministic_allowlisted_policy_engine",
      },
    },
    blockers: [
      "external_reference_only",
      "llm_execution_path_not_allowed",
      allowlistedDestinationExists ? null : "vault_allowlist_not_defined",
      yieldFeedIntegrated ? null : "yield_source_feed_not_integrated",
      yieldFeedIntegrated ? null : "withdrawal_latency_unmodelled",
      yieldFeedIntegrated ? null : "cashout_costs_unmeasured",
    ].filter(Boolean),
    overfitRisks: [
      "apy_history_not_measured",
      "yield_decay_not_measured",
      "protocol_specific_incentive_risk",
      "reference_repo_is_not_pnl_proof",
    ],
    nextStep: {
      code: "build_deterministic_yield_shadow_book",
      label: "build deterministic yield shadow book",
      command: null,
    },
    commands: [],
    preExecutionPlan: [
      "Replace LLM vault selection with deterministic scoring over an allowlisted protocol set.",
      "Shadow gross yield, exit slippage, withdrawal delay, and Gateway round-trip cashout cost before any execution path exists.",
      "Keep signer/executor isolated; dashboard, Telegram, and planning code must not hold private keys.",
    ],
    executionBlueprint: [
      {
        stage: "source_and_policy_design",
        required: true,
        deliverable: "Deterministic vault scorecard with TVL, audit status, withdrawal rules, and fee model.",
      },
      {
        stage: "paper_position_ledger",
        required: true,
        deliverable: "Shadow ledger that tracks deposits, accrued yield, withdrawal haircuts, and BTC cashout economics.",
      },
      {
        stage: "exit_simulation",
        required: true,
        deliverable: "Deterministic unwind model from Base USDC/wBTC back to BTC via Gateway with full fee accounting.",
      },
      {
        stage: "signer_boundary_review",
        required: true,
        deliverable: "Separate executor process with no LLM in the decision path and no private keys in dashboard surfaces.",
      },
      {
        stage: "tiny_manual_pilot_review",
        required: true,
        deliverable: "Manual-only pre-execution checklist after paper yield survives time, fee, and withdrawal checks.",
      },
    ],
  };
}

function pivotPriority(pivot) {
  const statusPriority = {
    pre_execution_blueprint: 0,
    candidate_for_validation: 1,
    blocked_policy_or_overfit: 2,
    research_only: 3,
    blocked_current_surface: 4,
  };
  const evidencePriority = {
    measured: 0,
    partial_measurement: 1,
    research: 2,
    external_reference: 3,
    none: 4,
  };
  return [statusPriority[pivot.status] ?? 99, evidencePriority[pivot.evidenceGrade] ?? 99, String(pivot.label)];
}

function comparePriority(left, right) {
  const a = pivotPriority(left);
  const b = pivotPriority(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function buildBudgetAssessment({ riskPolicy, treasuryPolicy, pivots = [], planningBudgetsUsd = DEFAULT_PLANNING_BUDGETS_USD } = {}) {
  const activeBudgetUsd = finite(treasuryPolicy.capital.activeBudgetUsd);
  const referenceCapUsd = finite(referenceBudgetUsd(treasuryPolicy));
  const budgetScenarios = normalizeBudgetScenarios(activeBudgetUsd, [referenceCapUsd, ...(planningBudgetsUsd || [])]);
  return {
    currentBudgetUsd: round(activeBudgetUsd),
    referenceBudgetUsd: round(referenceCapUsd),
    budgetScenarios,
    projectLossCapUsd: riskPolicy.projectLossCapUsd == null ? null : round(riskPolicy.projectLossCapUsd),
    explanation: [
      "Current active budget is inferred from per-strategy autoExecute caps; there is no project-wide live budget by default.",
      "Only strategies with measured, repeatable edge should earn a larger allocation; unproven edge should not pull the allocation upward.",
      "Any reference-cap scenarios are evaluation tools and do not themselves authorize larger operating capital.",
    ],
    pivotCapitalReview: pivots.map((pivot) => ({
      id: pivot.id,
      label: pivot.label,
      status: pivot.status,
      minimumCapitalUsd: pivot.capitalGuidance?.minimumCapitalUsd ?? null,
      researchPilotMinimumUsd: pivot.capitalGuidance?.researchPilotMinimumUsd ?? null,
      diversifiedSingleSleeveMinimumUsd: pivot.capitalGuidance?.diversifiedSingleSleeveMinimumUsd ?? null,
      defaultDualSleeveMinimumUsd: pivot.capitalGuidance?.defaultDualSleeveMinimumUsd ?? null,
      budgetFit: pivot.capitalGuidance?.budgetFit || pivot.budgetFit || null,
      budgetScenarios: buildPivotBudgetScenarios(pivot, budgetScenarios),
     })),
  };
}

function summarizePivotEntry(pivot = null) {
  if (!pivot) return null;
  return {
    id: pivot.id || null,
    label: pivot.label || null,
    category: pivot.category || null,
    status: pivot.status || null,
    evidenceGrade: pivot.evidenceGrade || null,
    reason: pivot.reason || null,
    blockerCount: pivot.blockers?.length || 0,
    blockers: (pivot.blockers || []).slice(0, 5),
    overfitRisks: (pivot.overfitRisks || []).slice(0, 5),
    nextActionCode: pivot.nextStep?.code || null,
    nextActionLabel: pivot.nextStep?.label || null,
    observedCapitalFloorUsd: pivot.capitalGuidance?.minimumCapitalUsd ?? null,
    observedNetUsd: pivot.capitalGuidance?.observedNetUsd ?? null,
    observedNetPct: pivot.capitalGuidance?.observedNetPct ?? null,
    researchPilotMinimumUsd: pivot.capitalGuidance?.researchPilotMinimumUsd ?? null,
    diversifiedSingleSleeveMinimumUsd: pivot.capitalGuidance?.diversifiedSingleSleeveMinimumUsd ?? null,
    defaultDualSleeveMinimumUsd: pivot.capitalGuidance?.defaultDualSleeveMinimumUsd ?? null,
    capitalCaveat: pivot.capitalGuidance?.caveat || null,
    budgetFit: pivot.capitalGuidance?.budgetFit || pivot.budgetFit || null,
    budgetScenarios: (pivot.budgetScenarios || []).map((scenario) => ({
      budgetUsd: scenario.budgetUsd,
      label: scenario.label,
      planningOnly: scenario.planningOnly,
      observedTradeFloor: scenario.observedTradeFloor || null,
      researchPilot: scenario.researchPilot || null,
      diversifiedSingleSleeve: scenario.diversifiedSingleSleeve || null,
      defaultDualSleeve: scenario.defaultDualSleeve || null,
    })),
  };
}

export function summarizeStrategyPivotPlan(plan = null) {
  if (!plan) return null;
  return {
    schemaVersion: plan.schemaVersion || 1,
    generatedAt: plan.generatedAt || null,
    currentBudgetUsd: plan.budgetAssessment?.currentBudgetUsd ?? null,
    referenceBudgetUsd: plan.budgetAssessment?.referenceBudgetUsd ?? null,
    budgetScenarios: plan.budgetAssessment?.budgetScenarios || [],
    budgetNote: plan.budgetAssessment?.explanation?.[0] || null,
    pivotCount: plan.pivots?.length || 0,
    topRecommendation: summarizePivotEntry(plan.pivots?.[0] || null),
    pivots: (plan.pivots || []).map((pivot) => summarizePivotEntry(pivot)),
  };
}

export function buildStrategyPivotPlan({
  dashboardStatus = null,
  state = {},
  triangleArtifacts = {},
  planningBudgetsUsd = DEFAULT_PLANNING_BUDGETS_USD,
  walletTotalUsd = null,
  allowlistedDestinationExists = false,
  yieldFeedIntegrated = false,
} = {}) {
  const riskPolicy = buildDefaultRiskPolicy();
  const treasuryPolicy = buildDefaultTreasuryPolicy({ walletTotalUsd });
  const budgetUsd = finite(treasuryPolicy.capital.activeBudgetUsd) ?? finite(referenceBudgetUsd(treasuryPolicy));
  const budgetScenarios = normalizeBudgetScenarios(finite(treasuryPolicy.capital.activeBudgetUsd), [
    referenceBudgetUsd(treasuryPolicy),
    ...(planningBudgetsUsd || []),
  ]);
  const catalog = buildStrategyCatalog({ dashboardStatus, state, triangleArtifacts });
  const strategy = dashboardStatus?.strategy || {};
  const pivots = [
    buildYieldBlueprintPivot({ riskPolicy, treasuryPolicy, budgetUsd, allowlistedDestinationExists, yieldFeedIntegrated }),
    buildProxySpreadPivot({ strategy, catalog, riskPolicy, budgetUsd }),
    buildStableLoopPivot({ strategy, catalog, riskPolicy, budgetUsd }),
    buildTrianglePivot({ catalog, budgetUsd }),
    buildGatewayLoopsPivot({ strategy, catalog, riskPolicy, budgetUsd }),
  ]
    .sort(comparePriority)
    .map((pivot) => ({
      ...pivot,
      budgetScenarios: buildPivotBudgetScenarios(pivot, budgetScenarios),
    }));

  return {
    schemaVersion: 1,
    generatedAt: dashboardStatus?.generatedAt || new Date().toISOString(),
    currentSystem: buildPolicyContext({ dashboardStatus, riskPolicy, treasuryPolicy }),
    budgetAssessment: buildBudgetAssessment({ riskPolicy, treasuryPolicy, pivots, planningBudgetsUsd }),
    pivots,
    recommendedPivotOrder: pivots.map((pivot) => ({
      id: pivot.id,
      label: pivot.label,
      status: pivot.status,
      reason: pivot.reason,
    })),
    notes: [
      "Capital floors are only marked as observed when a standardized trade notional and a measured edge both exist.",
      "Anything derived from external reference material remains blueprint-only until BOB Claw measures its own shadow results.",
      "Current live trading remains BLOCKED; this report is for research and pre-execution planning only.",
    ],
  };
}
