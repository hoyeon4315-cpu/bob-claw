// Pure deterministic mapper from a selector candidate row to a structured
// next-legal-capital-action descriptor. Common-structure across every
// DEPLOYMENT_SELECTOR_FAMILIES family (pendle, merkl, defillama,
// stable_carry, btc_wrapper_lending, tokenized_gold_reserve, radar,
// aggressive, strategy_catalog).
//
// Action taxonomy:
//   enter | hold | exit | redeem | settle | claim | harvest | consolidate
//   | refill | reconcile_receipt | bind_executor | no_trade_safety
//
// exit/redeem/settle/claim/harvest/consolidate require lifecycle evidence
// (position health, maturity/redeemability, exit/redeem EV,
// claimable/harvest amount, receipt/closedAt state, cost floor). The
// selector consumes upstream entry-side blockers only, so when a position
// is open and that lifecycle evidence is not wired, this mapper emits
// `hold` with `evidenceComplete: false` and lists the missing producers so
// downstream consumers (capital manager, position-health monitor, exit
// orchestrator) can route the follow-up rather than collapsing the surface
// into a vague NO_TRADE.

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
]);

const OPEN_POSITION_BLOCKERS = new Set([
  "open_position_active",
  "open_pendle_position_active",
  "opportunity_already_open",
]);

const COOLDOWN_BLOCKERS = new Set(["recent_execution_cooldown_active", "recent_execution_cooldown"]);

const RECONCILE_BLOCKERS = new Set(["receipt_path_missing"]);

const SAFETY_BLOCKERS = new Set([
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

const HOLD_REQUIRED_EVIDENCE = Object.freeze([
  "position_health",
  "position_maturity_or_redeemability",
  "exit_or_redeem_ev",
  "claimable_or_harvest_amount",
  "receipt_or_closed_at_state",
  "cost_floor",
]);

function blockerPrefix(blocker) {
  const colon = blocker.indexOf(":");
  return colon > 0 ? blocker.slice(0, colon) : blocker;
}

function matchBlocker(blockers, set) {
  for (const blocker of blockers) {
    if (set.has(blocker)) return blocker;
    const prefix = blockerPrefix(blocker);
    if (set.has(prefix)) return blocker;
  }
  return null;
}

function isFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number);
}

function producerNameFor(slot, fallback) {
  return slot?.value?.producerName || slot?.value?.trueExitProducerName || fallback;
}

function emptyLifecycleSummary() {
  return {
    evidencedKeys: [],
    missingKeys: [...HOLD_REQUIRED_EVIDENCE],
    proxyKeys: [],
    notApplicableKeys: [],
    missingProducerNames: HOLD_REQUIRED_EVIDENCE.map((k) => `${k}::producer_unknown`),
    isMature: false,
    hasClaimableRewards: false,
    claimReady: false,
    positionClosed: false,
    exitEvUsd: null,
    exitEvProvenanceKind: null,
    exitEvIsProxy: false,
    exitEvIsTrue: false,
    exitProducerName: null,
    costFloorUsd: null,
  };
}

function classifySlot(key, slot, buckets) {
  const status = slot?.status;
  if (!slot || status === "missing") {
    buckets.missingKeys.push(key);
    buckets.missingProducerNames.push(`${key}::${producerNameFor(slot, "producer_unknown")}`);
    return;
  }
  if (status === "proxy") {
    if (slot.value?.proxyAcceptedByPolicy) {
      buckets.evidencedKeys.push(key);
      return;
    }
    buckets.proxyKeys.push(key);
    buckets.missingProducerNames.push(`${key}::${producerNameFor(slot, "true_producer_unknown")}`);
    return;
  }
  if (status === "not_applicable") {
    buckets.notApplicableKeys.push(key);
    return;
  }
  buckets.evidencedKeys.push(key);
}

function deriveExitEvProvenanceKind(exitEv, exitEvSlot) {
  if (exitEv?.provenanceKind) return exitEv.provenanceKind;
  if (exitEvSlot?.status === "evidenced") return "true_exit_ev";
  if (exitEvSlot?.status === "proxy") return "entry_canary_ev_proxy";
  return "missing_exit_ev_producer";
}

