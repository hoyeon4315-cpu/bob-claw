# Payback minimum rationale

## Current committed policy

- `src/config/payback.mjs`
  - `baseRatio = 0.20`
  - `minPaybackSats = 50_000`
  - `cronExpression = "0 0 * * 1"` (weekly)

That means the scheduler needs roughly `250_000` sats of weekly gross realized profit before the first payback can clear the minimum:

`requiredGrossProfitSats = minPaybackSats / baseRatio = 50_000 / 0.20 = 250_000`

## Receipt-backed findings

### Current reporting-baseline view

- Reporting PnL baseline is active from `2026-04-27T06:13:35.097Z`.
- Since that reset, rolling 90-day realized gross profit is `0` sats.
- Result: `estimatedPeriodsToFirstPayback` is currently unavailable under both profiles because there is no positive realized run-rate to project from.

### Conservative historical bound (same 90-day model, no baseline reset)

- Rolling 90-day realized gross profit: `601` sats
- Observed scheduler periods in that window: `12.86`
- Realized gross profit per weekly period under `smallCapital_v1`: `46.74` sats
- Profile scaling from committed non-BTC settlement targets:
  - `smallCapital_v1`: `650` USD
  - `aggressive_v1`: `1_040` USD
  - aggressive scaling ratio vs active small profile: `1.6x`
- Projected weekly gross profit under `aggressive_v1`: `74.79` sats

Derived first-payback estimates:

| Profile | Weekly gross profit sats | Estimated periods to first payback |
| --- | ---: | ---: |
| `smallCapital_v1` | 46.74 | 5348.23 |
| `aggressive_v1` | 74.79 | 3342.64 |

Both are far beyond two quarters.

## What this proves

1. The current `50_000` sat minimum is not reality-based for the observed realized run-rate.
2. Lowering only `minPaybackSats` does **not** restore an economically meaningful cadence by itself.
3. To reach a first payback within 26 weekly periods at the current receipt-backed run-rate, the minimum would need to fall below roughly `243` sats under the small profile:

`46.74 sats/week * 26 weeks * 0.20 = 243.048 sats`

That is below any sensible Bitcoin batch threshold and would almost certainly be dominated by the existing offramp-cost guard.

## PR-only recommendation

Do **not** change runtime payback config in this parcel.

If the operator still wants a PR discussion, frame it as a **proof-of-life bookkeeping floor** discussion, not as an economics-complete optimization:

```diff
diff --git a/src/config/payback.mjs b/src/config/payback.mjs
@@
-  minPaybackSats: 50_000,
+  minPaybackSats: 5_000,
```

Rationale for the draft:

- `50_000` sats is disconnected from realized weekly profit.
- A lower floor would allow earlier accumulator flushes once a positive run-rate returns.
- This remains PR-only because a min-only reduction does not solve the current cash-out economics on its own.

Required before merging any such PR:

1. Re-run the receipt-backed cost model on the actual reserve-chain payback path.
2. Confirm the effective cash-out cost floor is compatible with the lowered minimum.
3. Recompute `estimatedPeriodsToFirstPayback` after fresh realized-positive periods exist past the current reporting baseline.

Until those conditions are met, `minPaybackSats = 50_000` should remain unchanged in runtime code.
