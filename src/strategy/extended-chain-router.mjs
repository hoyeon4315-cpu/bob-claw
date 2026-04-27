import { computeNetBtcApy } from "../strategy/btc-roundtrip-router.mjs";
import { fetchRouteQuotes } from "../strategy/route-cost-discovery.mjs";

const BTC_PRICE_USD = 95000;
const SATOSHIS_PER_BTC = 100_000_000;

// Gateway costs
const GATEWAY_COSTS = {
  onrampSats: 3000,
  offrampSats: 3500,
};

// Chain gas
const CHAIN_GAS = {
  base: { entryUsd: 0.06, exitUsd: 0.06 },
  ethereum: { entryUsd: 5.0, exitUsd: 3.0 },
  arbitrum: { entryUsd: 0.30, exitUsd: 0.30 },
  polygon: { entryUsd: 0.05, exitUsd: 0.05 },
  optimism: { entryUsd: 0.15, exitUsd: 0.15 },
  "bob l2": { entryUsd: 0.06, exitUsd: 0.06 },
  bnb: { entryUsd: 0.05, exitUsd: 0.05 },
  avalanche: { entryUsd: 0.10, exitUsd: 0.10 },
  berachain: { entryUsd: 0.20, exitUsd: 0.20 },
  unichain: { entryUsd: 0.06, exitUsd: 0.06 },
  soneium: { entryUsd: 0.10, exitUsd: 0.10 },
  sei: { entryUsd: 0.05, exitUsd: 0.05 },
  sonic: { entryUsd: 0.05, exitUsd: 0.05 },
  // NON-GATEWAY chains
  solana: { entryUsd: 0.01, exitUsd: 0.01 },   // cheap but bridge is expensive
  aptos: { entryUsd: 0.01, exitUsd: 0.01 },
  sui: { entryUsd: 0.01, exitUsd: 0.01 },
  "hyperliquid l1": { entryUsd: 0.01, exitUsd: 0.01 },
  starknet: { entryUsd: 0.50, exitUsd: 0.50 },
  "world chain": { entryUsd: 0.06, exitUsd: 0.06 },
  move: { entryUsd: 0.01, exitUsd: 0.01 },
  cardano: { entryUsd: 0.50, exitUsd: 0.50 },
  canto: { entryUsd: 0.05, exitUsd: 0.05 },
  flare: { entryUsd: 0.05, exitUsd: 0.05 },
  plasma: { entryUsd: 0.10, exitUsd: 0.10 },
  stellar: { entryUsd: 0.01, exitUsd: 0.01 },
  osmosis: { entryUsd: 0.01, exitUsd: 0.01 },
  ink: { entryUsd: 0.06, exitUsd: 0.06 },
  ton: { entryUsd: 0.01, exitUsd: 0.01 },
  tron: { entryUsd: 0.01, exitUsd: 0.01 },
  rootstock: { entryUsd: 0.05, exitUsd: 0.05 },
  neutron: { entryUsd: 0.01, exitUsd: 0.01 },
};

// Bridge costs to NON-GATEWAY chains (from Base, as our entry point)
// These are manual bridges AFTER Gateway onramp
const NON_GATEWAY_BRIDGE = {
  // EVM-compatible L2s (relatively cheap via Across/LiFi)
  arbitrum: { type: "evm_l2", bridgeBps: 15, minBridgeUsd: 0.50 },
  polygon: { type: "evm_l2", bridgeBps: 15, minBridgeUsd: 0.30 },
  "world chain": { type: "evm_l2", bridgeBps: 15, minBridgeUsd: 0.50 },
  ink: { type: "evm_l2", bridgeBps: 15, minBridgeUsd: 0.50 },
  starknet: { type: "evm_l2", bridgeBps: 25, minBridgeUsd: 1.00 },
  canto: { type: "evm", bridgeBps: 20, minBridgeUsd: 0.50 },
  flare: { type: "evm", bridgeBps: 20, minBridgeUsd: 0.50 },
  plasma: { type: "evm", bridgeBps: 20, minBridgeUsd: 0.50 },
  rootstock: { type: "evm", bridgeBps: 25, minBridgeUsd: 1.00 },
  
  // Non-EVM (expensive bridges)
  solana: { type: "non_evm", bridgeBps: 100, minBridgeUsd: 5.00, notes: "Wormhole/Portal required" },
  aptos: { type: "non_evm", bridgeBps: 150, minBridgeUsd: 8.00, notes: "LayerZero/Wormhole" },
  sui: { type: "non_evm", bridgeBps: 100, minBridgeUsd: 5.00, notes: "Wormhole/Portal" },
  "hyperliquid l1": { type: "non_evm", bridgeBps: 80, minBridgeUsd: 4.00, notes: "Arbitrum→Hyperliquid bridge" },
  move: { type: "non_evm", bridgeBps: 120, minBridgeUsd: 6.00, notes: "LayerZero" },
  cardano: { type: "non_evm", bridgeBps: 200, minBridgeUsd: 10.00, notes: "Indigo/Milkomeda" },
  stellar: { type: "non_evm", bridgeBps: 150, minBridgeUsd: 8.00, notes: "Stellar→EVM bridge limited" },
  osmosis: { type: "non_evm", bridgeBps: 100, minBridgeUsd: 5.00, notes: "IBC→Axelar" },
  ton: { type: "non_evm", bridgeBps: 120, minBridgeUsd: 6.00, notes: "TON Bridge" },
  tron: { type: "non_evm", bridgeBps: 80, minBridgeUsd: 4.00, notes: "Tron→EVM bridge" },
  neutron: { type: "non_evm", bridgeBps: 100, minBridgeUsd: 5.00, notes: "IBC→Axelar" },
};

