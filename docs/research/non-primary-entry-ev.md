# Non-Primary Entry EV Policy

## Objective

Non-primary chain entries must clear measured execution cost instead of a static
`minNetProfitUsd` floor. This keeps tiny canaries from being blocked by a
hard-coded `$10` threshold while still requiring positive expected realized net
EV after p90 cost, sparse-sample uncertainty, and a minimum economic edge.

## Formula

Runtime policy in `src/strategy/non-primary-entry-policy.mjs` uses:

```js
p90Cost = pnlEvGateP90(costLedger, chain, candidate)

uncertainty =
  candidate.observedSampleCount < 10 ? p90Cost * 0.50 :
  candidate.observedSampleCount < 30 ? p90Cost * 0.25 :
  p90Cost * 0.10

minEdgeFloor = max(0.50, candidate.notionalUsd * 0.005)
requiredEdge = p90Cost + uncertainty + minEdgeFloor
```

The candidate is allowed only when `expectedNetEvUsd >= requiredEdge`.

## Threshold Rationale

- `<10` samples uses a `50%` p90 uncertainty penalty because sparse receipts are
  not enough to trust a chain/protocol cost surface.
- `10-29` samples uses `25%` because cost history exists but is not yet
  seasoned.
- `30+` samples uses `10%` because p90 should already include ordinary execution
  variance.
- `$0.50` minimum edge prevents near-zero dust trades from being labeled
  profitable.
- `0.5%` of notional preserves proportional discipline for larger campaign
  entries.

The policy is config-driven by `NON_PRIMARY_ENTRY_EV_POLICY` in
`src/config/sizing.mjs`, with `reEvaluateEveryDays = 14` and
`expiresAt = "2026-05-22T00:00:00.000Z"` so the constants cannot become a silent
permanent bias.

## Safety Notes

This policy does not raise caps, flip `autoExecute`, bypass kill-switch checks,
or authorize signing. It only replaces the old static non-primary entry floor
with a deterministic EV gate inside the existing proposer -> policy -> signer
path. Reward-token candidates still pay claim/swap p90 costs when an explicit
reward token exists; native/share-price yield candidates do not pay reward-token
exit costs unless such a token is declared.
