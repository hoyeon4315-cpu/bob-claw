function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function hoursAgo(timestamp, now) {
  return (new Date(now).getTime() - new Date(timestamp).getTime()) / 3_600_000;
}

function minutesAgo(timestamp, now) {
  return (new Date(now).getTime() - new Date(timestamp).getTime()) / 60_000;
}

function strategyPolicyFromJob(job = {}) {
  return job.strategyPolicy || job.strategyConfig || null;
}

function isLeverageStrategy(job = {}, strategyPolicy = null) {
  if (strategyPolicy?.isLeverage === true) return true;
  const actionType = String(strategyPolicy?.actionType || job?.actionType || "").toLowerCase();
  const strategyType = String(strategyPolicy?.strategyType || job?.strategyType || "").toLowerCase();
  return actionType.includes("leverage") || actionType.includes("lending_loop") || strategyType.includes("leverage");
}

function missingLeverageFields(strategyPolicy = null) {
  return [
    "perTradeCapUsd",
    "healthFactorMin",
    "liquidationBufferPct",
    "unwindTriggerHealthFactor",
    "maxLoopIterations",
    "maxLtvPct",
  ].filter((field) => !isFiniteNumber(strategyPolicy?.[field]));
}

function latestTerminalStatuses(events = []) {
  return [...events]
    .filter((item) => ["confirmed", "failed"].includes(item.status))
    .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
}

export function buildExecutionRiskState({ receiptRecords = [], executionEvents = [], inventory = null, now = new Date().toISOString() }) {
  const receipt24h = receiptRecords.filter((item) => hoursAgo(item.observedAt, now) <= 24);
  const terminal = latestTerminalStatuses(executionEvents);

  let consecutiveFailures = 0;
  for (const item of terminal) {
    if (item.status === "failed") {
      consecutiveFailures += 1;
      continue;
    }
    break;
  }

  const dailyRealizedPnlUsd = receipt24h
    .map((item) => item.realized?.realizedNetPnlUsd)
    .filter(isFiniteNumber)
    .reduce((sum, value) => sum + value, 0);
  const projectRealizedPnlUsd = receiptRecords
    .map((item) => item.realized?.realizedNetPnlUsd)
    .filter(isFiniteNumber)
    .reduce((sum, value) => sum + value, 0);
  const projectLossUsedUsd = Math.max(0, -projectRealizedPnlUsd);
  const failedGasCost24hUsd = receipt24h
    .filter((item) => item.reconciliationStatus === "failed")
    .map((item) => item.realized?.actualKnownCostUsd)
    .filter(isFiniteNumber)
    .reduce((sum, value) => sum + value, 0);

  return {
    schemaVersion: 1,
    observedAt: now,
    dailyRealizedPnlUsd,
    projectRealizedPnlUsd,
    projectLossUsedUsd,
    failedGasCost24hUsd,
    consecutiveFailures,
    walletEstimatedUsd: inventory?.summary?.estimatedWalletUsd ?? null,
    lastReceiptAt: receiptRecords.length ? [...receiptRecords].sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt))[0].observedAt : null,
  };
}

