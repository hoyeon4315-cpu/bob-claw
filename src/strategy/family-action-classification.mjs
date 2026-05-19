// Pure deterministic classifier that maps each DEPLOYMENT_SELECTOR_FAMILIES
// row from `buildFamilyCoverage` into one of the action classes used by the
// strategy-universe action table. Inputs come from the selector's
// `familyCoverage` row plus optional refill/readiness context. No live state
// is mutated; this is a read-only join over already-built selector evidence.
//
// Classes (exactly one per family):
//   ENTERABLE_NOW
//   EXIT_OR_REDEEM_REQUIRED
//   CLAIM_OR_HARVEST_REQUIRED
//   REFILL_REQUIRED
//   RECONCILE_RECEIPT_REQUIRED
//   TRUE_HOLD_NOOP
//   TRUE_NO_TRADE_ECONOMICS
//   BLOCKED_BY_MISSING_PRODUCER
//   BLOCKED_BY_POLICY_SAFETY
//   POLICY_SEMANTIC_DEFECT_CANDIDATE
//   BLOCKED_BY_GOVERNING_SYNC_MISMATCH

export const FAMILY_ACTION_CLASSES = Object.freeze([
  "ENTERABLE_NOW",
  "EXIT_OR_REDEEM_REQUIRED",
  "CLAIM_OR_HARVEST_REQUIRED",
  "REFILL_REQUIRED",
  "RECONCILE_RECEIPT_REQUIRED",
  "TRUE_HOLD_NOOP",
  "TRUE_NO_TRADE_ECONOMICS",
  "BLOCKED_BY_MISSING_PRODUCER",
  "BLOCKED_BY_POLICY_SAFETY",
  "POLICY_SEMANTIC_DEFECT_CANDIDATE",
  "BLOCKED_BY_GOVERNING_SYNC_MISMATCH",
]);

const POLICY_SAFETY_BLOCKERS = new Set([
  "kill_switch_engaged",
  "consecutive_failure_pause",
  "max_daily_loss_breached",
  "strategy_auto_execute_not_enabled",
  "per_tx_cap_exceeded",
  "per_chain_cap_exceeded",
  "per_day_cap_missing",
  "max_daily_loss_cap_missing",
  "strategy_caps_missing",
  "strategy_id_missing",
  "chain_not_official_gateway_destination",
]);

const BIND_EXECUTOR_BLOCKERS = new Set([
  "protocol_executor_missing",
  "protocol_executor_required",
  "hold_executor_missing",
  "executor_missing",
  "protocol_binding_executor_missing",
  "protocol_binding_not_ready",
  "protocol_binding_identifier_has_no_code",
  "live_executor_not_bound",
  "generic_conversion_executor_not_built",
  "merkl_drop_campaign_entry_contract_missing",
  "defillama_requires_executable_protocol_binding",
  "route_specific_executor_inputs_required",
  "binding_kind_not_registered",
  "UNSUPPORTED_BINDING",
]);

const REFILL_BLOCKERS = new Set([
  "live_inventory_below_required_notional",
  "inventory_missing",
  "inventory_unknown",
  "inventory_snapshot_missing",
  "current_inventory_entry_route_required",
  "entry_asset_unavailable",
  "native_gas_unavailable",
  "native_gas_missing",
  "native_gas_inventory_required",
  "matched_token_missing",
  "live_inventory_entry_asset_not_found",
]);

const SYNC_BLOCKERS = new Set(["NO_RECEIPT_RECONCILIATION"]);
const POLICY_SEMANTIC_CANDIDATE_BLOCKERS = new Set(["executable_candidate_available"]);
const ACTIVE_POSITION_ACTION_REQUIRED = "NO_NEW_ENTRY_BUT_ACTIVE_POSITION_ACTION_REQUIRED";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function blockerPrefix(blocker) {
  const text = String(blocker || "");
  const colon = text.indexOf(":");
  return colon > 0 ? text.slice(0, colon) : text;
}

function blockerMatches(value, set) {
  if (!value) return false;
  const text = String(value);
  if (set.has(text)) return true;
  return set.has(blockerPrefix(text));
}

function decisionPath(decision) {
  return decision?.executableActionPath || {};
}

