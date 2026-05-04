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
2. The 30-day realized run-rate is not yet positive enough to justify an
   automatic PR candidate that lowers the minimum.
3. Because both profile forecasts are currently `unavailable` rather than
   `>= 8 periods`, the dashboard now surfaces
   `payback.proposedMinPaybackPatch = null`.

## Why the runtime minimum stays unchanged in this parcel

- A min-only change without fresh realized-positive reserve-chain periods would
  still be disconnected from the current receipt-backed run-rate.
- The active reporting baseline intentionally fail-closes here: no positive
  realized run-rate means no automatic minimum-lowering proposal.
- Runtime payback policy therefore stays unchanged until fresh realized-positive
  periods exist and the same 30-day model can estimate both profiles
  deterministically.

## Next trigger for revisiting the minimum

Re-open the PR-only minimum discussion only after:

1. The 30-day receipt-backed run-rate becomes positive after the current
   reporting baseline.
2. Both committed sleeve profiles produce deterministic
   `estimatedPeriodsToFirstPayback` values.
3. The reserve-chain offramp cost surface is rechecked against the then-current
   minimum candidate.
