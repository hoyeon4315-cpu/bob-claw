export const MERKL_AUTO_ENTRY_POLICY = Object.freeze({
  profileId: "merkl_auto_entry_live_validation_v1",
  enabled: true,
  minPriorityScore: 55,
  requireInventoryReady: true,
  requireProtocolBindingReady: true,
  allowedCapabilityGaps: Object.freeze([
    "current_inventory_entry_route_required",
    "chain_live_dex_route_unproven_or_missing_stable_output",
    "ethereum_l1_gas_ev_positive_check_required",
  ]),
  whitelistedEntrySymbols: Object.freeze([
    "BTC",
    "CBTC",
    "CBBTC",
    "DAI",
    "ETH",
    "LBTC",
    "PAXG",
    "RLUSD",
    "SOLVBTC",
    "TBTC",
    "USDC",
    "USDT",
    "WBTC",
    "WBTC.OFT",
    "WETH",
    "XAUT",
  ]),
});

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizedSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function entrySymbolsWhitelisted(queueItem = {}, policy = MERKL_AUTO_ENTRY_POLICY) {
  const whitelist = new Set((policy.whitelistedEntrySymbols || []).map(normalizedSymbol));
  const matchedSymbol = normalizedSymbol(queueItem.executionReadiness?.matchedToken?.ticker);
  if (matchedSymbol && whitelist.has(matchedSymbol)) return true;
  const symbols = queueItem.entryAssets?.length
    ? queueItem.entryAssets
    : queueItem.tokenSymbols?.length
      ? queueItem.tokenSymbols
      : [queueItem.executionReadiness?.matchedToken?.ticker].filter(Boolean);
  if (!symbols.length) return false;
  return symbols.every((symbol) => whitelist.has(normalizedSymbol(symbol)));
}

export function merklAutoEntryPolicy(overrides = {}) {
  return {
    ...MERKL_AUTO_ENTRY_POLICY,
    ...overrides,
    allowedCapabilityGaps: [
      ...MERKL_AUTO_ENTRY_POLICY.allowedCapabilityGaps,
      ...(overrides.allowedCapabilityGaps || []),
    ],
    whitelistedEntrySymbols: [
      ...MERKL_AUTO_ENTRY_POLICY.whitelistedEntrySymbols,
      ...(overrides.whitelistedEntrySymbols || []),
    ],
  };
}

export function evaluateMerklAutoEntry(queueItem = {}, {
  policy: policyInput = {},
  bindingSupported = false,
} = {}) {
  const policy = merklAutoEntryPolicy(policyInput);
  const blockers = [];
  if (!policy.enabled) blockers.push("merkl_auto_entry_disabled");
  if ((finite(queueItem.priorityScore) ?? 0) < policy.minPriorityScore) {
    blockers.push("priority_score_below_auto_entry_threshold");
  }
  if (policy.requireProtocolBindingReady && queueItem.protocolBindingPlan?.status !== "binding_ready") {
    blockers.push("protocol_binding_not_ready");
  }
  if (!bindingSupported) blockers.push("protocol_binding_executor_missing");
  if (policy.requireInventoryReady && queueItem.executionReadiness?.status !== "inventory_ready") {
    blockers.push(queueItem.executionReadiness?.status || "inventory_not_ready");
  }
  if (!entrySymbolsWhitelisted(queueItem, policy)) blockers.push("entry_asset_not_whitelisted");
  const allowedGaps = new Set(policy.allowedCapabilityGaps || []);
  const disallowedGap = (queueItem.capabilityGaps || []).find((gap) => !allowedGaps.has(gap));
  if (disallowedGap) blockers.push(disallowedGap);

  return {
    policyProfile: policy.profileId,
    status: blockers.length === 0 ? "ready" : "blocked",
    autoExecute: blockers.length === 0,
    blockers: [...new Set(blockers)],
    minPriorityScore: policy.minPriorityScore,
  };
}
