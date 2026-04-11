export function buildDefaultRiskPolicy() {
  return {
    schemaVersion: 1,
    projectLossCapUsd: 300,
    normalDailyLossCapUsd: 15,
    canaryDailyLossCapUsd: 5,
    maxConsecutiveFailures: 3,
    maxFailedGasCost24hUsd: 3,
    canaryWalletFloorUsd: 250,
    minNetProfitUsd: 0.3,
    minNetProfitPct: 0.005,
    staleJobMinutes: 30,
  };
}
