function compactReason(reason) {
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function refillBlockers(refillExecutions = []) {
  return refillExecutions
    .filter((item) => !item.executed)
    .map((item) => ({
      chain: item.chain || null,
      asset: item.asset || null,
      reason:
        compactReason(item.executionBlockedReason) ||
        compactReason(item.previewBlockedReason) ||
        compactReason(item.previewStatus) ||
        "refill_not_executed",
      selectedMethod: item.selectedExecutionMethod || item.executionMethod || null,
    }))
    .filter((item) => item.reason)
    .slice(0, 8);
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
  if (slice.refill.blockedCount > 0) return "resolve_refill_routes";
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
    refill: {
      jobCount: summary.refillJobCount ?? 0,
      autoJobCount: summary.autoRefillJobCount ?? 0,
      attemptedCount: summary.refillAttemptedCount ?? 0,
      executedCount: summary.refillExecutedCount ?? 0,
      blockedCount: refill.length,
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
