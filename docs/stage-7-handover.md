# Stage 7 Operator Handover

Written 2026-04-25. Code-side prep is in. Stage 7 (autonomous live ops) requires operator action — not code — to flip live.

## What `evaluateStageGate` checks

`src/executor/policy/stage-gate.mjs` is the single advisory gate. All seven signals must clear:

1. **Kill-switch unarmed.** `KILL_SWITCH_PATH` file does not exist.
2. **Auto-kill quiet 24h.** `dashboard/public/auto-kill-events.json` slice reports `triggerCount=0` in trailing 24h.
3. **Drawdown above floor.** Realized 24h PnL `> -50 USD` (default `STAGE_GATE_POLICY.maxDrawdownFloorUsd`).
4. **Oracle 4/4 reachable.** Last `snapshot-btc-oracles` run reports four reachable spot sources (Coinbase / Binance / Kraken / CoinGecko).
5. **Payback ready.** `paybackSnapshot.reserveOk=true`. Accumulator pending floor is 0 (operator override 2026-04-25): pre-live accumulator is empty by definition, so gating entry on it created a chicken-and-egg block. Drawdown floor and stale-quote rejection still cover post-trade risk.
6. **Executor heartbeat fresh.** Last heartbeat age `<= 90s`.
7. **No stale quotes.** Tick reports `staleQuoteCount=0`.

Any failure surfaces as `{kind, detail}` in `blockers`. Decision is `READY` or `BLOCKED`.

## Operator preflight checklist

Before flipping `liveTrading=true`, confirm each of the below on the operator host. Code cannot do these:

### Keys & signer
- [ ] Signer daemon process running with keys loaded from OS keychain (not env, not file).
- [ ] `signer-audit.jsonl` writable and append-only.
- [ ] `KILL_SWITCH_PATH` env set; touching that file halts execution.

### Inventory
- [ ] Per-chain native gas float above per-chain floor (`src/config/treasury-floors.mjs`).
- [ ] Base wallet has cbBTC ≥ first canary cap and USDC ≥ unwind buffer.
- [ ] BTC L1 sender wallet `bc1q...` has confirmed funds ≥ Gateway minimum onramp sats.

### Caps & policy (code, not runtime)
- [ ] `src/config/strategy-caps.mjs` per-strategy `perTxUsd` / `perDayUsd` / `perChainUsd` reflect intended dust-canary sizing.
- [ ] `PAYBACK_BTC_DEST_ADDR` env points to operator's L1 wallet — no testnet, no exchange deposit.
- [ ] `src/config/auto-kill.mjs` thresholds reviewed; trigger debounces match operator tolerance.

### External data
- [ ] `data/treasury-inventory.jsonl` populated by latest `npm run snapshot:treasury-inventory` run.
- [ ] `data/risk/auto-kill-events.jsonl` exists (created on first armed event; absence == clean).
- [ ] `data/oracle-divergence.jsonl` (or path resolved by `AUTO_KILL_ORACLES_PATH`) being appended by `snapshot-btc-oracles` cron.

### Dashboards
- [ ] `dashboard/public/dashboard-status.json` last write timestamp within last 5 min.
- [ ] `dashboard/public/auto-kill-events.json` slice present.
- [ ] `dashboard/public/strategy-tick-status.json` schema v2 readable.

## What stays out of operator scope

- Policy/cap edits during live ops — must be committed diff (CLAUDE.md non-negotiable #5).
- Manual signer override — daemon owns signing; operator only writes the kill-switch file.
- Payback ratio/timing decisions — `src/executor/payback/scheduler.mjs` decides deterministically.

## Time-window prerequisites

Stage 7 promotion isn't instant after `evaluateStageGate` returns READY. Receipt accumulation is real-time:

- 3 days fast-track lookback (`PROMOTION_THRESHOLDS.defaultLookbackDays = 3`)
- 14 days strict lookback (`PROMOTION_THRESHOLDS_STRICT.defaultLookbackDays = 14`)
- Signer-backed receipt count starts at 0 on first run; first-day window will report blocked even with everything ready

The wait is in the timeline, not the code.

## Expected first-tick output

After stage-gate clears, first autonomous tick should write:

- `data/risk/auto-kill-events.jsonl` (append-only, possibly empty in clean run)
- `dashboard/public/auto-kill-events.json` (24h slice)
- `data/strategy-tick-receipts.jsonl` (signer-backed receipts)
- `data/payback/accumulator-snapshot.json` (BTC-denominated pending)

Operator watches these; signer-audit.jsonl is the only write that materially moves money.
