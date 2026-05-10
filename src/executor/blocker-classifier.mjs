const CATEGORY_PATTERNS = Object.freeze([
  ["unsafe", /key|private|signer_bypass|policy_bypass|kill_switch_bypass|audit_rewrite|raw_tx_sign/i],
  ["policy", /policy|cap|slippage|stale_quote|approval|health_factor|liquidation|auto_execute|kill_switch|expected_net|positive_ev/i],
  ["capital", /insufficient|deposit|funds|balance|capital|inventory|gas_gap|source_inventory|same_chain_unprofitable/i],
  ["chain", /chain_|_down|rpc.*failed|all rpc endpoints failed|gateway_route_currently_unavailable/i],
  ["reader", /reader|position_mark|adapter_missing|rpc_failed|timeout|call_exception/i],
  ["source", /defillama|merkl|pendle|source|feed|endpoint|retired/i],
  ["external", /fetch failed|econn|provider|429|rate limit|network|mempool/i],
  ["operator", /manual|operator|dev_lock|approval_required/i],
  ["transient", /retry|temporar|stale|pending|cooldown/i],
  ["permanent", /unsupported|not_bound|contract_not_generalized|not implemented/i],
]);

const FIXABILITY_BY_CATEGORY = Object.freeze({
  permanent: "code_fixable",
  transient: "external_provider",
  capital: "operator_deposit_gated",
  policy: "policy_or_cap_rule_fixable",
  operator: "operator_deposit_gated",
  source: "external_provider",
  chain: "external_provider",
  reader: "code_fixable",
  external: "external_provider",
  unsafe: "unsafe_to_fix",
});

export function classifyBlocker(reason = "", context = {}) {
  const text = String(reason || context.reason || "").trim();
  const category = CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || "operator";
  return {
    category,
    fixability: FIXABILITY_BY_CATEGORY[category] || "code_fixable",
    reason: text || null,
    strategyId: context.strategyId || null,
    chain: context.chain || inferBlockedChain(text),
    source: context.source || null,
    scope: category === "chain" ? "chain" : category === "source" ? "source" : category === "reader" ? "reader" : category === "policy" ? "strategy" : "system",
    signerDispatchAllowed: category !== "policy" && category !== "unsafe" ? false : false,
  };
}

function inferBlockedChain(text) {
  const sameChain = text.match(/same_chain_unprofitable:need_\$?[0-9.]+_on_([a-z0-9_-]+)/i);
  if (sameChain?.[1]) return sameChain[1];
  return text.match(/\bchain[: -]([a-z0-9_-]+)/i)?.[1] ?? null;
}

export function isolateBlockedSlots(strategies = [], blockers = []) {
  const classified = blockers.map((blocker) => typeof blocker === "string" ? classifyBlocker(blocker) : blocker);
  const chainBlockers = new Set(classified.filter((item) => item.category === "chain").map((item) => item.chain).filter(Boolean));
  const sourceBlockers = new Set(classified.filter((item) => item.category === "source").map((item) => item.source).filter(Boolean));
  const strategyBlockers = new Set(classified.filter((item) => item.strategyId).map((item) => item.strategyId));
  return strategies.map((strategy) => {
    if (strategyBlockers.has(strategy.strategyId)) return { ...strategy, isolated: true, isolationReason: "strategy_blocker" };
    if (chainBlockers.has(strategy.chain)) return { ...strategy, isolated: true, isolationReason: "chain_blocker" };
    if (sourceBlockers.has(strategy.source)) return { ...strategy, isolated: true, isolationReason: "source_blocker" };
    return { ...strategy, isolated: false, isolationReason: null };
  });
}

export function consecutiveFailureVerdict({ failureCount = 0, maxFailures = 3, strategyId = null } = {}) {
  const count = Number(failureCount || 0);
  return {
    strategyId,
    failureCount: count,
    maxFailures,
    paused: count >= maxFailures,
    blocker: count >= maxFailures ? classifyBlocker("max_consecutive_failures_reached", { strategyId }) : null,
  };
}
