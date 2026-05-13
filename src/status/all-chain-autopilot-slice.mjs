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
  "insufficient_native_balance_for_lifi_gas",
  "expected_net_below_receipt_cost_p90_floor",
  "strategy_per_day_cap_exceeded",
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
  if (latestCompletedReport && (latestReport?.status === "running" || isTransientLatestError(latestReport))) {
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

export function refillNeedsLiveRemediation(item = {}) {
  if (!item.reason) return false;
  const reasons = String(item.reason)
    .split(",")
    .map((reason) => reason.trim())
    .filter(Boolean);
  if (reasons.length === 0) return false;
  return reasons.some((reason) => !REFILL_MANUAL_DEFERRAL_REASONS.has(reason));
}

function refillReason(item = {}, policyBlockerByJobId = new Map()) {
  const policyBlocker = item.jobId ? policyBlockerByJobId.get(item.jobId) : null;
  return (
    policyBlocker ||
    compactReason(item.executionBlockedReason) ||
    compactReason(item.previewBlockedReason) ||
    (compactReason(item.previewStatus) === "ready" ? null : compactReason(item.previewStatus)) ||
    (item.selectedExecutionMethod || item.executionMethod ? null : "refill_not_executed")
  );
}

function signerPolicyBlockerMapFromSteps(steps = []) {
  const map = new Map();
  if (!Array.isArray(steps)) return map;
  for (const step of steps) {
    const match = String(step?.name || "").match(/^treasury_refill_execute:([^:]+)/u);
    const jobId = match?.[1] || step?.json?.outcomeEvent?.jobId || step?.json?.execution?.jobId || null;
    if (!jobId || map.has(jobId)) continue;
    const stepResults = step?.json?.execution?.stepResults;
    if (!Array.isArray(stepResults)) continue;
    for (const result of stepResults) {
      const signerResult = result?.signerResult || {};
      if (signerResult.status !== "rejected" && signerResult.policy?.decision !== "BLOCK") continue;
      const blockers = [
        ...(Array.isArray(signerResult.policy?.blockers) ? signerResult.policy.blockers : []),
        ...(Array.isArray(signerResult.lifecycle?.blockers) ? signerResult.lifecycle.blockers : []),
      ].filter(Boolean);
      if (blockers.length > 0) {
        map.set(jobId, blockers.join(","));
        break;
      }
    }
  }
  return map;
}

function refillBlockers(refillExecutions = [], { policyBlockerByJobId = new Map() } = {}) {
  return refillExecutions
    .filter((item) => !item.executed)
    .map((item) => ({
      jobId: item.jobId || null,
      strategyId: item.strategyId || null,
      chain: item.chain || null,
      asset: item.asset || null,
      targetAsset: item.targetAsset || item.asset || null,
      sourceChain: item.sourceChain || null,
      sourceAsset: item.sourceAsset || null,
      reason: refillReason(item, policyBlockerByJobId),
      selectedMethod: item.selectedExecutionMethod || item.executionMethod || null,
      executorFamily: item.executorFamily || null,
      routeFamily: item.routeFamily || null,
      taxonomy: item.blockerTaxonomy || null,
      scope: item.blockerScope || null,
      improvementType: item.improvementType || null,
      waitingHelps: item.waitingHelps === true,
      dryRunCommand: item.dryRunCommand || null,
      safeResetCommand: item.safeResetCommand || null,
      nextOperatorAction: item.nextOperatorAction || null,
      routeDeferralReason: item.routeDeferralReason || null,
      routeDeferralAction: item.routeDeferralAction || null,
    }))
    .filter((item) => item.reason)
    .slice(0, 8);
}

function refillScopeKey(item = {}) {
  const scope = item.scope || {};
  return [
    scope.scopeType || "job",
    scope.strategyId || item.strategyId || "*",
    scope.chain || item.chain || "*",
    scope.targetAsset || item.targetAsset || item.asset || "*",
    scope.sourceAsset || item.sourceAsset || "*",
    scope.selectedMethod || item.selectedMethod || "*",
    scope.executorFamily || item.executorFamily || "*",
    scope.routeFamily || item.routeFamily || "*",
  ].join("|");
}

function refillScopeSummary(refill = []) {
  const affectedScopes = [
    ...new Map(
      refill.map((item) => [
        refillScopeKey(item),
        {
          scopeType: item.scope?.scopeType || "job",
          strategyId: item.scope?.strategyId || item.strategyId || null,
          chain: item.scope?.chain || item.chain || null,
          targetAsset: item.scope?.targetAsset || item.targetAsset || item.asset || null,
          sourceAsset: item.scope?.sourceAsset || item.sourceAsset || null,
          selectedMethod: item.scope?.selectedMethod || item.selectedMethod || null,
          executorFamily: item.scope?.executorFamily || item.executorFamily || null,
          routeFamily: item.scope?.routeFamily || item.routeFamily || null,
          taxonomy: item.taxonomy || null,
          reason: item.reason || null,
        },
      ]),
    ).values(),
  ];
  return {
    affectedScopes,
    waitingHelps: refill.some((item) => item.waitingHelps),
    waitingHelpsCount: refill.filter((item) => item.waitingHelps).length,
    dryRunCommands: unique(refill.map((item) => item.dryRunCommand)).slice(0, 4),
    safeResetCommands: unique(refill.map((item) => item.safeResetCommand)).slice(0, 4),
    nextOperatorActions: unique(refill.map((item) => item.nextOperatorAction)).slice(0, 4),
  };
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
    .filter(refillNeedsLiveRemediation).length;
}

export function resolveUnresolvedRefillCount({
  report = null,
  slice = null,
  capitalManagerRefillJobsLatest = null,
} = {}) {
  const baseUnresolved =
    finiteCount(slice?.refill?.unresolvedCount) || countUnresolvedRefillExecutions(report?.refillExecutions || []);
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
  const capitalManagerFullyAutoQueued = jobCount > 0 && manualReviewJobCount === 0 && autoQueuedJobCount >= jobCount;
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

function executionAttemptSummary({
  report = null,
  summary = {},
  refill = [],
  merklCanary = {},
  strategyDispatch = {},
  payback = {},
} = {}) {
  const mode = report?.mode || null;
  const executeMode = mode === "execute" || mode === "dry_run_first";
  const refillAttemptedCount = finiteCount(summary.refillAttemptedCount);
  const refillExecutedCount = finiteCount(summary.refillExecutedCount);
  const canaryExecutedCount = finiteCount(summary.canarySweep?.executedCount);
  const canaryBroadcastStepCount = finiteCount(summary.canarySweep?.broadcastStepCount);
  const merklCanaryReadyCount = finiteCount(merklCanary.readyCount);
  const merklCanarySelectedCount = finiteCount(merklCanary.selectedCount);
  const strategySelectedCount = finiteCount(strategyDispatch.selectedCount);
  const strategyLiveEligibleCount = Number.isFinite(strategyDispatch.liveEligibleCount)
    ? Number(strategyDispatch.liveEligibleCount)
    : null;
  const txBroadcastCount = refillExecutedCount + canaryBroadcastStepCount;
  const attemptedLive =
    executeMode &&
    (refillAttemptedCount > 0 ||
      refillExecutedCount > 0 ||
      canaryExecutedCount > 0 ||
      canaryBroadcastStepCount > 0 ||
      merklCanaryReadyCount > 0 ||
      merklCanarySelectedCount > 0 ||
      strategySelectedCount > 0 ||
      strategyLiveEligibleCount === 0 ||
      payback.status === "carry" ||
      payback.status === "deferred" ||
      payback.status === "blocked");

  let noTxReason = null;
  if (attemptedLive && txBroadcastCount === 0) {
    if (refill.some(refillNeedsLiveRemediation)) {
      noTxReason = "refill_routes_unresolved";
    } else if (merklCanary?.blockedReason) {
      noTxReason = merklCanary.blockedReason;
    } else if (strategyLiveEligibleCount === 0) {
      noTxReason = "no_live_eligible_strategy";
    } else if (payback?.reason) {
      noTxReason = payback.reason;
    } else if (report?.blockedReason) {
      noTxReason = report.blockedReason;
    } else {
      noTxReason = "policy_no_tx";
    }
  }

  return {
    mode,
    runId: report?.autopilotRunId || null,
    attemptedLive,
    completed:
      report?.phase === "completed" || report?.status === "completed" || report?.status === "completed_with_blockers",
    txBroadcastCount,
    refillAttemptedCount,
    refillExecutedCount,
    canaryExecutedCount,
    canaryBroadcastStepCount,
    merklCanaryReadyCount,
    merklCanarySelectedCount,
    merklCanaryBlockedReason: merklCanary?.blockedReason || null,
    strategySelectedCount,
    strategyLiveEligibleCount,
    paybackStatus: payback.status || null,
    paybackReason: payback.reason || null,
    noTxReason,
    readOnlyDashboard: true,
  };
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
  const merklCanaryHasLiveAttempt =
    finiteCount(merklCanary?.readyCount) > 0 ||
    finiteCount(merklCanary?.selectedCount) > 0 ||
    Boolean(merklCanary?.blockedReason);
  if (strategyDispatch?.liveEligibleCount === 0 && !merklCanaryHasLiveAttempt) {
    blockers.push({ source: "strategy_dispatch", reason: "no_live_eligible_strategy" });
  }
  if (payback?.reason && ["carry", "defer", "blocked"].includes(payback?.status)) {
    blockers.push({ source: "payback", reason: payback.reason });
  }
  return blockers.slice(0, 6);
}

function nextActionFor(slice) {
  if (!slice.present) return "run_all_chain_autopilot";
  if (slice.activeRun) return "await_all_chain_autopilot_completion";
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
      phase: null,
      status: "missing",
      activeRun: false,
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
        affectedScopes: [],
        unaffectedJobCount: 0,
        waitingHelps: false,
        waitingHelpsCount: 0,
        dryRunCommands: [],
        safeResetCommands: [],
        nextOperatorActions: [],
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
      execution: executionAttemptSummary(),
      topBlockers: [],
      nextAction: "run_all_chain_autopilot",
    };
    return empty;
  }

  const summary = report.summary || {};
  const refill = refillBlockers(report.refillExecutions || [], {
    policyBlockerByJobId: signerPolicyBlockerMapFromSteps(report.steps || []),
  });
  const refillScopes = refillScopeSummary(refill);
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
    phase: report.phase || null,
    status: report.status || null,
    activeRun: report.status === "running",
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
      affectedScopes: refillScopes.affectedScopes,
      unaffectedJobCount: Math.max(0, finiteCount(summary.refillJobCount) - refill.length),
      waitingHelps: refillScopes.waitingHelps,
      waitingHelpsCount: refillScopes.waitingHelpsCount,
      dryRunCommands: refillScopes.dryRunCommands,
      safeResetCommands: refillScopes.safeResetCommands,
      nextOperatorActions: refillScopes.nextOperatorActions,
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
    execution: executionAttemptSummary({ report, summary, refill, merklCanary, strategyDispatch, payback }),
    topBlockers: buildTopBlockers({ report, refill, merklCanary, strategyDispatch, payback }),
    nextAction: null,
  };
  slice.nextAction = nextActionFor(slice);
  return slice;
}