function classifySlots(evidence) {
  const buckets = {
    evidencedKeys: [],
    missingKeys: [],
    proxyKeys: [],
    notApplicableKeys: [],
    missingProducerNames: [],
  };
  for (const key of HOLD_REQUIRED_EVIDENCE) classifySlot(key, evidence[key], buckets);
  return buckets;
}

function summarizeExitEvSlot(exitEvSlot) {
  const exitEv = exitEvSlot?.value || null;
  return {
    exitEvUsd: isFiniteNumber(exitEv?.expectedNetUsd) ? Number(exitEv.expectedNetUsd) : null,
    exitEvProvenanceKind: deriveExitEvProvenanceKind(exitEv, exitEvSlot),
    exitEvIsProxy: exitEvSlot?.status === "proxy" && !exitEv?.proxyAcceptedByPolicy,
    exitEvIsTrue: exitEvSlot?.status === "evidenced" && exitEv?.provenanceKind === "true_exit_ev",
    exitProducerName: exitEv?.producerName || exitEv?.trueExitProducerName || null,
  };
}

function isMatureFrom(maturity) {
  return Boolean(maturity?.matured || maturity?.redeemable);
}

function isClaimReadyFrom(claimable) {
  return claimable?.claimPlanStatus === "ready" && Number(claimable?.readyChainCount) > 0;
}

function isPositionClosedFrom(closed) {
  return closed?.status === "closed" || Boolean(closed?.closedAt);
}

function summarizeStateSlots(evidence) {
  const maturity = evidence.position_maturity_or_redeemability?.value || null;
  const claimable = evidence.claimable_or_harvest_amount?.value || null;
  const closed = evidence.receipt_or_closed_at_state?.value || null;
  const cost = evidence.cost_floor?.value || null;
  return {
    isMature: isMatureFrom(maturity),
    hasClaimableRewards: Number(claimable?.totalClaimableUsd) > 0,
    claimReady: isClaimReadyFrom(claimable),
    positionClosed: isPositionClosedFrom(closed),
    costFloorUsd: isFiniteNumber(cost?.costFloorUsd) ? Number(cost.costFloorUsd) : null,
  };
}

function summarizeLifecycleEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return emptyLifecycleSummary();
  return {
    ...classifySlots(evidence),
    ...summarizeStateSlots(evidence),
    ...summarizeExitEvSlot(evidence.exit_or_redeem_ev || null),
  };
}

function handleOpenPositionBranch(openKey, lifecycle) {
  if (lifecycle.positionClosed) {
    return {
      action: "reconcile_receipt",
      reason: "open_blocker_but_position_closed",
      evidenceComplete: true,
      missingEvidence: [],
      holdQuality: null,
    };
  }
  const unevidenced = [...lifecycle.missingKeys, ...lifecycle.proxyKeys];
  if (lifecycle.isMature && unevidenced.length === 0) {
    return {
      action: "redeem",
      reason: "position_matured",
      evidenceComplete: true,
      missingEvidence: [],
      exitEvUsd: lifecycle.exitEvUsd,
      costFloorUsd: lifecycle.costFloorUsd,
    };
  }
  if (lifecycle.claimReady && lifecycle.hasClaimableRewards) {
    return { action: "claim", reason: "claimable_rewards_ready", evidenceComplete: true, missingEvidence: [] };
  }
  if (unevidenced.length > 0) {
    return {
      action: "hold",
      reason: openKey,
      evidenceComplete: false,
      holdQuality: "incomplete_evidence",
      missingEvidence: unevidenced,
      missingProducers: lifecycle.missingProducerNames,
      proxyEvidenceKeys: lifecycle.proxyKeys,
      exitEvUsd: lifecycle.exitEvUsd,
      exitEvProvenanceKind: lifecycle.exitEvProvenanceKind,
      costFloorUsd: lifecycle.costFloorUsd,
    };
  }
  if (lifecycle.exitEvIsTrue && lifecycle.exitEvUsd !== null && lifecycle.exitEvUsd > 0) {
    return {
      action: "exit",
      reason: "true_exit_ev_positive",
      evidenceComplete: true,
      holdQuality: null,
      missingEvidence: [],
      exitEvUsd: lifecycle.exitEvUsd,
      exitEvProvenanceKind: lifecycle.exitEvProvenanceKind,
      costFloorUsd: lifecycle.costFloorUsd,
      producer: lifecycle.exitProducerName,
      dispatchEligibility: "exit_executor_not_bound",
    };
  }
  return {
    action: "hold",
    reason: openKey,
    evidenceComplete: true,
    holdQuality: "true_hold_noop",
    missingEvidence: [],
    exitEvUsd: lifecycle.exitEvUsd,
    exitEvProvenanceKind: lifecycle.exitEvProvenanceKind,
    costFloorUsd: lifecycle.costFloorUsd,
    producer: lifecycle.exitProducerName,
  };
}

