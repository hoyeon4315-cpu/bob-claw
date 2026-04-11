# Treasury, Gas, and Profit Automation

Last updated: 2026-04-11

## Goal

Turn BOB Claw from a read-only verification harness into a phase-gated automated system that can:

- keep only required chain-native gas online
- maintain route-critical token inventory
- reject unprofitable routes after all observed costs
- separate orchestration from signing
- preserve the USD 300 ring-fenced rule

This document is intentionally conservative. The purpose is not to maximize activity. The purpose is to maximize the chance that any later live activity is measurable, bounded, and worth doing.

## Current Evidence

Observed now:

- The best prepared route is `bob->base wBTC.OFT->wBTC.OFT`.
- Exact gas estimation now succeeds for that route.
- Exact-gas-adjusted score remains negative.
- The current route is therefore mechanically executable but economically unattractive.

Supporting evidence already present in the repo:

- `docs/current-status.md` shows the route is prepared and exact gas is done.
- `docs/gas-policy.md` states that no route is executable unless profit survives all known costs.
- `docs/objective-gate-2026-04-10.md` states EVM-to-EVM movement routes were already being rejected by net edge after gas and native messaging cost.
- `data/gateway-scores.json` currently records the `bob->base` 10,000 sat route with:
  - `executionGasSource=eth_estimateGas`
  - `netEdgeUsd` about `-0.83`
  - `tradeReadiness=reject_no_net_edge`

Objective conclusion:

- The main blocker is no longer wallet prep.
- The main blocker is route economics.
- Automation must therefore optimize for selective execution and treasury efficiency, not for “always being able to fire”.

## Architecture Assessment

The repo already has four useful pieces:

1. Quote and route sampling
   - Gateway inventory, quote verification, DEX quote collection, Bitcoin fee collection, gas snapshot collection.

2. Read-only scoring
   - Route profitability and data-gap classification are already modeled.

3. Readiness monitoring
   - Wallet readiness, canary next-step planning, status/dashboard output, watcher automation.

4. Safety posture
   - Live trading remains blocked.
   - Private keys are explicitly isolated from Codex/OpenClaw.

What is missing for real automation:

1. Treasury manager
   - native gas top-up policy
   - token inventory policy
   - chain activation policy
   - rebalance job planning

2. Risk engine with execution authority
   - deterministic live gate
   - daily loss accounting
   - failed gas cost accounting
   - position and allowance caps

3. Signer / executor
   - isolated key process
   - idempotent job execution
   - receipt capture
   - post-trade reconciliation

4. Realized PnL ledger
   - paper PnL and realized PnL are not the same thing
   - route profitability cannot be trusted long-term without receipt-based accounting

## Why Automatic Gas Management Is Necessary

If the system ever trades across multiple chains, gas inventory becomes part of execution viability.

Without automatic gas management:

- profitable routes can be skipped because the source chain lacks native gas
- emergency manual top-ups add delay and stale the quote
- the bankroll gets stranded in the wrong chain or asset
- operator burden becomes the bottleneck instead of objective rules

With badly designed gas automation:

- capital gets fragmented across too many chains
- refill costs can exceed expected edge
- automation can “donate” capital to maintenance rather than trading
- top-up logic can hide real route unprofitability

Therefore the correct design is:

- automatic, but policy-driven
- chain-selective, not universal
- separated from opportunity scoring
- separated again from signing

## Required Service Split

### 1. Market Observer

Responsible for:

- Gateway routes
- Gateway quotes
- external DEX quotes
- gas snapshots
- Bitcoin fee snapshots
- route latency and failure statistics

Must not:

- sign
- fund
- approve
- rebalance

### 2. Profitability Engine

Responsible for:

- expected gross spread
- native messaging cost
- exact source gas when available
- destination swap cost when relevant
- DEX execution value
- fee and slippage model
- confidence and rejection reasons

Must output:

- expected net profit in USD
- expected net edge percent
- data gaps
- reason codes
- required execution prerequisites

### 3. Treasury / Gas Manager

Responsible for:

- per-chain native gas inventory
- route-critical token inventory
- allowance state where required
- refill and rebalance plans
- chain activation / deactivation

Must not:

- independently decide a trade is profitable

### 4. Deterministic Risk Engine

Responsible for:

- minimum net profit gate
- minimum net edge percent gate
- daily loss cap
- canary loss cap
- max consecutive failures
- stale quote rejection
- max pending refill jobs
- capital-at-risk budget checks

### 5. Signer / Executor

Responsible for:

- only executing approved jobs from the risk engine
- checking emergency stop before any signature
- writing receipts and actual cost/output results

Must be:

- isolated from dashboard, Codex, Telegram, and read-only automation

## Variables That Must Exist Before Real Automation

The following variables are not optional if the end goal is actual profit.

### Route Economics Variables

- `expectedInputUsd`
- `expectedOutputUsd`
- `nativeMessagingCostUsd`
- `exactSourceGasUsd`
- `destinationExecutionGasUsd`
- `dexFeeUsd`
- `priceImpactUsd`
- `slippageBps`
- `failedTxExpectedCostUsd`
- `gasShockBufferUsd`
- `quoteLatencyMs`
- `quoteExpirySeconds`
- `routeFailureRate`
- `routeDepthUsd`
- `routeCapacityUsd`

### Treasury Variables

