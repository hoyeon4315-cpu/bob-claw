export const ETHEREUM_L1_PHASE_DISABLED_REASON = "ethereum_l1_policy_override_disabled";
export const ETHEREUM_L1_POLICY_BLOCKED_CLASSIFICATION = "policy_blocked_ethereum_l1";

export function routeFromValue(value) {
  if (value?.route) return value.route;
  return value || null;
}

export function isEthereumL1Route(value) {
  const route = routeFromValue(value);
  return route?.srcChain === "ethereum" || route?.dstChain === "ethereum";
}

export function hasEthereumL1PhaseBlock(value) {
  if (!value || typeof value !== "object") return false;
  if (value.tradeReadiness === ETHEREUM_L1_PHASE_DISABLED_REASON) return true;
  if ((value.scoreDisqualifiers || []).includes(ETHEREUM_L1_PHASE_DISABLED_REASON)) return true;
  if ((value.blockers || []).includes(`gateway_${ETHEREUM_L1_PHASE_DISABLED_REASON}`)) return true;
  return false;
}
