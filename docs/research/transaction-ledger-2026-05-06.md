# Transaction Ledger Snapshot - 2026-05-06

## Purpose

This note records the first repeatable transaction-history ledger for the
operator wallet. It is read-only and derived from existing append-only logs and
receipt stores. It does not sign, broadcast, rewrite logs, or infer external
deposits from unsupported explorer UI data.

## Current Asset Tracking Review

Independent fresh scans and dashboard slices agree that current supported NAV is
about USD 370.6-370.8:

- Current NAV used by the ledger: about `370.66` USD
- Wallet/token NAV: about `303.9` USD
- Protocol NAV: `66.733354` USD
- Coverage: `full_rpc`
- Scan errors: `0`
- Protocol reader errors: `0`
- Positive unknown asset balances: `0`

The BOB `wBTC.OFT` balance is counted locally even if a wallet app displays
zero USD:

- Chain: `bob`
- Token: `0x0555e30da8f98308edb960aa94c0db47230d2b9c`
- Balance: `0.00023992`
- Approx value: `19.4` USD
- Tracking: registered BTC-priced token, counted in wallet total

The asset universe still has historical unknown targets under review, but none
have positive current balances. Therefore the ledger marks the current NAV as
`verified_current`, while preserving caveats for future scans.

## Command

```bash
npm run report:transaction-ledger -- --baseline-usd=450 --limit=12
```

For machine-readable full rows:

```bash
npm run report:transaction-ledger -- --baseline-usd=450 --json
```

## Current Summary

Latest run:

- Rows: about `1600`
- Receipt rows: `1464`
- Inbound inventory-diff rows: `42`
- BTC offramp rows: `4`
- Unquantified signer reverts not already reconciled: about `90`
- Inbound rows attributed to internal receipt/signer outputs: `34`, about
  `258.51` USD
- Inbound rows still not tx-attributed: `8`, about `27.68` USD
- Current NAV: about `370.66` USD
- Baseline: `450.00` USD
- Delta from current: about `79.34` USD

Cost and PnL:

- Reconciled realized net PnL: `-199.85` USD
- Recorded net including failed receipt rows: `-209.66` USD
- Total negative-cost rows: `214.08` USD
- Receipt gas subtotal: `82.25` USD
- Inbound inventory-diff total: `286.19` USD

Important accounting rule: do not add receipt gas to realized net PnL when
calculating total cost. The receipt net value already includes output/input/gas
effects. Gas is shown as a sub-explanation.

## Cost Buckets

| Category | Rows | Cost USD | PnL USD | Gas USD |
| --- | ---: | ---: | ---: | ---: |
| `swap_execution_cost` | `1032` | `74.13` | `-69.71` | `44.35` |
| `bridge_or_gateway_cost` | `146` | `57.47` | `-57.47` | `4.02` |
| `gas_refuel_cost` | `22` | `38.87` | `-38.87` | `0.04` |
| `protocol_position_cost` | `259` | `33.80` | `-33.80` | `33.82` |
| `failed_tx_cost` | `5` | `9.80` | `-9.80` | `0.01` |
| `btc_offramp_delivery` | `4` | `0.00` | `0.00` | `0.00` |
| `inbound_inventory_diff` | `8` | `0.00` | `0.00` | `0.00` |
| `internal_route_output` | `17` | `0.00` | `0.00` | `0.00` |
| `internal_strategy_output` | `17` | `0.00` | `0.00` | `0.00` |
| `unquantified_revert_cost` | about `90` | `0.00` | `0.00` | `0.00` |

Largest current cost rows:

| Observed at | Chain | Category | Kind | Cost USD |
| --- | --- | --- | --- | ---: |
| `2026-04-27T01:59:24.885Z` | `ethereum` | `bridge_or_gateway_cost` | `lifi_bridge` | `21.69` |
| `2026-05-04T11:09:02.455Z` | `ethereum` | `swap_execution_cost` | `token_dex_experiment` | `17.03` |
| `2026-04-26T10:52:56.744Z` | `sei` | `gas_refuel_cost` | `gas_zip_native_refuel` | `9.34` |
| `2026-04-26T04:20:02.929Z` | `base` | `failed_tx_cost` | `gas_zip_native_refuel` | `9.25` |
| `2026-04-26T13:08:39.368Z` | `ethereum` | `protocol_position_cost` | `erc4626_protocol_canary` | `8.51` |

## Data Sources

The ledger combines:

- `data/receipt-reconciliations.jsonl`
- `logs/signer-audit.jsonl`
- `data/gateway-btc-offramp-executions.jsonl`
- `data/treasury/inbound-events.jsonl`
- `data/whole-wallet-inventory.jsonl`

Receipt rows are the strongest cost evidence because they include tx hash,
chain, receipt, gas, output, and realized net PnL fields. Signer audit rows are
used to find reverted broadcasts that are not already in receipt
reconciliations. In the latest run, `89` reverted signer rows are present
outside the receipt store. They are listed as `unquantified_revert_cost` until
receipt pricing or native fee lookup converts them into exact USD cost.

Inbound events start as balance-diff evidence because current inbound event rows
lack tx hashes. The transaction ledger now deterministically upgrades an inbound
row when either:

- a reconciled receipt output matches the inbound row's chain, token, and
  snapshot window (`internal_route_output`), or
- a confirmed signer-audit row has an output-producing intent with a safe token
  source matching the same chain, token, and snapshot window
  (`internal_strategy_output`).

Signer-audit attribution is intentionally allowlisted. `approve_exact` rows are
not outputs even when metadata includes an `outputToken`; that field describes
the intended route, not a balance increase. The tests cover this regression
because approval misclassification would make the ledger look more certain than
the evidence supports.

This pass reduced unattributed inbound value from about `204.55` USD to about
`27.68` USD. The largest remaining item is Base `wBTC.OFT` at about `24.90`
USD from the wide `2026-04-24T21:09Z` to `2026-04-25T22:54Z` scan window.
Local logs show plausible nearby wrapped-BTC strategy activity, but the signer
metadata does not explicitly identify a Base `wBTC.OFT` output, so the ledger
keeps it as `inbound_inventory_diff` instead of inventing certainty.

## Remaining Work

The next improvement is transaction-history attribution for the remaining
unattributed inbound rows:

- `external_deposit`
- `internal_route_output`
- `reward_claim`
- `manual_adjustment`

That requires mining transaction history around balance-diff windows and
linking token deltas back to tx hashes. Once implemented, the system can explain
not only current NAV and execution costs, but also exact source-of-funds
history.
