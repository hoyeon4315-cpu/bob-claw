# Refill Funding Source Architecture

Last updated: 2026-04-11

## Goal

Define how BOB Claw should think about “how gas gets there” without hiding costs or assuming free capital movement.

This document exists because refill logic is not only a wallet-readiness problem. It is a profitability problem.

## Core Observation

A refill target and a refill funding source are different things.

Example:

- execution wallet on `base` needs ETH for gas
- the system may have:
  - ETH on `base`
  - WBTC on `base`
  - ETH on `bob`
  - WBTC on `bob`
  - external reserve capital

All of these imply different refill methods, costs, delays, and failure risks.

If the system only plans the target and ignores the funding source, it will overstate expected profitability.

## Evidence From Current Repo State

Current measured state already shows why this matters:

1. The best currently prepared route is `bob->base wBTC.OFT->wBTC.OFT`.
   - `docs/current-status.md`

2. Exact gas succeeds, but the route remains economically negative.
   - latest score for the 10,000 sat route:
     - `executionGasSource=eth_estimateGas`
     - `knownCostUsd` about `0.7958`
     - `netEdgeUsd` about `-0.8323`
     - `tradeReadiness=reject_no_net_edge`
   - source: `data/gateway-scores.json`

3. Gateway movement cost dominates small-size economics.
   - `docs/gateway-chain-comparison.md`
   - at 10,000 sats, BOB-neighbor route movement cost is roughly `$0.75-$0.84`

4. Current gas policy already requires all known costs to remain positive after cost buffers.
   - `docs/gas-policy.md`

Objective implication:

- refill funding source cost must be treated as another real cost
- otherwise the bot can look profitable at the route layer while losing money at the treasury layer

## The Important Distinction

There are two different refill problems:

### 1. Execution Refill

Definition:

- move capital into the execution wallet so the next approved action can happen

Examples:

- top up `bob` ETH for the execution wallet
- top up `base` wBTC.OFT for a reverse route

### 2. Reserve Replenishment

Definition:

- replenish the source that execution refill depends on

Examples:

- reserve wallet on `base` ran low on ETH after multiple top-ups
- reserve wallet on `bob` ran low on wBTC.OFT after repeated transfers
- reserve wallet itself must be refilled from bridge, DEX, or external source

This second layer is the one most systems under-model.

## Refill Source Types

These are the only realistic refill-source classes.

### A. Same-Chain Native Transfer

Example:

- reserve wallet on `base` sends ETH to execution wallet on `base`

Pros:

- simplest
- cheapest operationally
- lowest latency
- no swap slippage
- deterministic

Cons:

- requires a separate funded reserve wallet on the same chain

Best use:

- `dual_wallet` mode

### B. Same-Chain Token Transfer

Example:

- reserve wallet on `bob` sends `wBTC.OFT` to execution wallet on `bob`

Pros:

- simple
- no swap risk

Cons:

- only solves token shortage, not native shortage

Best use:

- route-token inventory top-up in `dual_wallet` mode

### C. Same-Chain Token -> Native Swap

Example:

- execution wallet on `bob` swaps `wBTC.OFT` to ETH to rebuild gas buffer

Pros:

- works in `single_wallet` mode
- no need for a separate reserve wallet

Cons:

- requires some bootstrap native gas already present
- adds swap fee, price impact, and slippage
- can fail at the worst moment when gas is already scarce

Best use:

- secondary refill method
- recovery when native is low but not zero

### D. Same-Chain Native -> Token Swap

Example:

- execution wallet on `base` swaps ETH to `wBTC.OFT` to rebuild route inventory

Pros:

- useful for token inventory maintenance

Cons:

- consumes native gas buffer
- adds DEX execution cost and slippage

Best use:

- token-side rebalance

### E. Cross-Chain Bridge / Cross-Chain Swap

Example:

- move value from `bob` to `base` because `base` reserve is low

Pros:

- solves true chain fragmentation

Cons:

- highest latency
- highest operational complexity
- bridge cost can dominate small-capital economics
- stale opportunity risk rises sharply
- extra protocol and settlement risk

Best use:

- reserve replenishment only
- not first-line execution refill

### F. External Capital Injection

Example:

- CEX withdrawal
- cold wallet transfer
- manual operator funding

Pros:

- clean reset when the system truly needs more capital

Cons:

- not autonomous
- not evidence that strategy is self-sustaining

Best use:

- canary phase only
- emergency or periodic reserve maintenance

## Objective Design Principle

The system should prefer refill methods in this order:

