# Transport Cap Clamp Rationale

Date: 2026-05-08

This note justifies the small-capital effective cap clamp added at the strategy cap lookup layer. The nominal registry entries in `src/config/strategy-caps/registry.mjs` stay unchanged so historical intent builders and documented transport lanes remain auditable; policy consumers receive the lower effective caps while small-capital mode is active.

## Signer-Audit Evidence

Source: `logs/signer-audit.jsonl`, trailing 30 days from `2026-04-08T00:00:00.000Z` through `2026-05-08T00:00:00.000Z`, filtered to transport / infrastructure strategy ids: `gateway-btc-funding-transfer`, `gateway-btc-onramp`, `gateway-btc-offramp`, `gas-zip-native-refuel`, `across-bridge`, `lifi-bridge`, `native-dex-experiment`, and `prelive_fork_execution`.

- Sample: 4,984 signer-audit rows; 1,439 confirmed rows; 960 confirmed economic rows after excluding approval-only intents.
- Confirmed economic volume: $3,975.23 total.
- By strategy: `gateway-btc-funding-transfer` 111 confirmed economic rows / $2,529.43 / max $56.61; `lifi-bridge` 44 / $954.18 / max $98.89; `native-dex-experiment` 773 / $305.06 / max $21.23; `gas-zip-native-refuel` 24 / $96.02 / max $9.72; `across-bridge` 7 / $86.32 / max $50.00; `gateway-btc-offramp` 1 / $4.22 / max $4.22.
- Parsed realized-loss fields in this window summed to $0.00. Reverted/error rows exist, but the signer-audit rows do not show realized net losses that would justify million-dollar daily loss budgets for small-capital operation.
- Raw audit `amountUsd` includes approval-intent anomalies, especially Li.Fi approvals around $38.6M. That is another reason the policy-visible effective cap should be explicit instead of letting future operators misread nominal infrastructure ceilings as intended daily risk.

## Clamp

When `SMALL_CAPITAL_CAMPAIGN_MODE` is active and the strategy id is transport / infrastructure, lookup returns:

`effective.perDayUsd = min(declared.perDayUsd, 200)`

`effective.maxDailyLossUsd = min(declared.maxDailyLossUsd, 100)`

The $200 daily effective cap is above the largest confirmed economic single transport row in the sampled window ($98.89) but far below the confusing $1,000,000 nominal entries. The $100 daily loss cap is stricter than the daily movement cap and preserves enough room for gas/revert noise without letting infrastructure routes behave like an uncapped strategy lane.
