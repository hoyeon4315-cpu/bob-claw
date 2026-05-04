# Parcel 14 postmortem

## Outcome

Parcel 14 did **not** proceed to a live broadcast. The pipeline halted at the
preview stage and no execution flag was bypassed.

## Blocking facts

### 1. Active sleeve profile is still the committed default

- `data/dashboard-status.json`
- `sleeveProfile.activeProfile = "smallCapital_v1"`

The handoff goal said `--profile=aggressive_v1`, but the runtime CLI does not
accept a profile override and the operating law forbids runtime profile flips.
Aggressive profile selection remains a committed config diff only.

### 2. The lane is still at Stage B

- `data/dashboard-status.json`
- `overall.lanePolicy.stage = "B"`
- `overall.lanePolicy.stageBlockers =`
  - `refresh_success_ratio_below_stage_b_threshold`
  - `refill_routes_unresolved`
  - `receipt_proven_payback_period_missing`
  - `stage_c_hysteresis_demoted`

Key evidence at the time of the attempt:

- `refreshSuccessRatio24h = 0.8084848484848485`
- `unresolvedRefillRoutes = 7`
- `deliveredPeriodCountOnReserveChain = 0`

Stage B means shadow-only. A live broadcast would have violated the staged
reopen policy.

### 3. Kill-switch was active before execution

Command:

```bash
npm run kill:status
```

Observed result:

- `kill-switch: HALTED`
- path: `/Users/love/.bob-claw/KILL_SWITCH`
- last toggle: `halt @ 2026-05-04T18:16:45.378Z by risk:auto-kill`
- reason: `auto_kill:failure_burst_per_strategy`

This is a hard stop checked before broadcast. It was not cleared in this parcel.

### 4. Autopilot preview confirmed the hard stop

Command:

```bash
npm run autopilot:all-chains -- --json --timeout-ms=120000
```

Observed result:

- `status = "error"`
- `blockedReason` included `Execution guard blocked: kill_switch_active`

Because the preview already hit the execution guard, there was no safe path to
continue to a live attempt.

## Decision

No live intent was flipped. No broadcast was attempted. No safety rail was
bypassed.

## What must change before retrying Parcel 14

1. Clear the underlying auto-kill condition and manually resume the kill-switch
   only after operator review.
2. Resolve the Stage B blockers so the lane reaches Stage C.
3. If aggressive profile validation is desired, select `aggressive_v1` by a
   committed config diff instead of a runtime CLI flag.
