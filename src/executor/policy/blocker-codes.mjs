import { createHash } from "node:crypto";

export const BLOCKER_CATEGORIES = Object.freeze([
  "filter",
  "hard_safety_stop",
  "economic_no_go",
  "proof_acquisition",
  "refill_or_inventory",
  "cooldown",
  "executor_unbound",
  "code_required",
  "manual_review",
  "payback_lifecycle",
]);

function entry(category, specificId, humanLabel, {
  severity = "info",
  autoResolvable = false,
  requiresExternalDeposit = false,
  expectedRetryShape = "none",
} = {}) {
  return Object.freeze({
    code: `${category}:${specificId}`,
    category,
    specificId,
    humanLabel,
    severity,
    autoResolvable,
    requiresExternalDeposit,
    expectedRetryShape,
  });
}

const REQUIRED = [
  entry("filter", "same_chain_unprofitable", "Candidate notional is below same-chain profitable minimum", { expectedRetryShape: "inventory_changed" }),
  entry("filter", "inventory_mismatch", "Candidate inventory is below required notional", { expectedRetryShape: "inventory_changed" }),
  entry("filter", "min_position_blocked", "Candidate notional is below venue minimum", { expectedRetryShape: "inventory_changed" }),
  entry("filter", "bridge_cost_greater_than_expected_net", "Bridge cost exceeds expected net", { expectedRetryShape: "inventory_changed" }),
  entry("filter", "no_positive_cap_or_inventory_usd", "No positive candidate cap or inventory", { expectedRetryShape: "inventory_changed" }),
  entry("filter", "capital_mismatch", "Candidate capital mismatch", { expectedRetryShape: "inventory_changed" }),
  entry("filter", "executable_candidate_stale", "Executable candidate stale after refresh failed", { expectedRetryShape: "bounded_backoff" }),
  entry("hard_safety_stop", "kill_switch_active", "Kill-switch active", { severity: "critical" }),
  entry("hard_safety_stop", "dev_lock_active", "Dev-lock active", { severity: "critical" }),
  entry("hard_safety_stop", "readiness_guard_blocked", "Live broadcast readiness guard blocked", { severity: "critical" }),
  entry("hard_safety_stop", "operator_hold", "Strategy held by operator", { severity: "critical" }),
  entry("hard_safety_stop", "paused_by_auto_kill", "Strategy paused by auto-kill", { severity: "critical" }),
  entry("hard_safety_stop", "position_exiting", "Position has exit or unwind action", { severity: "critical" }),
  entry("hard_safety_stop", "capless_strategy", "Strategy caps missing or invalid", { severity: "critical" }),
  entry("hard_safety_stop", "hf_breach", "Health factor or liquidation policy breach", { severity: "critical" }),
  entry("hard_safety_stop", "unknown_token", "Unknown token requires whitelist review", { severity: "critical" }),
  entry("economic_no_go", "capital_too_small", "Capital too small", { severity: "warning", requiresExternalDeposit: true, expectedRetryShape: "inventory_changed" }),
  entry("economic_no_go", "edge_below_variance_floor", "Edge below measured cost variance", { severity: "warning", expectedRetryShape: "inventory_changed" }),
  entry("economic_no_go", "cost_exceeds_payback_offramp_cap", "Payback cost exceeds policy cap", { severity: "warning", expectedRetryShape: "periodic" }),
  entry("proof_acquisition", "route_quote_stale", "Route quote stale", { severity: "warning", autoResolvable: true, expectedRetryShape: "bounded_backoff" }),
  entry("proof_acquisition", "gateway_route_unknown", "Gateway route unknown", { severity: "warning", autoResolvable: true, expectedRetryShape: "bounded_backoff" }),
  entry("proof_acquisition", "inventory_snapshot_stale", "Inventory snapshot stale", { severity: "warning", autoResolvable: true, expectedRetryShape: "bounded_backoff" }),
  entry("proof_acquisition", "rewards_unclaimed", "Reward tokens unclaimed", { severity: "warning", autoResolvable: true, expectedRetryShape: "receipt_confirmed" }),
  entry("proof_acquisition", "missing_yield_evidence", "Yield-side simulation evidence missing", { severity: "warning", autoResolvable: true, expectedRetryShape: "bounded_backoff" }),
  entry("proof_acquisition", "share_price_unwind_proof_missing", "Share-price unwind proof missing", { severity: "warning", autoResolvable: true, expectedRetryShape: "bounded_backoff" }),
  entry("proof_acquisition", "executable_candidate_stale", "Executable candidate stale", { severity: "warning", autoResolvable: true, expectedRetryShape: "bounded_backoff" }),
  entry("proof_acquisition", "merkl_queue_not_ready_for_tiny_live_canary", "Merkl queue not ready for tiny live canary", { severity: "warning", autoResolvable: true, expectedRetryShape: "bounded_backoff" }),
  entry("refill_or_inventory", "chain_under_target", "Chain under target", { severity: "warning", autoResolvable: true, expectedRetryShape: "receipt_confirmed" }),
  entry("refill_or_inventory", "gas_float_below_threshold", "Gas float below threshold", { severity: "warning", autoResolvable: true, expectedRetryShape: "receipt_confirmed" }),
  entry("refill_or_inventory", "idle_dust_consolidation_due", "Idle dust consolidation due", { severity: "warning", autoResolvable: true, expectedRetryShape: "receipt_confirmed" }),
  entry("cooldown", "fresh_roundtrip_proof_recorded", "Fresh round-trip proof recorded", { expectedRetryShape: "eta" }),
  entry("cooldown", "campaign_window_pending", "Campaign window pending", { expectedRetryShape: "eta" }),
  entry("cooldown", "harvest_period_pending", "Harvest period pending", { expectedRetryShape: "eta" }),
  entry("executor_unbound", "adapter_missing", "Executor adapter missing", { severity: "warning", expectedRetryShape: "code_queue" }),
  entry("executor_unbound", "protocol_binding_not_ready", "Protocol binding not ready", { severity: "warning", expectedRetryShape: "code_queue" }),
  entry("executor_unbound", "executor_missing", "Executor missing", { severity: "warning", expectedRetryShape: "code_queue" }),
  entry("executor_unbound", "unsupported_binding_kind", "Unsupported binding kind", { severity: "warning", expectedRetryShape: "code_queue" }),
  entry("code_required", "specific_recipe_required", "Specific recipe required", { severity: "warning", expectedRetryShape: "code_queue" }),
  entry("code_required", "strategy_tiny_live_cap_missing", "Strategy tiny live cap missing", { severity: "warning", expectedRetryShape: "code_queue" }),
  entry("code_required", "canary_graduation_failure_pause", "Canary graduation paused by failure state", { severity: "warning", expectedRetryShape: "code_queue" }),
  entry("code_required", "entry_asset_not_whitelisted", "Entry asset not whitelisted", { severity: "warning", expectedRetryShape: "code_queue" }),
  entry("code_required", "matched_token_missing", "Matched token missing", { severity: "warning", expectedRetryShape: "code_queue" }),
  entry("manual_review", "unknown_blocker_code", "Unknown blocker code", { severity: "warning", expectedRetryShape: "manual" }),
  entry("filter", "manual_operator_review_required", "Manual operator review required", { severity: "warning", expectedRetryShape: "manual" }),
  entry("payback_lifecycle", "payback_settlement_pending", "Payback settlement pending", { severity: "warning", expectedRetryShape: "periodic" }),
  entry("payback_lifecycle", "profit_attribution_gap", "Profit attribution gap", { severity: "warning", expectedRetryShape: "periodic" }),
];

