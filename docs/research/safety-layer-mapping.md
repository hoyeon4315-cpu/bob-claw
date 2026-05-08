---
status: current
updated_at: 2026-05-09
source_of_truth: AGENTS.md
---

# Safety Layer Mapping

This maps the current runtime safety authority after surface admission was
reduced to reporting-only metadata. It is intentionally narrow: no row below
grants cap raises, signer bypass, kill-switch bypass, or payback discretion.

## AGENTS.md Authority Quotes

The unchanged runtime authority lines are:

> This system is designed for unattended, multichain, fully-automated execution. There is no manual promotion step and no tiered phase gate. A strategy runs the moment its config declares `autoExecute: true` with valid caps committed to the repo; it halts the moment the kill-switch file exists, the drawdown limit trips, or its caps are breached.

> Stage, readiness, admission, promotion, destination, and dashboard labels are advisory/reporting metadata only. They may help rank work or explain evidence gaps, but they must not block a cap-valid `autoExecute: true` strategy outside the deterministic proposer -> policy -> signer path.

Auto-promotion remains commit-time only:

> `src/executor/auto-promotion-gate.mjs` is a pure function that takes an evidence file and the config and returns `{ passed, blockers, evaluated, initialCanaryCaps }`. Coding-session LLMs must use it as a commit guard before proposing `autoExecute: true`; it is not a runtime phase gate, not a signer input, and not a manual promotion step.

## Runtime Enforcement Map

| Safety rule | Runtime authority | Primary implementation | Verification |
| --- | --- | --- | --- |
| Capless strategy reject | Policy engine | `src/executor/policy/index.mjs`, `src/executor/policy/cap-check.mjs` | `node --test test/executor-policy-coverage.test.mjs` |
| Per-tx, per-day, per-chain, daily loss, failed-gas caps | Policy engine | `src/executor/policy/cap-check.mjs`, `src/config/strategy-caps.mjs` | `npm run report:policy-coverage -- --json` |
| Positive net profit after measured gas and slippage | Policy engine | `src/executor/policy/index.mjs`, EV helpers in policy modules | `node --test test/executor-policy-index.test.mjs` |
| Health factor and liquidation buffer | Policy engine | `src/executor/policy/index.mjs`, leverage policy helpers | `node --test test/policy-leverage-collateral.test.mjs` |
| Consecutive failure auto-pause | Policy engine | `src/executor/policy/consecutive-failures.mjs` | `node --test test/executor-consecutive-failures.test.mjs` |
| Drawdown and failed-gas loss gates | Policy engine | `src/executor/policy/cap-check.mjs` | `node --test test/executor-policy-coverage.test.mjs` |
| Stale quote reject | Policy engine | `src/executor/policy/stale-quote.mjs` | `node --test test/executor-stale-quote.test.mjs` |
| Unlimited approval reject | Policy engine | `src/executor/policy/approval-hygiene.mjs` | `node --test test/executor-approval-hygiene.test.mjs` |
| Kill-switch before broadcast | Policy engine and signer boundary | `src/executor/policy/kill-switch.mjs`, signer daemon | `npm run kill:status:json` |
| Auto-kill triggers | Auto-kill evaluator writes kill-switch, policy observes halt | `src/risk/auto-kill-triggers.mjs`, `src/config/auto-kill.mjs` | `node --test test/auto-kill-triggers.test.mjs` |
| Cold-start first-24h sizing clamp | Policy engine sizing adjustment, not an emit blocker | `src/executor/policy/cold-start-clamp.mjs` | `node --test test/policy-cold-start-clamp.test.mjs` |
| Leverage collateral below cap requirement | Policy engine reject separate from capless reject | `src/executor/policy/leverage-collateral-rule.mjs` | `node --test test/policy-leverage-collateral.test.mjs` |
| Surface admission | Reporting-only | `src/strategy/strategy-execution-surfaces.mjs`, `src/status/strategy-tick-slice.mjs` | `node --test test/strategy-execution-surfaces.test.mjs test/strategy-dispatch-runner.test.mjs` |
| Auto-promotion gate | Commit-time guard only | `src/executor/auto-promotion-gate.mjs`, `src/strategy/phase3-evidence-builder.mjs` | `node --test test/auto-promotion-gate-runtime-isolation.test.mjs test/phase3-evidence-builder.test.mjs` |
| Refill prerequisites | Intent may be emitted as pending prerequisite; signer still waits for policy-ready execution | `src/executor/dispatcher/refill-prerequisite-resolver.mjs`, dispatcher metadata | `node --test test/refill-prerequisite-resolver.test.mjs` |
| Payback ratio, timing, and amount | Deterministic payback scheduler/accumulator only | `src/config/payback.mjs`, `src/executor/payback/*` | `node --test test/payback-scheduler.test.mjs test/payback-accumulator.test.mjs` |

