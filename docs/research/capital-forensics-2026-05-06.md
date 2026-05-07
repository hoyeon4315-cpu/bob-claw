# Capital Forensics Snapshot - 2026-05-06

## Question

The operator expected at least USD 450 of deployed/build capital, while recent
wallet and protocol surfaces showed less than USD 400. This note records the
repeatable evidence path used to verify current NAV and explain the gap without
using explorer UI screenshots or unsupported portfolio estimates.

## Current Verified NAV

Fresh whole-wallet RPC scan:

- Observed at: `2026-05-05T23:38:23.518Z`
- Total NAV: `370.4735091043382` USD
- Wallet/token NAV: `303.74015510433816` USD
- Protocol NAV: `66.733354` USD
- Coverage: `full_rpc`
- Scan errors: `0`
- Reader errors: `0`
- Positive unknown asset balances: `0`

The current protocol position is Base YO ERC-4626 `yoUSD`, marked
`verified_current`, valued at `66.733354` USD.

BOB `wBTC.OFT` is counted in wallet NAV:

- Chain: `bob`
- Token: `0x0555e30da8f98308edb960aa94c0db47230d2b9c`
- Balance: `0.00023992`
- Estimated value: `19.39081424` USD
- Tracking status: `registered`
- `countedInWalletTotal: true`

## Baseline Gap

Against a USD 450 expectation:

- Current NAV: `370.4735091043382` USD
- Gap: `79.5264908956618` USD

This is the current verified on-chain and protocol value according to the local
asset registry plus protocol readers. It is not a Zerion or wallet-app
estimate.

## Receipt-Cost Ledger

Official receipt reconciliation summary:

- Records: `1464`
- Reconciled: `1447`
- Failed: `5`
- Pending output: `12`
- Realized net PnL/cost: `-199.85247317460357` USD
- Receipt gas: `82.24728538906058` USD
- Failed gas: `4.6294401874446605` USD

Largest cost buckets:

| Kind | Realized net USD | Receipt gas USD |
| --- | ---: | ---: |
| `token_dex_experiment` | `-49.0461` | `23.5457` |
| `gas_zip_native_refuel` | `-38.8676` | `0.0440` |
| `lifi_bridge` | `-34.1830` | `3.2330` |
| `erc4626_protocol_canary` | `-33.7991` | `33.8281` |
| `gateway_btc_consolidation` | `-20.8575` | `0.3528` |
| `native_dex_experiment` | `-20.6648` | `20.8102` |

The receipt ledger is cumulative execution cost, not an external deposit
ledger. It is enough to make a USD 79 current-NAV gap plausible, but it is not
the same thing as a source-of-funds proof.

## Inbound Deposit Evidence

Local inbound inventory diff events:

- Events: `42`
- Events with estimated USD: `40`
- Estimated positive balance-diff total: `286.193142` USD
- Events with tx hash: `0`

These rows prove positive inventory movements detected by the watcher, but they
cannot separate external deposits from internal route outputs because the
events do not yet carry tx hashes. Exact source-of-funds accounting still needs
tx-attributed inbound events.

## Historical Display Traps

Two historical values should not be used as current NAV:

1. External portfolio references around `701.93` USD came from
   `live_scan_with_external_portfolio` / external reference fields. Those are
   useful hints, not current local RPC NAV.
2. A local `437` USD-style peak came from protocol share double counting:
   `yoUSD` appeared once as a wallet token and again as a protocol position.
   Clean forensic reporting now excludes such rows from local peak accounting.

The clean local inventory peak in the current forensic report is:

- `392.61` USD at `2026-04-22T14:41:18.851Z`

## Repeatable Command

Use:

```bash
npm run report:transaction-ledger -- --baseline-usd=450
```

The command reports current verified NAV, wallet/protocol split, baseline gap,
clean local peak, external reference peak, excluded double-count rows, receipt
cost buckets, and inbound-diff caveats.

## Root Cause

The asset tracker is now capable of a fresh, itemized current NAV across wallet
tokens plus supported protocol positions. The earlier confusion came from three
separate accounting surfaces being mixed together:

- Current RPC/protocol NAV.
- External or stale portfolio references.
- Cumulative execution-volume and receipt-cost ledgers.

The current NAV below USD 400 is credible under the receipt ledger: live route
experiments, refuels, bridges, ERC-4626 canaries, and Gateway consolidation
have realized enough cumulative cost to explain the USD 79 gap versus a USD 450
expectation.

## Remaining Improvement

The remaining hard gap is not current asset visibility; it is source-of-funds
traceability. To make future deposits provable rather than inferred, inbound
inventory events should be upgraded to include transaction hashes and explicit
classification as `external_deposit`, `internal_route_output`, `reward_claim`,
or `manual_adjustment`.
