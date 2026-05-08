---
status: current
updated_at: 2026-05-09
source_of_truth: AGENTS.md
---

# Operations Runbook

This runbook keeps the path to the first realized BTC payback delivery narrow:
deterministic dispatcher -> policy engine -> signer daemon only. It does not
grant cap raises, autoExecute flips, kill-switch bypass, raw transaction
submission, or payback discretion.

## Main Merge

Inside the sandbox:

```bash
git switch main
git merge codex/chain-agnostic-aggressive-allocator-dashboard --no-ff
git push origin main
```

If `.git/index.lock` cannot be created with `Operation not permitted`, stop the
merge attempt and inspect only:

```bash
git status
lsof .git/index.lock
ps -ef | grep -E "git|node|executor"
```

Do not bypass filesystem permissions. The operator should run the same merge
commands from a local terminal after confirming no lock holder exists.

## Signer Health

Use the diagnosis command before any live dispatch:

```bash
npm run diagnose:signer-health -- --json
```

Cause mapping:

| Cause | Action |
| --- | --- |
| `clean` | Continue to kill-switch and capital checks. |
| `process_down` | Start deterministic daemons with `npm run executor:daemon` and `npm run executor:watchdog`. |
| `heartbeat_stale` | Restart deterministic daemons, wait 5 seconds, then rerun diagnosis. |
| `socket_unreachable` | Stop before broadcast; inspect signer socket path and daemon logs. |
| `rpc_unreachable_<chain>` | Stop before broadcast; inspect the named chain RPC config and network reachability. |
| `btc_rpc_unreachable` | Stop before any BTC or Gateway payback path. |
| `nonce_manager_error` | Stop before broadcast; inspect signer daemon nonce state. |

Daemon starts and restarts must use the npm scripts, not direct signer bypasses:

```bash
npm run executor:daemon &
npm run executor:watchdog &
```

Record manual restart timing in `logs/operator-action-audit.jsonl` or an
equivalent append-only operator audit file.

## Kill-Switch

Check state:

```bash
npm run kill:status
```

`RUNNING` means broadcasts may continue if every other gate is green. A set
kill-switch blocks every broadcast and the payback offramp. This runbook does
not authorize automatic toggles; kill-switch changes require an explicit
operator reason and the repo's audited commands.

## First Broadcast Checklist

Run these checks in order:

```bash
npm run diagnose:signer-health -- --json
npm run kill:status
npm run report:wallet-holdings-slice -- --json
npm run report:strategy-execution-surfaces -- --json
npm run report:payback-status -- --json
npm run executor:dispatch-target -- --target=wrapped-btc-loop-base-moonwell --dry-run --json
```

Proceed to live dispatch only when all are true:

| Gate | Required result |
| --- | --- |
| Signer health | cause is `clean`. |
| Kill-switch | status is `RUNNING` / off. |
| Capital | current `totalUsd` is at least 50% of the expected baseline. |
| Dry-run target | `selectedCount=1`, `executionStatus=preview`, `blockedReason=null`. |
| Live run control | no cooldown or live-admission blocker is present. |

Broadcast command:

```bash
npm run executor:dispatch-target -- --target=wrapped-btc-loop-base-moonwell --execute
```

The live path remains dispatcher -> policy -> signer. Policy alone enforces
caps, health factor, liquidation buffer, slippage, stale quotes, cold-start
clamp, leverage collateral, unlimited approvals, kill-switch, consecutive
failures, drawdown, and auto-kill.

## Failure Branches

| Branch | Response |
| --- | --- |
| Policy reject | Record the deterministic reject reason and stop. Do not retry around policy. |
| Signer nonce/gas/RPC error | Retry once. If it repeats, stop and report the exact class. |
| On-chain revert | Confirm receipt was logged, count the failure, and stop if the lane reaches 3 consecutive failures. |
| Auto-kill trip | Stop immediately; the kill-switch file is authoritative until operator review. |
| Cooldown/live-run-control blocker | Stop. Do not bypass cooldown. |

## Payback Delivery Flow

After a confirmed broadcast, verify the receipt path:

```bash
npm run report:payback-status -- --json
npm run report:strategy-tick-slice -- --json --commit-public
```

Expected natural progression:

1. Confirmed signer receipt appends to `logs/signer-audit.jsonl`.
2. Receipt ingestion records realized PnL in sats.
3. Accumulator adds realized BTC-denominated profit to pending payback.
4. Scheduler carries while pending sats are below the effective minimum.
5. When pending sats reach the effective minimum and offramp cost is within
   policy, scheduler emits the first deterministic delivery candidate.
6. Policy validates the payback intent before the signer can broadcast.

Emergency pause, kill-switch, drawdown, or excessive offramp cost keeps
planned payback at zero/deferred. No LLM decides payback ratio, timing, or
amount.