- `nativeBalanceByChain`
- `nativeMinBufferByChain`
- `nativeTargetBufferByChain`
- `nativeMaxBufferByChain`
- `tokenInventoryByChain`
- `tokenMinInventoryByRoute`
- `pendingRefillJobs`
- `lastRefillAt`
- `lastRefillCostUsd`
- `capitalAllocatedByChain`
- `capitalAllocatedByAsset`
- `walletTotalUsd`
- `walletLiquidUsd`

### Execution Safety Variables

- `allowanceCapByTokenSpender`
- `approvalMode` (`exact`, `capped`, never unlimited)
- `quoteAgeSeconds`
- `gasSnapshotAgeMinutes`
- `bitcoinFeeAgeMinutes`
- `emergencyStop`
- `liveModeEnabled`
- `consecutiveFailures`
- `failedGasCost24hUsd`
- `dailyRealizedPnlUsd`
- `dailyEstimatedPnlUsd`
- `dailyPaperPnlUsd`

### Strategy Quality Variables

- `realizedFillVsEstimateBps`
- `receiptGasUsd`
- `receiptOutputUsd`
- `realizedNetPnlUsd`
- `routeWinRate`
- `routeMedianRealizedPnlUsd`
- `routeP95LossUsd`
- `quoteDecay15s`
- `quoteDecay30s`
- `quoteDecay60s`
- `quoteDecay120s`

## Important Variables Still Weak or Missing

These are the main objective gaps between the current harness and a profitable automated system.

1. Destination-side execution cost is incomplete
   - Current modeling is strongest on Gateway source-side cost.
   - If a future strategy requires a destination swap, destination gas and receipt reconciliation must be explicit.

2. Refill cost is not modeled as a first-class economic input
   - A profitable route can become unprofitable if reaching the required gas state costs too much.

3. Capital fragmentation cost is not modeled
   - Small bankroll systems lose efficiency when too much inventory is spread across chains.

4. Gas percentile history is missing
   - Single snapshots are not enough for execution confidence.
   - p50, p95, and spike behavior matter.

5. Quote decay and time-to-finality are not yet tightly joined to execution policy
   - A route may look positive at detection but negative by the time refill or signing happens.

6. Realized PnL feedback loop is missing
   - Expected edge without receipt reconciliation leads to false confidence.

7. Route capacity and market impact are not proven
   - Especially important if strategy expands beyond straight Gateway movement.

8. Rebalance policy is not yet bounded
   - The system needs hard rules for when not to rebalance.

## Expected Failure Modes

If automation is added carelessly, these are the most likely failure modes.

1. Refill churn
   - The bot keeps topping up gas across chains more often than it finds real opportunities.

2. False profitability
   - Gross spread looks positive, but refill cost, slippage, or failed-tx expectation makes realized PnL negative.

3. Capital fragmentation
   - Too much capital sits idle in low-use chains.

4. Route drift
   - Gateway schema, fees, or settlement path change and automation keeps acting on stale assumptions.

5. Allowance creep
   - Automated approvals drift larger over time unless capped per spender and per route.

6. Operational deadlocks
   - A trade depends on a refill, the refill depends on a bridge, and the opportunity decays before both complete.

7. Misleading success rate
   - Mechanical success is confused with profitable success.

8. Tiny-edge overtrading
   - The bot fires on low-quality routes because exact gas succeeded, even though net edge remains too small.

## Treasury / Gas Policy Recommendation

Do not maintain native gas on every supported chain.

Instead:

1. Define an `active chain set`
   - only chains with approved strategies in the current phase

2. Use per-chain bands
   - `min buffer`
   - `target buffer`
   - `max buffer`

3. Refill only when all are true
   - the chain is in the active set
   - there is a route demand signal
   - refill cost is below policy threshold
   - refill does not violate daily cost or bankroll limits

4. Deactivate unused chains
   - sweep or stop topping up chains that have no approved route demand

5. Treat refill as an economic action
   - every refill must have its own recorded expected and realized cost

## Recommended Build Order

1. Treasury policy config
   - chain min/target/max buffers
   - per-token allowance caps
   - refill cost ceiling
   - active chain allowlist

2. Wallet inventory scanner
   - collect native balances, token balances, allowance state, and wallet USD exposure

3. Treasury planner
   - compute `ok`, `needs_refill`, `blocked`, `deactivate`

4. Refill job format
   - deterministic job schema for signer / executor

5. Risk-engine gate for refill jobs
   - refills must obey budget and safety policy too

6. Isolated signer / executor
   - one process with keys
   - exact approvals only
   - emergency stop checked

7. Receipt reconciliation
   - realized gas, output, and realized PnL

8. Route-level realized-performance ranking
   - only routes with positive realized expectancy stay enabled

## Immediate Objective Recommendation

Current best route economics say:

- the route is executable
- the route is measurable
- the route is not currently profitable

Therefore the next correct step is not “more automation first”.

The next correct step is:

1. finish the treasury/gas manager design
2. add refill-cost-aware policy variables
3. extend scoring so treasury maintenance cost can be charged against route economics when relevant
4. continue longer shadow data collection
5. only then decide whether any route deserves canary capital

## Non-Negotiable Rule

Automatic activity is not the goal.

Positive realized expectancy is the goal.

If the system learns that the correct action is:

- no refill
- no approval
- no trade

then that is success, not failure.
