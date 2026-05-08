# Idle Inventory Consolidation Defaults

Date: 2026-05-08

This note justifies the committed defaults in `buildDefaultTreasuryPolicy().idleInventoryConsolidation`. The defaults are config-only thresholds for planning consolidation candidates; they do not sign, bridge, whitelist tokens, raise caps, or bypass signer policy.

## Evidence Window

Source: `data/treasury/inbound-events.jsonl`, trailing 30 days as of `2026-05-08T00:00:00.000Z`.

- Records: 42 inbound inventory events, all inside the 30-day window.
- Chains represented: avalanche 5, base 21, bera 2, bsc 2, optimism 3, sei 1, soneium 2, sonic 3, unichain 2, ethereum 1.
- Event age distribution: min 134.75h, p25 227.11h, median 263.50h, p75 289.10h, p90 289.10h, max 289.10h.
- Estimated USD distribution: min $0.00, p25 $0.10, median $1.17, p75 $7.14, p90 $23.94, max $49.07.
- Known estimated USD total: $286.19. Events at or above $5: 15 events totaling $264.47.
- Events at least 72h old and at or above $5: 15 events.

## Defaults

`minIdleAgeMs = 72h`: the observed inbound set is already older than 72h at the review cut, so 72h is not an aggressive immediate-sweep threshold. It leaves three days for attribution, receipt ingestion, strategy matching, and transient route demand before inventory can be treated as idle.

`minIdleUsd = $5`: the median inbound item is only $1.17 and the p75 is $7.14. A $5 threshold ignores dust-like fragments while still catching the 15 meaningful fragments that account for $264.47 of the $286.19 known inbound value.

`maxAggregateIdleUsd = $50`: the largest single observed inbound item is $49.07, and p90 is $23.94. A $50 aggregate cap can consolidate one large fragment or a few medium fragments, but it cannot sweep the whole 30-day inbound set in one planning pass.

`dstChain = base`: Base is the current committed evidence-primary chain and has the deepest observed inbound concentration in the 30-day set (21 of 42 events). This is a planning default only; every actual movement still needs route cost, cap, kill-switch, and signer-policy approval.