## Runtime Isolation Checks

`evaluateAutoPromotion` must not appear in dispatcher, policy, signer,
all-chain autopilot, or strategy-dispatch runner hot paths. The current grep
verification command is:

```bash
rg -n "evaluateAutoPromotion\\s*\\(" \
  src/executor/dispatcher src/executor/policy src/executor/signer \
  src/executor/all-chain-autopilot.mjs src/session/strategy-dispatch-runner.mjs
```

Expected result: no matches. The regression test
`test/auto-promotion-gate-runtime-isolation.test.mjs` fails if a runtime call
site is added.

## Dashboard Funnel

`dashboard/public/strategy-tick-status.json` schema v5 and the live snapshot
writer expose the five reporting layers:

| Layer | Meaning |
| --- | --- |
| `tickPass` | latest strategy tick observed no tick-layer blocker |
| `runtimeExecutable` | `autoExecute && capsConfigured && policyOk && !killSwitchSet && !consecutiveFailureLock` |
| `intentEmitted` | dispatcher emitted or previewed an intent record |
| `broadcastSent` | signer broadcast evidence is present for that tick |
| `surfaceAdvice` | readiness/admission advice only, with `adviceAuthority: "commit_time_guard"` |

The dashboard may show this funnel, but it does not grant runtime authority.

Schema v5 also exposes first-broadcast reporting fields only:
`firstLiveBroadcastAt`, `firstLiveBroadcastTxHash`, `firstRealizedPnlSats`,
`paybackProgressTrajectory`, and top-level `overall.latestBroadcastAt`,
`overall.satsSinceFirstBroadcast`, `overall.daysSinceFirstBroadcast`, and
`overall.paybackEffectiveMinReachedAt`. These fields are derived from
tick/audit/receipt records and do not affect dispatcher, policy, signer, caps,
or payback scheduler decisions.

## 2026-05-09 Operations Checkpoint

| Task | Result | Safety note |
| --- | --- | --- |
| Task-1 main merge | Blocked in sandbox by `.git/index.lock` `Operation not permitted`; `lsof` showed no lock holder and `ps` showed only running node daemons. | No permission bypass attempted; operator terminal merge required. |
| Task-2 signer health | `npm run diagnose:signer-health -- --json` classified the live daemon with a hard `cause`; schema now also reports `readiness.readyForBroadcast`. | `cause=clean` is not allowed to hide incomplete diagnostic telemetry such as an older daemon that does not report nonce-manager state. |
| Task-3 daemon restart | Deterministic launchd reload completed with `npm run ops:launchd:install -- --json` after the audit exposed old-daemon nonce telemetry as a readiness limitation. | Reload used repo npm launchd scripts only, wrote an append-only `logs/operator-action-audit.jsonl` row, and post-restart diagnosis returned `cause=clean`, `readiness.readyForBroadcast=true`. |
| Task-4 kill-switch | `npm run kill:status` reported `RUNNING`. | No kill-switch toggle was performed. |
| Task-5 capital snapshot | Wallet holdings were about USD 360.65 with 100% freshness and price-source coverage; payback pending 601 sats vs effective min 5000 sats. | Payback remains carry-first until realized receipts naturally reach the minimum. |
| Task-6 dispatch dry-run | `wrapped-btc-loop-base-moonwell` selected one preview intent with `blockedReason=null`; dispatch records now expose `broadcastReadiness.readyForPolicyDispatch`, `readyForLiveBroadcast`, and advisory evidence separately. | `liveAdmissionBlockers` stay visible as advisory surface evidence and must not be converted into a runtime block or runtime approval. Policy and signer remain authoritative. |
| Task-7 first broadcast | Not run in the sandbox pass. | After the audit fix, the live preflight must use signer `readiness.readyForBroadcast` and dispatch `broadcastReadiness.readyForLiveBroadcast`, then let policy/signer decide. |
