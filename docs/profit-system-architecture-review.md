# Profit System Architecture Review

Last reviewed: 2026-04-11

## Why This Review Exists

The project goal is not to automate activity. The goal is to automate profitable, measurable, and bounded activity.

That distinction matters because the current repo already proves that a route can be mechanically executable while still being economically wrong to trade.

## Current Evidence

The strongest currently prepared route is still:

- `bob->base wBTC.OFT->wBTC.OFT`
- route key: `bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c`
- amount: `10000` units

Measured facts already present in the repo:

- `docs/current-status.md`
  - `txReady=true`
  - `exactGasDone=true`
  - `viableForPrep=true`
  - `Net edge now: $-0.8322`

- `data/gateway-scores.json`
  - `executionGasSource=eth_estimateGas`
  - `executionGasUsd ~= 0.000779`
  - `nativeCostUsd ~= 0.794244`
  - `knownCostUsd ~= 0.795803`
  - `netEdgeUsd ~= -0.832281`
  - `tradeReadiness=reject_no_net_edge`

- `npm run plan:treasury-actions -- --json --address=0x96262be63aa687563789225c2fe898c27a3b0ae4`
  - `decision=BLOCKED`
  - reason: `wallet_value_below_refill_floor`
  - route demand only exists for `bob`
  - `base` refill is blocked as low-demand overhead

Objective conclusion:

- wallet-prep logic is no longer the main truth bottleneck
- route economics are currently the main bottleneck
- treasury automation must be designed as a profit-preserving layer, not as a convenience layer

## What The Repo Already Has

The current codebase already covers meaningful parts of the stack.

### 1. Observer Layer

Implemented:

- Gateway route and quote collection
- DEX read-only quote collection
- gas snapshots
- Bitcoin fee snapshots
- wallet readiness checks

Files:

- `src/gateway/client.mjs`
- `src/cli/verify-gateway.mjs`
- `src/cli/quote-dex.mjs`
- `src/cli/gas-snapshot.mjs`
- `src/cli/bitcoin-fee-snapshot.mjs`
- `src/cli/check-estimator-wallet.mjs`

### 2. Scoring Layer

Implemented:

- reference-value scoring
- Gateway `tx.value` cost handling
- exact source gas support
- gas shock buffer
- stale gas rejection
- failure-rate rejection

Files:

- `src/scoring/gateway-score.mjs`
- `src/cli/score-gateway.mjs`
- `docs/gas-policy.md`

### 3. Treasury Readiness Layer

Implemented:

- policy config
- inventory scan
- refill planning
- refill job schema

Files:

- `src/treasury/policy.mjs`
- `src/treasury/inventory.mjs`
- `src/treasury/planner.mjs`
- `src/treasury/refill-job.mjs`

### 4. Safety Boundary

Implemented in project rules and architecture stance:

- no live key handling in Codex/OpenClaw
- no unlimited approvals
- live trading blocked by default
- USD 300 ring-fenced capital rule

Files:

- `AGENTS.md`
- `docs/bob-claw-instant-swap-plan.md`
- `docs/objective-gate-2026-04-10.md`

## What Is Still Missing

These are not optional if the final goal is real profit.

### 1. Reserve-Replenishment Economics

Current treasury planning answers:

- what is low
- what should be refilled
- what method family is plausible

It does not yet answer:

- where refill capital should come from
- what that source movement truly costs
- whether the refill itself destroys route expectancy

This is the most important missing treasury variable set.

### 2. Receipt-Based Realized PnL

The repo still relies mainly on estimated economics.

Without a realized ledger, the system cannot answer:

- expected vs realized output drift
- real gas paid
- real bridge / swap maintenance cost
- true win rate after all operating overhead

### 3. Deterministic Execution Gate

There is no isolated signer/executor path yet.

That means the stack does not yet have:

- final pre-sign checks
- job idempotency under execution
- receipt capture
- failure accounting
- emergency stop enforcement in live flow

### 4. Reserve Layer State

The current policy supports `single_wallet` and conceptually `dual_wallet`, but the repo does not yet model:

- reserve balances by chain
- reserve funding source
- reserve depletion rate
- reserve replenishment trigger

## The Correct Mental Model

The system should be treated as six linked layers.

### 1. Market Observer

Purpose:

- discover opportunities
- measure latency, fee, route behavior, and quote freshness

### 2. Profitability Engine

Purpose:

- decide whether the route itself appears worth executing before treasury movement cost

### 3. Treasury Planner

Purpose:

- decide whether required native gas and token inventory can be maintained efficiently

### 4. Funding Source Planner

Purpose:

- decide how treasury replenishment would actually happen

This layer is currently the biggest design gap.

### 5. Deterministic Risk Engine

Purpose:

- combine route economics, treasury economics, loss caps, and system state into a final yes/no gate

### 6. Isolated Executor + Reconciliation

Purpose:

- perform the approved job
- capture receipts
- write realized costs and realized output back into the system

## The Profit Formula Must Change

Right now route scoring is mostly about route-level net edge.

For actual automation, the system needs a stricter formula:

