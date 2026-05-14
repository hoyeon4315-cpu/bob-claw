// Gateway availability policy check.
//
// Rejects any intent that references a Gateway-backed cross-chain method
// while Gateway is disabled (committed flag OR runtime state file). This
// is the policy-engine backstop that stops a Gateway intent even if the
// planner was run with stale availability state.

import { GATEWAY_POLICY, isGatewayMethod, resolveGatewayAvailability } from "../../config/gateway.mjs";

function normalizeGatewayChain(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === "bnb" || normalized === "bnb chain") return "bsc";
  if (normalized === "berachain" || normalized === "bera chain") return "bera";
  if (normalized === "bob l2" || normalized === "bob chain") return "bob";
  return normalized;
}

function normalizeGatewayToken(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

function routeChainsFromIntent(intent = {}) {
  const route =
    intent.gatewayRoute ||
    intent.route ||
    intent.routeContext ||
    intent.metadata?.gatewayRoute ||
    intent.metadata?.route ||
    intent.metadata?.routeContext ||
    intent.quote?.route ||
    intent.quote?.routeContext ||
    {};
  const srcChain = normalizeGatewayChain(
    route.srcChain ||
      route.fromChain ||
      route.sourceChain ||
      intent.srcChain ||
      intent.fromChain ||
      intent.metadata?.srcChain ||
      intent.metadata?.fromChain ||
      null,
  );
  const dstChain = normalizeGatewayChain(
    route.dstChain ||
      route.toChain ||
      route.destinationChain ||
      intent.dstChain ||
      intent.toChain ||
      intent.metadata?.dstChain ||
      intent.metadata?.toChain ||
      null,
  );
  return srcChain && dstChain ? { srcChain, dstChain } : null;
}

function routeTokensFromIntent(intent = {}) {
  const route =
    intent.gatewayRoute ||
    intent.route ||
    intent.routeContext ||
    intent.metadata?.gatewayRoute ||
    intent.metadata?.route ||
    intent.metadata?.routeContext ||
    intent.quote?.route ||
    intent.quote?.routeContext ||
    {};
  const srcToken = normalizeGatewayToken(
    route.srcToken || route.fromToken || route.sourceToken || intent.srcToken || intent.metadata?.srcToken || null,
  );
  const dstToken = normalizeGatewayToken(
    route.dstToken || route.toToken || route.destinationToken || intent.dstToken || intent.metadata?.dstToken || null,
  );
  return srcToken || dstToken ? { srcToken, dstToken } : null;
}

function routeChainsFromApiRoute(route = {}) {
  const srcChain = normalizeGatewayChain(route.srcChain || route.fromChain || route.sourceChain || null);
  const dstChain = normalizeGatewayChain(route.dstChain || route.toChain || route.destinationChain || null);
  return srcChain && dstChain ? { srcChain, dstChain } : null;
}

function routeTokensFromApiRoute(route = {}) {
  const srcToken = normalizeGatewayToken(route.srcToken || route.fromToken || route.sourceToken || null);
  const dstToken = normalizeGatewayToken(route.dstToken || route.toToken || route.destinationToken || null);
  return srcToken || dstToken ? { srcToken, dstToken } : null;
}

function currentRouteAvailable({ intent, availability }) {
  if (!Array.isArray(availability?.routes)) return null;
  const requested = routeChainsFromIntent(intent);
  if (!requested) return null;
  const requestedTokens = routeTokensFromIntent(intent);
  return availability.routes.some((route) => {
    const current = routeChainsFromApiRoute(route);
    if (current?.srcChain !== requested.srcChain || current?.dstChain !== requested.dstChain) return false;
    if (!requestedTokens) return true;
    const currentTokens = routeTokensFromApiRoute(route);
    if (requestedTokens.srcToken && currentTokens?.srcToken !== requestedTokens.srcToken) return false;
    if (requestedTokens.dstToken && currentTokens?.dstToken !== requestedTokens.dstToken) return false;
    return true;
  });
}

export async function checkGatewayAvailability({
  intent,
  policy = GATEWAY_POLICY,
  availability = null,
  now = new Date().toISOString(),
} = {}) {
  const resolved = availability || (await resolveGatewayAvailability({ policy, now }));
  const intentMethod = intent?.method || intent?.fundingMethod || intent?.executor || null;
  const intentType = String(intent?.type || intent?.intentType || "").toLowerCase();
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
    const routeAvailable = currentRouteAvailable({ intent, availability: resolved });
    if (routeAvailable === false) {
      return {
        policy: "gateway_availability",
        observedAt: resolved.observedAt,
        decision: "BLOCK",
        blockers: ["gateway_route_currently_unavailable"],
        gatewayAvailable: true,
        routeAvailable: false,
        reason: "gateway_route_currently_unavailable",
      };
    }
    return {
      policy: "gateway_availability",
      observedAt: resolved.observedAt,
      decision: "ALLOW",
      blockers: [],
      gatewayAvailable: true,
      routeAvailable,
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
