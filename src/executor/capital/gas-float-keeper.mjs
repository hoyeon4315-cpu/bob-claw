function finite(value) {
  return Number.isFinite(value) ? value : null;
}

export function evaluateGasFloatKeeper({
  targetBalances,
  balancesByChain = {},
  now = new Date().toISOString(),
  minimumTopUpUsd = 1,
  activeChainSet = null,
} = {}) {
  const actions = [];
  const observations = [];

  for (const item of targetBalances.items || []) {
    const active = !activeChainSet || activeChainSet.has(item.chain);
    const currentNativeUsd = finite(balancesByChain[item.chain]?.nativeUsd) ?? 0;
    const shortfallUsd = Math.max(0, (item.gasFloatTargetUsd || 0) - currentNativeUsd);
    if (active && currentNativeUsd < (item.gasFloatMinUsd || 0) && shortfallUsd >= minimumTopUpUsd) {
      actions.push({
        type: "gas_float_top_up",
        chain: item.chain,
        amountUsd: shortfallUsd,
        targetUsd: item.gasFloatTargetUsd,
        currentUsd: currentNativeUsd,
      });
    } else {
      observations.push({
        chain: item.chain,
        currentUsd: currentNativeUsd,
        minUsd: item.gasFloatMinUsd,
        targetUsd: item.gasFloatTargetUsd,
        status: !active ? "inactive" : currentNativeUsd < (item.gasFloatTargetUsd || 0) ? "below_target" : "healthy",
      });
    }
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    decision: actions.length > 0 ? "TOP_UP_REQUIRED" : "HEALTHY",
    actions,
    observations,
  };
}
