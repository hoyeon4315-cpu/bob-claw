function finiteNumber(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readPath(target, path) {
  if (!target || typeof target !== "object") return undefined;
  return path.split(".").reduce((value, segment) => (value == null ? undefined : value[segment]), target);
}

function firstPresent(target, paths = []) {
  for (const path of paths) {
    const value = readPath(target, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function firstFinite(target, paths = []) {
  for (const path of paths) {
    const value = finiteNumber(readPath(target, path));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function normalizePaybackSlice(paybackStatus = null) {
  return paybackStatus?.payback || paybackStatus || {};
}

function minimumProgress(payback = null) {
  return payback?.scheduler?.minimumPaybackProgress || payback?.scheduler?.previewAfterDestination || null;
}

function topEvGate({ merklCanaryReport = null, allChainReport = null } = {}) {
  return (
    merklCanaryReport?.summary?.topEvGate ||
    allChainReport?.summary?.merklCanary?.topEvGate ||
    allChainReport?.steps?.merkl_canary_autopilot?.json?.summary?.topEvGate ||
    null
  );
}

function topCanaryBlocker({ merklCanaryReport = null, allChainReport = null } = {}) {
  return (
    merklCanaryReport?.summary?.topBlocker ||
    merklCanaryReport?.blockedReason ||
    allChainReport?.summary?.merklCanary?.topBlocker ||
    allChainReport?.summary?.merklCanary?.blockedReason ||
    null
  );
}

function proofRequiredItems(report = null) {
  const direct = report?.idleCapitalReport?.proofRequired;
  if (Array.isArray(direct)) return direct;
  const fromPlan = report?.plan?.allocator?.idleCapitalReport?.proofRequired;
  if (Array.isArray(fromPlan)) return fromPlan;
  const fromSummary = report?.summary?.idleCapitalReport?.proofRequired;
  return Array.isArray(fromSummary) ? fromSummary : [];
}

function countByReason(items = [], selector = (item) => item) {
  const counts = {};
  for (const item of items) {
    const reason = selector(item);
    if (typeof reason === "string" && reason.length > 0) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function cleanRefillPreview(item = {}) {
  if (!item) return true;
  if (item.previewStatus === "ready") return true;
  if (
    item.previewStatus === "deferred" &&
    item.previewBlockedReason === "routing_exhausted" &&
    item.routeDeferralReason &&
    item.routeDeferralAction
  ) {
    return true;
  }
  return !item.previewBlockedReason;
}

function dryRunFirstLikelyAllowed(allChainReport = null) {
  if (!allChainReport) return null;
  if (allChainReport.status === "completed") return true;
  if (allChainReport.status !== "completed_with_blockers") return false;
  if (allChainReport.blockedReason) return false;
  const summary = allChainReport.summary || {};
  if (summary.autoKill?.triggered === true || summary.autoKill?.killSwitchActive === true || summary.autoKill?.alreadyArmed === true) {
    return false;
  }
  const executionGate = summary.executionGate || {};
  if (executionGate.autoKillTriggered === true || executionGate.killSwitchActive === true || executionGate.killSwitchAlreadyArmed === true) {
    return false;
  }
  if (executionGate.blockedReason && executionGate.blockedReason !== "preview_only") return false;
  return (allChainReport.refillExecutions || []).every(cleanRefillPreview);
}

function normalizeCurrent({ paybackStatus = null } = {}) {
  const payback = normalizePaybackSlice(paybackStatus);
  const minimum = minimumProgress(payback);
  const preMinimumPreview =
    payback?.scheduler?.preMinimumCompositePreview ||
    payback?.carry?.costPreview ||
    paybackStatus?.preMinimumCompositePreview ||
    null;
  const quoteProofMatrix =
    payback?.scheduler?.quoteProofMatrix ||
    paybackStatus?.quoteProofMatrix ||
    null;
  return {
    schedulerStatus: payback?.scheduler?.status || paybackStatus?.decision?.status || null,
    schedulerReason: payback?.scheduler?.reason || paybackStatus?.decision?.reason || null,
    grossProfitSatsPeriod:
      firstFinite(payback, ["grossProfitSatsPeriod"]) ??
      firstFinite(paybackStatus, ["decision.snapshot.grossProfitSats_period"]),
    accumulatorPendingSats: firstFinite(payback, ["accumulatorPendingSats"]),
    paidBackSatsLifetime: firstFinite(payback, ["paidBackSatsLifetime"]),
    grossTargetBeforeCostsSats: firstFinite(minimum, ["grossTargetBeforeCostsSats"]),
    minPaybackSats: firstFinite(minimum, ["minPaybackSats"]),
    requiredGrossProfitSats: firstFinite(minimum, ["requiredGrossProfitSats"]),
    satsToMinimumPayback: firstFinite(minimum, ["satsToMinimumPayback"]),
    progressToMinimumRatio: firstFinite(minimum, ["progressToMinimumRatio"]),
    compositePreviewStatus: paybackStatus?.compositePreview?.status || null,
    compositePreviewReason: paybackStatus?.compositePreview?.reason || null,
    plannedPaybackSats: firstFinite(paybackStatus, ["compositePreview.plannedPaybackSats"]),
    estimatedOfframpCostSats: firstFinite(paybackStatus, ["compositePreview.estimatedOfframpCostSats"]),
    preMinimumCompositePreviewStatus: preMinimumPreview?.status || null,
    preMinimumCompositePreviewReason: preMinimumPreview?.reason || null,
    preMinimumExecutionEligible: preMinimumPreview?.executionEligible === true,
    preMinimumIntentEligible: preMinimumPreview?.intentEligible === true,
    preMinimumPreviewInputSats: firstFinite(preMinimumPreview, ["previewInputSats"]),
    preMinimumEstimatedOfframpCostSats: firstFinite(preMinimumPreview, ["estimatedOfframpCostSats"]),
    preMinimumEstimatedNetPaybackSats: firstFinite(preMinimumPreview, ["estimatedNetPaybackSats", "plannedPaybackSats"]),
    preMinimumSatsToMinimumAfterCosts: firstFinite(preMinimumPreview, ["satsToMinimumAfterCosts"]),
    quoteProofMatrixStatusCounts: quoteProofMatrix?.statusCounts || null,
    quoteProofMatrixRows: Array.isArray(quoteProofMatrix?.rows) ? quoteProofMatrix.rows.length : null,
    quoteProofMatrixReadOnly: quoteProofMatrix?.readOnly === true,
    lastPaybackSettledSats: firstFinite(payback, ["lastPaybackSettledSats"]),
    lastPaybackSettledAt: payback?.lastPaybackSettledAt || null,
  };
}

function normalizeProfitCreation({ merklAllocatorReport = null, merklCanaryReport = null, allChainReport = null } = {}) {
  const evGate = topEvGate({ merklCanaryReport, allChainReport });
  const proofRequired = proofRequiredItems(merklAllocatorReport);
  const refillPreviewBlockerCounts = countByReason(
    allChainReport?.refillExecutions || [],
    (item) => item?.previewBlockedReason,
  );
  return {
    merklCanaryStatus: merklCanaryReport?.status || allChainReport?.summary?.merklCanary?.status || null,
    merklCanaryBlockedReason: merklCanaryReport?.blockedReason || allChainReport?.summary?.merklCanary?.blockedReason || null,
    merklCanaryTopBlocker: topCanaryBlocker({ merklCanaryReport, allChainReport }),
    merklCanaryTopEvGate: evGate
      ? {
          status: evGate.status || null,
          blocker: evGate.blocker || null,
          currentAmountUsd: finiteNumber(evGate.currentAmountUsd),
          neededUsd: finiteNumber(evGate.neededUsd),
          holdDays: finiteNumber(evGate.holdDays),
          limitingFactor: evGate.limitingFactor || null,
        }
      : null,
    allocatorStatus: merklAllocatorReport?.status || null,
    allocatorBlockedReason: merklAllocatorReport?.blockedReason || null,
    proofRequiredCount: proofRequired.length,
    firstProofRequired: proofRequired[0] || null,
    allChainStatus: allChainReport?.status || null,
    allChainBlockedReason: allChainReport?.blockedReason || null,
    allChainExecutionGateBlockedReason: allChainReport?.summary?.executionGate?.blockedReason || null,
    allChainDryRunFirstLikelyAllowed: dryRunFirstLikelyAllowed(allChainReport),
    refillPreviewBlockerCounts,
    capitalManagerCapitalPlanDecision: allChainReport?.summary?.capitalManager?.capitalPlanDecision || null,
    capitalManagerRefillJobCount: finiteNumber(allChainReport?.summary?.capitalManager?.refillJobCount),
    capitalManagerAutoRefillJobCount: finiteNumber(allChainReport?.summary?.capitalManager?.autoRefillJobCount),
  };
}

function deliveryPath() {
  return [
    {
      id: "realized_profit",
      owner: "merkl_canary_or_portfolio_exit",
      requirement: "Create payback-eligible realized net PnL with receipt-backed entry and exit/unwind.",
    },
    {
      id: "accumulator_minimum",
      owner: "payback_accumulator",
      requirement: "Book enough gross profit sats for the configured payback ratio to clear minPaybackSats.",
    },
    {
      id: "reserve_asset",
      owner: "capital_manager",
      requirement: "Hold profit-reserve WBTC route-side inventory on the configured reserve chain.",
    },
    {
      id: "composite_plan",
      owner: "payback_scheduler",
      requirement: "Build swap/consolidation/offramp plan with estimated costs below policy limits.",
    },
    {
      id: "policy_signer",
      owner: "policy_engine_and_signer",
      requirement: "Submit every intent through policy, signer, kill-switch, and audit append-only paths.",
    },
    {
      id: "bitcoin_l1_delivery_proof",
      owner: "receipt_ingestor",
      requirement: "Record source tx, Gateway order id, and matching Bitcoin L1 txid/balance delta.",
    },
  ];
}

function statusFrom({ current, profitCreation, paybackStatus = null } = {}) {
  if (Number.isFinite(current.lastPaybackSettledSats) && current.lastPaybackSettledSats > 0) {
    return "payback_delivered";
  }
  if (paybackStatus?.compositePreview?.status === "ready") return "payback_delivery_ready";
  if (current.schedulerStatus === "blocked") return "payback_blocked";
  if (current.schedulerStatus === "defer" || current.schedulerStatus === "deferred") return "payback_deferred";
  if (
    current.schedulerStatus === "carry" &&
    (current.schedulerReason === "planned_payback_below_minimum" ||
      current.schedulerReason === "non_positive_payback_target")
  ) {
    return "profit_creation_required";
  }
  if (profitCreation.merklCanaryTopEvGate?.status === "blocked") return "canary_ev_floor_blocked";
  if (current.schedulerStatus === "plan") return "payback_planning_required";
  return "blocked";
}

function blockersFor({ status, current, profitCreation, paybackStatus = null } = {}) {
  const blockers = [];
  if (current.schedulerReason) {
    blockers.push({
      source: "payback_scheduler",
      code: current.schedulerReason,
      severity: status === "profit_creation_required" ? "blocking" : "review",
    });
  }
  if (paybackStatus?.compositePreview?.status && paybackStatus.compositePreview.status !== "ready") {
    blockers.push({
      source: "payback_composite_preview",
      code: paybackStatus.compositePreview.reason || paybackStatus.compositePreview.status,
      severity: "blocking",
    });
  }
  if (profitCreation.merklCanaryTopEvGate?.blocker) {
    blockers.push({
      source: "merkl_canary_ev_gate",
      code: profitCreation.merklCanaryTopEvGate.blocker,
      severity: "blocking",
      currentAmountUsd: profitCreation.merklCanaryTopEvGate.currentAmountUsd,
      neededUsd: profitCreation.merklCanaryTopEvGate.neededUsd,
      limitingFactor: profitCreation.merklCanaryTopEvGate.limitingFactor,
    });
  } else if (profitCreation.merklCanaryTopBlocker) {
    blockers.push({
      source: "merkl_canary",
      code: profitCreation.merklCanaryTopBlocker,
      severity: "review",
    });
  }
  if (profitCreation.allocatorBlockedReason) {
    blockers.push({
      source: "merkl_portfolio_allocator",
      code: profitCreation.allocatorBlockedReason,
      severity: "review",
    });
  }
  for (const [reason, count] of Object.entries(profitCreation.refillPreviewBlockerCounts || {})) {
    blockers.push({
      source: "all_chain_dry_run_first",
      code: `refill_preview_blocked:${reason}`,
      severity: "blocking",
      count,
    });
  }
  return blockers;
}

function nextActionsFor({ status, current, profitCreation, paybackStatus = null } = {}) {
  if (status === "payback_delivery_ready") {
    return [
      {
        code: "run_payback_scheduler_execute",
        command: "npm run executor:payback-scheduler:once -- --execute --json --write",
        safety: "policy_signer_kill_switch_required",
      },
    ];
  }
  if (current.schedulerReason === "missing_destination_config") {
    return [
      {
        code: "set_payback_btc_destination_env",
        env: firstPresent(paybackStatus, ["policy.bitcoinDestAddressEnv"]) || "PAYBACK_BTC_DEST_ADDR",
        safety: "configuration_required_before_planning",
      },
    ];
  }
  if (current.schedulerReason === "reserve_asset_missing") {
    return [
      {
        code: "restore_profit_reserve_wbtc_oft",
        command: "npm run executor:all-chain-autopilot -- --json --write",
        safety: "capital_manager_policy_signer_path",
      },
    ];
  }
  const actions = [];
  if (status === "profit_creation_required" || current.schedulerReason === "planned_payback_below_minimum") {
    actions.push({
      code: "create_payback_eligible_realized_pnl",
      command: "npm run executor:all-chain-autopilot -- --json --write",
      safety: "live_canary_and_portfolio_caps_only",
      remainingSatsToMinimum: current.satsToMinimumPayback,
      requiredGrossProfitSats: current.requiredGrossProfitSats,
    });
  }
  if (Object.keys(profitCreation.refillPreviewBlockerCounts || {}).length > 0) {
    actions.push({
      code: "review_refill_failure_lock_before_live_execute",
      command: "npm run executor:all-chain-autopilot -- --dry-run-first --execute --json --write",
      safety: "dry_run_first_skips_live_execution_until_refill_preview_is_clean",
      blockers: profitCreation.refillPreviewBlockerCounts,
    });
  }
  if (profitCreation.merklCanaryTopEvGate?.status === "blocked") {
    actions.push({
      code: "satisfy_top_canary_ev_floor",
      blocker: profitCreation.merklCanaryTopEvGate.blocker,
      currentAmountUsd: profitCreation.merklCanaryTopEvGate.currentAmountUsd,
      neededUsd: profitCreation.merklCanaryTopEvGate.neededUsd,
      limitingFactor: profitCreation.merklCanaryTopEvGate.limitingFactor,
      safety: "capital_manager_refill_only_no_cap_raise",
    });
  }
  if (actions.length === 0) {
    actions.push({
      code: "rerun_payback_status_preview",
      command: "npm run report:payback-status -- --json",
      safety: "read_only",
    });
  }
  actions.push({
    code: "harvest_exit_and_ingest_receipts_before_payback",
    command: "npm run executor:merkl-portfolio-exit -- --json --write",
    safety: "policy_signer_receipt_required",
  });
  actions.push({
    code: "rerun_payback_status_after_realization",
    command: "npm run report:payback-status -- --json",
    safety: "read_only",
  });
  return actions;
}

export function buildPaybackDeliveryRunway({
  paybackStatus = null,
  merklAllocatorReport = null,
  merklCanaryReport = null,
  allChainReport = null,
  now = new Date().toISOString(),
} = {}) {
  const current = normalizeCurrent({ paybackStatus });
  const profitCreation = normalizeProfitCreation({ merklAllocatorReport, merklCanaryReport, allChainReport });
  const status = statusFrom({ current, profitCreation, paybackStatus });
  const blockers = blockersFor({ status, current, profitCreation, paybackStatus });
  const nextActions = nextActionsFor({ status, current, profitCreation, paybackStatus });
  return Object.freeze({
    schemaVersion: 1,
    observedAt: now,
    finalGoal: "native_btc_payback_delivery",
    status,
    current: Object.freeze(current),
    profitCreation: Object.freeze(profitCreation),
    deliveryPath: Object.freeze(deliveryPath().map(Object.freeze)),
    blockers: Object.freeze(blockers.map(Object.freeze)),
    nextActions: Object.freeze(nextActions.map(Object.freeze)),
  });
}

export default buildPaybackDeliveryRunway;