export function nextLegalCapitalAction(candidate = {}) {
  const blockers = Array.isArray(candidate.blockers) ? candidate.blockers.map(String) : [];
  const capStatus = candidate.capResult?.status || candidate.capStatus || null;
  const evNet = isFiniteNumber(candidate.expectedRealizedNetUsd) ? Number(candidate.expectedRealizedNetUsd) : null;
  const lifecycle = summarizeLifecycleEvidence(candidate.lifecycleEvidence);

  const safetyKey = matchBlocker(blockers, SAFETY_BLOCKERS);
  if (safetyKey) {
    return {
      action: "no_trade_safety",
      reason: safetyKey,
      evidenceComplete: true,
      missingEvidence: [],
    };
  }

  const openKey = matchBlocker(blockers, OPEN_POSITION_BLOCKERS);
  if (openKey) {
    return handleOpenPositionBranch(openKey, lifecycle);
  }

  const bindKey = matchBlocker(blockers, BIND_EXECUTOR_BLOCKERS);
  if (bindKey) {
    return {
      action: "bind_executor",
      reason: bindKey,
      evidenceComplete: true,
      missingEvidence: [],
    };
  }

  const refillKey = matchBlocker(blockers, REFILL_BLOCKERS);
  if (refillKey) {
    return {
      action: "refill",
      reason: refillKey,
      evidenceComplete: true,
      missingEvidence: [],
    };
  }

  const cooldownKey = matchBlocker(blockers, COOLDOWN_BLOCKERS);
  if (cooldownKey) {
    return {
      action: "hold",
      reason: cooldownKey,
      evidenceComplete: true,
      missingEvidence: [],
    };
  }

  const reconcileKey = matchBlocker(blockers, RECONCILE_BLOCKERS);
  if (reconcileKey) {
    return {
      action: "reconcile_receipt",
      reason: reconcileKey,
      evidenceComplete: true,
      missingEvidence: [],
    };
  }

  if (capStatus && capStatus !== "ready") {
    return {
      action: "no_trade_safety",
      reason: `cap_status_${capStatus}`,
      evidenceComplete: true,
      missingEvidence: [],
    };
  }

  if (blockers.length === 0 && capStatus === "ready" && evNet !== null && evNet > 0) {
    return {
      action: "enter",
      reason: "candidate_eligible",
      evidenceComplete: true,
      missingEvidence: [],
    };
  }

  return {
    action: "no_trade_safety",
    reason: blockers[0] || "no_eligible_candidate",
    evidenceComplete: true,
    missingEvidence: [],
  };
}

export const NEXT_LEGAL_CAPITAL_ACTIONS = Object.freeze([
  "enter",
  "hold",
  "exit",
  "redeem",
  "settle",
  "claim",
  "harvest",
  "consolidate",
  "refill",
  "reconcile_receipt",
  "bind_executor",
  "no_trade_safety",
]);

export const HOLD_LIFECYCLE_EVIDENCE_REQUIREMENTS = HOLD_REQUIRED_EVIDENCE;
