# Payback minimum rationale

## Current committed policy

- `src/config/payback.mjs`
  - `baseRatio = 0.20`
  - `minPaybackSats = 50_000` static legacy ceiling
  - `effectiveMinPaybackSats({ operatingCapitalSats })`
  - `cronExpression = "0 0 * * 1"` (weekly)

The runtime minimum is now capital-aware:

```js
pctFloor = floor(operatingCapitalSats * 0.005)
effectiveMinPaybackSats = clamp(pctFloor, 5_000, 50_000)
```

The static `50_000` sats value remains the absolute ceiling and the fallback when
operating capital cannot be measured. The formula does not change `baseRatio`,
`maxOfframpCostPctOfPayback`, `perPeriodMaxSats`, `annualMaxPaybackSats`,
`regimeMultipliers`, `volMultiplier`, or emergency pause rules.

At the current operating-capital scale (`~620,000` sats), the percent floor is
`3,100` sats, so the absolute floor applies:

`effectiveMinPaybackSats = clamp(3_100, 5_000, 50_000) = 5_000`

That means the scheduler needs roughly `25_000` sats of gross realized profit
before the first payback can clear the effective minimum:

`requiredGrossProfitSats = 5_000 / 0.20 = 25_000`

## Current 30-day receipt-backed view

Dashboard/payback forecasting now uses a rolling 30-day realized-PnL window.

- Reporting PnL baseline is active from `2026-04-27T06:13:35.097Z`.
- Rolling 30-day realized gross profit inside that active baseline is currently `0`
  sats.
- Result: `estimatedPeriodsToFirstPayback` is unavailable under both
  `smallCapital_v1` and `aggressive_v1` because there is no positive realized
  run-rate to project from.

## What this means operationally

1. The current accumulator state (`601 / 5_000 sats` effective minimum) is still
   below the configured minimum.
2. The 30-day realized run-rate is not yet positive in either committed sleeve
   profile.
3. A non-positive realized run-rate still makes the projected periods to first
   payback unbounded. The scheduler must keep carrying until realized-positive
   receipts lift the gross target above the effective minimum and the measured
   offramp cost remains within policy.
4. Historical PR-only proposal artifacts remain review-only context. Runtime
   execution now reads the committed effective minimum above and never uses a
   dashboard proposal as authority to change payback timing or amount.

## Why this does not loosen payback safety

- Payback is still funded only from realized positive PnL.
- If estimated offramp cost exceeds `10%` of the planned payback, the scheduler
  still defers.
- If the effective minimum is not met, the scheduler still carries.
- If operating capital cannot be measured, the scheduler falls back to the old
  `50_000` sats minimum.
- The formula lowers dust friction for small capital, but it does not change
  payback ratio, timing, caps, emergency pause, signer isolation, kill-switch
  checks, or the deterministic policy path.
