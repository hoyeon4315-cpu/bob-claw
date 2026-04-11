# Phase 0 Findings

Last updated: 2026-04-10

## Verified

- BOB Gateway mainnet API is reachable from this workspace with network approval.
- `GET /v1/get-routes` currently returns 113 routes.
- Gateway routes include `bitcoin -> bob`, `bob -> bitcoin`, `bob -> base`, and `base -> bob`.
- Current unique chains are avalanche, base, bera, bitcoin, bob, bsc, ethereum, soneium, sonic, and unichain.
- The current route list does not expose Arbitrum routes. Arbitrum should not be assumed for Gateway-based Instant Swap unless it appears in route data later.
- `bitcoin -> bob` returns an `onramp` quote with `signedQuoteData`.
- BOB-neighbor EVM routes return a `layerZero` quote shape with transaction calldata.

## Early Measurements

Sample route: `bitcoin -> bob`, token `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c`.

- 10,000 sats quote returned roughly 9,952-9,954 output units.
- 25,000 sats quote returned roughly 24,981-24,982 output units.
- Larger samples returned slightly above 1:1 output in one short run, which must not be treated as profit until reverse route, BTC price, and settlement risk are modeled.
- Estimated settlement time fluctuated materially, observed around 385-517 seconds for `bitcoin -> bob`.

Sample route: `bob -> base` / `base -> bob`, same token.

- Output amount was 1:1 for sampled sizes.
- Token fee field was zero, but transaction `value` was non-zero.
- The native transaction value must be converted to USD and included as a cost.
- Estimated time was around 60 seconds in successful samples.

BOB-neighbor route comparison:

- Most EVM BOB-neighbor routes returned 1:1 output at the 10,000-unit sample size.
- Approximate native-cost conversion placed most BOB-neighbor LayerZero movement costs around USD 0.73-0.84 per route in the first comparison sample.
- `bob -> bitcoin` returned only 9,531 output units for 10,000 input units in one sample, implying a 4.45 percent fee ratio at that size.
- `bob -> bitcoin` requires a Bitcoin recipient address, not an EVM recipient address.

## Risks Found

- Rapid quote calls can trigger Cloudflare challenge / HTTP 403 HTML responses.
- Response shapes differ by route type. Treating unknown shapes as valid would create false signals.
- Gateway does not currently replace the need for a reverse-price or exit-path check.
- Onramp settlement time is long enough that stale-price risk matters.
- L2 bridge-style routes may be capital movement routes, not standalone profit opportunities.

## Immediate Build Direction

1. Continue with slow quote sampling and structured failure capture.
2. Add reference pricing before any profit scoring.
3. Add native gas / transaction value USD conversion.
4. Add reverse-route checks for exit feasibility.
5. Only after 7 days of shadow data decide whether live canary is justified.
