import { LENDING_LOOP_REQUIRED_POLICY_FIELDS } from "./lending-loop-research.mjs";
import {
  buildWrappedBtcLoopExecutionActions,
  buildWrappedBtcLoopUnwindActions,
  resolveWrappedBtcLoopAdapter,
  summarizeWrappedBtcLoopAdapter,
} from "../defi/wrapped-btc-loop-adapters.mjs";
import {
  buildStablecoinLoopExecutionActions,
  buildStablecoinLoopUnwindActions,
  resolveStablecoinLoopAdapter,
  summarizeStablecoinLoopAdapter,
} from "../defi/stablecoin-loop-adapters.mjs";
import { buildEmergencyUnwindExecutionPlan, evaluateLeverageWatcher } from "../defi/leverage-watchers.mjs";
import { buildOracleSanitySnapshot } from "../market/oracle-sanity.mjs";
import { summarizeRecursiveLendingLoopDryRunRuns } from "./recursive-lending-loop-dry-run.mjs";
import { resolveWrappedBtcLoopBindingSupport } from "./wrapped-btc-loop-bindings.mjs";

const DEFAULT_CONFIGS = Object.freeze({
  recursive_wrapped_btc_lending_loop: Object.freeze({
    id: "recursive_wrapped_btc_lending_loop",
    label: "Recursive wrapped-BTC lending loop",
    strategyType: "leverage_lending_loop",
    arrivalFamily: "wrapped_btc",
    isLeverage: true,
    chain: "base",
    protocol: "moonwell",
    collateralAsset: "cbBTC",
    borrowAsset: "USDC",
    perTradeCapUsd: 300,
    targetHealthFactor: 1.65,
    healthFactorMin: 1.35,
    liquidationBufferPct: 12,
    unwindTriggerHealthFactor: 1.3,
    maxLoopIterations: 4,
    maxLtvPct: 62,
  }),
  recursive_stablecoin_lending_loop: Object.freeze({
    id: "recursive_stablecoin_lending_loop",
    label: "Recursive stablecoin lending loop",
    strategyType: "leverage_lending_loop",
    arrivalFamily: "stablecoin",
    isLeverage: true,
    chain: "base",
    protocol: "morpho",
    collateralAsset: "USDC",
    borrowAsset: "USDT",
    perTradeCapUsd: 250,
    targetHealthFactor: 1.14,
    healthFactorMin: 1.08,
    liquidationBufferPct: 6,
    unwindTriggerHealthFactor: 1.05,
    maxLoopIterations: 5,
    maxLtvPct: 87,
    pegDriftTriggerPct: 0.5,
  }),
});

const DEFAULT_MARKET_ASSUMPTIONS = Object.freeze({
  recursive_wrapped_btc_lending_loop: Object.freeze({
    liquidationThresholdPct: 74,
    supplyAprBps: 240,
    borrowAprBps: 130,
    loopSwapFeeBps: 12,
    unwindSlippageBps: 20,
    unwindFixedCostUsd: 2.5,
    minIncrementUsd: 40,
    oracleDriftTriggerPct: 4,
    maxUnwindGasUsd: 10,
  }),
  recursive_stablecoin_lending_loop: Object.freeze({
    liquidationThresholdPct: 92,
    supplyAprBps: 510,
    borrowAprBps: 360,
    loopSwapFeeBps: 2,
    unwindSlippageBps: 4,
    unwindFixedCostUsd: 1.2,
    minIncrementUsd: 35,
    oracleDriftTriggerPct: 0.5,
    maxUnwindGasUsd: 8,
  }),
});

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

function requiredConfigFields(config = {}) {
  return unique([
    ...LENDING_LOOP_REQUIRED_POLICY_FIELDS,
    "chain",
    "protocol",
    "collateralAsset",
    "borrowAsset",
    config.arrivalFamily === "stablecoin" ? "pegDriftTriggerPct" : null,
  ]);
}

function validateRequiredNumbers(config = {}) {
  return requiredConfigFields(config).filter((field) => {
    if (["chain", "protocol", "collateralAsset", "borrowAsset"].includes(field)) {
      return !config[field];
    }
    return !Number.isFinite(config[field]);
  });
}

export function listRecursiveLendingLoopStrategyIds() {
  return Object.keys(DEFAULT_CONFIGS);
}

