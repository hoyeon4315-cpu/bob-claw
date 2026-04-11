# BOB Claw Instant Swap Plan

Last reviewed: 2026-04-10

## Objective

Build BOB Claw as a small-capital, phase-gated trading system around BOB Gateway / Instant Swap opportunities, with EVM DEX wrapper-BTC arbitrage as a secondary route.

The real risk budget is USD 300. More capital may exist, but the bot must only see and use a ring-fenced wallet capped at USD 300 until live results justify expansion.

## Working Thesis

The original idea is strongest if BOB Gateway Instant Swap provides:

- executable quotes, not just indicative prices
- locked or bounded output amounts
- transparent fee breakdown
- short enough settlement time that stale price risk is small
- enough solver or route liquidity for USD 10-150 ticket sizes

If Instant Swap is not live, not accessible by API, too slow, too expensive, or too shallow, the system falls back to quote monitoring and no live trading.

## Objective Concerns

1. BOB Network DEX liquidity is currently shallow enough that USD 150 trades may move markets.
2. Gateway / intent swaps are not the same as atomic same-block DEX arbitrage.
3. Public docs and public snippets around Instant Swap are not enough to assume production readiness.
4. Fixed fee assumptions are unsafe. Every quote and receipt must carry observed fees.
5. A USD 300 bankroll cannot tolerate repeated failed transactions, stale quotes, or over-approval.
6. OpenClaw is useful for orchestration and reporting, but private-key trading execution must stay isolated.

## Strategy Ranking

1. Gateway / Instant Swap quote edge
   - Primary route.
   - Compare Gateway executable output against external reference prices and reverse routes.
   - Only trade if quote is executable, bounded, and expected profit survives all fees.

2. Gateway affiliate / routing revenue
   - Low capital risk.
   - Useful if there is user flow or public dashboard traffic.
   - Not enough alone unless traffic exists.

3. BOB / Arbitrum wrapper-BTC DEX arbitrage
   - Secondary route.
   - Requires pool depth checks, price-impact simulation, and bridge/rebalance cost controls.

4. Flash loans
   - Later only.
   - Not part of the USD 300 initial build.

5. Leverage, perps, martingale, aggressive rebalancing
   - Forbidden for this project.

## Architecture

```text
OpenClaw / Codex operator layer
  - reads reports
  - starts / stops services
  - reviews anomaly summaries
  - never holds private keys

Local BOB Claw services on Mac mini
  - quote sampler
  - opportunity scorer
  - risk engine
  - signer / executor
  - SQLite event store
- Telegram notifier
- read-only dashboard status JSON

Cloudflare dashboard
  - mobile-first status UI
  - read-only
  - no private keys
  - no trade-submit buttons at first
```

## Service Boundaries

### Quote Sampler

Collects:

- BOB Gateway routes
- Gateway quotes
- DEX aggregator quotes
- pool reserve snapshots where available
- gas estimates
- token balances
- Pyth / external reference prices

It never signs transactions.

### Opportunity Scorer

Computes:

- gross spread
- total fee estimate
- expected slippage
- route latency
- quote freshness
- expected net profit
- confidence score

It never trades directly.

### Risk Engine

Blocks execution when:

- quote is stale
- fee breakdown is missing
- expected net profit is below threshold
- price impact is above threshold
- daily loss would exceed the cap
- route has insufficient recent samples
- RPC / quote failure rate is elevated
- observed execution differs too much from estimate

### Signer / Executor

The only process with private-key access.

Rules:

- burner wallet only
- USD 300 maximum funded balance
- chain-level allowance caps
- no unlimited approvals
- dry-run default
- explicit live-mode file required
- emergency stop file checked before every transaction

## Harness Engineering

The harness is the core product before the bot trades.

### Replay Harness

Replays recorded quotes and asks:

- would the bot have traded?
- what did it think profit was?
- did the opportunity survive updated fees?
- would daily loss limits have stopped it?

### Shadow Harness

Runs on live mainnet without signing.

Records:

- quote at detection time
- quote immediately before hypothetical execution
- gas estimate
- estimated route time
- simulated net profit
- opportunity decay after 15s, 30s, 60s, 120s

### Execution Harness

For testnet or tiny live canary only.

Records:

- submitted transaction
- receipt
- actual gas paid
- actual output
- realized slippage
- realized net profit
- mismatch between expected and realized result

### Kill Harness

Independent safety checks:

- max daily loss USD 15 during normal operation
- hard project loss cap USD 300
- max consecutive failures 3
- max failed gas cost USD 3 per day
- stop if wallet total drops below USD 250 during canary
- stop if quote source disagrees with execution source beyond tolerance

## Phase Plan

### Phase 0: Instant Swap Verification

Goal: prove whether Instant Swap is usable as an executable route.

Tasks:

