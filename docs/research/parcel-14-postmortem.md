# Parcel 14 postmortem

## Summary

Parcel 14 did not proceed to a live broadcast. The aggressive live-canary goal was
blocked by the existing system halt and by current stage readiness evidence. No
policy or kill-switch flag was bypassed.

## Attempt

- Command attempted: `npm run autopilot:all-chains -- --profile=aggressive_v1 --dry-run-first --json --timeout-ms=180000 --canary-timeout-ms=180000 --dispatch-timeout-ms=180000`
- CLI behavior check: `--dry-run-first` only runs preview followed by execution
  when `--execute` is also present. Without `--execute`, this is preview-only.
- The preview process produced no JSON output before it exceeded the intended
  timeout window, so the operator-session child process started for this parcel
  was stopped. The pre-existing autopilot loop was not stopped.

## Blocking evidence

- Kill-switch status: `HALTED`
- Active halt reason: `auto_kill:failure_burst_per_strategy`
- Replay state: no trigger is currently firing, but the stale arm remains
  present and manual operator review is required before resume.
- Latest all-chain autopilot execution gate:
  - `requestedExecute: true`
  - `liveCapableStepExecution: false`
  - `blockedReason: kill_switch_armed`
  - `autoKillTriggered: false`
  - `killSwitchActive: true`
  - `killSwitchAlreadyArmed: true`
- Latest canary sweep:
  - `status: blocked`
  - `blockedReason: kill_switch_present`
  - `previewReadyCount: 0`
  - `executedCount: 0`
  - `broadcastStepCount: 0`
- Latest strategy dispatch:
  - `batchStatus: preview`
  - `selectedCount: 10`
  - `liveEligibleCount: 0`
  - `capitalDispatchReadiness: refill_pending_individual_strategy_gates_enforced`
- Stage evaluator:
  - `stage: A`
  - blockers: `refresh_success_ratio_below_stage_b_threshold`,
    `receipt_proven_payback_period_missing`
  - `refreshSuccessRatio24h: 0.9251543209876543`
  - `deliveredPeriodCountOnReserveChain: 0`
  - `paybackPendingSats: 601`

## Audit outcome

- Recent signer-audit tail inspected: last 200 rows contained 0 broadcast rows.
- No broadcast block hash was observed for Parcel 14.
- No receipt reconciliation row was observed for a Parcel 14 intent.
- Payback accumulator did not receive a delivery-backed delta from this parcel.

## Decision

Live flipping was not attempted. The correct next action is operator review of
the stale kill-switch arm, then a new dry-run-first pass after Stage refresh and
payback blockers are rechecked. A coding agent must not remove the kill-switch
without an explicit operator resume request and audit reason.
