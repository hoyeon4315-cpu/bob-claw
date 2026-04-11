function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function hoursAgo(timestamp, now) {
  return (new Date(now).getTime() - new Date(timestamp).getTime()) / 3_600_000;
}

function minutesAgo(timestamp, now) {
  return (new Date(now).getTime() - new Date(timestamp).getTime()) / 60_000;
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
  const dailyLossCapUsd = mode === "live" ? riskPolicy.canaryDailyLossCapUsd : riskPolicy.normalDailyLossCapUsd;
  const effectiveNetPnlUsd = job.systemEconomics?.effectiveSystemNetPnlUsd;
  const routeNetPnlUsd = isFiniteNumber(job.systemEconomics?.routeExecutableNetEdgeUsd)
    ? job.systemEconomics.routeExecutableNetEdgeUsd
    : job.systemEconomics?.routeNetEdgeUsd;
  const routeInputUsd = job.systemEconomics?.routeInputUsd ?? null;

  if (riskState.projectLossUsedUsd >= riskPolicy.projectLossCapUsd) {
    blockers.push("project_loss_cap_reached");
  }
  if (riskState.dailyRealizedPnlUsd <= -dailyLossCapUsd) {
    blockers.push("daily_loss_cap_reached");
  }
  if (riskState.failedGasCost24hUsd >= riskPolicy.maxFailedGasCost24hUsd) {
    blockers.push("failed_gas_cap_reached");
  }
  if (riskState.consecutiveFailures >= riskPolicy.maxConsecutiveFailures) {
    blockers.push("max_consecutive_failures_reached");
  }
  if (mode === "live" && isFiniteNumber(riskState.walletEstimatedUsd) && riskState.walletEstimatedUsd < riskPolicy.canaryWalletFloorUsd) {
    blockers.push("wallet_floor_breached");
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
  if (isFiniteNumber(effectiveNetPnlUsd) && effectiveNetPnlUsd > 0 && effectiveNetPnlUsd < riskPolicy.minNetProfitUsd) {
    blockers.push("system_net_pnl_below_min_profit");
  }
  if (isFiniteNumber(routeInputUsd) && routeInputUsd > 0 && isFiniteNumber(effectiveNetPnlUsd)) {
    const edgePct = effectiveNetPnlUsd / routeInputUsd;
    if (edgePct < riskPolicy.minNetProfitPct) {
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
      ageMinutes,
    },
  };
}