export function buildDefaultRecursiveLendingLoopConfig(strategyId = "recursive_wrapped_btc_lending_loop") {
  const config = DEFAULT_CONFIGS[strategyId];
  if (!config) {
    throw new Error(`Unsupported recursive lending loop strategy: ${strategyId}`);
  }
  return { ...config };
}

export function buildDefaultRecursiveLendingLoopMarketAssumptions(strategyId = "recursive_wrapped_btc_lending_loop") {
  const config = DEFAULT_MARKET_ASSUMPTIONS[strategyId];
  if (!config) {
    throw new Error(`Unsupported recursive lending loop strategy: ${strategyId}`);
  }
  return { ...config };
}

export function validateRecursiveLendingLoopConfig(config = {}) {
  const missingFields = validateRequiredNumbers(config);
  const errors = [];
  if (Number.isFinite(config.unwindTriggerHealthFactor) && Number.isFinite(config.healthFactorMin) && config.unwindTriggerHealthFactor > config.healthFactorMin) {
    errors.push("unwindTriggerHealthFactor must be less than or equal to healthFactorMin");
  }
  if (Number.isFinite(config.healthFactorMin) && Number.isFinite(config.targetHealthFactor) && config.healthFactorMin > config.targetHealthFactor) {
    errors.push("healthFactorMin must be less than or equal to targetHealthFactor");
  }
  if (Number.isFinite(config.maxLtvPct) && (config.maxLtvPct <= 0 || config.maxLtvPct >= 100)) {
    errors.push("maxLtvPct must be between 0 and 100");
  }
  if (Number.isFinite(config.liquidationBufferPct) && config.liquidationBufferPct <= 0) {
    errors.push("liquidationBufferPct must be positive");
  }
  if (Number.isFinite(config.maxLoopIterations) && config.maxLoopIterations < 1) {
    errors.push("maxLoopIterations must be at least 1");
  }
  if (config.arrivalFamily === "stablecoin" && Number.isFinite(config.pegDriftTriggerPct) && config.pegDriftTriggerPct <= 0) {
    errors.push("pegDriftTriggerPct must be positive");
  }
  return {
    ok: missingFields.length === 0 && errors.length === 0,
    missingFields,
    errors,
  };
}

function buildLoopIterations(config = {}, market = {}) {
  const liquidationThresholdPct = finite(market.liquidationThresholdPct) ?? 0;
  const targetHealthFactor = finite(config.targetHealthFactor) ?? 0;
  const maxLtvPct = finite(config.maxLtvPct) ?? 0;
  const minIncrementUsd = finite(market.minIncrementUsd) ?? 0;
  const loopSwapFeePct = (finite(market.loopSwapFeeBps) ?? 0) / 10_000;
  const perTradeCapUsd = finite(config.perTradeCapUsd) ?? 0;
  const targetLtvPct = Math.min(maxLtvPct, liquidationThresholdPct / Math.max(targetHealthFactor, 1));
  const borrowPct = Math.max(0, targetLtvPct / 100);

  let loopCollateralUsd = perTradeCapUsd;
  let totalCollateralUsd = perTradeCapUsd;
  let totalDebtUsd = 0;
  let entryFeesUsd = 0;
  const iterations = [];

  for (let index = 0; index < config.maxLoopIterations; index += 1) {
    const borrowUsd = loopCollateralUsd * borrowPct;
    if (!(borrowUsd >= minIncrementUsd)) break;
    const feeUsd = borrowUsd * loopSwapFeePct;
    const recycledCollateralUsd = Math.max(0, borrowUsd - feeUsd);
    totalDebtUsd += borrowUsd;
    totalCollateralUsd += recycledCollateralUsd;
    entryFeesUsd += feeUsd;
    iterations.push({
      iteration: index + 1,
      inputCollateralUsd: round(loopCollateralUsd),
      borrowUsd: round(borrowUsd),
      swapFeeUsd: round(feeUsd, 4),
      recycledCollateralUsd: round(recycledCollateralUsd),
    });
    loopCollateralUsd = recycledCollateralUsd;
  }

  return {
    iterations,
    entryFeesUsd,
    totalCollateralUsd,
    totalDebtUsd,
    targetLtvPct,
    effectiveLtvPct: totalCollateralUsd > 0 ? (totalDebtUsd / totalCollateralUsd) * 100 : null,
    projectedHealthFactor: totalDebtUsd > 0 ? liquidationThresholdPct / ((totalDebtUsd / totalCollateralUsd) * 100) : null,
    projectedLiquidationBufferPct:
      totalCollateralUsd > 0 ? liquidationThresholdPct - (totalDebtUsd / totalCollateralUsd) * 100 : null,
  };
}

