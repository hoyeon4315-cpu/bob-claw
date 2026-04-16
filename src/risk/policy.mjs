export function buildDefaultRiskPolicy() {
  return {
    schemaVersion: 2,
    // Project-wide ring-fence removed. Per-strategy caps live in each strategy's
    // own config. `null` means "no project-level cap"; the canary/execution
    // gates skip the cap check when the value is null.
    projectLossCapUsd: null,
    // Per-deployment daily loss cap. Operator may inject a value via env or
    // strategy config; default is no project-level daily cap.
    dailyLossCapUsd: null,
    maxConsecutiveFailures: 3,
    maxFailedGasCost24hUsd: 3,
    // Wallet floor stays for the canary mode that still uses it; default null
    // disables the check for non-canary deployments.
    canaryWalletFloorUsd: null,
    // Minimum net profit floor. 0 means "any strictly-positive net trade is
    // permitted". The variance check belongs in the execution gate, not here.
    minNetProfitUsd: 0,
    minNetProfitPct: 0,
    // Reserved for the gas+slippage variance floor implemented at the gate.
    minNetProfitEpsilonUsd: 0,
    staleJobMinutes: 30,
    // Leverage strategies (lending loops, perps) are allowed at the policy
    // level. Per-strategy configs supply concrete `healthFactorMin` and
    // `liquidationBufferPct` thresholds; null defaults mean the gate trusts
    // the strategy-level config to declare them.
    leverage: {
      allowed: true,
      healthFactorMin: null,
      liquidationBufferPct: null,
    },
  };
}