const GATEWAY_11 = new Set([
  "ethereum", "base", "bsc", "avalanche", "optimism",
  "berachain", "unichain", "soneium", "sei", "sonic", "bob l2"
]);

function sats(btcAmount) {
  return Math.round(btcAmount * SATOSHIS_PER_BTC);
}
function btc(satsAmount) {
  return satsAmount / SATOSHIS_PER_BTC;
}

export function computeExtendedNetBtcApy(opportunity = {}, principalBtc = 1.0, holdDays = 30) {
  const chain = (opportunity.chain || "").toLowerCase().trim();
  const isGateway = GATEWAY_11.has(chain);
  const principalUsd = principalBtc * BTC_PRICE_USD;

  // Base net APY (same as before)
  const baseNet = computeNetBtcApy(opportunity, principalBtc, holdDays);

  if (isGateway) {
    // Gateway destination: direct route
    return {
      ...baseNet,
      routeType: "gateway_direct",
      isGateway: true,
      bridgeToChainCostBtc: 0,
      bridgeFromChainCostBtc: 0,
      manualBridgeNotes: null,
    };
  }

  // NON-GATEWAY: need manual bridge from Base (our Gateway entry point)
  const bridgeConfig = NON_GATEWAY_BRIDGE[chain];
  if (!bridgeConfig) {
    return {
      ...baseNet,
      viable: false,
      routeType: "unsupported_chain",
      reason: `No bridge config for ${chain}`,
    };
  }

  // Bridge cost: to non-Gateway + back to Base
  const bridgeToUsd = Math.max(principalUsd * (bridgeConfig.bridgeBps / 10000), bridgeConfig.minBridgeUsd);
  const bridgeFromUsd = Math.max(principalUsd * (bridgeConfig.bridgeBps / 10000), bridgeConfig.minBridgeUsd);
  const totalBridgeUsd = bridgeToUsd + bridgeFromUsd;
  const totalBridgeBtc = btc(sats(totalBridgeUsd / BTC_PRICE_USD));

  // Total cost = Gateway round-trip + chain gas + manual bridges + swap
  const gas = CHAIN_GAS[chain] || { entryUsd: 0.50, exitUsd: 0.50 };
  const gasCostBtc = btc(sats((gas.entryUsd + gas.exitUsd) / BTC_PRICE_USD));
  const gatewayCostBtc = btc(GATEWAY_COSTS.onrampSats + GATEWAY_COSTS.offrampSats);
  const swapCostBtc = opportunity.isStable ? principalBtc * 0.0050 : 0;

  const totalCostBtc = gatewayCostBtc + gasCostBtc + totalBridgeBtc + swapCostBtc;

  // Recalculate net
  const apyDecimal = (opportunity.apy ?? 0) / 100;
  const yearFraction = holdDays / 365;
  const grossYieldBtc = principalBtc * apyDecimal * yearFraction;
  const netYieldBtc = grossYieldBtc - totalCostBtc;
  const netApy = principalBtc > 0 ? (netYieldBtc / principalBtc) * (365 / holdDays) * 100 : 0;
  const breakevenDays = grossYieldBtc > 0 ? Math.ceil(totalCostBtc / (grossYieldBtc / holdDays)) : Infinity;

  return {
    ...baseNet,
    routeType: "post_gateway_manual_bridge",
    isGateway: false,
    bridgeToChainCostBtc: btc(sats(bridgeToUsd / BTC_PRICE_USD)),
    bridgeFromChainCostBtc: btc(sats(bridgeFromUsd / BTC_PRICE_USD)),
    totalBridgeCostBtc: totalBridgeBtc,
    totalCostBtc,
    grossYieldBtc,
    netYieldBtc,
    netApy,
    breakevenDays,
    viable: netYieldBtc > 0,
    manualBridgeNotes: bridgeConfig.notes || null,
    bridgeType: bridgeConfig.type,
  };
}

export function rankAllChains(opportunities = [], principalBtc = 1.0, holdDays = 30) {
  const ranked = opportunities
    .map((opp) => ({
      ...opp,
      netBtc: computeExtendedNetBtcApy(opp, principalBtc, holdDays),
    }))
    .sort((a, b) => b.netBtc.netApy - a.netBtc.netApy);
  return ranked;
}