- confirm live API endpoints and supported routes
- test USD 10 / 25 / 50 / 100 / 150 quote sizes
- measure fee breakdown
- measure quote expiry or lock behavior
- compare forward and reverse quotes
- compare with Pyth and DEX aggregator prices
- record failure and latency rates

Pass criteria:

- quote success rate above 95 percent for selected route
- fee breakdown present and parseable
- quote latency below 2 seconds at p95
- net-positive opportunities appear in shadow data after all fees
- route supports enough size for at least USD 25 trades

Fail action:

- do not build live executor
- keep dashboard and monitoring only

### Phase 1: Mainnet Shadow Data

Goal: collect statistically useful opportunity data without risking funds.

Duration:

- minimum 7 days
- longer if opportunity count is low

Pass criteria:

- at least 30 hypothetical opportunities with positive net profit
- median expected profit above USD 0.30
- worst-case estimated loss per failed trade below USD 0.10
- opportunity decay does not erase profit before expected submission time

### Phase 2: Testnet / Fork Execution

Goal: prove the mechanical path.

Pass criteria:

- 50 successful simulated or testnet execution cycles
- no missing DB records
- Telegram alerts accurate
- dashboard reflects all state transitions
- circuit breaker tested intentionally

### Phase 3: Tiny Live Canary

Goal: test real settlement with minimal capital.

Capital:

- start USD 20-50
- single route only

Pass criteria:

- realized output within tolerance
- cumulative realized loss less than USD 5
- no failed approvals
- no stuck transactions
- no unbounded allowance remains

### Phase 4: USD 300 Live Ring

Goal: operate only after canary success.

Rules:

- total wallet balance capped near USD 300
- one route at a time
- no automatic rebalancing at first
- daily review required
- dashboard mobile view prioritized

### Phase 5: Expansion

Expansion requires realized profit, not paper profit.

Candidate triggers:

- 30 live trades
- positive realized PnL after gas and fees
- no severe incidents
- route liquidity remains stable
- manual review approves increase

## Initial Parameters

```text
DRY_RUN=true
PROJECT_LOSS_CAP_USD=300
NORMAL_DAILY_LOSS_CAP_USD=15
CANARY_DAILY_LOSS_CAP_USD=5
MIN_NET_PROFIT_USD=0.30
MIN_NET_PROFIT_PCT=0.50
MAX_PRICE_IMPACT_PCT=0.30
MAX_SLIPPAGE_PCT=0.50
MAX_QUOTE_AGE_MS=5000
MAX_CONSECUTIVE_FAILURES=3
MAX_APPROVAL_USD=60 during canary
```

These are starting guardrails, not truths. The harness may tighten them before live trading.

## Dashboard Priorities

Mobile-first dashboard:

- current mode: dry-run / shadow / canary / live
- wallet value and capital-at-risk
- last quote and route status
- active opportunity score
- realized PnL
- paper PnL
- daily loss meter
- circuit breaker state
- latest Telegram alert
- route health
- manual emergency stop status

No live trade button in the first version.

## OpenClaw Policy

OpenClaw can be used for:

- scheduling checks
- reading logs
- generating reports
- Telegram command routing
- operator summaries
- code review assistance

OpenClaw must not:

- hold private keys
- decide to bypass risk checks
- trade directly from natural language
- change live parameters without a committed config diff
- auto-disable emergency stops

## Build Order

1. Create project scaffold and AGENTS rules.
2. Implement config schema and safety defaults.
3. Implement SQLite event store.
4. Implement Gateway route / quote sampler.
5. Implement external price and DEX quote adapters.
6. Implement opportunity scorer.
7. Implement replay and shadow harnesses.
8. Implement Telegram alerts.
9. Implement mobile dashboard.
10. Only then implement signer / executor.

## Anti-Overfit Gate

Before moving from shadow mode to canary mode, run the overfit audit and require:

- 7 days of shadow data
- 24 or more hourly buckets
- 30 or more samples per candidate route
- 4 or more amount levels per candidate route
- route failure rate under 10 percent
- p95 gas-aware profitability
- executable DEX quotes, not only reference prices
- exact gas estimates with the canary wallet

If the audit says `LIVE_BLOCKED`, no live trading.

## BOB Update Policy

When BOB Gateway, Instant Swap, supported routes, fees, or quote schemas change, treat the change as a new experiment.

- Refresh route inventory.
- Diff supported chains/tokens/routes.
- Re-verify quote response shapes.
- Reset affected shadow baselines.
- Re-run the overfit audit.
- Do not enable live trading from an announcement alone.

## Decision Rule

The project succeeds if it proves either:

- Instant Swap has exploitable, repeatable, fee-adjusted opportunities, or
- it does not, and the bot prevents us from donating USD 300 to gas, slippage, stale quotes, or wishful thinking.
