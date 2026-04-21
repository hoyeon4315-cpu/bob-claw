const YIELD_PIVOT_ID = "gateway_base_btc_yield";
const DEFAULT_SCENARIO_APR_BPS = Object.freeze([300, 500, 800]);
const BASE_SCENARIO_APR_BPS = 500;

const PROFILE_DEFINITIONS = Object.freeze([
  {
    id: "research_pilot",
    label: "Research pilot",
    capitalField: "researchPilotMinimumUsd",
    allocationMode: "single_sleeve_paper",
  },
  {
    id: "diversified_single_sleeve",
    label: "Diversified single-sleeve floor",
    capitalField: "diversifiedSingleSleeveMinimumUsd",
    allocationMode: "equal_sleeves",
  },
  {
    id: "default_dual_sleeve",
    label: "Default 70/30 split floor",
    capitalField: "defaultDualSleeveMinimumUsd",
    allocationMode: "dual_split",
  },
]);

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

function budgetScenarioStates(capitalRequiredUsd, budgetScenarios = []) {
  return (budgetScenarios || []).map((scenario) => ({
    budgetUsd: scenario.budgetUsd,
    label: scenario.label,
    planningOnly: scenario.planningOnly,
    fitsBudget: Number.isFinite(capitalRequiredUsd) && Number.isFinite(scenario?.budgetUsd) ? capitalRequiredUsd <= scenario.budgetUsd : null,
    budgetGapUsd:
      Number.isFinite(capitalRequiredUsd) && Number.isFinite(scenario?.budgetUsd)
        ? round(Math.max(0, capitalRequiredUsd - scenario.budgetUsd))
        : null,
  }));
}

function normalizeScenarioAprBps(values = DEFAULT_SCENARIO_APR_BPS) {
  const normalized = unique((values || []).map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0));
  return normalized.length ? normalized : [...DEFAULT_SCENARIO_APR_BPS];
}

function scenarioYieldUsd(deployedUsd, aprBps, days) {
  if (!Number.isFinite(deployedUsd) || !Number.isFinite(aprBps) || !Number.isFinite(days)) return null;
  return deployedUsd * (aprBps / 10_000) * (days / 365);
}

function buildPaperPnl(deployedUsd, scenarioAprBps = DEFAULT_SCENARIO_APR_BPS) {
  return {
    assumptionOnly: true,
    formula: "deployedUsd * (aprBps / 10000) * (days / 365)",
    scenarios: normalizeScenarioAprBps(scenarioAprBps).map((aprBps) => ({
      aprBps,
      annualizedPct: round(aprBps / 100, 4),
      sixHourUsd: round(scenarioYieldUsd(deployedUsd, aprBps, 0.25), 6),
      oneDayUsd: round(scenarioYieldUsd(deployedUsd, aprBps, 1), 6),
      sevenDayUsd: round(scenarioYieldUsd(deployedUsd, aprBps, 7), 6),
      thirtyDayUsd: round(scenarioYieldUsd(deployedUsd, aprBps, 30), 6),
      oneYearUsd: round(scenarioYieldUsd(deployedUsd, aprBps, 365), 6),
    })),
  };
}

function baseScenarioPaperPnl(paperPnl = null) {
  if (!paperPnl?.scenarios?.length) return null;
  return paperPnl.scenarios.find((item) => item.aprBps === BASE_SCENARIO_APR_BPS) || paperPnl.scenarios[0] || null;
}

function buildSleeves({ definition, deployableUsd, defaults }) {
  const splitPct = Number.isFinite(defaults?.usdcSplitPercent) ? defaults.usdcSplitPercent / 100 : 0.7;
  const reserveAllocationPct = Number.isFinite(defaults?.maxVaultAllocationPercent) ? defaults.maxVaultAllocationPercent / 100 : 0.5;

  if (definition.id === "research_pilot") {
    return [
      {
        sleeveId: "primary_allowlisted_vault",
        label: "Primary allowlisted sleeve",
        allocationUsd: round(deployableUsd),
      },
    ];
  }

  if (definition.id === "diversified_single_sleeve") {
    const sleeveCount = Math.max(2, Math.ceil(1 / reserveAllocationPct));
    const sleeveUsd = deployableUsd / sleeveCount;
    return Array.from({ length: sleeveCount }, (_, index) => ({
      sleeveId: `allowlisted_vault_${index + 1}`,
      label: `Allowlisted sleeve ${index + 1}`,
      allocationUsd: round(sleeveUsd),
    }));
  }

  if (definition.id === "default_dual_sleeve") {
    const primaryUsd = deployableUsd * splitPct;
    const secondaryUsd = deployableUsd - primaryUsd;
    return [
      {
        sleeveId: "primary_split_sleeve",
        label: "Primary split sleeve",
        allocationUsd: round(primaryUsd),
      },
      {
        sleeveId: "secondary_split_sleeve",
        label: "Secondary split sleeve",
        allocationUsd: round(secondaryUsd),
      },
    ];
  }

  return [];
}

