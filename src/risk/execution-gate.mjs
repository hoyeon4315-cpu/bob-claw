function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function isNativeRefillJob(job = {}) {
  return String(job?.type || "").toLowerCase() === "refill_native";
}

function isRefillJob(job = {}) {
  return String(job?.type || "").toLowerCase().startsWith("refill_");
}

function hoursAgo(timestamp, now) {
  return (new Date(now).getTime() - new Date(timestamp).getTime()) / 3_600_000;
}

function minutesAgo(timestamp, now) {
  return (new Date(now).getTime() - new Date(timestamp).getTime()) / 60_000;
}

function resumeAfterTimestamp(resumeAfterFailureAt = null) {
  if (!resumeAfterFailureAt) return null;
  const timestamp = new Date(resumeAfterFailureAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function strategyPolicyFromJob(job = {}) {
  return job.strategyPolicy || job.strategyConfig || null;
}

function jobExposureUsd(job = {}) {
  const directExposureValues = [
    job.estimatedAssetValueUsd,
    job.targetAmountUsd,
    job.amountUsd,
  ].filter(isFiniteNumber);
  if (isRefillJob(job) && directExposureValues.length > 0) {
    return directExposureValues.reduce((max, value) => Math.max(max, value), null);
  }
  return [
    job.systemEconomics?.routeInputUsd,
    ...directExposureValues,
  ].filter(isFiniteNumber).reduce((max, value) => Math.max(max, value), null);
}

function fundingSourceAutoExecutable(fundingSource = null) {
  if (!fundingSource) return false;
  if (fundingSource.selectionStatus === "ready") return true;
  return (
    fundingSource.selectionStatus === "conditional" &&
    (fundingSource.missingInputs || []).length === 0 &&
    (fundingSource.settlementRequirements || []).length > 0 &&
    !fundingSource.requiresManualFunding
  );
}

function failedGasCostUsdForReceipt(record = {}) {
  const receiptGasUsd = record.realized?.receiptGasUsd;
  const sourceTxSucceeded = record.flags?.failed === false || Number(record.receipt?.status) === 1;
  if (sourceTxSucceeded && isFiniteNumber(receiptGasUsd)) {
    return receiptGasUsd;
  }
  return record.realized?.actualKnownCostUsd;
}

function isLeverageStrategy(job = {}, strategyPolicy = null) {
  if (strategyPolicy?.isLeverage === true) return true;
  const actionType = String(strategyPolicy?.actionType || job?.actionType || "").toLowerCase();
  const strategyType = String(strategyPolicy?.strategyType || job?.strategyType || "").toLowerCase();
  return actionType.includes("leverage") || actionType.includes("lending_loop") || strategyType.includes("leverage");
}

function isHoldingPeriodCarryStrategy(job = {}, strategyPolicy = null) {
  const economicsMode = String(strategyPolicy?.economicsMode || job?.economicsMode || "").toLowerCase();
  const category = String(strategyPolicy?.category || job?.category || "").toLowerCase();
  const actionType = String(strategyPolicy?.actionType || job?.actionType || "").toLowerCase();
  const strategyType = String(strategyPolicy?.strategyType || job?.strategyType || "").toLowerCase();
  return (
    economicsMode === "holding_period_carry" ||
    category === "yield" ||
    actionType.includes("yield") ||
    actionType.includes("lending_loop") ||
    strategyType.includes("lending_loop")
  );
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

function latestTerminalStatuses(events = [], resumeAfterFailureAt = null) {
  const resumeAfterMs = resumeAfterTimestamp(resumeAfterFailureAt);
  return [...events]
    .filter((item) => ["confirmed", "delivered", "failed"].includes(item.status))
    .filter((item) => !isSignerAvailabilityFailure(item))
    .filter((item) => !isPartialPreparationFailure(item))
    .filter((item) => resumeAfterMs === null || new Date(item.observedAt || 0).getTime() > resumeAfterMs)
    .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
}

function errorMessage(record = {}) {
  return String(record.error?.message || record.error || "");
}

function isSignerAvailabilityFailure(record = {}) {
  if (record.status !== "failed") return false;
  return /ECONNREFUSED.+executor-signer\.sock|executor-signer\.sock.+ECONNREFUSED/u.test(errorMessage(record));
}

function isKeyEnvironmentFailure(record = {}) {
  if (record.status !== "failed") return false;
  if (hasExecutionProgressEvidence(record)) return false;
  const txHashes = Array.isArray(record.txHashes) ? record.txHashes.filter(Boolean) : [];
  if (txHashes.length > 0) return false;
  return /BURNER_EVM_KEY_PATH|BURNER_PRIVATE_KEY_PATH|BURNER_BTC_KEY_PATH/u.test(errorMessage(record));
}

function hasExecutionProgressEvidence(record = {}) {
  return Boolean(
    record.sourceBalanceAfter ||
    record.destinationBalanceAfter ||
    record.destinationProof ||
    record.receiptIngest ||
    record.destinationObservedDelta,
  );
}

function isPartialPreparationFailure(record = {}) {
  if (record.status !== "failed") return false;
  if (hasExecutionProgressEvidence(record)) return false;
  const txHashes = Array.isArray(record.txHashes) ? record.txHashes.filter(Boolean) : [];
  const stepIds = Array.isArray(record.stepIds) ? record.stepIds.filter(Boolean) : [];
  if (txHashes.length > 0 && stepIds.length > 0 && txHashes.length < stepIds.length) {
    return true;
  }
  if (txHashes.length === 0 && /insufficient_native_balance_for_gas/u.test(errorMessage(record))) {
    return true;
  }
  return false;
}

export function buildExecutionRiskState({
  receiptRecords = [],
  executionEvents = [],
  inventory = null,
  resumeAfterFailureAt = null,
  now = new Date().toISOString(),
} = {}) {
  const receipt24h = receiptRecords.filter((item) => hoursAgo(item.observedAt, now) <= 24);
  const terminal = latestTerminalStatuses(executionEvents, resumeAfterFailureAt);
  const infrastructureFailureCount = executionEvents.filter((item) =>
    isSignerAvailabilityFailure(item) || isKeyEnvironmentFailure(item)
  ).length;

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
    .map((item) => failedGasCostUsdForReceipt(item))
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
    infrastructureFailureCount,
    walletEstimatedUsd: inventory?.summary?.estimatedWalletUsd ?? null,
    lastReceiptAt: receiptRecords.length ? [...receiptRecords].sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt))[0].observedAt : null,
    resumeAfterFailureAt,
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
  const exposureUsd = jobExposureUsd(job);
  const leverageStrategy = isLeverageStrategy(job, strategyPolicy);
  const holdingPeriodCarryStrategy = isHoldingPeriodCarryStrategy(job, strategyPolicy);
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
  if (mode === "live" && isFiniteNumber(perTradeCapUsd) && isFiniteNumber(exposureUsd) && exposureUsd > perTradeCapUsd) {
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
  if (job.fundingSource?.selectionStatus === "conditional" && !fundingSourceAutoExecutable(job.fundingSource)) {
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

  if (!isRefillJob(job) && job.systemEconomics?.tradeReadiness && String(job.systemEconomics.tradeReadiness).startsWith("reject_")) {
    blockers.push("route_trade_rejected");
  }
  if (isFiniteNumber(effectiveNetPnlUsd) && effectiveNetPnlUsd <= 0 && !isRefillJob(job) && !holdingPeriodCarryStrategy) {
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
      exposureUsd: exposureUsd ?? null,
      strategyId,
      strategyPerTradeCapUsd: perTradeCapUsd ?? null,
      leverageStrategy,
      holdingPeriodCarryStrategy,
      missingLeverageFields: leverageMissingFields,
      ageMinutes,
    },
  };
}
