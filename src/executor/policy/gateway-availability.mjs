// Gateway availability policy check.
//
// Rejects any intent that references a Gateway-backed cross-chain method
// while Gateway is disabled (committed flag OR runtime state file). This
// is the policy-engine backstop that stops a Gateway intent even if the
// planner was run with stale availability state.

import { GATEWAY_POLICY, isGatewayMethod, resolveGatewayAvailability } from "../../config/gateway.mjs";

export async function checkGatewayAvailability({
  intent,
  policy = GATEWAY_POLICY,
  availability = null,
  now = new Date().toISOString(),
} = {}) {
  const resolved = availability || (await resolveGatewayAvailability({ policy, now }));
  const intentMethod = intent?.method || intent?.fundingMethod || intent?.executor || null;
  const intentType = String(intent?.type || "").toLowerCase();
  const gatewayIntent =
    isGatewayMethod(intentMethod) ||
    intentType.includes("gateway") ||
    Boolean(intent?.gatewayOrderId) ||
    Boolean(intent?.gatewayQuoteId);
  if (!gatewayIntent) {
    return {
      policy: "gateway_availability",
      observedAt: resolved.observedAt,
      decision: "ALLOW",
      blockers: [],
      gatewayAvailable: resolved.available,
      reason: resolved.reason || null,
    };
  }
  if (resolved.available) {
    return {
      policy: "gateway_availability",
      observedAt: resolved.observedAt,
      decision: "ALLOW",
      blockers: [],
      gatewayAvailable: true,
      reason: null,
    };
  }
  return {
    policy: "gateway_availability",
    observedAt: resolved.observedAt,
    decision: "BLOCK",
    blockers: [resolved.reason || "gateway_operator_paused"],
    gatewayAvailable: false,
    reason: resolved.reason || "gateway_operator_paused",
    stateFile: resolved.stateFile || null,
  };
}
