# BOB Claw System Automation Report - 2026-05-07

## Executive Summary

The real runtime is running. This is not a dashboard-only preview:

- Kill-switch state: running.
- Signer daemon: loaded and running under launchd.
- Watchdog: loaded and running under launchd.
- Gate self-heal loop: loaded and running under launchd.
- All-chain autopilot loop: loaded and running under launchd with `--execute --write`.
- Strategy evidence refresh: loaded and running under launchd.
- Dashboard public live service: loaded and running under launchd.

I also pressed the live execution path manually with:

```bash
npm run executor:all-chain-autopilot -- --execute --write --json
```

The run completed in execute mode, but deterministic policy sent no
transactions. That is the correct outcome for the current evidence state: the
system is alive, evaluated live-capable paths, and refused to spend gas where
routes, profit proof, or payback delivery proof were not ready.

## Latest Execution Tick

| Field | Value |
| --- | --- |
| Run id | `88391014-6a6e-49b9-b5df-ab8eedbf2349` |
| Observed at | `2026-05-07T12:25:04.587Z` |
| Mode | `execute` |
| Status | `completed_with_blockers` |
| Official Gateway chains evaluated | 11 |
| Refill jobs found | 38 |
| Auto-refill jobs found | 6 |
| Refill attempts sent | 0 |
| Refill executions delivered | 0 |
| Canary candidates scanned | 12 |
| Canary candidates preview-ready | 7 |
| Canary executions sent | 0 |
| Canary broadcast steps | 0 |
| Strategy dispatch selected live count | 0 |
| Payback status | `carry` |
| Pending payback carry | 601 sats |

## Why No Transaction Was Sent

The current no-transaction outcome is mostly a safety result, not an inactive
system result.

Primary blockers:

- `refill_routes_unresolved`
- `receipt_proven_payback_period_missing`
- `no_live_eligible_strategy`
- `planned_payback_below_minimum`

Concrete refill blockers observed by the readiness check:

| Chain | Asset | Reason | Selected method |
| --- | --- | --- | --- |
| BOB | ETH | `routing_exhausted` | cross-chain bridge or swap |
| Base | cbBTC | `routing_exhausted` | cross-chain bridge or swap |
| Base | USDC | `routing_exhausted` | same-chain token swap |
| Ethereum | RLUSD | `missing_src_token_decimals` | LI.FI bridge |
| Ethereum | USDT | `missing_src_token_decimals` | LI.FI bridge |
| Optimism | wBTC.OFT | `routing_exhausted` | cross-chain bridge or swap |

The payback scheduler also ran in execute mode during the autopilot tick, but
carried instead of off-ramping because the planned payback was below the
configured minimum:

- Gross profit in period: 601 sats.
- Base ratio target before costs: 120 sats.
- Minimum payback: 50,000 sats.
- Action: carry forward, no offramp intent.

## Dashboard Improvement Added

The DeFi dashboard's `Live lane` card now has an explicit `Execution` cell.
It shows whether a real execute tick was attempted and whether any transaction
was broadcast.

Current expected display:

- `Execution`: `No tx`
- Reason: `refill routes unresolved`

This is intentionally read-only. It does not add a button, signer authority,
cap mutation, or any runtime permission. The dashboard now explains the exact
difference between:

- runtime is off,
- runtime is running but blocked by policy,
- runtime broadcasted a policy-approved transaction.

## Confidence Loop Result

I am not factually 100% confident that a profitable live strategy is available
right now. The evidence says the opposite: the system is running, but policy is
blocking live sends because the current candidates do not clear route,
execution, or payback proof requirements.

I am confident in this narrower strategy:

1. Keep the live runtime running.
2. Let deterministic policy block unprofitable or unproven transactions.
3. Fix route and proof gaps before spending gas.
4. Show the operator the exact no-transaction reason on the dashboard.

That is the correct small-capital behavior. It avoids confusing "execution
mode was pressed" with "a transaction should be forced."

## Next Fix Targets

1. Resolve refill route gaps for BOB ETH, Base cbBTC, Base USDC, and Optimism
   wBTC.OFT.
2. Fix source-token decimal coverage for Ethereum RLUSD and Ethereum USDT
   bridge planning.
3. Produce a receipt-proven payback period before claiming the payback lane is
   delivered.
4. Keep Merkl and radar canaries under tiny-canary EV gates; do not override
   same-chain unprofitable blockers just to create activity.
5. Keep BNB as one official Gateway destination, not a special strategic bias.

## Operator Translation

The engine is on. It looked for something it was allowed to do. It found
possible work, but every live spend path still had a concrete blocker. So it
did the right thing: it did not burn gas.

The next meaningful progress is not "press harder"; it is to clear the route
and proof gaps so the next execute tick can send a transaction only when the
policy engine sees a positive, capped, receipt-backed path.
