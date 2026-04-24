// Bridge provider registry.
//
// Catalogs every cross-chain bridge provider the planner may consider
// beyond BOB Gateway. Status values are deterministic and change only
// through a committed diff:
//
//   - "live"            : executor helper implemented and live-proven.
//   - "design_scaffold" : catalog entry only; no runtime executor yet.
//   - "disabled"        : operator hold, not selectable.
//
// Fee profiles are best-effort vendor-documented defaults. When the
// executor runs a real quote it overrides these with the quote payload.
// A provider without a live executor MUST NOT be returned as a preferred
// candidate. The planner will include it as a conditional candidate so
// the dashboard and reports can surface the gap.

export const BRIDGE_PROVIDERS = Object.freeze({
  bob_gateway: Object.freeze({
    id: "bob_gateway",
    label: "BOB Gateway",
    status: "live",
    methodIds: Object.freeze([
      "cross_chain_bridge_or_swap",
      "cross_chain_swap_via_btc_intermediate",
    ]),
    supportedChains: Object.freeze([
      "ethereum",
      "bob",
      "base",
      "bsc",
      "avalanche",
      "unichain",
      "bera",
      "optimism",
      "soneium",
      "sei",
      "sonic",
    ]),
    assetFamilies: Object.freeze(["btc"]),
    fixedCostUsdEstimate: 0.2,
    variableCostBpsEstimate: 75,
    latencyMsEstimate: 240_000,
    gatewayBacked: true,
    notes:
      "Primary BTC-family transport lane. All other providers are fallbacks activated when Gateway is paused or a non-BTC route is required.",
  }),
  across: Object.freeze({
    id: "across",
    label: "Across Protocol v3",
    status: "live",
    methodIds: Object.freeze(["cross_chain_bridge_across"]),
    supportedChains: Object.freeze([
      "ethereum",
      "base",
      "optimism",
      "unichain",
      "arbitrum",
      "polygon",
    ]),
    assetFamilies: Object.freeze(["eth", "stable", "btc"]),
    fixedCostUsdEstimate: 0.15,
    variableCostBpsEstimate: 25,
    latencyMsEstimate: 180_000,
    gatewayBacked: false,
    notes:
      "Lowest observed fee intent-based bridge; permissionless API at /suggested-fees + SpokePool.deposit. Live-proven on Base -> Optimism USDC; BSC is excluded until a chain-local SpokePool deployment is verified.",
  }),
  lifi: Object.freeze({
    id: "lifi",
    label: "LI.FI Aggregator",
    status: "live",
    methodIds: Object.freeze(["cross_chain_bridge_lifi"]),
    supportedChains: Object.freeze([
      "ethereum",
      "base",
      "optimism",
      "unichain",
      "arbitrum",
      "polygon",
      "bnb",
      "avalanche",
      "bera",
      "sei",
    ]),
    assetFamilies: Object.freeze(["eth", "stable", "btc"]),
    fixedCostUsdEstimate: 0.25,
    variableCostBpsEstimate: 45,
    latencyMsEstimate: 300_000,
    gatewayBacked: false,
    notes:
      "Aggregator /quote executor. Used as a deterministic fallback when BOB Gateway has no route for a non-BTC refill path.",
  }),
  relay: Object.freeze({
    id: "relay",
    label: "Relay Protocol",
    status: "design_scaffold",
    methodIds: Object.freeze(["cross_chain_bridge_relay"]),
    supportedChains: Object.freeze([
      "ethereum",
      "base",
      "optimism",
      "unichain",
      "bera",
    ]),
    assetFamilies: Object.freeze(["eth", "stable"]),
    fixedCostUsdEstimate: 0.1,
    variableCostBpsEstimate: 15,
    latencyMsEstimate: 60_000,
    gatewayBacked: false,
    notes:
      "Intent-based bridge; fastest observed latency for small EVM rotations. Good candidate for gas-float-keeper native refills where Gas.Zip is unsupported.",
  }),
  stargate: Object.freeze({
    id: "stargate",
    label: "Stargate v2 / LayerZero",
    status: "design_scaffold",
    methodIds: Object.freeze(["cross_chain_bridge_stargate"]),
    supportedChains: Object.freeze([
      "ethereum",
      "base",
      "optimism",
      "unichain",
      "bnb",
      "avalanche",
      "bera",
      "sonic",
      "sei",
    ]),
    assetFamilies: Object.freeze(["stable", "eth"]),
    fixedCostUsdEstimate: 0.3,
    variableCostBpsEstimate: 60,
    latencyMsEstimate: 240_000,
    gatewayBacked: false,
    notes:
      "Deep USDC/USDT/ETH liquidity pools and strong Avalanche/BSC/Sonic/Sei coverage where Across is unsupported.",
  }),
});

export function listBridgeProviders({ statusFilter = null } = {}) {
  const entries = Object.values(BRIDGE_PROVIDERS);
  if (!statusFilter) return entries;
  const allowed = new Set(Array.isArray(statusFilter) ? statusFilter : [statusFilter]);
  return entries.filter((provider) => allowed.has(provider.status));
}

export function bridgeProviderByMethod(method) {
  const normalized = String(method || "").toLowerCase();
  for (const provider of Object.values(BRIDGE_PROVIDERS)) {
    if ((provider.methodIds || []).includes(normalized)) return provider;
  }
  return null;
}

export function bridgeProvidersForPair({ srcChain, dstChain, assetFamily = null } = {}) {
  const src = String(srcChain || "").toLowerCase();
  const dst = String(dstChain || "").toLowerCase();
  const family = assetFamily ? String(assetFamily).toLowerCase() : null;
  return Object.values(BRIDGE_PROVIDERS).filter((provider) => {
    if (!provider.supportedChains.includes(src)) return false;
    if (!provider.supportedChains.includes(dst)) return false;
    if (family && !(provider.assetFamilies || []).includes(family)) return false;
    return true;
  });
}

export function liveBridgeProvidersForPair(args) {
  return bridgeProvidersForPair(args).filter((provider) => provider.status === "live");
}

export function fallbackProvidersWhenGatewayPaused(args) {
  return bridgeProvidersForPair(args).filter(
    (provider) => !provider.gatewayBacked && provider.status !== "disabled",
  );
}