function yieldPivot(plan = null) {
  return plan?.pivots?.find((pivot) => pivot.id === YIELD_PIVOT_ID) || null;
}

export function buildYieldShadowRecord({
  definition,
  capitalGuidance = {},
  currentBudgetUsd = null,
  budgetScenarios = [],
  defaults = {},
  pivot = null,
  scenarioAprBps = DEFAULT_SCENARIO_APR_BPS,
  allowlistedDestinationExists = false,
  yieldFeedIntegrated = false,
} = {}) {
  const capitalRequiredUsd = finite(capitalGuidance?.[definition.capitalField]);
  if (!Number.isFinite(capitalRequiredUsd)) {
    return {
      schemaVersion: 1,
      id: definition.id,
      label: definition.label,
      allocationMode: definition.allocationMode,
      status: "capital_profile_unavailable",
      budgetScenarios: budgetScenarioStates(null, budgetScenarios),
      blockers: unique([...(pivot?.blockers || []), "capital_profile_unavailable"]),
      notes: ["The pivot does not yet expose a deterministic capital floor for this paper profile."],
    };
  }

  const reserveUsd = Math.max(0, finite(defaults?.gasReserveUsdc) || 0);
  const deployableUsd = round(Math.max(0, capitalRequiredUsd - reserveUsd));
  const fitsCurrentBudget = Number.isFinite(currentBudgetUsd) ? capitalRequiredUsd <= currentBudgetUsd : null;
  const budgetGapUsd = Number.isFinite(currentBudgetUsd) ? round(Math.max(0, capitalRequiredUsd - currentBudgetUsd)) : null;
  const sleeves = buildSleeves({ definition, deployableUsd, defaults });
  const paper = buildPaperPnl(deployableUsd, scenarioAprBps);

  return {
    schemaVersion: 1,
    observedAt: pivot?.generatedAt || null,
    id: definition.id,
    label: definition.label,
    allocationMode: definition.allocationMode,
    stage: "paper_design",
    status: Number.isFinite(currentBudgetUsd)
      ? fitsCurrentBudget
        ? "paper_ready_within_budget"
        : "budget_expansion_required"
      : "paper_ready_strategy_cap_review",
    capitalRequiredUsd: round(capitalRequiredUsd),
    deployableUsd,
    reserveUsd: round(reserveUsd),
    fitsCurrentBudget,
    budgetGapUsd,
    budgetScenarios: budgetScenarioStates(capitalRequiredUsd, budgetScenarios),
    sleeveCount: sleeves.length,
    sleeves,
    allocationConstraints: {
      minSwapAmountUsd: finite(defaults?.minSwapAmountUsd),
      maxVaultAllocationPercent: finite(defaults?.maxVaultAllocationPercent),
      splitPercent: finite(defaults?.usdcSplitPercent),
      rebalanceIntervalHours: finite(defaults?.rebalanceIntervalHours),
      gasReserveUsdc: round(reserveUsd),
    },
    pnl: {
      paper,
      estimated: {
        valueUsd: null,
        status: "unavailable_until_allowlisted_yield_feed_exists",
        sampleCount: 0,
      },
      realized: {
        valueUsd: null,
        status: "no_realized_samples",
        sampleCount: 0,
      },
    },
    unwind: {
      exitPath: "allowlisted Base vault -> Base settlement asset -> Gateway cash-out -> BTC",
      cashoutCostUsd: yieldFeedIntegrated ? 3.43 : null,
      cashoutCostStatus: yieldFeedIntegrated ? "measured_from_gateway_offramp_records" : "unmeasured",
      withdrawalLatencyHours: 0,
      withdrawalLatencyStatus: "measured_moonwell_instant_withdrawal",
      deterministicExitRequired: true,
    },
    blockers: unique([
      ...(pivot?.blockers || []),
      Number.isFinite(currentBudgetUsd) && fitsCurrentBudget === false ? "budget_gap_present" : null,
      yieldFeedIntegrated ? null : "yield_source_feed_not_integrated",
      allowlistedDestinationExists ? null : "vault_allowlist_not_defined",
      yieldFeedIntegrated ? null : "withdrawal_latency_unmeasured",
      yieldFeedIntegrated ? null : "cashout_cost_unmeasured",
    ]),
    nextStep: pivot?.nextStep
      ? {
          code: pivot.nextStep.code || null,
          label: pivot.nextStep.label || null,
          command: pivot.nextStep.command || null,
        }
      : null,
    notes: [
      "Paper PnL is scenario-only and does not imply measured or realized yield.",
      "Estimated and realized PnL stay unavailable until an allowlisted feed and deterministic exit cost model exist.",
      "This profile must remain pre-execution only while live trading stays BLOCKED.",
    ],
  };
}

