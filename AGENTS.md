# BOB Claw Rules

## Core Context

- Initial live risk budget: USD 300.
- More capital may exist, but the bot must only use a ring-fenced wallet capped near USD 300 until live data proves expansion is justified.
- Primary strategy: BOB Gateway / Instant Swap quote verification.
- Secondary strategy: wrapper-BTC arbitrage across Gateway-supported low-fee chains.
- Ethereum L1 trading is disabled for the USD 300 phase unless explicitly re-approved after fee analysis.

## Objective Review

- Do not say a route is profitable until measured quote, fee, latency, and execution data support it.
- Treat all profit claims as hypotheses until replay/shadow/live receipt data confirms them.
- If data says no trade, no trade.

## Execution Safety

- Default mode is dry-run or shadow mode.
- Private keys are only allowed in the signer/executor process.
- OpenClaw, Codex, dashboards, and Telegram handlers must not hold private keys.
- No unlimited approvals.
- No leverage, perps, martingale, or automatic strategy escalation.
- No LLM in the trade execution decision path.
- Emergency stop must be checked before any live transaction.

## Risk Limits

- Project loss cap: USD 300.
- Normal daily loss cap: USD 15.
- Canary daily loss cap: USD 5.
- Minimum net profit target: USD 0.30 and 0.50 percent after all known fees.
- Max consecutive failures: 3.
- Stale quotes must be rejected.

## Build Order

1. Route and quote verification.
2. Shadow/replay harness.
3. Telegram and mobile dashboard.
4. Testnet/fork execution harness.
5. Tiny live canary.
6. USD 300 live ring.

## Dashboard Context

- Before changing dashboard UI, read `docs/dashboard-context.md`.
- The dashboard is a mobile-first BTC -> BOB -> chains flow map, not a table-first operator page.
- The browser may only read `dashboard/public/dashboard-status.json`; do not publish raw JSONL data.
- Dashboard copy must stay user-facing and visual. Avoid internal schema, signer, executor, or strategy jargon.
- `liveTrading` must remain `BLOCKED` in public status unless the execution architecture is explicitly redesigned and reviewed.

## Reporting

- Every result must distinguish paper PnL, estimated PnL, and realized PnL.
- Every route report must include sample count, quote success rate, latency, fees, and rejection reasons.