function buildEconomics(loop = {}, market = {}, initialCapitalUsd = null, dryRunReceipts = []) {
  const supplyAprBps = finite(market.supplyAprBps) ?? 0;
  const borrowAprBps = finite(market.borrowAprBps) ?? 0;
  const unwindSlippageBps = finite(market.unwindSlippageBps) ?? 0;
  const unwindFixedCostUsd = finite(market.unwindFixedCostUsd) ?? 0;
  const annualSupplyUsd = loop.totalCollateralUsd * (supplyAprBps / 10_000);
  const annualBorrowUsd = loop.totalDebtUsd * (borrowAprBps / 10_000);
  const unwindSlippageUsd = loop.totalCollateralUsd * (unwindSlippageBps / 10_000);
  const dryRunSummary = summarizeRecursiveLendingLoopDryRunRuns(dryRunReceipts);
  const realizedSamples = dryRunReceipts.filter((item) => item?.result === "passed");
  const realizedNetCarryUsd = realizedSamples.length
    ? realizedSamples.reduce((sum, item) => sum + (item.realizedNetCarryUsd ?? 0), 0) / realizedSamples.length
    : null;
  return {
    paper: {
      annualSupplyCarryUsd: round(annualSupplyUsd, 4),
      annualBorrowCostUsd: round(annualBorrowUsd, 4),
      entryLoopFeesUsd: round(loop.entryFeesUsd, 4),
      unwindSlippageUsd: round(unwindSlippageUsd, 4),
      unwindFixedCostUsd: round(unwindFixedCostUsd, 4),
      annualNetCarryUsd: round(annualSupplyUsd - annualBorrowUsd - loop.entryFeesUsd - unwindSlippageUsd - unwindFixedCostUsd, 4),
      annualNetCarryPctOnInitialCapital:
        Number.isFinite(initialCapitalUsd) && initialCapitalUsd > 0
          ? round(((annualSupplyUsd - annualBorrowUsd - loop.entryFeesUsd - unwindSlippageUsd - unwindFixedCostUsd) / initialCapitalUsd) * 100, 4)
          : null,
    },
    estimated: {
      status: dryRunSummary.dryRunReceiptRecorded ? "simulated_dry_run_estimate" : "unavailable_until_receipts_exist",
      valueUsd: realizedNetCarryUsd != null ? round(realizedNetCarryUsd, 4) : null,
      sampleCount: dryRunSummary.passedCount ?? 0,
    },
    realized: {
      status: dryRunSummary.dryRunReceiptRecorded ? "simulated_dry_run_receipts" : "no_realized_samples",
      valueUsd: realizedNetCarryUsd != null ? round(realizedNetCarryUsd, 4) : null,
      sampleCount: realizedSamples.length,
    },
  };
}

function buildWatcherPlan(config = {}, market = {}, loop = {}) {
  return {
    breachAction: "auto_unwind",
    checks: [
      {
        id: "health_factor_floor",
        threshold: config.healthFactorMin,
        observed: round(loop.projectedHealthFactor, 4),
        comparison: "must_stay_above",
      },
      {
        id: "liquidation_buffer_floor",
        thresholdPct: config.liquidationBufferPct,
        observedPct: round(loop.projectedLiquidationBufferPct, 4),
        comparison: "must_stay_above",
      },
      {
        id: "unwind_trigger_health_factor",
        threshold: config.unwindTriggerHealthFactor,
        comparison: "trigger_auto_unwind_at_or_below",
      },
      {
        id: config.arrivalFamily === "stablecoin" ? "peg_drift" : "oracle_drift",
        thresholdPct: config.pegDriftTriggerPct ?? market.oracleDriftTriggerPct,
        comparison: "pause_new_entries_and_review",
      },
      {
        id: "unwind_gas_budget",
        thresholdUsd: market.maxUnwindGasUsd,
        comparison: "pause_expansion_when_above",
      },
    ],
  };
}

