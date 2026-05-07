const DEFAULT_COSTS_USD = Object.freeze({
  bridge: 0,
  gas: null,
  claim: 0.2,
  rewardSwap: 0.3,
});

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function pushSample(map, key, value) {
  if (!key) return;
  const number = finiteNumber(value);
  if (number === null || number < 0) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(number);
}

function p90(values = []) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1);
  return sorted[index];
}

function conservativeP90(map, key, fallback) {
  const values = map.get(key) || [];
  const value = p90(values);
  if (value === null) return fallback;
  const sparseMultiplier = values.length < 20 ? 1.5 : 1;
  return Math.round(value * sparseMultiplier * 1_000_000) / 1_000_000;
}

export function buildRadarCostLedger({
  auditRecords = [],
  defaultCostsUsd = DEFAULT_COSTS_USD,
} = {}) {
  const bridgeByRoute = new Map();
  const gasByChain = new Map();
  const claimByProtocol = new Map();
  const swapByRewardToken = new Map();

  for (const record of auditRecords || []) {
    const intent = record.intent || {};
    const realized = record.realized || {};
    const costs = record.costs || {};
    const receipt = record.receipt || {};
    const chain = record.chain || intent.chain || null;
    const route = intent.entryRoute || record.entryRoute || `${intent.srcChain || chain || "unknown"}:${intent.dstChain || chain || "unknown"}`;
    const protocol = intent.protocol || record.protocol || record.protocolId || null;
    const rewardToken = intent.rewardToken || record.rewardToken || record.rewardTokenSymbol || null;

    pushSample(
      bridgeByRoute,
      route,
      firstFinite(realized.bridgeCostUsd, costs.bridgeUsd, record.bridgeCostUsd, intent.estimatedBridgeCostUsd),
    );
    pushSample(
      gasByChain,
      chain,
      firstFinite(realized.gasCostUsd, costs.gasUsd, receipt.gasCostUsd, record.gasCostUsd, intent.estimatedGasCostUsd),
    );
    pushSample(
      claimByProtocol,
      protocol,
      firstFinite(realized.claimCostUsd, costs.claimUsd, record.claimCostUsd),
    );
    pushSample(
      swapByRewardToken,
      rewardToken,
      firstFinite(realized.rewardSwapCostUsd, costs.rewardSwapUsd, record.rewardSwapCostUsd),
    );
  }

  return {
    p90BridgeCostUsdForRoute(route) {
      return conservativeP90(bridgeByRoute, route, defaultCostsUsd.bridge);
    },
    p90GasCostUsdForChain(chain) {
      return conservativeP90(gasByChain, chain, defaultCostsUsd.gas);
    },
    p90ClaimCostUsdForProtocol(protocol) {
      return conservativeP90(claimByProtocol, protocol, defaultCostsUsd.claim);
    },
    p90RewardSwapCostUsdForToken(token) {
      return conservativeP90(swapByRewardToken, token, defaultCostsUsd.rewardSwap);
    },
    sampleCounts: {
      bridgeRoutes: Object.fromEntries([...bridgeByRoute.entries()].map(([key, values]) => [key, values.length])),
      gasChains: Object.fromEntries([...gasByChain.entries()].map(([key, values]) => [key, values.length])),
      claimProtocols: Object.fromEntries([...claimByProtocol.entries()].map(([key, values]) => [key, values.length])),
      rewardTokens: Object.fromEntries([...swapByRewardToken.entries()].map(([key, values]) => [key, values.length])),
    },
  };
}
