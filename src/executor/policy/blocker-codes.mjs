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

function entry(
  category,
  specificId,
  humanLabel,
  { severity = "info", autoResolvable = false, requiresExternalDeposit = false, expectedRetryShape = "none" } = {},
) {
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
  entry("filter", "same_chain_unprofitable", "Candidate notional is below same-chain profitable minimum", {
    expectedRetryShape: "inventory_changed",
  }),
  entry("filter", "inventory_mismatch", "Candidate inventory is below required notional", {
    expectedRetryShape: "inventory_changed",
  }),
  entry("filter", "min_position_blocked", "Candidate notional is below venue minimum", {
    expectedRetryShape: "inventory_changed",
  }),
  entry("filter", "bridge_cost_greater_than_expected_net", "Bridge cost exceeds expected net", {
    expectedRetryShape: "inventory_changed",
  }),
  entry("filter", "no_positive_cap_or_inventory_usd", "No positive candidate cap or inventory", {
    expectedRetryShape: "inventory_changed",
  }),
  entry("filter", "capital_mismatch", "Candidate capital mismatch", { expectedRetryShape: "inventory_changed" }),
  entry("filter", "executable_candidate_stale", "Executable candidate stale after refresh failed", {
    expectedRetryShape: "bounded_backoff",
  }),
  entry("hard_safety_stop", "kill_switch_active", "Kill-switch active", { severity: "critical" }),
  entry("hard_safety_stop", "dev_lock_active", "Dev-lock active", { severity: "critical" }),
  entry("hard_safety_stop", "readiness_guard_blocked", "Live broadcast readiness guard blocked", {
    severity: "critical",
  }),
  entry("hard_safety_stop", "operator_hold", "Strategy held by operator", { severity: "critical" }),
  entry("hard_safety_stop", "paused_by_auto_kill", "Strategy paused by auto-kill", { severity: "critical" }),
  entry("hard_safety_stop", "position_exiting", "Position has exit or unwind action", { severity: "critical" }),
  entry("hard_safety_stop", "capless_strategy", "Strategy caps missing or invalid", { severity: "critical" }),
  entry("hard_safety_stop", "hf_breach", "Health factor or liquidation policy breach", { severity: "critical" }),
  entry("hard_safety_stop", "unknown_token", "Unknown token requires whitelist review", { severity: "critical" }),
  entry("economic_no_go", "capital_too_small", "Capital too small", {
    severity: "warning",
    requiresExternalDeposit: true,
    expectedRetryShape: "inventory_changed",
  }),
  entry("economic_no_go", "edge_below_variance_floor", "Edge below measured cost variance", {
    severity: "warning",
    expectedRetryShape: "inventory_changed",
  }),
  entry("economic_no_go", "cost_exceeds_payback_offramp_cap", "Payback cost exceeds policy cap", {
    severity: "warning",
    expectedRetryShape: "periodic",
  }),
  entry("proof_acquisition", "route_quote_stale", "Route quote stale", {
    severity: "warning",
    autoResolvable: true,
    expectedRetryShape: "bounded_backoff",
  }),
  entry("proof_acquisition", "gateway_route_unknown", "Gateway route unknown", {
    severity: "warning",
    autoResolvable: true,
    expectedRetryShape: "bounded_backoff",
  }),
  entry("proof_acquisition", "inventory_snapshot_stale", "Inventory snapshot stale", {
    severity: "warning",
    autoResolvable: true,
    expectedRetryShape: "bounded_backoff",
  }),
  entry("proof_acquisition", "rewards_unclaimed", "Reward tokens unclaimed", {
    severity: "warning",
    autoResolvable: true,
    expectedRetryShape: "receipt_confirmed",
  }),
  entry("proof_acquisition", "missing_yield_evidence", "Yield-side simulation evidence missing", {
    severity: "warning",
    autoResolvable: true,
    expectedRetryShape: "bounded_backoff",
  }),
  entry("proof_acquisition", "share_price_unwind_proof_missing", "Share-price unwind proof missing", {
    severity: "warning",
    autoResolvable: true,
    expectedRetryShape: "bounded_backoff",
  }),
  entry("proof_acquisition", "executable_candidate_stale", "Executable candidate stale", {
    severity: "warning",
    autoResolvable: true,
    expectedRetryShape: "bounded_backoff",
  }),
  entry(
    "proof_acquisition",
    "merkl_queue_not_ready_for_tiny_live_canary",
    "Merkl queue not ready for tiny live canary",
    { severity: "warning", autoResolvable: true, expectedRetryShape: "bounded_backoff" },
  ),
  entry("refill_or_inventory", "chain_under_target", "Chain under target", {
    severity: "warning",
    autoResolvable: true,
    expectedRetryShape: "receipt_confirmed",
  }),
  entry("refill_or_inventory", "gas_float_below_threshold", "Gas float below threshold", {
    severity: "warning",
    autoResolvable: true,
    expectedRetryShape: "receipt_confirmed",
  }),
  entry("refill_or_inventory", "idle_dust_consolidation_due", "Idle dust consolidation due", {
    severity: "warning",
    autoResolvable: true,
    expectedRetryShape: "receipt_confirmed",
  }),
  entry(
    "refill_or_inventory",
    "expected_net_below_receipt_cost_p90_floor",
    "Expected net below measured p90 receipt+cost floor (common on base for wBTC.OFT refills)",
    { severity: "warning", autoResolvable: true, expectedRetryShape: "inventory_changed" },
  ),
  entry(
    "refill_or_inventory",
    "bridge_quote_cost_above_discretionary_ceiling",
    "Bridge/quote cost above discretionary review ceiling (causes manualReview on capital rebalance)",
    { severity: "warning", autoResolvable: false, expectedRetryShape: "manual" },
  ),
  entry(
    "refill_or_inventory",
    "routing_exhausted",
    "All known routes exhausted or timed out for the asset/chain pair",
    { severity: "warning", autoResolvable: true, expectedRetryShape: "bounded_backoff" },
  ),
  entry("cooldown", "fresh_roundtrip_proof_recorded", "Fresh round-trip proof recorded", { expectedRetryShape: "eta" }),
  entry("cooldown", "campaign_window_pending", "Campaign window pending", { expectedRetryShape: "eta" }),
  entry("cooldown", "harvest_period_pending", "Harvest period pending", { expectedRetryShape: "eta" }),
  entry("executor_unbound", "adapter_missing", "Executor adapter missing", {
    severity: "warning",
    expectedRetryShape: "code_queue",
  }),
  entry("executor_unbound", "protocol_binding_not_ready", "Protocol binding not ready", {
    severity: "warning",
    expectedRetryShape: "code_queue",
  }),
  entry("executor_unbound", "executor_missing", "Executor missing", {
    severity: "warning",
    expectedRetryShape: "code_queue",
  }),
  entry("executor_unbound", "unsupported_binding_kind", "Unsupported binding kind", {
    severity: "warning",
    expectedRetryShape: "code_queue",
  }),
  entry("code_required", "specific_recipe_required", "Specific recipe required", {
    severity: "warning",
    expectedRetryShape: "code_queue",
  }),
  entry("code_required", "strategy_tiny_live_cap_missing", "Strategy tiny live cap missing", {
    severity: "warning",
    expectedRetryShape: "code_queue",
  }),
  entry("code_required", "canary_graduation_failure_pause", "Canary graduation paused by failure state", {
    severity: "warning",
    expectedRetryShape: "code_queue",
  }),
  entry("code_required", "entry_asset_not_whitelisted", "Entry asset not whitelisted", {
    severity: "warning",
    expectedRetryShape: "code_queue",
  }),
  entry("code_required", "matched_token_missing", "Matched token missing", {
    severity: "warning",
    expectedRetryShape: "code_queue",
  }),
  entry("manual_review", "unknown_blocker_code", "Unknown blocker code", {
    severity: "warning",
    expectedRetryShape: "manual",
  }),
  entry("filter", "manual_operator_review_required", "Manual operator review required", {
    severity: "warning",
    expectedRetryShape: "manual",
  }),
  entry("payback_lifecycle", "payback_settlement_pending", "Payback settlement pending", {
    severity: "warning",
    expectedRetryShape: "periodic",
  }),
  entry("payback_lifecycle", "profit_attribution_gap", "Profit attribution gap", {
    severity: "warning",
    expectedRetryShape: "periodic",
  }),
  entry(
    "reader",
    "evm_source_disagreement",
    "EVM wallet scan vs autopilot capitalManager disagree beyond threshold (unified-nav-reader halt)",
    { severity: "warning", autoResolvable: true, expectedRetryShape: "receipt_confirmed" },
  ),
  entry(
    "reader",
    "base_rpc_degraded",
    "Base chain RPCs failing for receipt/position reads (causes receipt_read_failed flood and autopilot snapshot drift)",
    { severity: "warning", autoResolvable: true, expectedRetryShape: "bounded_backoff" },
  ),
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

const LEGACY_RULES = [
  { match: (t) => t.includes("same_chain_unprofitable"), code: "filter:same_chain_unprofitable" },
  {
    match: (t) => t === "min_position_blocked" || t === "target_allocation_below_min_position_usd",
    code: "filter:min_position_blocked",
  },
  {
    match: (t) => t.includes("bridge_cost_greater_than_expected_net"),
    code: "filter:bridge_cost_greater_than_expected_net",
  },
  { match: (t) => t.includes("no_positive_cap_or_inventory_usd"), code: "filter:no_positive_cap_or_inventory_usd" },
  {
    match: (t, ctx) =>
      ctx.candidateScopedInventory === true && (t.includes("inventory_missing") || t.includes("inventory_unknown")),
    code: "filter:inventory_mismatch",
  },
  {
    match: (t, ctx) => ctx.staleAfterRefreshFailed === true && t.includes("executable_candidate_stale"),
    code: "filter:executable_candidate_stale",
  },
  { match: (t) => t.includes("kill_switch"), code: "hard_safety_stop:kill_switch_active" },
  { match: (t) => t.includes("dev_lock"), code: "hard_safety_stop:dev_lock_active" },
  {
    match: (t) =>
      t.includes("readyforlivebroadcast") ||
      t.includes("ready_for_live_broadcast") ||
      t.includes("dispatch_not_ready_for_live_broadcast"),
    code: "hard_safety_stop:readiness_guard_blocked",
  },
  { match: (t) => t.includes("operator_hold"), code: "hard_safety_stop:operator_hold" },
  {
    match: (t) => t.includes("paused_by_auto_kill") || t.includes("auto_kill_triggered"),
    code: "hard_safety_stop:paused_by_auto_kill",
  },
  {
    match: (t) => t.includes("position_exiting") || t.includes("exit_descriptor") || t.includes("unwind_descriptor"),
    code: "hard_safety_stop:position_exiting",
  },
  {
    match: (t) =>
      t.includes("strategy_caps_missing") ||
      t.includes("strategy_caps_invalid") ||
      t === "missing_caps" ||
      t.includes("capless"),
    code: "hard_safety_stop:capless_strategy",
  },
  {
    match: (t) => t.includes("hf_breach") || t.includes("hf_below") || t.includes("liquidation"),
    code: "hard_safety_stop:hf_breach",
  },
  { match: (t) => t.includes("entry_asset_not_whitelisted"), code: "code_required:entry_asset_not_whitelisted" },
  { match: (t) => t.includes("matched_token_missing"), code: "code_required:matched_token_missing" },
  { match: (t) => t.includes("manual_operator_review_required"), code: "filter:manual_operator_review_required" },
  { match: (t) => t.includes("unknown_token") || t.includes("whitelist"), code: "hard_safety_stop:unknown_token" },

  {
    match: (t) => t.includes("capital_too_small") || t.includes("insufficient_capital"),
    code: "economic_no_go:capital_too_small",
  },
  {
    match: (t) => t.includes("payback") && t.includes("cost"),
    code: "economic_no_go:cost_exceeds_payback_offramp_cap",
  },
  {
    match: (t) =>
      t.includes("unprofitable") ||
      t.includes("variance_floor") ||
      t.includes("policy_reject") ||
      t.includes("ev_below"),
    code: "economic_no_go:edge_below_variance_floor",
  },

  {
    match: (t) => t.includes("stale") && (t.includes("quote") || t.includes("route")),
    code: "proof_acquisition:route_quote_stale",
  },
  { match: (t) => t.includes("executable_candidate_stale"), code: "proof_acquisition:executable_candidate_stale" },
  {
    match: (t) => t.includes("share_price_unwind_proof_missing"),
    code: "proof_acquisition:share_price_unwind_proof_missing",
  },
  {
    match: (t) => t.includes("merkl_queue_not_ready_for_tiny_live_canary"),
    code: "proof_acquisition:merkl_queue_not_ready_for_tiny_live_canary",
  },
  {
    match: (t) =>
      t.includes("gateway_route") ||
      t.includes("route_unknown") ||
      t.includes("route_currently_unavailable") ||
      t.includes("missing_gateway_quote"),
    code: "proof_acquisition:gateway_route_unknown",
  },
  {
    match: (t) => t.includes("inventory") || t.includes("wallet_holdings"),
    code: "proof_acquisition:inventory_snapshot_stale",
  },
  {
    match: (t) => t.includes("rewards_unclaimed") || t.includes("claim_blocked") || t.includes("claimable"),
    code: "proof_acquisition:rewards_unclaimed",
  },
  {
    match: (t) => t.includes("missing_yield_evidence") || t.includes("yield_evidence_missing"),
    code: "proof_acquisition:missing_yield_evidence",
  },

  {
    match: (t) =>
      t.includes("chain_under_target") || t.includes("refill_routes_unresolved") || t.includes("refill_required"),
    code: "refill_or_inventory:chain_under_target",
  },
  {
    match: (t) => t.includes("gas_float") || t.includes("native_balance") || t.includes("missing_gateway_gas"),
    code: "refill_or_inventory:gas_float_below_threshold",
  },
  {
    match: (t) => t.includes("idle") && t.includes("consolidation"),
    code: "refill_or_inventory:idle_dust_consolidation_due",
  },

  { match: (t) => t.includes("fresh_roundtrip_proof_recorded"), code: "cooldown:fresh_roundtrip_proof_recorded" },
  { match: (t) => t.includes("campaign_window"), code: "cooldown:campaign_window_pending" },
  { match: (t) => t.includes("harvest_period"), code: "cooldown:harvest_period_pending" },
  { match: (t) => t.includes("cooldown"), code: "cooldown:fresh_roundtrip_proof_recorded" },

  { match: (t) => t.includes("protocol_binding_not_ready"), code: "executor_unbound:protocol_binding_not_ready" },
  { match: (t) => t.includes("unsupported_binding_kind"), code: "executor_unbound:unsupported_binding_kind" },
  {
    match: (t) =>
      t.includes("adapter_missing") ||
      t.includes("executor_missing") ||
      t.includes("executor_binding_missing") ||
      t.includes("protocol_binding_executor_missing"),
    code: "executor_unbound:executor_missing",
  },
  {
    match: (t) => t.includes("strategy_tiny_live_cap_missing") || t.includes("tiny_live_cap_missing"),
    code: "code_required:strategy_tiny_live_cap_missing",
  },
  {
    match: (t) => t.includes("canary_graduation_failure_pause"),
    code: "code_required:canary_graduation_failure_pause",
  },
  {
    match: (t) => t.includes("specific_recipe_required") || t.includes("code_required"),
    code: "code_required:specific_recipe_required",
  },
  { match: (t) => t.includes("payback_settlement_pending"), code: "payback_lifecycle:payback_settlement_pending" },
  { match: (t) => t.includes("profit_attribution_gap"), code: "payback_lifecycle:profit_attribution_gap" },
];

function codeForLegacy(raw, context = {}) {
  const text = normalizeLegacyText(raw);
  if (!text) return "manual_review:unknown_blocker_code";
  if (BLOCKER_CODES[text]) return text;
  if (FORBIDDEN_LEGACY_NAMES.has(text)) return "code_required:specific_recipe_required";

  for (const rule of LEGACY_RULES) {
    if (rule.match(text, context)) return rule.code;
  }
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