function hasActionableExit(decisions) {
  return decisions.some((d) => {
    const path = decisionPath(d);
    return (
      ["exit", "unwind", "redeem"].includes(path.action) &&
      (path.blocker === null || path.blocker === undefined) &&
      path.producer &&
      path.dispatchEligibility !== "exit_executor_not_bound" &&
      path.dispatchEligibility !== "unsupported_binding"
    );
  });
}

function hasUnsupportedBindingDecision(decisions) {
  return decisions.some((d) => {
    if (d?.actionDecision === "UNSUPPORTED_BINDING") return true;
    const path = decisionPath(d);
    if (path.dispatchEligibility === "unsupported_binding") return true;
    if (path.dispatchEligibility === "exit_executor_not_bound") return true;
    if (path.blocker === "binding_kind_not_registered") return true;
    return false;
  });
}

function hasHealthCheckRequired(decisions) {
  return decisions.some((d) => d?.actionDecision === "HEALTH_CHECK_REQUIRED");
}

function allHoldNoop(decisions) {
  if (decisions.length === 0) return false;
  return decisions.every((d) => {
    if (d?.actionDecision !== "HOLD_NOOP") return false;
    const path = decisionPath(d);
    return path.blocker === null || path.blocker === undefined;
  });
}

function deriveMissingProducerForBinding(family, row, decisions) {
  for (const d of decisions) {
    const path = decisionPath(d);
    if (
      path.dispatchEligibility === "unsupported_binding" ||
      d?.actionDecision === "UNSUPPORTED_BINDING" ||
      path.blocker === "binding_kind_not_registered"
    ) {
      return `${path.bindingKey || d?.missingBindingKey || "unknown"}::binding_executor_unregistered`;
    }
    if (path.dispatchEligibility === "exit_executor_not_bound") {
      return `${path.bindingKey || "unknown"}::exit_executor_unbound`;
    }
  }
  const blocker = row?.firstBlockingReason || null;
  if (blockerMatches(blocker, BIND_EXECUTOR_BLOCKERS)) {
    return `${family}::${blocker}`;
  }
  return null;
}

function governingFieldPathFor(family, actionClass, hasDecisions) {
  switch (actionClass) {
    case "ENTERABLE_NOW":
      return `familyCoverage[family=${family}].signerIntentReadyCount`;
    case "EXIT_OR_REDEEM_REQUIRED":
      return `familyCoverage[family=${family}].activeActionEconomics.perPositionDecisions[*].executableActionPath`;
    case "CLAIM_OR_HARVEST_REQUIRED":
      return `claimHarvestSummary.chains[*].status`;
    case "REFILL_REQUIRED":
      return `familyCoverage[family=${family}].firstBlockingReason`;
    case "RECONCILE_RECEIPT_REQUIRED":
      return `familyCoverage[family=${family}].unreconciledBroadcastCount`;
    case "TRUE_HOLD_NOOP":
      return `familyCoverage[family=${family}].activeActionEconomics.perPositionDecisions[*].executableActionPath`;
    case "TRUE_NO_TRADE_ECONOMICS":
      return `familyCoverage[family=${family}].evPositiveCandidateCount`;
    case "BLOCKED_BY_MISSING_PRODUCER":
      return hasDecisions
        ? `familyCoverage[family=${family}].activeActionEconomics.perPositionDecisions[*].executableActionPath.blocker`
        : `familyCoverage[family=${family}].firstBlockingReason`;
    case "BLOCKED_BY_POLICY_SAFETY":
      return `familyCoverage[family=${family}].firstBlockingReason`;
    case "POLICY_SEMANTIC_DEFECT_CANDIDATE":
      return `familyCoverage[family=${family}].firstBlockingReason`;
    case "BLOCKED_BY_GOVERNING_SYNC_MISMATCH":
      return `familyCoverage[family=${family}].unreconciledBroadcastCount`;
    default:
      return null;
  }
}

