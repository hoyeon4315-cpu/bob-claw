function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function countBy(items = [], selector) {
  return (items || []).reduce((counts, item) => {
    const key = selector(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function laneMap(laneReclassification = null) {
  return new Map((laneReclassification?.lanes || []).map((lane) => [lane.id, lane]));
}

function scaffoldMap(secondaryStrategyScaffolds = null) {
  return new Map((secondaryStrategyScaffolds?.scaffolds || []).map((item) => [item.id, item]));
}

function trustTierBlockers(protocolTrustTiers = null, targetIds = [], { resolveTrustTierDecision } = {}) {
  if (!resolveTrustTierDecision) return targetIds.length ? ["protocol_trust_tier_not_recorded"] : [];
  const decision = resolveTrustTierDecision(protocolTrustTiers, targetIds);
  if (decision.forbiddenTargets.length > 0) return ["protocol_tier_forbidden"];
  if (decision.recorded) return [];
  return ["protocol_trust_tier_not_recorded"];
}

function searchBudgetState(searchComplexityBudgets = null, id = null, { resolveSearchComplexityBudget } = {}) {
  if (!resolveSearchComplexityBudget) {
    return {
      status: "budget_unverified",
      blockers: ["search_complexity_budget_not_recorded"],
    };
  }
  const budget = resolveSearchComplexityBudget(searchComplexityBudgets, id);
  if (budget?.status === "recorded") {
    return {
      status: "budget_recorded",
      blockers: [],
    };
  }
  return {
    status: "budget_unverified",
    blockers: ["search_complexity_budget_not_recorded"],
  };
}

function oosState(wrappedBtcLoopOosEvidence = null, dryRunRecorded = false) {
  if (wrappedBtcLoopOosEvidence?.summary?.signerWindowReady) {
    return {
      oosSplitStatus: "signer_backed_window_recorded",
      blockers: [],
    };
  }
  if (wrappedBtcLoopOosEvidence?.summary?.simulatedWindowReady) {
    return {
      oosSplitStatus: "simulated_oos_window_recorded",
      blockers: ["signer_backed_oos_receipts_missing"],
    };
  }
  return {
    oosSplitStatus: dryRunRecorded ? "pending_real_oos_receipts" : "missing_oos_receipts",
    blockers: [dryRunRecorded ? "oos_receipt_window_below_policy" : "dry_run_receipt_missing"],
  };
}

function baseEntry({
  id,
  label,
  oosSplitStatus,
  searchComplexityStatus,
  shockTestStatus,
  trustTierStatus,
  blockers = [],
  evidence = null,
  nextAction = null,
}) {
  const overallStatus = blockers.length ? "blocked" : "passed";
  return {
    id,
    label,
    overallStatus,
    oosSplitStatus,
    searchComplexityStatus,
    shockTestStatus,
    trustTierStatus,
    blockers: unique(blockers),
    evidence,
    nextAction,
  };
}

function wrappedLoopValidation({
  wrappedBtcLendingLoopSlice = null,
  wrappedBtcLoopDryRun = null,
  wrappedBtcLoopOosEvidence = null,
  protocolTrustTiers = null,
  resolveTrustTierDecision = null,
} = {}) {
  const dryRunRecorded = wrappedBtcLoopDryRun?.dryRunReceiptRecorded === true;
  const oos = oosState(wrappedBtcLoopOosEvidence, dryRunRecorded);
  const trustBlockers = trustTierBlockers(
    protocolTrustTiers,
    [wrappedBtcLendingLoopSlice?.strategy?.protocol].filter(Boolean),
    { resolveTrustTierDecision },
  );
  return baseEntry({
    id: "wrapped_btc_loop_validation",
    label: "Wrapped-BTC loop validation",
    oosSplitStatus: oos.oosSplitStatus,
    searchComplexityStatus: "bounded_design_surface",
    shockTestStatus: dryRunRecorded ? "simulated_pass" : "not_run",
    trustTierStatus: "protocol_review_required",
    blockers: [
      ...oos.blockers,
      ...trustBlockers,
    ],
    evidence: {
      strategyId: wrappedBtcLendingLoopSlice?.strategy?.id || null,
      protocol: wrappedBtcLendingLoopSlice?.strategy?.protocol || null,
          dryRunReceiptRecorded: dryRunRecorded,
          autoUnwindPassCount: wrappedBtcLoopDryRun?.autoUnwindPassCount ?? 0,
          oosEvidenceStatus: wrappedBtcLoopOosEvidence?.summary?.status || null,
    },
    nextAction: {
      code: "collect_wrapped_btc_loop_oos_receipts",
      command: "npm run ingest:wrapped-btc-loop-receipt -- --write",
    },
  });
}

function stableLoopValidation({
  lane = null,
  scaffold = null,
  protocolTrustTiers = null,
  resolveTrustTierDecision = null,
  searchComplexityBudgets = null,
  resolveSearchComplexityBudget = null,
} = {}) {
  const trustBlockers = trustTierBlockers(protocolTrustTiers, scaffold?.protocolTrack?.protocols || [], { resolveTrustTierDecision });
  const searchBudget = searchBudgetState(searchComplexityBudgets, "stablecoin_spread_loop_validation", { resolveSearchComplexityBudget });
  return baseEntry({
    id: "stablecoin_spread_loop_validation",
    label: "Stablecoin spread loop validation",
    oosSplitStatus: lane?.passesOverfitGate === true ? "pending_oos_window_check" : "blocked_by_overfit",
    searchComplexityStatus: searchBudget.status,
    shockTestStatus: lane?.clearsNewFloor === true ? "not_run" : "blocked_before_shock_test",
    trustTierStatus: "protocol_review_required",
    blockers: [
      lane?.passesOverfitGate === true ? null : "overfit_gate_blocked",
      lane?.clearsNewFloor === true ? null : "positive_ev_outside_variance_missing",
      ...searchBudget.blockers,
      ...trustBlockers,
    ],
    evidence: lane
      ? {
          laneId: lane.id,
          statusNew: lane.statusNew,
          netPnlMeasuredUsd: lane.netPnlMeasuredUsd ?? null,
          gasSlippageVarianceUsd: lane.gasSlippageVarianceUsd ?? null,
        }
      : null,
    nextAction: {
      code: "run_stable_loop_oos_validation",
      command: "npm run audit:overfit -- --write && npm run report:lane-reclassification -- --write",
    },
  });
}

function proxySpreadValidation({ lane = null, searchComplexityBudgets = null, resolveSearchComplexityBudget = null } = {}) {
  const searchBudget = searchBudgetState(searchComplexityBudgets, "proxy_spread_expansion_validation", { resolveSearchComplexityBudget });
  return baseEntry({
    id: "proxy_spread_expansion_validation",
    label: "Proxy spread expansion validation",
    oosSplitStatus: lane?.passesOverfitGate === true ? "pending_oos_window_check" : "blocked_by_overfit",
    searchComplexityStatus: searchBudget.status,
    shockTestStatus: lane?.clearsNewFloor === true ? "not_run" : "blocked_before_shock_test",
    trustTierStatus: "market_structure_review_required",
    blockers: [
      lane?.passesOverfitGate === true ? null : "overfit_gate_blocked",
      ...searchBudget.blockers,
      "receipt_backed_cross_wrapper_samples_missing",
    ],
    evidence: lane
      ? {
          laneId: lane.id,
          statusNew: lane.statusNew,
          netPnlMeasuredUsd: lane.netPnlMeasuredUsd ?? null,
        }
      : null,
    nextAction: {
      code: "expand_proxy_receipt_coverage",
      command: "npm run report:btc-proxy-spreads",
    },
  });
}

function secondaryScaffoldValidation(scaffolds = []) {
  return scaffolds.map((item) =>
    baseEntry({
      id: `${item.id}_validation`,
      label: `${item.label} validation`,
      oosSplitStatus: "no_measurement_window",
      searchComplexityStatus: "not_started",
      shockTestStatus: "not_run",
      trustTierStatus: "protocol_review_required",
      blockers: ["design_scaffold_only", ...(item.blockers || [])],
      evidence: {
        scaffoldId: item.id,
        status: item.status,
        leverage: item.leverage,
      },
      nextAction: item.nextAction || null,
    }),
  );
}

export function buildPhase3StrategyValidation({
  laneReclassification = null,
  wrappedBtcLendingLoopSlice = null,
  wrappedBtcLoopDryRun = null,
  wrappedBtcLoopOosEvidence = null,
  secondaryStrategyScaffolds = null,
  protocolTrustTiers = null,
  resolveTrustTierDecision = null,
  searchComplexityBudgets = null,
  resolveSearchComplexityBudget = null,
  now = null,
} = {}) {
  const lanes = laneMap(laneReclassification);
  const scaffolds = scaffoldMap(secondaryStrategyScaffolds);
  const validations = [
    wrappedLoopValidation({
      wrappedBtcLendingLoopSlice,
      wrappedBtcLoopDryRun,
      wrappedBtcLoopOosEvidence,
      protocolTrustTiers,
      resolveTrustTierDecision,
    }),
    stableLoopValidation({
      lane: lanes.get("stablecoin_entry_exit_loops") || null,
      scaffold: scaffolds.get("stablecoin_spread_loop") || null,
      protocolTrustTiers,
      resolveTrustTierDecision,
      searchComplexityBudgets,
      resolveSearchComplexityBudget,
    }),
    proxySpreadValidation({
      lane: lanes.get("btc_proxy_spreads") || null,
      searchComplexityBudgets,
      resolveSearchComplexityBudget,
    }),
    ...secondaryScaffoldValidation((secondaryStrategyScaffolds?.scaffolds || []).filter((item) => !["stablecoin_spread_loop", "proxy_spread_expansion"].includes(item.id))),
  ];
  const topValidation = validations.find((item) => item.overallStatus !== "passed") || validations[0] || null;
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      validationCount: validations.length,
      statusCounts: countBy(validations, (item) => item.overallStatus || "unknown"),
      passedCount: validations.filter((item) => item.overallStatus === "passed").length,
      topBlockedId: topValidation?.id || null,
      nextAction: topValidation?.nextAction || null,
    },
    validations,
  };
}

export function summarizePhase3StrategyValidation(report = null) {
  if (!report) return null;
  const topBlocked =
    report.validations?.find((item) => item.id === report.summary?.topBlockedId) ||
    report.validations?.find((item) => item.overallStatus !== "passed") ||
    null;
  return {
    validationCount: report.summary?.validationCount ?? 0,
    statusCounts: report.summary?.statusCounts || {},
    passedCount: report.summary?.passedCount ?? 0,
    topBlocked: topBlocked
      ? {
          id: topBlocked.id || null,
          label: topBlocked.label || null,
          overallStatus: topBlocked.overallStatus || null,
        }
      : null,
    nextAction: report.summary?.nextAction || null,
  };
}