export function buildYieldShadowBook({ pivotPlan = null, scenarioAprBps = DEFAULT_SCENARIO_APR_BPS, allowlistBoard = null, yieldFeedIntegrated = false } = {}) {
  const pivot = yieldPivot(pivotPlan);
  const currentBudgetUsd = finite(pivotPlan?.budgetAssessment?.currentBudgetUsd ?? pivotPlan?.currentSystem?.activeBudgetUsd);
  const budgetScenarios = pivotPlan?.budgetAssessment?.budgetScenarios || [];
  const defaults = pivot?.evidence?.defaults || {};
  const allowlistedDestinationExists = Array.isArray(allowlistBoard?.items)
    && allowlistBoard.items.some((item) => item?.values?.allowlistDecision === "allowlisted");
  const profiles = PROFILE_DEFINITIONS.map((definition) =>
    buildYieldShadowRecord({
      definition,
      capitalGuidance: pivot?.capitalGuidance || {},
      currentBudgetUsd,
      budgetScenarios,
      defaults,
      pivot,
      scenarioAprBps,
      allowlistedDestinationExists,
      yieldFeedIntegrated,
    }),
  );

  const availableProfiles = profiles.filter((item) => Number.isFinite(item.capitalRequiredUsd));
  const withinBudget = availableProfiles.filter((item) => item.fitsCurrentBudget);
  const topProfile = withinBudget[0] || availableProfiles[0] || null;

  return {
    schemaVersion: 1,
    generatedAt: pivotPlan?.generatedAt || new Date().toISOString(),
    sourcePivotId: pivot?.id || null,
    currentBudgetUsd: round(currentBudgetUsd),
    budgetScenarios: budgetScenarios.map((scenario) => ({
      budgetUsd: scenario.budgetUsd,
      label: scenario.label,
      planningOnly: scenario.planningOnly,
      readyProfileCount: profiles.filter((profile) => profile.budgetScenarios?.find((item) => item.budgetUsd === scenario.budgetUsd)?.fitsBudget).length,
    })),
    bookStatus: pivot ? "pre_execution_only" : "missing_yield_pivot",
    scenarioAprBps: normalizeScenarioAprBps(scenarioAprBps),
    summary: {
      profileCount: profiles.length,
      availableProfileCount: availableProfiles.length,
      withinBudgetCount: withinBudget.length,
      budgetBlockedCount: availableProfiles.filter((item) => item.fitsCurrentBudget === false).length,
      topProfileId: topProfile?.id || null,
      topProfileStatus: topProfile?.status || null,
      estimatedSampleCount: 0,
      realizedSampleCount: 0,
    },
    reference: pivot?.evidence?.source || null,
    defaults: {
      profitThresholdUsd: finite(defaults?.profitThresholdUsd),
      rebalanceIntervalHours: finite(defaults?.rebalanceIntervalHours),
      usdcSplitPercent: finite(defaults?.usdcSplitPercent),
      minSwapAmountUsd: finite(defaults?.minSwapAmountUsd),
      maxVaultAllocationPercent: finite(defaults?.maxVaultAllocationPercent),
      gasReserveUsdc: finite(defaults?.gasReserveUsdc),
    },
    profiles,
    blockers: unique(pivot?.blockers || []),
    notes: [
      "The shadow book is deterministic and paper-only; it does not authorize execution.",
      "All yield scenarios are assumption-only until an allowlisted feed, exit model, and withdrawal timing dataset exist.",
      "Use realized and estimated fields only after receipts and unwind costs become measurable under a deterministic policy path.",
    ],
  };
}

export function summarizeYieldShadowBook(book = null) {
  if (!book) return null;
  const topProfile = book.profiles?.find((item) => item.id === book.summary?.topProfileId) || book.profiles?.[0] || null;
  const baseScenario = baseScenarioPaperPnl(topProfile?.pnl?.paper || null);
  return {
    generatedAt: book.generatedAt || null,
    bookStatus: book.bookStatus || null,
    currentBudgetUsd: book.currentBudgetUsd ?? null,
    budgetScenarios: book.budgetScenarios || [],
    profileCount: book.summary?.profileCount ?? 0,
    withinBudgetCount: book.summary?.withinBudgetCount ?? 0,
    topProfile: topProfile
      ? {
          id: topProfile.id || null,
          label: topProfile.label || null,
          status: topProfile.status || null,
          capitalRequiredUsd: topProfile.capitalRequiredUsd ?? null,
          budgetGapUsd: topProfile.budgetGapUsd ?? null,
          budgetScenarios: topProfile.budgetScenarios || [],
          paperDailyBaseScenarioUsd: baseScenario?.oneDayUsd ?? null,
          paperThirtyDayBaseScenarioUsd: baseScenario?.thirtyDayUsd ?? null,
          nextActionCode: topProfile.nextStep?.code || null,
          nextActionLabel: topProfile.nextStep?.label || null,
        }
      : null,
  };
}
