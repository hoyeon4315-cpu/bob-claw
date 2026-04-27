import { fetchRouteQuotes } from "./route-cost-discovery.mjs";
import { computeOpportunityScore } from "./opportunity-ranker.mjs";

const BTC_PRICE_USD = 95000;
const SATOSHIS_PER_BTC = 100_000_000;
const GATEWAY_COSTS = {
  onrampSats: 3000,  // ~$2.85
  offrampSats: 3500, // ~$3.32
};
const CHAIN_GAS = {
  base: { entryUsd: 0.06, exitUsd: 0.06 },
  ethereum: { entryUsd: 5.0, exitUsd: 3.0 },
  "bob l2": { entryUsd: 0.06, exitUsd: 0.06 },
  bnb: { entryUsd: 0.05, exitUsd: 0.05 },
  avalanche: { entryUsd: 0.10, exitUsd: 0.10 },
  optimism: { entryUsd: 0.15, exitUsd: 0.15 },
  berachain: { entryUsd: 0.20, exitUsd: 0.20 },
  unichain: { entryUsd: 0.06, exitUsd: 0.06 },
  soneium: { entryUsd: 0.10, exitUsd: 0.10 },
  sei: { entryUsd: 0.05, exitUsd: 0.05 },
  sonic: { entryUsd: 0.05, exitUsd: 0.05 },
};

function sats(btcAmount) {
  return Math.round(btcAmount * SATOSHIS_PER_BTC);
}
function btc(satsAmount) {
  return satsAmount / SATOSHIS_PER_BTC;
}

export function computeNetBtcApy(opportunity = {}, principalBtc = 1.0, holdDays = 30) {
  const chain = (opportunity.chain || opportunity.dstChain || "").toLowerCase();
  const gas = CHAIN_GAS[chain] || { entryUsd: 0.50, exitUsd: 0.50 };
  const principalUsd = principalBtc * BTC_PRICE_USD;

  // Gateway round-trip cost
  const gatewayCostBtc = btc(GATEWAY_COSTS.onrampSats + GATEWAY_COSTS.offrampSats);

  // Chain gas
  const gasCostBtc = btc(sats((gas.entryUsd + gas.exitUsd) / BTC_PRICE_USD));

  // Swap cost if stablecoin route
  const swapCostBtc = opportunity.isStable ? principalBtc * 0.0050 : 0; // 50 bps for BTC→stable swap

  // Total round-trip cost
  const totalCostBtc = gatewayCostBtc + gasCostBtc + swapCostBtc;

  // Gross yield
  const apyDecimal = (opportunity.apy ?? opportunity.apr ?? 0) / 100;
  const yearFraction = holdDays / 365;
  const grossYieldBtc = principalBtc * apyDecimal * yearFraction;

  // Net yield
  const netYieldBtc = grossYieldBtc - totalCostBtc;
  const netApy = principalBtc > 0 ? (netYieldBtc / principalBtc) * (365 / holdDays) * 100 : 0;
  const breakevenDays = grossYieldBtc > 0 ? Math.ceil(totalCostBtc / (grossYieldBtc / holdDays)) : Infinity;

  return {
    principalBtc,
    holdDays,
    apy: opportunity.apy ?? 0,
    grossYieldBtc,
    totalCostBtc,
    gatewayCostBtc,
    gasCostBtc,
    swapCostBtc,
    netYieldBtc,
    netApy,
    breakevenDays,
    viable: netYieldBtc > 0,
    chain,
    opportunityId: opportunity.pool || opportunity.identifier || "unknown",
  };
}

export function computeMultiHopNetApy({
  currentPosition = null,
  newOpportunity = {},
  principalBtc = 1.0,
  bridgeCostBps = 25,
  holdDays = 30,
} = {}) {
  if (!currentPosition) {
    // Fresh entry: just compute net APY of new opportunity
    return computeNetBtcApy(newOpportunity, principalBtc, holdDays);
  }

  const currentNet = computeNetBtcApy(currentPosition, principalBtc, holdDays);
  const newNet = computeNetBtcApy(newOpportunity, principalBtc, holdDays);

  const isSameChain = currentPosition.chain?.toLowerCase() === newOpportunity.chain?.toLowerCase();

  if (isSameChain) {
    // Same chain: just compare net APY directly (no bridge)
    const improvement = newNet.netApy - currentNet.netApy;
    return {
      ...newNet,
      isSameChain: true,
      improvement,
      shouldRotate: improvement > 1.0, // >1% APY improvement to justify gas
      bridgeCostBtc: 0,
      reason: improvement > 1.0 ? "same_chain_higher_yield" : "insufficient_improvement",
    };
  }

  // Cross-chain: include bridge cost
  const bridgeCostBtc = principalBtc * (bridgeCostBps / 10000);
  const newNetAfterBridge = {
    ...newNet,
    netYieldBtc: newNet.netYieldBtc - bridgeCostBtc,
    netApy: ((newNet.grossYieldBtc - newNet.totalCostBtc - bridgeCostBtc) / principalBtc) * (365 / holdDays) * 100,
    bridgeCostBtc,
  };
  newNetAfterBridge.viable = newNetAfterBridge.netYieldBtc > 0;

  const improvement = newNetAfterBridge.netApy - currentNet.netApy;

  return {
    ...newNetAfterBridge,
    isSameChain: false,
    improvement,
    shouldRotate: improvement > 1.0 && newNetAfterBridge.viable,
    reason: improvement > 1.0
      ? "cross_chain_higher_yield_after_bridge"
      : newNetAfterBridge.viable
        ? "improvement_below_threshold"
        : "cross_chain_unprofitable",
  };
}

export function rankByNetBtcApy(opportunities = [], principalBtc = 1.0, holdDays = 30) {
  const ranked = opportunities
    .map((opp) => ({
      ...opp,
      netBtc: computeNetBtcApy(opp, principalBtc, holdDays),
      score: computeOpportunityScore(opp),
    }))
    .sort((a, b) => b.netBtc.netApy - a.netBtc.netApy);
  return ranked;
}

export function findBestRoute(opportunities = [], currentPosition = null, principalBtc = 1.0, holdDays = 30) {
  const ranked = rankByNetBtcApy(opportunities, principalBtc, holdDays);

  if (!currentPosition) {
    const best = ranked[0];
    return {
      action: "enter",
      target: best,
      reason: best?.netBtc.viable ? "best_net_btc_apy" : "no_viable_opportunity",
      rankedCount: ranked.length,
    };
  }

  const comparisons = ranked.map((opp) => ({
    opportunity: opp,
    comparison: computeMultiHopNetApy({ currentPosition, newOpportunity: opp, principalBtc, holdDays }),
  }));

  const best = comparisons.sort((a, b) => b.comparison.netApy - a.comparison.netApy)[0];

  if (best.comparison.shouldRotate) {
    return {
      action: "rotate",
      from: currentPosition,
      to: best.opportunity,
      improvement: best.comparison.improvement,
      reason: best.comparison.reason,
      bridgeCostBtc: best.comparison.bridgeCostBtc,
    };
  }

  return {
    action: "hold",
    current: currentPosition,
    bestAlternative: best.opportunity,
    reason: best.comparison.reason,
  };
}
