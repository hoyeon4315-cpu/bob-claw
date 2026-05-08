# Operating Capital Scale

## Objective

Small-capital campaign budgets use a single baseline at `$1,000` operating capital
and derive effective budgets from measured operating capital. The formula is a
committed policy surface, not a runtime cap-raise side channel: baseline values
remain in config, and runtime reports expose both nominal and effective values.

## Scale Formula

`src/config/operating-capital-scale.mjs` defines:

```js
SCALE_BANDS = [
  { maxCapitalUsd: 500,   bandId: "tiny",      multiplier: 0.6 },
  { maxCapitalUsd: 1000,  bandId: "small",     multiplier: 1.0 },
  { maxCapitalUsd: 5000,  bandId: "moderate",  multiplier: 2.0 },
  { maxCapitalUsd: 25000, bandId: "operating", multiplier: 4.0 },
  { maxCapitalUsd: null,  bandId: "scaling",   multiplier: 8.0 },
];

effectiveBudgetUsd(baselineUsd, operatingCapitalUsd) =
  baselineUsd * selectedBand.multiplier
```

The selected band is the first band whose `maxCapitalUsd` is `null` or greater
than or equal to measured operating capital. The `$1,000` baseline maps to the
`small` band and therefore keeps a `1.0` multiplier.

## Baseline Source

The duplicated USD constants now live in
`src/config/small-capital-campaign-mode.mjs`:

- `SMALL_CAPITAL_DEFAULT_BUDGETS_USD_BASELINE`
- `SMALL_CAPITAL_RADAR_CAPS_BASELINE`
- `SMALL_CAPITAL_NON_PRIMARY_ENTRY_BASELINE`, which now records the p90-cost
  EV policy metadata rather than a scaled static dollar floor.

`src/config/sleeve-profile.mjs` imports these constants so the sleeve profile and
small-capital mode cannot drift silently.

## Current Capital Example

At the currently measured operating capital near `$358`, the `tiny` band applies:

- `opportunisticMaxUsd`: `$125` baseline -> `$75` effective.
- `radar perCanaryUsd`: `$30` baseline -> `$18` effective.
- non-primary entry: no `$10 -> $6` static floor remains. Entry uses the
  receipt/ledger p90 EV formula documented in
  `docs/research/non-primary-entry-ev.md`.

The dashboard should expose nominal and effective budgets together so operators
do not mistake a scaled report value for an unbounded live cap.

## Safety Notes

The formula scales only committed baseline values. It does not change signer
isolation, kill-switch checks, capless rejection, stale-quote rejection, HF floor,
liquidation buffer, payback ratio/timing rules, or `autoExecute`. Signer policy
must continue to use deterministic cap validation and the existing proposer ->
policy -> signer path.