function baseClassification(family, row, decisions) {
  return {
    family,
    actionClass: null,
    reason: null,
    missingProducer: null,
    governingFieldPath: null,
    discoveredCandidateCount: finiteNumber(row.discoveredCandidateCount, 0),
    evPositiveCandidateCount: finiteNumber(row.evPositiveCandidateCount, 0),
    policyEligibleCandidateCount: finiteNumber(row.policyEligibleCandidateCount, 0),
    activePositionCount: finiteNumber(row.activePositionCount, 0),
    signerIntentReadyCount: finiteNumber(row.signerIntentReadyCount, 0),
    unreconciledBroadcastCount: finiteNumber(row.unreconciledBroadcastCount, 0),
    claimReadyUsd: finiteNumber(row.activeActionEconomics?.claimReadyUsd, 0),
    claimPendingUsd: finiteNumber(row.activeActionEconomics?.claimPendingUsd, 0),
    claimChainReadyCount: finiteNumber(row.activeActionEconomics?.claimChainReadyCount, 0),
    selectorSelectedAction: row.selectedAction || null,
    selectorFirstBlockingReason: row.firstBlockingReason || null,
    refillNeed: null,
    nextLegalCapitalActionCounts: {},
    hasDecisions: decisions.length > 0,
  };
}

function refillJobFor(family, refillJobs) {
  if (!Array.isArray(refillJobs)) return null;
  for (const job of refillJobs) {
    if (job?.family && job.family === family) return job;
    if (family === "tokenized_gold_reserve" && /xau|paxg|gold/i.test(`${job?.asset || ""}`)) return job;
  }
  return null;
}

function finalize(result, actionClass, reason, extras = {}) {
  const out = {
    ...result,
    actionClass,
    reason,
    missingProducer: extras.missingProducer ?? null,
    refillNeed: extras.refillNeed ?? null,
    governingFieldPath: governingFieldPathFor(result.family, actionClass, result.hasDecisions),
    nextLegalCapitalActionCounts: extras.nextLegalCapitalActionCounts ?? result.nextLegalCapitalActionCounts,
  };
  delete out.hasDecisions;
  return out;
}

function tryEnterable(result, row) {
  if (finiteNumber(row.signerIntentReadyCount, 0) > 0 || row.selectedAction === "signer_intent_ready") {
    return finalize(result, "ENTERABLE_NOW", "signer_intent_ready_candidate");
  }
  return null;
}

function tryPolicySafety(result, blocker) {
  if (blockerMatches(blocker, POLICY_SAFETY_BLOCKERS)) {
    return finalize(result, "BLOCKED_BY_POLICY_SAFETY", blocker);
  }
  return null;
}

function tryClaimReady(result, econ) {
  const claimReadyUsd = finiteNumber(econ.claimReadyUsd, 0);
  const claimChainReadyCount = finiteNumber(econ.claimChainReadyCount, 0);
  if (claimReadyUsd > 0 && claimChainReadyCount > 0) {
    return finalize(result, "CLAIM_OR_HARVEST_REQUIRED", "claim_chain_ready");
  }
  return null;
}

function tryExit(result, decisions) {
  if (hasActionableExit(decisions)) {
    return finalize(result, "EXIT_OR_REDEEM_REQUIRED", "actionable_exit_path_present");
  }
  return null;
}

function tryMissingProducer(result, row, blocker, decisions) {
  const family = row.family;
  const econ = row.activeActionEconomics || {};
  if (hasUnsupportedBindingDecision(decisions) || blockerMatches(blocker, BIND_EXECUTOR_BLOCKERS)) {
    const missingProducer = deriveMissingProducerForBinding(family, row, decisions) || `${family}::executor_unbound`;
    return finalize(result, "BLOCKED_BY_MISSING_PRODUCER", blocker || "binding_or_executor_not_registered", {
      missingProducer,
    });
  }
  if (econ.claimTopBlocker === "distributor_address_missing") {
    return finalize(result, "BLOCKED_BY_MISSING_PRODUCER", econ.claimTopBlocker, {
      missingProducer: `${family}::distributor_address_resolution_missing`,
    });
  }
  if (hasHealthCheckRequired(decisions)) {
    return finalize(result, "BLOCKED_BY_MISSING_PRODUCER", "position_mark_failed_needs_health_action_producer", {
      missingProducer: `${family}::position_health_action_producer_missing`,
    });
  }
  if (
    finiteNumber(row.activePositionCount, 0) > 0 &&
    !decisions.length &&
    (blocker === ACTIVE_POSITION_ACTION_REQUIRED || econ.topActiveActionReason === ACTIVE_POSITION_ACTION_REQUIRED)
  ) {
    return finalize(result, "BLOCKED_BY_MISSING_PRODUCER", "active_position_action_producer_missing", {
      missingProducer: `${family}::active_position_action_producer_missing`,
    });
  }
  return null;
}

