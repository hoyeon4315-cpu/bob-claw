import { buildTargetBalances } from "./target-balances.mjs";
import { evaluateGasFloatKeeper } from "./gas-float-keeper.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

export function buildCapitalRebalancePlan({
  strategyCaps,
  balancesByChain = {},
  now = new Date().toISOString(),
} = {}) {
  const targets = buildTargetBalances({ strategyCaps, now });
  const gasFloat = evaluateGasFloatKeeper({
    targetBalances: targets,
    balancesByChain,
    now,
  });
  const actions = [...gasFloat.actions];

  for (const item of targets.items || []) {
    const currentSettlementUsd = finite(balancesByChain[item.chain]?.settlementUsd) ?? 0;
    const shortfallUsd = Math.max(0, (item.settlementTargetUsd || 0) - currentSettlementUsd);
    if (shortfallUsd > 0) {
      actions.push({
        type: "capital_rebalance",
        chain: item.chain,
        amountUsd: shortfallUsd,
        targetUsd: item.settlementTargetUsd,
        currentUsd: currentSettlementUsd,
      });
    }
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    decision: actions.length > 0 ? "REBALANCE_REQUIRED" : "BALANCED",
    targets,
    gasFloat,
    actions,
  };
}
