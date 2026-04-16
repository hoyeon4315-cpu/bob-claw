import { LENDING_LOOP_REQUIRED_POLICY_FIELDS } from "./lending-loop-research.mjs";
import {
  buildWrappedBtcLoopExecutionActions,
  buildWrappedBtcLoopUnwindActions,
  resolveWrappedBtcLoopAdapter,
  summarizeWrappedBtcLoopAdapter,
} from "../defi/wrapped-btc-loop-adapters.mjs";
import { buildEmergencyUnwindExecutionPlan, evaluateLeverageWatcher } from "../defi/leverage-watchers.mjs";
import { buildOracleSanitySnapshot } from "../market/oracle-sanity.mjs";
import { summarizeWrappedBtcLendingLoopDryRunRuns } from "./wrapped-btc-lending-loop-dry-run.mjs";
import { resolveWrappedBtcLoopBindingSupport } from "./wrapped-btc-loop-bindings.mjs";

const DEFAULT_STRATEGY_CONFIG = Object.freeze({
  id: "wrapped-btc-loop-base-moonwell",
  label: "Wrapped BTC lending loop (Base / Moonwell)",
  strategyType: "leverage_lending_loop",
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
});

const DEFAULT_MARKET_ASSUMPTIONS = Object.freeze({
  liquidationThresholdPct: 74,
  supplyAprBps: 240,
  borrowAprBps: 130,
  loopSwapFeeBps: 12,
  unwindSlippageBps: 20,
  unwindFixedCostUsd: 2.5,
  minIncrementUsd: 40,
  oracleDriftTriggerPct: 4,
  maxUnwindGasUsd: 10,
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

function requiredConfigFields() {
  return [...LENDING_LOOP_REQUIRED_POLICY_FIELDS, "chain", "protocol", "collateralAsset", "borrowAsset"];
}

function validateRequiredNumbers(config = {}) {
  return requiredConfigFields().filter((field) => {
    if (["chain", "protocol", "collateralAsset", "borrowAsset"].includes(field)) {
      return !config[field];
    }
    return !Number.isFinite(config[field]);
  });
}

export function buildDefaultWrappedBtcLendingLoopConfig() {
  return { ...DEFAULT_STRATEGY_CONFIG };
}

export function validateWrappedBtcLendingLoopConfig(config = {}) {
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
  const dryRunSummary = summarizeWrappedBtcLendingLoopDryRunRuns(dryRunReceipts);
  const realizedSamples = dryRunReceipts.filter((item) => item.result === "passed");
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
      status: dryRunSummary.dryRunReceiptRecorded ? "simulated_dry_run_estimate" : "unavailable_until_protocol_adapter_and_rate_feed_exist",
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
        id: "oracle_drift",
        thresholdPct: market.oracleDriftTriggerPct,
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
  return {
    readiness: "design_only_until_dry_run_passes",
    dryRunRequired: true,
    steps: [
      `halt new ${config.protocol || "protocol"} borrow loops`,
      `repay ${config.borrowAsset || "borrow asset"} debt until health factor recovers above ${config.targetHealthFactor || "target"}`,
      `withdraw ${config.collateralAsset || "collateral asset"} collateral`,
      "swap/bridge back to the treasury settlement path",
      "reconcile receipt and realized unwind cost before any re-entry",
    ],
  };
}

export function buildWrappedBtcLendingLoopScaffold({
  strategyConfig = buildDefaultWrappedBtcLendingLoopConfig(),
  marketAssumptions = DEFAULT_MARKET_ASSUMPTIONS,
  dryRunReceipts = [],
  oracleInputs = null,
  now = null,
} = {}) {
  const config = { ...buildDefaultWrappedBtcLendingLoopConfig(), ...(strategyConfig || {}) };
  const market = { ...DEFAULT_MARKET_ASSUMPTIONS, ...(marketAssumptions || {}) };
  const validation = validateWrappedBtcLendingLoopConfig(config);
  const loop = buildLoopIterations(config, market);
  const protocolAdapter = resolveWrappedBtcLoopAdapter(config);
  const oracleSanity = buildOracleSanitySnapshot({
    assetKey: "btc",
    protocolPriceUsd: oracleInputs?.protocolPriceUsd,
    referenceSamples: oracleInputs?.referenceSamples || [],
    now,
    driftAlertPct: market.oracleDriftTriggerPct,
    minReferenceSampleCount: Math.max(1, Math.min(2, protocolAdapter?.referenceOracles?.length || 1)),
  });
  const executionActions = buildWrappedBtcLoopExecutionActions({
    adapter: protocolAdapter,
    loop,
    strategyConfig: config,
  });
  const bindingSupport = resolveWrappedBtcLoopBindingSupport({
    strategyId: config.id,
    strategyConfig: config,
  });
  const dryRunSummary = summarizeWrappedBtcLendingLoopDryRunRuns(dryRunReceipts);
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
      oracleDriftTriggerPct: market.oracleDriftTriggerPct,
      unwindGasUsd: 0,
      maxUnwindGasUsd: market.maxUnwindGasUsd,
    },
  });
  const unwindPlan = {
    ...buildUnwindPlan(config),
    actions: buildWrappedBtcLoopUnwindActions({
      adapter: protocolAdapter,
      loop,
      strategyConfig: config,
    }),
  };
  const emergencyUnwindExecution = buildEmergencyUnwindExecutionPlan({
    strategyConfig: config,
    protocolAdapter,
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
    protocolAdapter ? null : "protocol_adapter_not_built",
    ...(bindingSupport.blockers || []),
    dryRunSummary.dryRunReceiptRecorded ? null : "dry_run_unwind_not_recorded",
    dryRunSummary.passedCount > 0 ? null : "estimated_and_realized_rate_feeds_missing",
  ]);

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    strategy: {
      ...config,
      stage: "design_scaffold",
      requiredPolicyFields: [...LENDING_LOOP_REQUIRED_POLICY_FIELDS],
    },
    protocolAdapter: summarizeWrappedBtcLoopAdapter(protocolAdapter),
    bindingSupport,
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
      readyForDryRun: validation.ok && Boolean(protocolAdapter),
      readyForLive: false,
    },
    nextActions: unique([
      ...(bindingSupport.nextActions || []),
      "wire protocol adapter for the selected venue",
      "record live rate snapshot and unwind cost feed",
      "run fork or dry-run unwind before any live promotion",
    ]),
    notes: [
      "Paper PnL is explicitly separate from estimated and realized PnL.",
      "This scaffold is deterministic planning only and does not execute on-chain actions.",
      "Any threshold breach is designed to auto-unwind rather than wait for operator intervention.",
      "Chainlink and Pyth fit this path as reference-only sanity checks, not as the primary trade trigger.",
    ],
  };
}
