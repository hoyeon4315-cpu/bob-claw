// Keep probe quote reuse inside the same freshness envelope as the executor stale-quote floor.
export const dexQuoteCacheTtlMs = 30_000;
export const refuelMaxSlippagePct = 0.05;
export const refuelMinAmountUsd = 4.0;
export const bridgeMaxCostUsd = 1.5;
export const consolidationMaxCostUsd = 0.8;
export const perCategoryDailyUsd = Object.freeze({
  probe: 3,
  refuel: 5,
  bridge: 10,
  consolidation: 5,
});

export const DISCRETIONARY_BUDGET = Object.freeze({
  dexQuoteCacheTtlMs,
  gasZipNativeRefuel: Object.freeze({
    maxQuoteLossRatio: refuelMaxSlippagePct,
    refuelMinAmountUsd,
  }),
  bridgeMovement: Object.freeze({
    quoteCostCeilingUsd: bridgeMaxCostUsd,
  }),
  consolidationMovement: Object.freeze({
    quoteCostCeilingUsd: consolidationMaxCostUsd,
  }),
  last24hBudgetUsdByCategory: perCategoryDailyUsd,
});

export function gasZipDiscretionaryBudget() {
  return DISCRETIONARY_BUDGET.gasZipNativeRefuel;
}

export function bridgeMovementDiscretionaryBudget() {
  return DISCRETIONARY_BUDGET.bridgeMovement;
}

export function consolidationDiscretionaryBudget() {
  return DISCRETIONARY_BUDGET.consolidationMovement;
}