export const BLOCKER_CODES = Object.freeze(Object.fromEntries(REQUIRED.map((item) => [item.code, item])));

const FORBIDDEN_LEGACY_NAMES = new Set([
  "recipe_not_proven",
  "refill_proof_not_proven",
  "route_proof_not_proven",
  "evidence_missing_manual_only",
]);

function normalizeLegacyText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, "_")
    .toLowerCase();
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableCanonical(value[key])]),
  );
}

export function paramsHash(params = {}) {
  return createHash("sha256")
    .update(JSON.stringify(stableCanonical(params || {})))
    .digest("hex")
    .slice(0, 16);
}

function parseColonParams(text) {
  const parts = String(text || "").split(":");
  if (parts.length <= 1) return {};
  return {
    detail: parts.slice(1).join(":"),
  };
}

function codeForLegacy(raw, context = {}) {
  const text = normalizeLegacyText(raw);
  if (!text) return "manual_review:unknown_blocker_code";
  if (BLOCKER_CODES[text]) return text;
  if (FORBIDDEN_LEGACY_NAMES.has(text)) return "code_required:specific_recipe_required";

  if (text.includes("same_chain_unprofitable")) return "filter:same_chain_unprofitable";
  if (text === "min_position_blocked" || text === "target_allocation_below_min_position_usd") return "filter:min_position_blocked";
  if (text.includes("bridge_cost_greater_than_expected_net")) return "filter:bridge_cost_greater_than_expected_net";
  if (text.includes("no_positive_cap_or_inventory_usd")) return "filter:no_positive_cap_or_inventory_usd";
  if (context.candidateScopedInventory === true && (text.includes("inventory_missing") || text.includes("inventory_unknown"))) {
    return "filter:inventory_mismatch";
  }
  if (context.staleAfterRefreshFailed === true && text.includes("executable_candidate_stale")) {
    return "filter:executable_candidate_stale";
  }

  if (text.includes("kill_switch")) return "hard_safety_stop:kill_switch_active";
  if (text.includes("dev_lock")) return "hard_safety_stop:dev_lock_active";
  if (text.includes("readyforlivebroadcast") || text.includes("ready_for_live_broadcast") || text.includes("dispatch_not_ready_for_live_broadcast")) {
    return "hard_safety_stop:readiness_guard_blocked";
  }
  if (text.includes("operator_hold")) return "hard_safety_stop:operator_hold";
  if (text.includes("paused_by_auto_kill") || text.includes("auto_kill_triggered")) return "hard_safety_stop:paused_by_auto_kill";
  if (text.includes("position_exiting") || text.includes("exit_descriptor") || text.includes("unwind_descriptor")) return "hard_safety_stop:position_exiting";
  if (text.includes("strategy_caps_missing") || text.includes("strategy_caps_invalid") || text === "missing_caps" || text.includes("capless")) {
    return "hard_safety_stop:capless_strategy";
  }
  if (text.includes("hf_breach") || text.includes("hf_below") || text.includes("liquidation")) return "hard_safety_stop:hf_breach";
  if (text.includes("entry_asset_not_whitelisted")) return "code_required:entry_asset_not_whitelisted";
  if (text.includes("matched_token_missing")) return "code_required:matched_token_missing";
  if (text.includes("manual_operator_review_required")) return "manual_review:manual_operator_review_required";
  if (text.includes("unknown_token") || text.includes("whitelist")) return "hard_safety_stop:unknown_token";

  if (text.includes("capital_too_small") || text.includes("insufficient_capital")) return "economic_no_go:capital_too_small";
  if (text.includes("payback") && text.includes("cost")) return "economic_no_go:cost_exceeds_payback_offramp_cap";
  if (text.includes("unprofitable") || text.includes("variance_floor") || text.includes("policy_reject") || text.includes("ev_below")) {
    return "economic_no_go:edge_below_variance_floor";
  }

  if (text.includes("stale") && (text.includes("quote") || text.includes("route"))) return "proof_acquisition:route_quote_stale";
  if (text.includes("executable_candidate_stale")) return "proof_acquisition:executable_candidate_stale";
  if (text.includes("share_price_unwind_proof_missing")) return "proof_acquisition:share_price_unwind_proof_missing";
  if (text.includes("merkl_queue_not_ready_for_tiny_live_canary")) return "proof_acquisition:merkl_queue_not_ready_for_tiny_live_canary";
  if (text.includes("gateway_route") || text.includes("route_unknown") || text.includes("route_currently_unavailable") || text.includes("missing_gateway_quote")) {
    return "proof_acquisition:gateway_route_unknown";
  }
  if (text.includes("inventory") || text.includes("wallet_holdings")) return "proof_acquisition:inventory_snapshot_stale";
  if (text.includes("rewards_unclaimed") || text.includes("claim_blocked") || text.includes("claimable")) return "proof_acquisition:rewards_unclaimed";
  if (text.includes("missing_yield_evidence") || text.includes("yield_evidence_missing")) return "proof_acquisition:missing_yield_evidence";

  if (text.includes("chain_under_target") || text.includes("refill_routes_unresolved") || text.includes("refill_required")) return "refill_or_inventory:chain_under_target";
  if (text.includes("gas_float") || text.includes("native_balance") || text.includes("missing_gateway_gas")) return "refill_or_inventory:gas_float_below_threshold";
  if (text.includes("idle") && text.includes("consolidation")) return "refill_or_inventory:idle_dust_consolidation_due";

  if (text.includes("fresh_roundtrip_proof_recorded")) return "cooldown:fresh_roundtrip_proof_recorded";
  if (text.includes("campaign_window")) return "cooldown:campaign_window_pending";
  if (text.includes("harvest_period")) return "cooldown:harvest_period_pending";
  if (text.includes("cooldown")) return "cooldown:fresh_roundtrip_proof_recorded";

  if (text.includes("protocol_binding_not_ready")) return "executor_unbound:protocol_binding_not_ready";
  if (text.includes("unsupported_binding_kind")) return "executor_unbound:unsupported_binding_kind";
  if (text.includes("adapter_missing") || text.includes("executor_missing") || text.includes("executor_binding_missing") || text.includes("protocol_binding_executor_missing")) {
    return "executor_unbound:executor_missing";
  }
  if (text.includes("strategy_tiny_live_cap_missing") || text.includes("tiny_live_cap_missing")) return "code_required:strategy_tiny_live_cap_missing";
  if (text.includes("canary_graduation_failure_pause")) return "code_required:canary_graduation_failure_pause";
  if (text.includes("specific_recipe_required") || text.includes("code_required")) return "code_required:specific_recipe_required";
  if (text.includes("payback_settlement_pending")) return "payback_lifecycle:payback_settlement_pending";
  if (text.includes("profit_attribution_gap")) return "payback_lifecycle:profit_attribution_gap";

  return "manual_review:unknown_blocker_code";
}

