# NFT And CL Freshness Policy

## Objective

Concentrated-liquidity positions cannot rely on a 24h NFT cache. A stale
position index can hide an exited/rebalanced NFT or miss range-health drift, so
the indexer now treats NFT ownership and CL health as short-lived operational
evidence.

## Cache And Invalidation

`src/treasury/nft-position-indexer.mjs` uses:

```js
NFT_POSITION_CACHE_TTL_MS = 30 * 60 * 1000
ETH_BTC_INVALIDATE_MOVE_PCT = 0.03
```

The cache refreshes when any of these are true:

- cached wallet entry is older than 30 minutes;
- ETH/BTC moves by at least 3% from the cached reference ratio;
- an explicit rebalance event newer than the cached entry is supplied;
- the kill-switch toggle timestamp is newer than the cached entry.

These triggers only refresh read-side position evidence. They do not emit a
trade, alter caps, toggle `autoExecute`, or bypass signer policy.

## Dashboard CL Health

`src/strategy/aerodrome-cl-manager.mjs` now exposes a dashboard-ready CL health
slice with:

- `timeInRangePct24h`
- `impermanentLossPct`
- `impermanentLossUsd`
- `accumulatedFeesUsd`
- `feesVsIlRatio`
- `ilExceedsFees`
- `ilExceedsFeesHours`

The health status is `review` when the current tick reports emergency exit,
`timeInRangePct24h < 0.60`, or `ilExceedsFeesHours >= 6`. This is dashboard
evidence for operator visibility and auto-kill inputs; it is not a live-trading
permission path.
