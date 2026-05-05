# Payback minimum rationale

## Current committed policy

- `src/config/payback.mjs`
  - `baseRatio = 0.20`
  - `minPaybackSats = 50_000`
  - `cronExpression = "0 0 * * 1"` (weekly)

That means the scheduler needs roughly `250_000` sats of gross realized profit
before the first payback can clear the current minimum:

`requiredGrossProfitSats = minPaybackSats / baseRatio = 50_000 / 0.20 = 250_000`

## Current 30-day receipt-backed view

Dashboard/payback forecasting now uses a rolling 30-day realized-PnL window.

- Reporting PnL baseline is active from `2026-04-27T06:13:35.097Z`.
- Rolling 30-day realized gross profit inside that active baseline is currently `0`
  sats.
- Result: `estimatedPeriodsToFirstPayback` is unavailable under both
  `smallCapital_v1` and `aggressive_v1` because there is no positive realized
  run-rate to project from.

## What this means operationally

1. The current accumulator state (`601 / 50_000 sats`) is still far below the
   configured minimum.
2. The 30-day realized run-rate is not yet positive in either committed sleeve
   profile.
3. A non-positive realized run-rate makes the projected periods to first payback
   unbounded, which trivially exceeds the eight-period proposal threshold.
   Parcel 18 therefore widened the proposal logic so that the dashboard surfaces
   `payback.proposedMinPaybackPatch = "data/payback/proposed-min-payback-diff.patch"`
   and emits a PR-only diff under
   `data/payback/proposed-min-payback-diff.patch`.
4. The PR-only patch is annotated with the trigger
   (`both_profiles_non_positive_run_rate` or `both_profiles_above_threshold`)
   and explicitly marked as a draft for operator review.

## Why the runtime minimum stays unchanged

- The dashboard surface and the on-disk patch are PR drafts only. Per AGENTS.md,
  any change to payback ratio, timing, or `minPaybackSats` requires a committed
  config diff with rationale in this document. The dashboard pipeline never
  rewrites `src/config/payback.mjs` and never raises caps at runtime.
- The proposal exists so that operator review is not blocked behind the same
  positivity gate that prevents the forecast from estimating a finite period
  count. It does not by itself authorise a runtime change.

## Next trigger for promoting the proposal into a committed change

Promote the PR draft into a real commit only after:

1. The 30-day receipt-backed run-rate has at least one positive period under the
   active reporting baseline.
2. The reserve-chain offramp cost surface is rechecked against the then-current
   minimum candidate (`PROPOSED_MIN_PAYBACK_SATS = 5_000` is a placeholder, not
   a vetted target).
3. Both committed sleeve profiles produce deterministic
   `estimatedPeriodsToFirstPayback` values that still exceed eight periods, or
   an explicit operator note records why the floor change is desired despite a
   shorter forecast.
