# Asset Tracking Root Cause - 2026-05-06

## Current Confirmed State

The latest deterministic whole-wallet scan observed the operator EVM wallet
plus the active protocol reader surface at about USD 370.8:

- liquid wallet assets: about USD 304
- protocol assets: about USD 66.7 in Base YO ERC-4626 `yoUSD`
- authoritative scan errors: 0
- active protocol reader errors: 0
- positive unknown asset balances: 0

This is the confirmed current itemized value from direct wallet/protocol reads.
It is not the same thing as cumulative transaction volume, historical portfolio
high water mark, or external portfolio reference value.

## Why The Number Looked Wrong

The old dashboard and CLI surfaces mixed three different truths:

1. Current itemized wallet balances from RPC.
2. Current protocol positions from protocol readers.
3. External address-scan references and older Zerion cache values.

Those values have different reliability. Historical Zerion cache data contained
large stale/unclassified entries, including a Moonwell cbBTC-looking value around
USD 459. That value is not supported by the latest deterministic current reader
surface, so it must not be counted as current capital.

The dashboard also made a confusing split: wallet holdings showed only liquid
wallet assets around USD 244, while capital summary could include protocol
positions around USD 66.7. That made the operator-visible total look like it had
fallen further than the current itemized wallet-plus-protocol total.

Cumulative receipt output is another false lead. `receipt-reconciliations` and
`signer-audit` contain many successful swaps, deposits, redeems, and bridges.
Summing those rows produces hundreds of dollars of historical movement, but
those are flows, not current balances.

## Root Cause

The system had no deterministic "asset universe" layer. It scanned a committed
token registry plus active protocol readers, but it did not automatically mine
its own transaction and protocol logs for every token address the system had
touched. That meant a new strategy, vault share token, router output token, or
chain-specific asset could become invisible until a human committed registry or
reader support.

The failure mode was not that RPC balances were fake. The failure mode was that
the system could overstate confidence when the set of queried tokens was not
proven complete.

## Fix Implemented

`src/treasury/asset-universe.mjs` now builds a deterministic asset universe
from:

- committed token registry
- `data/receipt-reconciliations.jsonl`
- `logs/signer-audit.jsonl`
- `data/treasury/inbound-events.jsonl`
- `data/protocol-position-marks.jsonl`

`scanWholeWalletInventory()` now queries tx-derived token targets in addition to
static registry targets. Unknown tx-derived token addresses are not
auto-whitelisted. They are queried and surfaced as review backlog. They block
`full_rpc` exact current coverage only when they have a positive current
balance.

The scanner now reads ERC-20 metadata on-chain for discovered targets and uses a
generic ERC-4626 `asset()` / `convertToAssets()` preview when a held vault share
does not have a direct price. This recovered the current value of held
`alphaForexV2` and `steakUSDT` vault shares instead of leaving them as unknown
zero-USD tokens.

Protocol-reader-covered share tokens are excluded from wallet totals when their
same value is already counted through the protocol position reader. This avoids
double counting Base `yoUSD` as both wallet token and deployed protocol
position.

Protocol mark refresh now emits an explicit `zero_position_observed` failure
when a reader returns no positions for an active ledger entry. Active positions
are no longer silently skipped.

## New Exactness Rule

The dashboard may call a value exact only when:

- every supported chain scan succeeds
- every positive tx-derived token balance is either registered, protocol-reader
  covered, or valued by a deterministic on-chain preview path
- unknown positive token balances are zero
- active protocol positions have fresh/current reader marks
- recent signer movement is reconciled
- no external unclassified value is needed to explain the total

Otherwise the surface must say "verified known assets only" and list the
blockers.

## Future Onboarding Contract

Every new live strategy or protocol must commit these before `autoExecute` can
be treated as asset-tracking safe:

- chain, protocolId, bindingKind, strategyId
- stable logical positionId
- wallet/account key
- share, market, debt, reward, and underlying token addresses
- decimals and BTC/USD price path
- protocol reader or explicit registry coverage
- zero-balance semantics
- freshness TTL and dashboard alias mapping
- tests proving no reader errors, no unlabeled positions, and no silent
  zero-position result

If a strategy touches a token that is not in registry and not protocol-reader
covered, the dashboard must block exact capital confidence until a committed
diff resolves it.
