# Asset Price Freshness And Confidence

## Objective

Wallet and protocol holdings must not look exact merely because the dashboard was
rebuilt. Every visible holding row needs explicit source, price freshness,
divergence, freshness, and confidence metadata.

## Row Metadata

`dashboard/public/wallet-holdings.json` rows expose:

- `priceSource`: `{ name, type, observedAt, divergencePct }` plus the committed
  primary/secondary/fallback source ladder.
- `priceFreshness`: `fresh`, `stale`, or `missing`.
- `priceObservedAt`: timestamp used for the price.
- `priceDivergenceStatus`: `ok`, `warn`, or `block`.
- `freshness`: wallet/protocol source freshness, `fresh` or `stale`.
- `confidence`: `verified_current`, `rpc_inferred`, `registry_only`, or `low`.

## Source Ladder

BTC and ETH-denominated assets use Chainlink-style on-chain oracle labels as the
primary source (`chainlink:btc_usd`, `chainlink:eth_usd`). Stablecoins use the
committed USD-stable source label. ERC-4626-like share tokens with a
`convertToAssets` valuation use `erc4626_underlying_preview`. The committed
secondary source is DEX pool median, and the fallback source is CoinGecko HTTP;
fallback-derived rows should remain stale unless a fresh observation timestamp is
present.

## Divergence Thresholds

When a row carries multi-source divergence:

- `divergencePct > 1` => `priceDivergenceStatus = "warn"`.
- `divergencePct > 3` => `priceDivergenceStatus = "block"`.

Rows with `block` divergence or unregistered tracking status are visible in the
dashboard but excluded from wallet-total eligibility.

## Freshness Thresholds

- Wallet/protocol source freshness uses a 60 second TTL, aligned to the
  realtime operating-capital source.
- Price freshness uses a 5 minute TTL for dashboard row metadata.

Stale rows do not become fresh just because `generatedAt` changed.

## Unknown Assets

Unknown or pending-whitelist assets normalize to `trackingStatus:
"unregistered"`. They remain visible for operator review, carry low confidence,
and do not count into operating capital until a committed registry/config diff
approves them.