function buildUnwindPlan(config = {}) {
  const settleAsset = config.arrivalFamily === "stablecoin" ? "treasury stable sleeve" : "treasury BTC sleeve";
  return {
    readiness: "design_only_until_dry_run_passes",
    dryRunRequired: true,
    steps: [
      `halt new ${config.protocol || "protocol"} borrow loops`,
      `repay ${config.borrowAsset || "borrow asset"} debt until health factor recovers above ${config.targetHealthFactor || "target"}`,
      `withdraw ${config.collateralAsset || "collateral asset"} collateral`,
      `return collateral into the ${settleAsset}`,
      "reconcile receipt and realized unwind cost before any re-entry",
    ],
  };
}

function adapterToolkit(config = {}) {
  if (config.arrivalFamily === "wrapped_btc") {
    return {
      adapter: resolveWrappedBtcLoopAdapter(config),
      summarize: summarizeWrappedBtcLoopAdapter,
      buildEntryActions: buildWrappedBtcLoopExecutionActions,
      buildUnwindActions: buildWrappedBtcLoopUnwindActions,
    };
  }
  if (config.arrivalFamily === "stablecoin") {
    return {
      adapter: resolveStablecoinLoopAdapter(config),
      summarize: summarizeStablecoinLoopAdapter,
      buildEntryActions: buildStablecoinLoopExecutionActions,
      buildUnwindActions: buildStablecoinLoopUnwindActions,
    };
  }
  return {
    adapter: null,
    summarize: () => null,
    buildEntryActions: () => [],
    buildUnwindActions: () => [],
  };
}

function buildExecutionSupport(config = {}, adapter = null) {
  if (!adapter) return null;
  if (config.arrivalFamily === "wrapped_btc") {
    return resolveWrappedBtcLoopBindingSupport({
      strategyId: config.id,
      strategyConfig: config,
    });
  }
  const supportedVenue = config.chain === "base" && config.protocol === "morpho";
  const blockers = unique([
    supportedVenue ? null : "unsupported_venue_profile",
    "stable_swap_binding_missing",
    "dry_run_receipt_missing",
  ]);
  const missingFacts = unique([
    supportedVenue ? null : `Planner currently supports Base Morpho only; received ${config.protocol || "unknown"} on ${config.chain || "unknown"}.`,
    "Signer-owned stable-swap calldata and venue bindings are still required before any live promotion.",
    "Receipt-backed borrow-rate and unwind-cost samples are still required before promotion beyond dry-run planning.",
  ]);
  return {
    strategyId: config.id,
    status: supportedVenue ? "planning_adapter_ready" : "unsupported_venue_profile",
    executableFromRepo: false,
    requestedVenue: {
      strategyId: config.id,
      chain: config.chain || null,
      protocol: config.protocol || null,
      collateralAsset: config.collateralAsset || null,
      borrowAsset: config.borrowAsset || null,
    },
    deterministicPath: [
      "approve collateral stable to the selected lending market",
      "deposit collateral stable",
      "borrow the second stablecoin against collateral",
      "swap borrowed stable back into collateral stable",
      "re-deposit recycled collateral while rechecking health factor and peg drift",
      "repay debt first, then release collateral during unwind",
    ],
    blockers,
    missingFacts,
    warnings: [
      "Stablecoin loop planning is deterministic, but live promotion still requires signer-owned venue bindings and receipt-backed peg behavior.",
    ],
    nextActions: unique([
      "materialize signer-owned stable-swap calldata from an allowlisted venue path",
      "record dry-run receipts for borrow, recycle, and unwind legs",
      "capture borrow spread and unwind-cost samples before live promotion",
    ]),
  };
}

