# Stage 7 Operator Handover

Written 2026-04-25. System is designed for **unattended, multichain, fully-automated execution** (AGENTS.md L28-29). Operator's role is one-time setup, not per-tick supervision. Once the daemon is running with seed BTC, it handles 11-chain inventory rebalancing, gas top-ups, refill jobs, strategy dispatch, and payback accumulation autonomously.

## What `evaluateStageGate` checks

`src/executor/policy/stage-gate.mjs` is the single advisory gate. Seven signals; all must clear before stage-7 entry:

1. **Kill-switch unarmed.** `KILL_SWITCH_PATH` file does not exist.
2. **Auto-kill quiet 24h.** `dashboard/public/auto-kill-events.json` reports `triggerCount=0`.
3. **Drawdown above floor.** Realized 24h PnL `> -50 USD`.
4. **Oracle 4/4 reachable.** `snapshot-btc-oracles` reports four reachable sources.
5. **Payback reserveOk.** Accumulator pending floor is 0 (operator override 2026-04-25): accumulator fills BY live execution, not before.
6. **Executor heartbeat fresh.** Age `<= 90s`.
7. **No stale quotes.** `staleQuoteCount=0`.

## Operator one-time setup

These are the only things code cannot do. After this, the system runs unattended.

### Keys & daemon (one-time)
- [ ] Signer daemon running with keys in OS keychain (not env, not file).
- [ ] `KILL_SWITCH_PATH` env set; touching that file halts execution.
- [ ] `PAYBACK_BTC_DEST_ADDR` env = operator's L1 wallet for payback returns.

### Seed capital (one-time)
- [ ] BTC L1 sender wallet `bc1qpkdqyrycv900kh97jctjn83e2ypc0xfmhv8546` funded with seed sats above Gateway minimum onramp threshold.

That is the **entire** operator preflight. The daemon does the rest.

## What the daemon does autonomously

After seed BTC lands and the daemon starts, no further operator action is required:

- **BTC L1 → 11-chain seeding.** `gateway-btc-onramp` pulls BTC from sender wallet, mints wBTC.OFT on Bob, propagates to Base/Avalanche/Sonic/etc via official Gateway routes.
- **Inventory rebalancing.** `all-chain-autopilot.mjs` scans all 11 chains every tick, detects under-floor balances, generates refill jobs, executes them via Gateway / gas-zip / LI.FI / Across.
- **Gas float top-ups.** Native gas under-floor → `gas_zip_native_refuel` automatically.
- **Strategy dispatch.** Strategy registry (`run-strategy-tick.mjs`) selects eligible strategies, builds previews, signs intents through the daemon.
- **Payback accumulation.** Realized BTC-denominated profit accrues in `data/payback/accumulator-snapshot.json`. Scheduler dispatches when threshold + reserve checks pass — operator does not decide ratio or timing.
- **Risk gates.** Auto-kill triggers (`src/risk/auto-kill-triggers.mjs`) arm on drawdown / consecutive failure / oracle divergence / heartbeat staleness — daemon halts itself.

## What stays out of operator scope

- Manual rebalancing across chains — daemon's `all-chain-autopilot` handles this every tick.
- Manual capital movement — keys are in the daemon, not the operator's hand.
- Cap or policy edits — committed diff only (CLAUDE.md non-negotiable #5).
- Payback ratio / timing — `src/executor/payback/scheduler.mjs` decides deterministically.

## Time-window prerequisites

Stage 7 promotion isn't instant after stage-gate returns READY:

- Promotion lookback already 0/0 (commit `c3f5608`) — first signer-backed receipt = eligible to scale.
- Drawdown floor & stale-quote circuit breakers fire post-trade only — no entry delay.
- Oracle reachability is per-tick — fails fast if a source goes down.

The only intrinsic wait is "first tick has not happened yet". Once seed BTC is in the sender wallet and the daemon ticks, receipts start accumulating.

## Expected first-tick output

After stage-gate clears, first autonomous tick writes:

- `data/risk/auto-kill-events.jsonl` (append-only)
- `dashboard/public/auto-kill-events.json` (24h slice)
- `data/strategy-tick-receipts.jsonl` (signer-backed receipts)
- `data/payback/accumulator-snapshot.json` (BTC-denominated pending)
- `logs/signer-audit.jsonl` — append-only record of every signed intent (CLAUDE.md non-negotiable #6).

`signer-audit.jsonl` is the canonical record of capital movement. Operator monitors this; daemon writes it.
