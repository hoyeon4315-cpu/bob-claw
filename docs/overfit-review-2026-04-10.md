# Overfit Review - 2026-04-10

## Verdict

Current status:

- Shadow collection: allowed
- Live trading: blocked

The current harness works, but the current dataset is too small and too concentrated to support live trading.

## Objective Audit Result

Latest audit result:

- Observed window: about 0.26 hours
- Target window: 168 hours
- Route coverage: 18 / 113 routes, about 15.9 percent
- Target coverage: 50 percent
- Candidate routes with at least 30 samples: 0
- Hourly buckets: 2
- Target hourly buckets: 24
- Failure rate: 11.5 percent
- Target failure rate: at or below 10 percent
- Cloudflare failures observed: 6
- Gas snapshots: fresh enough at the time of audit

## Overfit Risks Present

1. Time overfit
   - The data comes from a short observation window.
   - It may reflect one temporary Gateway, gas, or market state.

2. Route overfit
   - Only 18 of 113 routes have been observed.
   - BOB-neighbor routes are useful, but not enough for a global Gateway conclusion.

3. Amount overfit
   - Some routes have only one or two amount levels.
   - Fixed route costs make small and large ticket economics very different.

4. Failure underweighting
   - Cloudflare challenge responses were observed.
   - Failure rate must reduce route score, not remain a log-only concern.

5. Price-source overfit
   - CoinGecko is a reference price, not executable price.
   - Trading decisions require DEX/router quotes.

6. Gas-model overfit
   - Gas snapshots are useful but not enough.
   - Exact `eth_estimateGas` preflight now exists, but successful estimates still require a funded/approved sender.
   - Fallback gas snapshots may price observation data, but must not promote a route to candidate readiness.

7. Schema/data hygiene risk
   - Early legacy samples exist without `schemaVersion`.
   - Future production scoring should separate experiments by schema and run.

## Changes To The Plan

### Previous Next Step

Build reference pricing and opportunity scoring.

### Revised Next Step

Build a shadow scanner that stores enough data to defeat the current overfit risks:

- route coverage expansion
- amount ladder coverage
- time bucket coverage
- quote failure-rate tracking
- quote decay tracking
- DEX executable quote integration
- gas percentile history
- schema-aware reports

## New Gates Before Live Canary

Live canary remains blocked until all are true:

1. At least 7 days of shadow data.
2. At least 24 distinct hourly buckets.
3. At least 30 samples for each candidate route.
4. At least 4 amount levels for each candidate route.
5. Failure rate below 10 percent for candidate routes.
   - This is now enforced in route scoring too; high-failure routes cannot become clean shadow candidates.
6. Route cost survives p95 gas, not just current gas.
7. DEX/router executable quote is integrated.
8. Exact `eth_estimateGas` succeeds with the canary wallet.
9. Token decimals are verified on-chain.
10. Expected net profit survives failed-transaction expected cost.

## Current Strategic Implication

BOB Gateway is still promising, especially if official Instant Swap reduces or subsidizes fees. But the current measured state says:

- Gateway movement is real.
- Movement cost is material for USD 300.
- The bot needs external DEX price dislocation to make Gateway routes profitable.
- No current evidence justifies live trading yet.

## Audit Harness Verification

The audit code was split into a reusable module and tested with fixture data.

Verified behavior:

- shallow short-lived data blocks live trading
- broad, deep, fresh shadow data allows canary review
- schema-less legacy data is now a warning, not a permanent blocker
- BOB-neighbor route coverage is checked separately from global route discovery coverage
