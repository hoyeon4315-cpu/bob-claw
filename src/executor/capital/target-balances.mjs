import { listStrategyCaps } from "../../config/strategy-caps.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function effectivePerStrategySettlementTargetUsd(strategy = {}, chain, policy = null) {
  const perChainRaw = strategy.caps?.perChainUsd?.[chain];
  const perChainUsd = finite(perChainRaw);
  // Operator explicitly setting perChainUsd=0 means "do not target this chain".
  // Do NOT fall through to policy defaults in that case.
  if (perChainUsd === 0) return 0;
  const liveUnitUsd = finite(strategy.caps?.tinyLivePerTxUsd) ?? finite(strategy.caps?.perTxUsd);
  const canaryStartUsdMax = finite(policy?.capital?.canaryStartUsdMax);
  const maxIdleCapitalPerChainUsd = finite(policy?.capital?.maxIdleCapitalPerChainUsd);
  const candidates = [
    perChainUsd,
    liveUnitUsd,
    canaryStartUsdMax,
    maxIdleCapitalPerChainUsd,
  ].filter((value) => Number.isFinite(value) && value > 0);
  if (!candidates.length) return 0;
  return Math.min(...candidates);
}

export function buildTargetBalances({
  strategyCaps = listStrategyCaps(),
  includeInactive = false,
  policy = null,
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
      existing.settlementTargetUsd = Math.max(
        existing.settlementTargetUsd,
        effectivePerStrategySettlementTargetUsd(strategy, chain, policy),
      );
      existing.gasFloatMinUsd = Math.max(existing.gasFloatMinUsd, finite(gasFloat.minUsd) ?? 0);
      existing.gasFloatTargetUsd = Math.max(existing.gasFloatTargetUsd, finite(gasFloat.targetUsd) ?? 0);
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
