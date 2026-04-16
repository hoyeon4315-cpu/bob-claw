import { listStrategyCaps } from "../../config/strategy-caps.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

export function buildTargetBalances({
  strategyCaps = listStrategyCaps(),
  includeInactive = false,
  now = new Date().toISOString(),
} = {}) {
  const chains = new Map();

  for (const strategy of strategyCaps) {
    if (!includeInactive && strategy.autoExecute !== true) continue;
    for (const [chain, perChainUsd] of Object.entries(strategy.caps?.perChainUsd || {})) {
      const existing = chains.get(chain) || {
        chain,
        strategyIds: [],
        settlementTargetUsd: 0,
        gasFloatMinUsd: 0,
        gasFloatTargetUsd: 0,
      };
      const gasFloat = strategy.gasFloat?.[chain] || {};
      existing.strategyIds.push(strategy.strategyId);
      existing.settlementTargetUsd += finite(perChainUsd) ?? 0;
      existing.gasFloatMinUsd += finite(gasFloat.minUsd) ?? 0;
      existing.gasFloatTargetUsd += finite(gasFloat.targetUsd) ?? 0;
      chains.set(chain, existing);
    }
  }

  const items = [...chains.values()].sort((left, right) => left.chain.localeCompare(right.chain));
  return {
    schemaVersion: 1,
    observedAt: now,
    items,
    summary: {
      chainCount: items.length,
      totalSettlementTargetUsd: items.reduce((sum, item) => sum + item.settlementTargetUsd, 0),
      totalGasFloatTargetUsd: items.reduce((sum, item) => sum + item.gasFloatTargetUsd, 0),
    },
  };
}