1. same-chain reserve transfer
2. same-chain swap with bootstrap gas
3. cross-chain reserve movement
4. external manual funding

Not because this order is philosophically nicer, but because it is usually cheaper, faster, and more deterministic.

## Why “DEX Will Handle It” Is Not Enough

Saying “the wallet can just swap into gas” is incomplete for three reasons:

1. Swap transactions still need gas
   - if native is truly zero, a normal EVM swap usually cannot start

2. Refill swaps are not free
   - DEX fee
   - slippage
   - price impact
   - gas for the refill itself

3. Refill swaps distort strategy economics
   - if repeated often, refill swaps can become a hidden operating expense larger than the route edge

Therefore:

- DEX refill is a valid method
- DEX refill must never be assumed to be the default free solution

## Variables The Treasury Layer Must Add

These variables need to exist beyond route scoring.

### Execution Refill Variables

- `executionRefillTargetChain`
- `executionRefillTargetAsset`
- `executionRefillAmount`
- `executionRefillMethod`
- `executionRefillExpectedCostUsd`
- `executionRefillExpectedLatencyMs`
- `executionRefillRequiresBootstrapGas`

### Reserve Replenishment Variables

- `reserveChain`
- `reserveAsset`
- `reserveAvailableUsd`
- `reserveDepletionRisk`
- `reserveReplenishmentMethod`
- `reserveReplenishmentExpectedCostUsd`
- `reserveReplenishmentExpectedLatencyMs`
- `reserveReplenishmentFailureRisk`

### Full-System Profitability Variables

- `routeExpectedNetPnlUsd`
- `executionRefillAmortizedCostUsd`
- `reserveReplenishmentAmortizedCostUsd`
- `effectiveSystemNetPnlUsd`
- `capitalMovementCostUsd`

This last value is the one that matters:

- `effectiveSystemNetPnlUsd = routeExpectedNetPnlUsd - executionRefillAmortizedCostUsd - reserveReplenishmentAmortizedCostUsd`

If this is not positive, the system is not actually profitable.

## Recommended Operating Modes

### Mode 1: Single-Wallet Canary

Characteristics:

- one wallet only
- small capital
- no separate reserve
- refills come from same-wallet swaps or manual operator top-up

Pros:

- lowest complexity
- appropriate for early canary

Cons:

- weak resilience
- refill logic is fragile when native balance is near zero

Recommendation:

- good for initial proof
- not good for scaled automation

### Mode 2: Dual-Wallet Same-Chain Reserve

Characteristics:

- execution wallet
- reserve wallet
- both on active chains only

Pros:

- much better reliability
- cleaner accounting
- refill speed is strong

Cons:

- reserve still needs replenishment
- more wallets to track

Recommendation:

- best medium-term target if any route becomes truly viable

### Mode 3: Multi-Chain Reserve Network

Characteristics:

- reserve balances on many chains
- rebalance automation

Pros:

- widest coverage

Cons:

- highest fragmentation cost
- highest complexity
- wrong for USD 300 phase

Recommendation:

- do not use in current project phase

## Recommended Treasury Research Sequence

1. Keep `single_wallet` as the default policy mode for now
   - this matches current capital reality

2. Add refill method candidates to jobs
   - already started in code

3. Add funding-source classification
   - `same_chain_reserve`
   - `same_chain_swap`
   - `cross_chain_bridge`
   - `external_manual`

4. Add reserve-replenishment modeling
   - even if execution is still single-wallet

5. Add amortized refill-cost accounting
   - route PnL must be adjusted by treasury maintenance cost

6. Only after positive realized expectancy, consider dual-wallet mode

## Main Risks If This Is Skipped

1. Hidden treasury loss
   - route-level PnL looks positive, whole system PnL is negative

2. False autonomy
   - system appears automated but still depends on invisible manual top-ups

3. Zero-gas deadlocks
   - wallet cannot even execute the refill path it planned

4. Over-rotation into bridges
   - automation starts spending edge on capital movement

5. Unclear source-of-truth accounting
   - impossible to tell whether profits came from strategy or from operator funding

## Objective Recommendation

The correct mental model is not:

- “execution wallet and reserve wallet solve gas”

The correct model is:

- strategy PnL
- execution refill cost
- reserve replenishment cost
- capital source cost

All four must be modeled together.

For the current phase:

- keep refill methods explicit
- default to same-chain methods first
- treat DEX refill as a valid but conditional method
- treat bridge refill as reserve maintenance, not as the normal first response
- do not consider any route truly profitable until treasury costs are amortized into system-level PnL