export function buildRecursiveLendingLoopScaffold({
  strategyId = "recursive_wrapped_btc_lending_loop",
  strategyConfig = null,
  marketAssumptions = null,
  dryRunReceipts = [],
  oracleInputs = null,
  now = null,
} = {}) {
  const config = {
    ...buildDefaultRecursiveLendingLoopConfig(strategyId),
    ...(strategyConfig || {}),
  };
  const market = {
    ...buildDefaultRecursiveLendingLoopMarketAssumptions(config.id || strategyId),
    ...(marketAssumptions || {}),
  };
  const validation = validateRecursiveLendingLoopConfig(config);
  const loop = buildLoopIterations(config, market);
  const { adapter, summarize, buildEntryActions, buildUnwindActions } = adapterToolkit(config);
  const executionSupport = buildExecutionSupport(config, adapter);
  const driftTriggerPct = config.pegDriftTriggerPct ?? market.oracleDriftTriggerPct;
  const oracleSanity = buildOracleSanitySnapshot({
    assetKey: config.arrivalFamily === "stablecoin" ? "usd" : "btc",
    protocolPriceUsd: oracleInputs?.protocolPriceUsd,
    referenceSamples: oracleInputs?.referenceSamples || [],
    now,
    driftAlertPct: driftTriggerPct,
    minReferenceSampleCount: Math.max(1, Math.min(2, adapter?.referenceOracles?.length || 1)),
  });
  const executionActions = buildEntryActions({
    adapter,
    loop,
    strategyConfig: config,
  });
  const dryRunSummary = summarizeRecursiveLendingLoopDryRunRuns(dryRunReceipts);
  const economics = buildEconomics(loop, market, config.perTradeCapUsd, dryRunReceipts);
  const watcherPlan = buildWatcherPlan(config, market, loop);
  const watcherRuntime = evaluateLeverageWatcher({
    strategyConfig: config,
    positionState: {
      currentHealthFactor: round(loop.projectedHealthFactor, 4),
      currentLiquidationBufferPct: round(loop.projectedLiquidationBufferPct, 4),
    },
    marketState: {
      oracleDriftPct: oracleSanity.protocolDriftPct ?? 0,
      oracleDriftTriggerPct: driftTriggerPct,
      unwindGasUsd: 0,
      maxUnwindGasUsd: market.maxUnwindGasUsd,
    },
  });
  const unwindPlan = {
    ...buildUnwindPlan(config),
    actions: buildUnwindActions({
      adapter,
      loop,
      strategyConfig: config,
    }),
  };
  const emergencyUnwindExecution = buildEmergencyUnwindExecutionPlan({
    strategyConfig: config,
    protocolAdapter: adapter,
    unwindActions: unwindPlan.actions,
    watcherDecision: watcherRuntime,
    positionState: {
      currentHealthFactor: round(loop.projectedHealthFactor, 4),
      currentLiquidationBufferPct: round(loop.projectedLiquidationBufferPct, 4),
    },
    now,
  });
  const blockers = unique([
    validation.missingFields.length ? "strategy_config_incomplete" : null,
    validation.errors.length ? "strategy_config_invalid" : null,
    adapter ? null : "protocol_adapter_not_built",
    ...(executionSupport?.blockers || []),
    dryRunSummary.dryRunReceiptRecorded ? null : "dry_run_unwind_not_recorded",
    dryRunSummary.passedCount > 0 ? null : "estimated_and_realized_rate_feeds_missing",
  ]);

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    strategy: {
      ...config,
      stage: "design_scaffold",
      requiredPolicyFields: requiredConfigFields(config),
    },
    protocolAdapter: summarize(adapter),
    executionSupport,
    dryRunSummary,
    validation,
    marketAssumptions: market,
    oracleSanity,
    entryPlan: {
      initialCollateralUsd: round(config.perTradeCapUsd),
      targetLtvPct: round(loop.targetLtvPct, 4),
      effectiveLtvPct: round(loop.effectiveLtvPct, 4),
      projectedHealthFactor: round(loop.projectedHealthFactor, 4),
      projectedLiquidationBufferPct: round(loop.projectedLiquidationBufferPct, 4),
      loopedExposureMultiple:
        Number.isFinite(config.perTradeCapUsd) && config.perTradeCapUsd > 0
          ? round(loop.totalCollateralUsd / config.perTradeCapUsd, 4)
          : null,
      totalCollateralUsd: round(loop.totalCollateralUsd),
      totalDebtUsd: round(loop.totalDebtUsd),
      iterations: loop.iterations,
    },
    executionPlan: {
      actionCount: executionActions.length,
      actions: executionActions,
    },
    watcherPlan,
    watcherRuntime,
    unwindPlan,
    emergencyUnwindExecution,
    pnl: economics,
    blockers,
    readiness: {
      readyForDryRun: validation.ok && Boolean(adapter),
      readyForLive: false,
    },
    nextActions: unique([
      ...(executionSupport?.nextActions || []),
      "run fork or dry-run unwind before any live promotion",
      "capture receipt-backed carry, gas, and unwind samples before promotion",
    ]),
    notes: [
      "Paper PnL is explicitly separate from estimated and realized PnL.",
      "This scaffold is deterministic planning only and does not execute on-chain actions.",
      "Any threshold breach is designed to auto-unwind rather than wait for operator intervention.",
    ],
  };
}
