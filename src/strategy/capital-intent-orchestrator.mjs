const SAFETY = Object.freeze({
  reportOnly: true,
  canLive: false,
  runtimeAuthority: "none",
  allowedToExecuteLive: false,
  liveExecutionAuthority: "none",
  signerCalled: false,
  runtimeStateMutated: false,
  autoExecuteChanged: false,
  policyRelaxed: false,
  capRelaxed: false,
  evCostRelaxed: false,
});

const HARD_BLOCKER_VERDICTS = Object.freeze({
  duplicate_open_intent: "blocked_duplicate_open_intent",
  duplicate_guard_active: "blocked_duplicate_open_intent",
  cooldown_active: "blocked_cooldown_active",
  kill_switch_present: "blocked_kill_switch_present",
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringAmount(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    return String(value);
  }
  return null;
}

function bigintOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function subtractToString(left, right) {
  const leftBig = bigintOrNull(left);
  const rightBig = bigintOrNull(right);
  if (leftBig === null || rightBig === null) return null;
  const diff = leftBig - rightBig;
  return diff > 0n ? diff.toString() : "0";
}

function provenance(source, amount, extra = {}) {
  return {
    source: source || null,
    observedAt: extra.observedAt || extra.generatedAt || null,
    generatedAt: extra.generatedAt || null,
    amount,
    chain: extra.chain || null,
    lane: extra.lane || null,
    failureReason: extra.failureReason || null,
  };
}

function selectedRoute(candidate = {}) {
  return (
    array(candidate.routeSourceRanking).find((entry) => entry?.selected) || array(candidate.routeSourceRanking)[0] || {}
  );
}

function routeMinimum(candidate = {}, route = {}) {
  const quote = candidate.routeQuoteRef || {};
  return stringAmount(
    candidate.amountSweep?.routeMinimumAmountSats,
    route.minRouteAmountSats,
    candidate.minRouteAmountSats,
    quote.quoteAmountFloor?.minimum,
    candidate.minimumAmount,
  );
}

function quotedAmount(candidate = {}, route = {}) {
  const quote = candidate.routeQuoteRef || {};
  return stringAmount(
    candidate.amountSweep?.quotedAmountSats,
    route.quotedAmountSats,
    quote.amount,
    candidate.quotedAmountSats,
    candidate.amount,
  );
}

function safeAllocatable(candidate = {}, route = {}) {
  return stringAmount(
    candidate.amountSweep?.safeAllocatableAmountSats,
    route.safeAllocatableAmountSats,
    candidate.safeAllocatableAmountSats,
  );
}

function missingAmount(candidate = {}, route = {}) {
  const explicit = stringAmount(candidate.amountSweep?.missingSats, route.missingSats, candidate.missingSats);
  if (explicit) return explicit;
  return (
    subtractToString(
      quotedAmount(candidate, route) || routeMinimum(candidate, route),
      safeAllocatable(candidate, route),
    ) || "0"
  );
}

function sourceTruthStatus(candidate = {}) {
  return candidate.sourceTruthStatus || candidate.sourceActionItem?.sourceTruthStatus || candidate.status || null;
}

function routeMinimumField(candidate = {}, route = {}) {
  const quote = candidate.routeQuoteRef || {};
  return provenance(quote.producer || quote.source || "route_quote_producer", routeMinimum(candidate, route), {
    observedAt: quote.observedAt,
    generatedAt: quote.generatedAt,
    chain: candidate.destinationChain,
    lane: candidate.lane,
    failureReason: quote.failureReason || candidate.economicBlocker || null,
  });
}

function quoteAmountField(candidate = {}, route = {}) {
  const quote = candidate.routeQuoteRef || {};
  return provenance(
    quote.producer || quote.source || route.quoteProvenance || "route_quote_producer",
    quotedAmount(candidate, route),
    {
      observedAt: quote.observedAt,
      generatedAt: quote.generatedAt,
      chain: candidate.destinationChain,
      lane: candidate.lane,
      failureReason: route.blocker || candidate.economicBlocker || null,
    },
  );
}

function safeAllocatableField(candidate = {}, route = {}) {
  return provenance("src/strategy/remediation-lane-intent-candidate.mjs", safeAllocatable(candidate, route), {
    chain: candidate.sourceChain,
    lane: candidate.lane,
    failureReason: candidate.sizingBlocker || null,
  });
}

function missingAmountField(candidate = {}, route = {}) {
  return provenance("src/strategy/capital-intent-orchestrator.mjs", missingAmount(candidate, route), {
    chain: candidate.destinationChain,
    lane: candidate.lane,
    failureReason: route.blocker || candidate.economicBlocker || null,
  });
}

function capSource(candidate = {}) {
  const ref = candidate.policyCapRef || candidate.capSource || {};
  return {
    source: ref.producer || ref.source || null,
    bindingSource: ref.bindingProducer || null,
    resolvedStrategyId: ref.resolvedStrategyId || null,
    perTxCap: provenance(ref.producer || ref.source || null, finiteNumber(ref.perTxUsd), {
      chain: candidate.destinationChain,
      lane: candidate.lane,
      failureReason: ref.perTxUsd == null ? "per_tx_cap_missing" : null,
    }),
    perDayCap: provenance(ref.producer || ref.source || null, finiteNumber(ref.perDayUsd), {
      chain: candidate.destinationChain,
      lane: candidate.lane,
      failureReason: ref.perDayUsd == null ? "per_day_cap_missing" : null,
    }),
    maxDailyLossUsd: provenance(ref.producer || ref.source || null, finiteNumber(ref.maxDailyLossUsd), {
      chain: candidate.destinationChain,
      lane: candidate.lane,
      failureReason: ref.maxDailyLossUsd == null ? "max_daily_loss_missing" : null,
    }),
    raw: ref,
  };
}

function reserveField(ref = {}, fallbackSource, candidate = {}) {
  return provenance(ref.producer || ref.source || fallbackSource, stringAmount(ref.amountSats, ref.amount), {
    observedAt: ref.observedAt,
    generatedAt: ref.generatedAt,
    chain: ref.chain || candidate.sourceChain || null,
    lane: candidate.lane,
    failureReason: ref.failureReason || null,
  });
}

function reserveImpact(candidate = {}) {
  return {
    paybackReserve: reserveField(candidate.paybackReserveRef, "src/treasury/refill-job.mjs", candidate),
    gasReserve: reserveField(candidate.gasReserveRef, "src/treasury/refill-job.mjs", candidate),
    safeAllocatableAfterReserves: safeAllocatableField(candidate, selectedRoute(candidate)),
  };
}

function quoteProvenance(candidate = {}, route = {}) {
  const quote = candidate.routeQuoteRef || {};
  return {
    source: quote.producer || quote.source || route.quoteProvenance || null,
    quoteProvenance: route.quoteProvenance || null,
    observedAt: quote.observedAt || null,
    generatedAt: quote.generatedAt || null,
    amount: quotedAmount(candidate, route),
    chain: candidate.destinationChain || null,
    lane: candidate.lane || null,
    failureReason: route.blocker || candidate.economicBlocker || null,
    routeKey: quote.routeKey || null,
  };
}

function costValue(candidate = {}, key) {
  return finiteNumber(candidate[key] ?? candidate.costFloor?.[key] ?? candidate.evDecomposition?.[key]);
}

function costFloorProvenance(candidate = {}) {
  const source = candidate.floorEvidence?.source || "src/executor/policy/ev-cost-floor.mjs";
  const common = { chain: candidate.destinationChain, lane: candidate.lane };
  return {
    expectedNetUsd: provenance(source, costValue(candidate, "expectedNetUsd"), common),
    requiredNetUsd: provenance(source, costValue(candidate, "requiredNetUsd"), common),
    p90CostUsd: provenance(source, costValue(candidate, "p90CostUsd"), common),
    effectiveFloorUsd: provenance(source, costValue(candidate, "effectiveFloorUsd"), common),
    routeKnownCostUsd: provenance(source, costValue(candidate, "routeKnownCostUsd"), common),
    profitClaimed: candidate.policyMode === "rebalance" ? false : costValue(candidate, "expectedNetUsd") > 0,
  };
}

function inferPolicyMode(candidate = {}) {
  if (candidate.policyMode) return candidate.policyMode;
  if (candidate.reallocationCandidate) return "rebalance";
  if (candidate.discoveryCanaryBudget || candidate.receiptGate || candidate.auditGate) return "path_opening_canary";
  return "normal_trade";
}

function hardBlockerVerdict(candidate = {}) {
  for (const blocker of array(candidate.safetyBlockers)) {
    if (HARD_BLOCKER_VERDICTS[blocker]) return HARD_BLOCKER_VERDICTS[blocker];
  }
  if (candidate.duplicateGuard?.status && candidate.duplicateGuard.status !== "clear")
    return "blocked_duplicate_open_intent";
  if (candidate.cooldown?.status && candidate.cooldown.status !== "clear") return "blocked_cooldown_active";
  if (candidate.killSwitch?.status && candidate.killSwitch.status !== "clear") return "blocked_kill_switch_present";
  return null;
}

function hasQuote(candidate = {}, route = {}) {
  const quote = candidate.routeQuoteRef || {};
  const amount = stringAmount(candidate.amountSweep?.quotedAmountSats, quote.amount, candidate.quotedAmountSats);
  return Boolean(amount && (route.quoteProvenance !== "missing_quote_cost_provenance" || candidate.routeQuoteRef));
}

function isCapBelowRouteMinimum(candidate = {}, route = {}) {
  const minimum = bigintOrNull(routeMinimum(candidate, route));
  const safe = bigintOrNull(safeAllocatable(candidate, route));
  const total = bigintOrNull(candidate.sourceAmountTotalSats || candidate.availableSourceAmountSats);
  return minimum !== null && safe !== null && safe < minimum && total !== null && total >= minimum;
}

function canaryGatesMissing(candidate = {}) {
  const missing = [];
  if (!candidate.discoveryCanaryBudget?.amountUsd || !candidate.discoveryCanaryBudget?.source) missing.push("budget");
  if (candidate.receiptGate?.required !== true || !candidate.receiptGate?.source) missing.push("receipt_gate");
  if (candidate.auditGate?.required !== true || !candidate.auditGate?.source) missing.push("audit_gate");
  return missing;
}

function modeVerdict({ candidate, route, policyMode }) {
  const hard = hardBlockerVerdict(candidate);
  if (hard) return { policyVerdict: hard, canIntent: false };
  if (!hasQuote(candidate, route)) return { policyVerdict: "blocked_quote_less_route", canIntent: false };
  if (isCapBelowRouteMinimum(candidate, route)) {
    return { policyVerdict: "POLICY_SEMANTIC_DEFECT_CANDIDATE", canIntent: false };
  }
  if (policyMode === "path_opening_canary") {
    const missing = canaryGatesMissing(candidate);
    if (missing.includes("budget")) return { policyVerdict: "blocked_canary_budget_missing", canIntent: false };
    if (missing.length > 0) return { policyVerdict: `blocked_canary_${missing[0]}_missing`, canIntent: false };
    return { policyVerdict: "report_only_path_opening_canary_candidate", canIntent: candidate.canIntent !== false };
  }
  if (policyMode === "rebalance") {
    return { policyVerdict: "report_only_rebalance_candidate", canIntent: candidate.canIntent !== false };
  }
  const expected = costValue(candidate, "expectedNetUsd");
  const floor =
    costValue(candidate, "effectiveFloorUsd") ??
    costValue(candidate, "requiredNetUsd") ??
    costValue(candidate, "p90CostUsd");
  if (expected === null || floor === null)
    return { policyVerdict: "blocked_cost_floor_provenance_missing", canIntent: false };
  if (expected < floor) return { policyVerdict: "blocked_expected_net_below_cost_floor", canIntent: false };
  return { policyVerdict: "report_only_intent_candidate", canIntent: candidate.canIntent === true };
}

function retryTrigger(candidate = {}) {
  return (
    candidate.waitlistRecheckCommand ||
    candidate.waitlist?.waitlistRecheckCommand ||
    candidate.nextAutomationStep ||
    "fresh_selector_or_refill_planner_rerun"
  );
}

function buildRow(candidate = {}) {
  const route = selectedRoute(candidate);
  const policyMode = inferPolicyMode(candidate);
  const verdict = modeVerdict({ candidate, route, policyMode });
  return {
    family: candidate.family || null,
    lane: candidate.lane || null,
    policyMode,
    policyVerdict: verdict.policyVerdict,
    sourceTruthStatus: sourceTruthStatus(candidate),
    routeMinimum: routeMinimumField(candidate, route),
    quoteAmount: quoteAmountField(candidate, route),
    safeAllocatable: safeAllocatableField(candidate, route),
    missingAmount: missingAmountField(candidate, route),
    capSource: capSource(candidate),
    reserveImpact: reserveImpact(candidate),
    quoteProvenance: quoteProvenance(candidate, route),
    costFloorProvenance: costFloorProvenance(candidate),
    retryTrigger: retryTrigger(candidate),
    canIntent: verdict.canIntent === true,
    canLive: false,
    reportOnly: true,
    runtimeAuthority: "none",
  };
}

function reportStatus(rows = []) {
  if (rows.length === 0) return "NO_CAPITAL_INTENT_ROWS_REPORT_ONLY";
  if (rows.some((row) => row.policyVerdict === "POLICY_SEMANTIC_DEFECT_CANDIDATE")) {
    return "POLICY_SEMANTIC_DEFECT_CANDIDATE_CAP_BELOW_ROUTE_MINIMUM";
  }
  return "CAPITAL_INTENT_ORCHESTRATOR_READY_REPORT_ONLY";
}

export function buildCapitalIntentOrchestratorReport({
  generatedAt = null,
  laneIntentCandidates = [],
  laneIntentCandidateReport = null,
} = {}) {
  const candidates =
    laneIntentCandidates.length > 0 ? laneIntentCandidates : array(laneIntentCandidateReport?.laneIntentCandidates);
  const rows = candidates.map(buildRow);
  return {
    generatedAt: generatedAt || laneIntentCandidateReport?.generatedAt || new Date(0).toISOString(),
    status: reportStatus(rows),
    rows,
    summary: {
      rowCount: rows.length,
      canIntentCount: rows.filter((row) => row.canIntent).length,
      canLiveCount: 0,
      reportOnlyCount: rows.length,
      policyModeCounts: rows.reduce((acc, row) => {
        acc[row.policyMode] = (acc[row.policyMode] || 0) + 1;
        return acc;
      }, {}),
      policyVerdictCounts: rows.reduce((acc, row) => {
        acc[row.policyVerdict] = (acc[row.policyVerdict] || 0) + 1;
        return acc;
      }, {}),
    },
    ...SAFETY,
  };
}