```text
routeNetEdgeUsd
- executionRefillExpectedCostUsd
- reserveReplenishmentExpectedCostUsd
- expectedFailureCostUsd
- capitalFragmentationDragUsd
= effectiveSystemNetPnlUsd
```

This is the objective minimum.

Why:

- a route can be positive by quote math but still negative after repeated gas maintenance
- a refill may be cheap once but expensive on average
- a USD 300 bankroll is especially sensitive to hidden maintenance cost

## Variables That Are Definitely Required

These are the variables most likely to be missing if the system later feels “automated but still not profitable.”

### Route Variables

- `expectedInputUsd`
- `expectedOutputUsd`
- `nativeMessagingCostUsd`
- `exactSourceGasUsd`
- `destinationExecutionGasUsd`
- `dexFeeUsd`
- `priceImpactUsd`
- `quoteLatencyMs`
- `quoteExpirySeconds`
- `routeFailureRate`

### Treasury Variables

- `nativeBalanceByChain`
- `nativeTargetBufferByChain`
- `tokenInventoryByChain`
- `walletTotalUsd`
- `walletLiquidUsd`
- `pendingRefillJobs`
- `lastRefillCostUsd`
- `capitalAllocatedByChain`

### Funding Source Variables

- `fundingSourceType`
- `fundingSourceChain`
- `fundingSourceAsset`
- `executionRefillExpectedCostUsd`
- `executionRefillExpectedLatencyMs`
- `reserveReplenishmentExpectedCostUsd`
- `reserveReplenishmentExpectedLatencyMs`
- `requiresBootstrapNative`
- `manualFundingDependency`

### Realized Performance Variables

- `receiptGasUsd`
- `receiptOutputUsd`
- `realizedNetPnlUsd`
- `realizedFillVsEstimateBps`
- `routeMedianRealizedPnlUsd`
- `routeP95LossUsd`
- `failedGasCost24hUsd`

## What Should Not Be Done Yet

These are the tempting but wrong moves for the current phase.

### 1. Do Not Activate Many Chains At Once

Reason:

- capital fragments faster than edge scales
- refill churn becomes the strategy
- current evidence only supports a narrow active set

### 2. Do Not Treat DEX Refill As Free

Reason:

- swaps need gas
- swaps add price impact and fee
- repeated refill swaps can consume the entire edge

### 3. Do Not Treat Reserve Wallet As A Magic Fix

Reason:

- reserve itself also needs replenishment
- reserve movement cost is real cost
- reserve only changes where the complexity sits

### 4. Do Not Build Live Executor Before Realized Ledger

Reason:

- otherwise the system can “feel live” while hiding negative expectancy

## Recommended Operating Model By Phase

### Phase A: Current Best Mode

Mode:

- `single_wallet`
- manual reserve replenishment
- automatic observation and planning only

Why this is correct now:

- current profitable evidence is not strong enough
- route edge is negative
- treasury automation should stay advisory until the economics justify execution complexity

### Phase B: First Real Treasury Upgrade

Add:

- funding-source planner
- reserve replenishment model
- receipt ledger

Still keep:

- no autonomous cross-chain reserve movement
- no live execution by default

### Phase C: Controlled Dual-Wallet Mode

Only after realized evidence exists:

- same-chain reserve wallet per active chain
- exact capped approvals only where required
- job idempotency and receipt reconciliation

### Phase D: Cross-Chain Reserve Automation

Only after:

- one or more routes show stable realized positive expectancy
- reserve replenishment cost is modeled from receipts, not assumptions

## Objective Risk Register

These are the most likely failure modes.

### Hidden Maintenance Loss

Symptom:

- route score looks acceptable
- daily bankroll still drifts downward

Cause:

- refill costs not recorded as system PnL

### Zero-Native Deadlock

Symptom:

- wallet holds tokens but cannot execute refill swap

Cause:

- DEX refill assumed possible without bootstrap native gas

### Capital Fragmentation

Symptom:

- many chains funded
- few trades taken
- idle capital rises

Cause:

- active set expanded before evidence justified it

### False Positives From Estimated PnL

Symptom:

- paper model says edge exists
- realized results underperform consistently

Cause:

- receipt-based feedback loop missing

### Execution Complexity Dominates Edge

Symptom:

- many jobs, many checks, little actual gain

Cause:

- the system is trying to automate a structurally weak edge

## The Most Important Design Rule

The treasury system should not ask:

- “Can I make this wallet ready?”

It should ask:

- “Should I spend capital and operational complexity to make this wallet ready?”

That is the difference between a working bot and a profitable one.

## Recommendation For The Next Concrete Build Step

The next highest-value component is:

- `funding source planner`

It should sit between treasury planning and refill job creation.

Its job should be:

- choose candidate refill source
- estimate source-side movement cost
- estimate latency
- mark whether refill is manual-only, same-chain, or cross-chain
- calculate `effectiveSystemNetPnlUsd` impact

After that, the next required component is:

- `receipt reconciliation ledger`

These two pieces are more important than rushing into a live executor.
