// Lending-protocol looping research catalog.
//
// Placeholder module that declares the *design intent* for recursive supply/
// borrow lending-loop strategies (Aave/Compound/Dolomite-style). The executor,
// protocol adapters, health-factor watcher, and unwind path are NOT yet built.
//
// This file exists so the strategy catalog surfaces lending-loop research as
// a named candidate and so the risk-policy fields that a live lending-loop
// strategy must declare are documented in one place.

/**
 * Risk-policy fields that *must* be declared in a concrete lending-loop
 * strategy config before it can be promoted from `candidate_for_design` to
 * live. Enforcement is the executor's responsibility; this is the contract
 * the design is expected to honor.
 */
export const LENDING_LOOP_REQUIRED_POLICY_FIELDS = Object.freeze([
  "targetHealthFactor",
  "healthFactorMin",
  "maxLoopIterations",
  "maxLtvPct",
  "liquidationBufferPct",
  "unwindTriggerHealthFactor",
  "perTradeCapUsd",
]);

/**
 * Return the research catalog entries contributed by this module. Intended to
 * be merged into the broader strategy catalog by callers that want lending
 * loops visible in reports.
 */
export function buildLendingLoopResearchEntries() {
  return [
    {
      id: "recursive_wrapped_btc_lending_loop",
      label: "Recursive wrapped-BTC lending loop",
      category: "yield",
      actionType: "leverage_lending_loop",
      arrivalFamily: "wrapped_btc",
      status: "candidate_for_design",
      thesis:
        "Supply wrapped BTC as collateral on a destination-chain money market, borrow a correlated asset, re-supply, and repeat up to a configured health-factor floor to amplify the native yield spread.",
      requiredPolicyFields: [...LENDING_LOOP_REQUIRED_POLICY_FIELDS],
      notBuilt: [
        "protocol adapter (Aave / Compound / Dolomite)",
        "live health-factor watcher",
        "emergency-unwind executor",
        "per-iteration fee and slippage accounting",
      ],
      notes: [
        "Leverage is policy-permitted (see AGENTS.md). This catalog entry is the placeholder until a concrete executor, adapter, and unwind test land.",
      ],
    },
    {
      id: "recursive_stablecoin_lending_loop",
      label: "Recursive stablecoin lending loop",
      category: "yield",
      actionType: "leverage_lending_loop",
      arrivalFamily: "stablecoin",
      status: "candidate_for_design",
      thesis:
        "Supply stablecoin as collateral, borrow a second stablecoin, swap or re-supply, and loop to capture the supply-vs-borrow spread with a bounded liquidation buffer.",
      requiredPolicyFields: [...LENDING_LOOP_REQUIRED_POLICY_FIELDS],
      notBuilt: [
        "stable-swap path selector",
        "peg-divergence watcher",
        "unwind-cost estimator",
      ],
    },
  ];
}
