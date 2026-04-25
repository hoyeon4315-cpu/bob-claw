# Execution Stage Map

Last updated: 2026-04-12

## Why this exists

BOB Claw should not treat every kind of execution proof as the same thing.

- `testnet` proves plumbing
- `fork execution` proves the mechanical path against mainnet-like state
- `tiny live canary` proves real settlement
- none of them alone proves durable profitability

Profitability still needs fresh mainnet quotes, gas, DEX legs, wallet readiness, and repeated shadow evidence.

## The Four Stages

### 1. Shadow

Purpose:
- measure live mainnet quotes without signing
- detect decay, latency, failure rate, and stale inputs
- reject fake edges before any transaction exists

What it proves:
- the opportunity existed in observed data
- the route survives first-pass fee and freshness checks

What it does not prove:
- that a signed transaction will settle as expected
- that realized output will match the estimate

Use this when:
- a route still has stale or missing inputs
- the system is still building time diversity
- live policy is blocked

### 2. Mechanical Simulation

Purpose:
- use RPC estimation and `eth_call` to test the execution path without settlement

What it proves:
- payload shape is valid
- contracts respond
- the route is mechanically callable

What it does not prove:
- realized gas
- realized slippage
- real settlement risk

Use this when:
- shadow evidence is good enough to justify deeper checking
- you want a low-risk way to catch broken calldata or route assumptions

### 3. Fork Execution

Purpose:
- submit an externally signed raw transaction to a fork RPC that mirrors mainnet state more closely than testnet

What it proves:
- planner -> signer -> submitter -> journal -> receipt pipeline works
- the route can be exercised with a realistic state snapshot
- execution records stay in sync across plan, submission, receipt, and audit

What it does not prove:
- live market reaction after submission
- true production latency
- durable profitability across time

Why this is preferred over generic testnet:
- testnet liquidity and pricing are not the real market
- Gateway and DEX behavior on testnet can create false confidence
- fork execution is closer to the route we actually care about

### 4. Tiny Live Canary

Purpose:
- prove real settlement with the smallest acceptable capital and full risk guardrails

What it proves:
- realized gas
- realized output
- realized slippage
- actual mismatch between estimate and receipt

What it still does not prove:
- long-run profitability
- that the route should scale beyond the ring-fenced wallet

Use this only when:
- shadow replay is ready
- simulation target is met
- fork confirmation target is met
- manual review is explicitly approved

## Where Testnet Fits

Testnet is still useful, but only for narrow goals.

Good uses:
- signer and submitter connectivity
- Telegram and dashboard state transitions
- journal and receipt ingestion checks
- intentional circuit-breaker testing

Bad uses:
- proving an arbitrage edge
- proving real slippage
- proving real fee economics
- deciding canary promotion

If the question is `will the bot plumbing work?`, testnet helps.

If the question is `will this make money in the real market?`, testnet is weak evidence.

## Recommended Order

1. Refresh stale market, gas, Gateway, and DEX inputs.
2. Re-score the route with fresh inputs.
3. Accumulate more shadow evidence until the time gates are satisfied.
4. Run mechanical simulation until the success target is met.
5. Plan fork execution and submit with an external signer.
6. Reconcile receipts and verify execution audit completeness.
7. Only then consider a tiny live canary review.

## Practical Rule

Use `testnet` to prove software wiring.

Use `fork execution` to prove the pre-live mechanical path.

Use `tiny live canary` to prove real settlement.

Use `shadow evidence` to decide whether any of that is economically worth doing.