export function buildExecutionRiskDecision({
  job,
  riskState,
  riskPolicy,
  mode = "dry_run",
  now = new Date().toISOString(),
}) {
  const blockers = [];
  const reviews = [];
  const warnings = [];
  const dailyLossCapUsd = riskPolicy.dailyLossCapUsd;
  const effectiveNetPnlUsd = job.systemEconomics?.effectiveSystemNetPnlUsd;
  const routeNetPnlUsd = isFiniteNumber(job.systemEconomics?.routeExecutableNetEdgeUsd)
    ? job.systemEconomics.routeExecutableNetEdgeUsd
    : job.systemEconomics?.routeNetEdgeUsd;
  const routeInputUsd = job.systemEconomics?.routeInputUsd ?? null;
  const strategyPolicy = strategyPolicyFromJob(job);
  const strategyId = strategyPolicy?.id || job.strategyId || job.strategyLabel || null;
  const perTradeCapUsd = strategyPolicy?.perTradeCapUsd ?? null;
  const leverageStrategy = isLeverageStrategy(job, strategyPolicy);
  const leverageMissingFields = leverageStrategy ? missingLeverageFields(strategyPolicy) : [];

  if (isFiniteNumber(riskPolicy.projectLossCapUsd) && riskState.projectLossUsedUsd >= riskPolicy.projectLossCapUsd) {
    blockers.push("project_loss_cap_reached");
  }
  if (isFiniteNumber(dailyLossCapUsd) && riskState.dailyRealizedPnlUsd <= -dailyLossCapUsd) {
    blockers.push("daily_loss_cap_reached");
  }
  if (riskState.failedGasCost24hUsd >= riskPolicy.maxFailedGasCost24hUsd) {
    blockers.push("failed_gas_cap_reached");
  }
  if (riskState.consecutiveFailures >= riskPolicy.maxConsecutiveFailures) {
    blockers.push("max_consecutive_failures_reached");
  }
  if (mode === "live" && isFiniteNumber(riskPolicy.canaryWalletFloorUsd) && isFiniteNumber(riskState.walletEstimatedUsd) && riskState.walletEstimatedUsd < riskPolicy.canaryWalletFloorUsd) {
    blockers.push("wallet_floor_breached");
  }
  if (mode === "live" && strategyId && !strategyPolicy) {
    blockers.push("strategy_policy_missing");
  }
  if (mode === "live" && (strategyPolicy || strategyId) && !isFiniteNumber(perTradeCapUsd)) {
    blockers.push("strategy_per_trade_cap_missing");
  }
  if (mode === "live" && isFiniteNumber(perTradeCapUsd) && isFiniteNumber(routeInputUsd) && routeInputUsd > perTradeCapUsd) {
    blockers.push("strategy_per_trade_cap_exceeded");
  }
  if (mode === "live" && leverageStrategy && riskPolicy.leverage?.allowed === false) {
    blockers.push("leverage_policy_disabled");
  }
  if (mode === "live" && leverageStrategy && leverageMissingFields.length > 0) {
    blockers.push("leverage_policy_fields_missing");
  }
  if (
    mode === "live" &&
    leverageStrategy &&
    isFiniteNumber(strategyPolicy?.currentHealthFactor) &&
    isFiniteNumber(strategyPolicy?.healthFactorMin) &&
    strategyPolicy.currentHealthFactor < strategyPolicy.healthFactorMin
  ) {
    blockers.push("health_factor_below_min");
  }
  if (
    mode === "live" &&
    leverageStrategy &&
    isFiniteNumber(strategyPolicy?.currentLiquidationBufferPct) &&
    isFiniteNumber(strategyPolicy?.liquidationBufferPct) &&
    strategyPolicy.currentLiquidationBufferPct < strategyPolicy.liquidationBufferPct
  ) {
    blockers.push("liquidation_buffer_below_min");
  }

  const ageMinutes = minutesAgo(job.createdAt || job.observedAt || now, now);
  if (ageMinutes > riskPolicy.staleJobMinutes) {
    blockers.push("stale_job_plan");
  }

  if (typeof job.requiresManualReview === "boolean" && job.requiresManualReview) {
    reviews.push("job_requires_manual_review");
  }
  if (job.fundingSource?.selectionStatus === "manual_only") {
    reviews.push("manual_funding_only");
  }
  if (job.fundingSource?.selectionStatus === "conditional") {
    reviews.push("conditional_funding_source");
  }
  if (job.fundingSource?.requiresReserveState) {
    reviews.push("reserve_state_unmodelled");
  }
  if (job.fundingSource?.requiresManualFunding) {
    reviews.push("manual_funding_dependency");
  }
  if ((job.fundingSource?.missingInputs || []).includes("bootstrap_native_required")) {
    reviews.push("bootstrap_native_required");
  }

  if (job.systemEconomics?.tradeReadiness && String(job.systemEconomics.tradeReadiness).startsWith("reject_")) {
    blockers.push("route_trade_rejected");
  }
  if (isFiniteNumber(effectiveNetPnlUsd) && effectiveNetPnlUsd <= 0) {
    blockers.push("system_net_pnl_non_positive");
  }
  // Profit-floor checks only apply when the policy actually sets a positive
  // floor. minNetProfitUsd === 0 is the new default — any strictly-positive
  // net PnL is allowed (`<= 0` is already caught above).
  if (
    isFiniteNumber(effectiveNetPnlUsd) &&
    effectiveNetPnlUsd > 0 &&
    riskPolicy.minNetProfitUsd > 0 &&
    effectiveNetPnlUsd < riskPolicy.minNetProfitUsd
  ) {
    blockers.push("system_net_pnl_below_min_profit");
  }
  if (isFiniteNumber(routeInputUsd) && routeInputUsd > 0 && isFiniteNumber(effectiveNetPnlUsd)) {
    const edgePct = effectiveNetPnlUsd / routeInputUsd;
    if (riskPolicy.minNetProfitPct > 0 && edgePct < riskPolicy.minNetProfitPct) {
      blockers.push("system_net_pnl_below_min_edge");
    }
  } else if (!isFiniteNumber(routeInputUsd) && isFiniteNumber(routeNetPnlUsd) && routeNetPnlUsd <= 0) {
    warnings.push("route_input_usd_missing");
  }

  const decision = blockers.length > 0 ? "BLOCKED" : reviews.length > 0 ? "REVIEW" : "ALLOW";

  return {
    schemaVersion: 1,
    observedAt: now,
    jobId: job.jobId,
    mode,
    decision,
    blockers: [...new Set(blockers)],
    reviews: [...new Set(reviews)],
    warnings: [...new Set(warnings)],
    metrics: {
      dailyRealizedPnlUsd: riskState.dailyRealizedPnlUsd,
      projectLossUsedUsd: riskState.projectLossUsedUsd,
      failedGasCost24hUsd: riskState.failedGasCost24hUsd,
      consecutiveFailures: riskState.consecutiveFailures,
      walletEstimatedUsd: riskState.walletEstimatedUsd,
      effectiveSystemNetPnlUsd: effectiveNetPnlUsd ?? null,
      routeNetPnlUsd: routeNetPnlUsd ?? null,
      routeInputUsd: routeInputUsd ?? null,
      strategyId,
      strategyPerTradeCapUsd: perTradeCapUsd ?? null,
      leverageStrategy,
      missingLeverageFields: leverageMissingFields,
      ageMinutes,
    },
  };
}