function tryReceiptReconcile(result, row, blocker) {
  if (finiteNumber(row.unreconciledBroadcastCount, 0) > 0 || blockerMatches(blocker, SYNC_BLOCKERS)) {
    return finalize(result, "RECONCILE_RECEIPT_REQUIRED", blocker || "NO_RECEIPT_RECONCILIATION", {
      missingProducer: `${row.family}::receipt_reconciliation_producer`,
    });
  }
  return null;
}

function tryPolicySemanticCandidate(result, blocker) {
  if (blockerMatches(blocker, POLICY_SEMANTIC_CANDIDATE_BLOCKERS)) {
    return finalize(result, "POLICY_SEMANTIC_DEFECT_CANDIDATE", blocker);
  }
  return null;
}

function refillNeedFromJob(job) {
  if (!job) {
    return { executionMethod: null, executionReason: null, chain: null, asset: null, status: "unmet_inventory_gap" };
  }
  return {
    executionMethod: job.executionMethod || null,
    executionReason: job.executionReason || null,
    chain: job.chain || null,
    asset: job.asset || null,
    status: job.status || null,
  };
}

function tryRefill(result, row, blocker, ctx) {
  if (!blockerMatches(blocker, REFILL_BLOCKERS)) return null;
  const job = refillJobFor(row.family, ctx.refillJobs);
  return finalize(result, "REFILL_REQUIRED", blocker, { refillNeed: refillNeedFromJob(job) });
}

function tryClaimEconomicsBelowFloor(result, econ) {
  const claimPendingUsd = finiteNumber(econ.claimPendingUsd, 0);
  const blocker = econ.claimTopBlocker;
  if (claimPendingUsd > 0 && blocker && /below_min|exceeds_claimable/i.test(String(blocker))) {
    return finalize(result, "TRUE_NO_TRADE_ECONOMICS", blocker);
  }
  return null;
}

function tryHoldNoop(result, row, decisions) {
  if (allHoldNoop(decisions) && finiteNumber(row.activePositionCount, 0) > 0) {
    return finalize(result, "TRUE_HOLD_NOOP", "all_active_positions_hold_noop");
  }
  return null;
}

function tryNoTradeEconomics(result, row, blocker) {
  if (
    finiteNumber(row.discoveredCandidateCount, 0) > 0 &&
    finiteNumber(row.evPositiveCandidateCount, 0) === 0 &&
    finiteNumber(row.activePositionCount, 0) === 0
  ) {
    return finalize(result, "TRUE_NO_TRADE_ECONOMICS", blocker || "no_positive_ev_candidate");
  }
  return null;
}

const CLASSIFIERS = Object.freeze([
  (result, row, blocker, decisions, ctx, econ) => tryEnterable(result, row),
  (result, row, blocker) => tryPolicySafety(result, blocker),
  (result, row, blocker, decisions, ctx, econ) => tryClaimReady(result, econ),
  (result, row, blocker, decisions) => tryExit(result, decisions),
  (result, row, blocker, decisions) => tryMissingProducer(result, row, blocker, decisions),
  (result, row, blocker) => tryReceiptReconcile(result, row, blocker),
  (result, row, blocker, decisions, ctx) => tryRefill(result, row, blocker, ctx),
  (result, row, blocker, decisions, ctx, econ) => tryClaimEconomicsBelowFloor(result, econ),
  (result, row, blocker, decisions) => tryHoldNoop(result, row, decisions),
  (result, row, blocker) => tryNoTradeEconomics(result, row, blocker),
  (result, row, blocker) => tryPolicySemanticCandidate(result, blocker),
]);

export function classifyFamilyActionRow(row = {}, ctx = {}) {
  const family = row.family;
  const econ = row.activeActionEconomics || {};
  const decisions = array(econ.perPositionDecisions);
  const blocker = row.firstBlockingReason;
  const result = baseClassification(family, row, decisions);
  result.nextLegalCapitalActionCounts = ctx.nextLegalDistByFamily?.[family] || {};

  for (const classify of CLASSIFIERS) {
    const out = classify(result, row, blocker, decisions, ctx, econ);
    if (out) return out;
  }

  return finalize(result, "BLOCKED_BY_GOVERNING_SYNC_MISMATCH", blocker || "selector_classifier_default_fallback");
}

export function buildFamilyActionTable(familyCoverageRows = [], ctx = {}) {
  return array(familyCoverageRows).map((row) => classifyFamilyActionRow(row, ctx));
}