export function normalizeBlocker(rawString, context = {}) {
  const raw = String(rawString ?? "").trim();
  const code = codeForLegacy(raw, context);
  const meta = BLOCKER_CODES[code] || BLOCKER_CODES["manual_review:unknown_blocker_code"];
  const params = {
    ...parseColonParams(raw),
    ...(context && typeof context === "object" ? context : {}),
  };
  return {
    code: meta.code,
    params,
    legacyText: raw || null,
    category: meta.category,
    paramsHash: paramsHash(params),
  };
}

export function assertBlockerCode(code) {
  if (!BLOCKER_CODES[code]) {
    throw new Error(`Unknown blocker code: ${code}`);
  }
  return code;
}

export function isHardSafetyStop(code) {
  return BLOCKER_CODES[code]?.category === "hard_safety_stop";
}

export function isFilterBlockerCode(code) {
  return BLOCKER_CODES[code]?.category === "filter";
}

export function splitCandidateBlockers(rawBlockers = [], context = {}) {
  const blockers = [];
  const filters = [];
  const blockerCodes = [];
  const filterCodes = [];
  for (const raw of rawBlockers || []) {
    const normalized = normalizeBlocker(raw, context);
    if (isFilterBlockerCode(normalized.code)) {
      filters.push(raw);
      filterCodes.push(normalized.code);
    } else {
      blockers.push(raw);
      blockerCodes.push(normalized.code);
    }
  }
  return {
    blockers,
    filters,
    blockerCodes,
    filterCodes,
  };
}
