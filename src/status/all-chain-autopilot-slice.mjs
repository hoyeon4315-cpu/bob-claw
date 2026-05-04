import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../config/small-capital-campaign-mode.mjs";

function compactReason(reason) {
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

function finiteCount(value) {
  return Number.isFinite(value) && value >= 0 ? Number(value) : 0;
}

const REFILL_MANUAL_DEFERRAL_REASONS = new Set([
  "routing_exhausted",
  "cross_chain_token_refill_executor_missing",
  "cross_chain_native_refill_executor_missing",
]);

function isTransientLatestError(report = null) {
  if (report?.status !== "error") return false;
  const blockedReason = compactReason(report?.blockedReason)?.toLowerCase() || "";
  return blockedReason.includes("timed out");
}

function observedMs(report = null) {
  const ms = new Date(report?.observedAt || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function resolveAllChainAutopilotReport(latestReport = null, latestCompletedReport = null) {
  if (
    latestReport?.status === "running" &&
    latestCompletedReport?.status === "error" &&
    observedMs(latestReport) > observedMs(latestCompletedReport)
  ) {
    return latestReport;
  }
  if (
    latestCompletedReport &&
    (latestReport?.status === "running" || isTransientLatestError(latestReport))
  ) {
    return latestCompletedReport;
  }
  return latestReport || latestCompletedReport || null;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function canaryLadderSummary(policy = SMALL_CAPITAL_CAMPAIGN_MODE.canaryGraduation) {
  const rungsUsd = Array.isArray(policy?.rungsUsd)
    ? policy.rungsUsd.map(Number).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  return {
    enabled: policy?.enabled === true,
    rungsUsd,
    maxAutoGraduatedUsd: Number.isFinite(policy?.maxAutoGraduatedUsd) ? Number(policy.maxAutoGraduatedUsd) : null,
    lossLockUsd: Number.isFinite(policy?.realizedDailyLossLockUsd) ? Number(policy.realizedDailyLossLockUsd) : null,
    failurePauseAt: Number.isFinite(policy?.maxSubstantiveFailures) ? Number(policy.maxSubstantiveFailures) : null,
    noTxSentNeutral: policy?.noTxSentIsNeutral === true,
  };
}

function refillNeedsLiveRemediation(item = {}) {
  return Boolean(item.reason) && !REFILL_MANUAL_DEFERRAL_REASONS.has(item.reason);
}

function refillReason(item = {}) {
  return (
    compactReason(item.executionBlockedReason) ||
    compactReason(item.previewBlockedReason) ||
    (compactReason(item.previewStatus) === "ready" ? null : compactReason(item.previewStatus)) ||
    (item.selectedExecutionMethod || item.executionMethod ? null : "refill_not_executed")
  );
}

function refillBlockers(refillExecutions = []) {
  return refillExecutions
    .filter((item) => !item.executed)
    .map((item) => ({
      chain: item.chain || null,
      asset: item.asset || null,
      reason: refillReason(item),
      selectedMethod: item.selectedExecutionMethod || item.executionMethod || null,
    }))
    .filter((item) => item.reason)
    .slice(0, 8);
}

function unwrapCapitalManagerRefillJobsLatest(payload = null) {
  if (!payload || typeof payload !== "object") return null;
  return payload.jobs && typeof payload.jobs === "object" ? payload.jobs : payload;
}

function countUnresolvedRefillExecutions(refillExecutions = [], { refillSource = null } = {}) {
  return refillExecutions
    .filter((item) => !item.executed)
    .filter((item) => !refillSource || item.refillSource === refillSource)
    .map((item) => ({
      reason: refillReason(item),
    }))
    .filter(refillNeedsLiveRemediation)
    .length;
}

export function resolveUnresolvedRefillCount({
  report = null,
  slice = null,
  capitalManagerRefillJobsLatest = null,
} = {}) {
  const baseUnresolved =
    finiteCount(slice?.refill?.unresolvedCount) ||
    countUnresolvedRefillExecutions(report?.refillExecutions || []);
  const capitalManagerLatest = unwrapCapitalManagerRefillJobsLatest(capitalManagerRefillJobsLatest);
  if (!report || !capitalManagerLatest) return baseUnresolved;
  const latestObservedAt = observedMs(capitalManagerLatest);
  if (!(latestObservedAt > observedMs(report))) return baseUnresolved;
  const staleCapitalManagerUnresolved = countUnresolvedRefillExecutions(report.refillExecutions || [], {
    refillSource: "capital_manager",
  });
  if (staleCapitalManagerUnresolved === 0) return baseUnresolved;
  const summary = capitalManagerLatest.summary || {};
  const jobCount = finiteCount(summary.jobCount);
  const manualReviewJobCount = finiteCount(summary.manualReviewJobCount);
  const autoQueuedJobCount = finiteCount(summary.autoQueuedJobCount);
  const capitalManagerFullyAutoQueued =
    jobCount > 0 &&
    manualReviewJobCount === 0 &&
    autoQueuedJobCount >= jobCount;
  if (!capitalManagerFullyAutoQueued) return baseUnresolved;
  return Math.max(0, baseUnresolved - staleCapitalManagerUnresolved);
}

function openedDeployments(deployments = []) {
  return deployments
    .filter((item) => item.status === "position_opened")
    .map((item) => ({
      opportunityId: item.opportunityId || null,
      status: item.status || null,
      txHash: item.txHash || null,
    }));
}

function buildTopBlockers({ report, refill, merklCanary, strategyDispatch, payback }) {
  const blockers = [];
  if (report?.blockedReason) {
    blockers.push({ source: "autopilot", reason: report.blockedReason });
  }
  for (const item of refill.slice(0, 3)) {
    blockers.push({
      source: "refill",
      reason: item.reason,
      chain: item.chain,
      asset: item.asset,
    });
  }
  if (merklCanary?.blockedReason) {
    blockers.push({ source: "merkl_canary", reason: merklCanary.blockedReason });
  }
  if (strategyDispatch?.liveEligibleCount === 0) {
    blockers.push({ source: "strategy_dispatch", reason: "no_live_eligible_strategy" });
  }
  if (payback?.reason && ["carry", "defer", "blocked"].includes(payback?.status)) {
    blockers.push({ source: "payback", reason: payback.reason });
  }
  return blockers.slice(0, 6);
}

function nextActionFor(slice) {
  if (!slice.present) return "run_all_chain_autopilot";
  if (slice.refill.unresolvedCount > 0) return "resolve_refill_routes";
  if (slice.payback.reason === "reserve_asset_missing") return "restore_payback_reserve";
  if (slice.portfolio.status === "positions_opened") return "monitor_live_positions";
  if (slice.payback.status === "carry") return "accrue_payback_until_minimum";
  if (slice.strategyDispatch.liveEligibleCount === 0) return "continue_shadow_dispatch";
  return "continue_live_watch";
}

export function buildAllChainAutopilotDashboardSlice(report = null) {
  if (!report) {
    const empty = {
      schemaVersion: 1,
      present: false,
      observedAt: null,
      mode: null,
      status: "missing",
      blockedReason: null,
      officialChainCount: 0,
      canary: {
        status: null,
        executedCount: 0,
        deliveredCount: 0,
        blockedCount: 0,
        chainsTouched: [],
      },
      canaryLadder: canaryLadderSummary(),
      refill: {
        jobCount: 0,
        autoJobCount: 0,
        attemptedCount: 0,
        executedCount: 0,
        blockedCount: 0,
        blockers: [],
      },
      portfolio: {
        status: null,
        openedCount: 0,
        deployments: [],
      },
      strategyDispatch: {
        batchStatus: null,
        selectedCount: 0,
        successCount: 0,
        failedCount: 0,
        liveEligibleCount: null,
        missingExecutorCount: null,
      },
      payback: {
        status: null,
        reason: null,
        plannedPaybackSats: null,
        pendingCarrySats: null,
        nextAction: null,
      },
      topBlockers: [],
      nextAction: "run_all_chain_autopilot",
    };
    return empty;
  }

  const summary = report.summary || {};
  const refill = refillBlockers(report.refillExecutions || []);
  const merklCanary = summary.merklCanary || {};
  const strategyDispatch = summary.strategyDispatch || {};
  const payback = summary.payback || {};
  const deployments = openedDeployments(summary.portfolio?.allocator?.deployments || []);
  const manualBacklogCount = Math.max(
    refill.filter((item) => REFILL_MANUAL_DEFERRAL_REASONS.has(item.reason)).length,
    finiteCount(report?.jobs?.summary?.manualReviewJobCount),
  );
  const slice = {
    schemaVersion: 1,
    present: true,
    observedAt: report.observedAt || null,
    mode: report.mode || null,
    status: report.status || null,
    blockedReason: report.blockedReason || null,
    officialChainCount: summary.officialChainCount ?? report.chains?.length ?? 0,
    canary: {
      status: summary.canarySweep?.status || null,
      executedCount: summary.canarySweep?.executedCount ?? 0,
      deliveredCount: summary.canarySweep?.deliveredCount ?? 0,
      blockedCount: summary.canarySweep?.blockedCount ?? 0,
      chainsTouched: unique(summary.canarySweep?.chainsTouched || []),
    },
    canaryLadder: canaryLadderSummary(),
    refill: {
      jobCount: summary.refillJobCount ?? 0,
      autoJobCount: summary.autoRefillJobCount ?? 0,
      attemptedCount: summary.refillAttemptedCount ?? 0,
      executedCount: summary.refillExecutedCount ?? 0,
      blockedCount: refill.length,
      unresolvedCount: refill.filter(refillNeedsLiveRemediation).length,
      manualBacklogCount,
      blockers: refill,
    },
    portfolio: {
      status: summary.portfolio?.status || null,
      openedCount: deployments.length,
      deployments,
    },
    strategyDispatch: {
      batchStatus: strategyDispatch.batchStatus || null,
      selectedCount: strategyDispatch.selectedCount ?? 0,
      successCount: strategyDispatch.successCount ?? 0,
      failedCount: strategyDispatch.failedCount ?? 0,
      liveEligibleCount: strategyDispatch.liveEligibleCount ?? null,
      missingExecutorCount: strategyDispatch.missingExecutorCount ?? null,
    },
    payback: {
      status: payback.status || null,
      reason: payback.reason || null,
      plannedPaybackSats: payback.plannedPaybackSats ?? null,
      pendingCarrySats: payback.pendingCarrySats ?? null,
      nextAction: payback.nextAction || null,
    },
    topBlockers: buildTopBlockers({ report, refill, merklCanary, strategyDispatch, payback }),
    nextAction: null,
  };
  slice.nextAction = nextActionFor(slice);
  return slice;
}
