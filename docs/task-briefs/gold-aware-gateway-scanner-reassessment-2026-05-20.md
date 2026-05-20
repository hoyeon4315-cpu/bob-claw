---
status: task_brief
created_at: 2026-05-20
owner: coordinator
policy_authority: AGENTS.md
runtime_authority: none
mode: report_only
---

# Gold-Aware Gateway Arbitrage Scanner Reassessment

This brief is an execution guide, not live truth. Fresh diagnostics, source
code, and `AGENTS.md` win over this document. **Live execution forbidden.
Report-only deliverables. PR allowed; merge forbidden.**

## Goal

Reassess `src/strategy/dex-gateway-arbitrage.mjs` from a wBTC-only loop
scanner into a **gold-aware, multi-family** Gateway arbitrage scanner that
compares wBTC, stablecoin, and tokenized-gold loop candidates under one
identical full-cost basis.

Restate the framing: **BOB Gateway itself is not the constraint.** Gateway
exposes the 11-chain destination set fixed by `AGENTS.md` and already lists
gold + stablecoin destinations against `bitcoin`. The constraint is
**internal producer coverage** inside BOB Claw — asset family registry,
scanner filter predicate, and loop closure rules — not Gateway support.

## Evidence (Gateway support is not the blocker)

Source: `data/gateway-routes.jsonl` (latest snapshot, runId
`2026-05-20T12:18:45.095Z-...`).

BTC ↔ Gold / Stable routes already advertised by Gateway:

| Pair                 | srcToken                | dstToken                |
| -------------------- | ----------------------- | ----------------------- |
| `bitcoin → ethereum` | `0x0...0` (BTC)         | `0x45804880...` (PAXG)  |
| `ethereum → bitcoin` | `0x45804880...` (PAXG)  | `0x0...0` (BTC)         |
| `bitcoin → ethereum` | `0x0...0` (BTC)         | `0x68749665...` (XAUT)  |
| `ethereum → bitcoin` | `0x68749665...` (XAUT)  | `0x0...0` (BTC)         |
| `bitcoin → base`     | `0x0...0` (BTC)         | `0x1217BfE6...` (oUSDT) |
| `base → bitcoin`     | `0x1217BfE6...` (oUSDT) | `0x0...0` (BTC)         |

`data/gateway-gold-readiness-latest.json` already reports:
`routeAvailable=true`, `bestGoldAsset=XAUT`, `preflight.best.roundTripCostBps
≈ 97.87`, `successfulAttemptCount=6`. Round-trip is quotable today.

## Producer-Coverage Gap (the real blocker)

Current scanner asset filter (`src/strategy/dex-gateway-arbitrage.mjs:98-104`):

```
function eligibleBtc(score) { return isBtcLikeAsset(src) && isBtcLikeAsset(dst); }
function eligibleEth(score) { return isEthLikeAsset(src) && isEthLikeAsset(dst); }
```

Family taxonomy (`src/assets/tokens.mjs`):

- `isBtcLikeAsset` ⇒ `family ∈ {btc, wrapped_btc}` (line 449-451).
- `isEthLikeAsset` ⇒ `priceKey==="ethereum"` + ticker/family check
  (line 457-459).
- `PAXG` and `XAUT` entries exist but are tagged `family: "other"` with
  `priceKey: "paxg" | "xaut"` (lines 209-223). No `gold` / `tokenized_gold`
  family.
- Stablecoins use `family: "stablecoin"`. No scanner predicate consumes them
  as a Gateway loop family at all.

Consequences:

1. `buildDexGatewayLoops` filter rejects every BTC↔PAXG / BTC↔XAUT score
   even when the route exists, the quote returns, and the entry leg
   succeeds.
2. `buildCrossAssetArbitrageSummary` handles stable↔btc and stable↔eth
   cross-asset pairs but does not feed into the same Gateway loop summary
   the wBTC scanner produces, so the apples-to-apples full-cost compare
   does not exist.
3. Gold readiness lives in `src/strategy/gateway-gold-route-readiness.mjs`,
   a separate preflight path that measures `roundTripCostBps` only and
   does not produce a `measuredLoopNetUsd` comparable to the wBTC scanner.

The scanner is producer-blind to two of three candidate families that
Gateway already supports.

## Proposed Report-Only Scope

Strictly **report-only**. No live execution. No signer changes. No policy
relaxation. No cap raise.

### S1. Asset family registry

- `src/assets/tokens.mjs`
  - Add `isStableAsset(asset)` predicate (`family === "stablecoin"`).
  - Add `isGoldAsset(asset)` predicate (`ticker ∈ {XAUT, PAXG}` or a new
    `family: "tokenized_gold"` once retagged).
  - Retag `XAUT`, `PAXG` from `family: "other"` to `family:
"tokenized_gold"` (only after grep proves no caller branches on
    `family === "other"` for those tickers in a way that would change live
    behavior — `family_action_classification` and `merkl-opportunity-*`
    sites must continue to map to the existing `tokenized_gold_reserve`
    family classification, not the new token family tag; introduce a
    separate `assetFamily` tag if needed to keep the classification surface
    untouched).

### S2. Scanner extension

- `src/strategy/dex-gateway-arbitrage.mjs`
  - Generalize `buildDexGatewayLoops` `scoreFilter` to accept a family key
    (`btc | eth | stable | gold`) and dispatch to the appropriate predicate.
  - Keep `buildDexGatewayArbitrageSummary` (wBTC) behavior unchanged for
    backward compatibility; add `buildStableGatewayArbitrageSummary` and
    `buildGoldGatewayArbitrageSummary` mirror exports.
  - Cost model **identical** across families:
    `measuredLoopNetUsd = destinationExecutableUsd − entryStableUsd −
gatewayKnownCostUsd − entryGasUsd`. No per-family fee cap, no per-key
    EV override, no bypass widening.
  - For families whose source/destination are not the same token (e.g.,
    BTC → XAUT → BTC), require both legs through the existing entry quote
    - Gateway score join. Reuse `latestEntryQuotes` and `gatewayRouteKey`
      semantics; do not introduce a parallel route key.

### S3. Comparator report (new CLI, report-only)

- New file: `src/cli/report-gateway-multi-family-arbitrage.mjs`
- Inputs:
  - `data/gateway-scores.json`
  - latest `data/gateway-quotes.jsonl` entries via existing reader.
- Outputs: prints (and `--json` writes) one comparator row per family:
  ```
  family | routeCount | exactAmountMatchCount | profitableExactCount |
  bestLoop.measuredLoopNetUsd | closestLoop.routeKey
  ```
- No write into `dashboard/public/**`. No mutation of
  `dashboard-status.json`. Generated artifact path:
  `data/gateway-multi-family-arbitrage-latest.json`. Operator runs the CLI
  by hand when needed.

### S4. Tests (mandatory)

- `test/dex-gateway-arbitrage.test.mjs`: extend with fixtures that include
  one BTC→XAUT→BTC loop and one BTC→oUSDT→BTC loop, assert filter
  selection and `measuredLoopNetUsd` arithmetic match the existing wBTC
  arithmetic to the cent.
- Negative test: a stale entry quote and a missing exit score must produce
  identical blocker codes across all three families (`missing_source_entry
_quote`, `missing_destination_exit_quote`).

## Hard Boundaries

- **No live execution.** Producer + report CLI only.
- **No merge.** PR may be opened for review; do not merge to `main`.
- **No policy gate relaxation.** EV thresholds, fallback costs, blocker
  detection logic, slippage buffer, cap raise — none of these may shift to
  make a gold loop appear profitable.
- **No `family: "other"` semantic change that affects an existing live
  classification path.** If retagging XAUT/PAXG to `tokenized_gold` would
  change `merkl-opportunity-policy` or `family-action-classification`
  behavior, keep the token-level family tag separate from the strategy
  family classification and add `assetFamily` for the scanner only.
- **No dashboard surface mutation.** Comparator output stays in `data/`.

## Success Definition (for the report-only deliverable)

A. Comparator CLI runs and emits a row for each of `wbtc`, `stable`,
`gold` with the same cost columns, sourced from the same scanner code
path.

B. `test/dex-gateway-arbitrage.test.mjs` passes including the new gold and
stable fixtures.

C. PR diff contains only:

- `src/assets/tokens.mjs` (predicate additions, optional retag isolated
  from classification surface)
- `src/strategy/dex-gateway-arbitrage.mjs` (filter generalization)
- `src/cli/report-gateway-multi-family-arbitrage.mjs` (new)
- `test/dex-gateway-arbitrage.test.mjs` (extended)
- optional: `package.json` script entry `report:gateway-multi-family`.

D. No diff in `dashboard/public/**`, `src/executor/policy/**`,
`src/executor/signer/**`, `src/config/strategy-caps.mjs`, or any
`*-caps.mjs`.

## Out of Scope

- Live entry into XAUT/PAXG sleeves.
- Touching `gateway-gold-route-readiness.mjs` semantics or its blocker
  vocabulary.
- Adding a new dashboard tile.
- Changing payback ratio, accumulator math, or BTC-denominated accounting
  rules.
- Adding LLM dependencies anywhere on the producer or reporter path.

## Open Questions (escalate to operator before coding S1 retag)

1. Does retagging XAUT/PAXG `family` from `"other"` to `"tokenized_gold"`
   change any existing classifier branch? Grep `family === "other"`
   in `src/**` and confirm. If yes, keep family `"other"` and use a new
   `assetFamily` field instead.
2. Is `oUSDT` on Base the only stable destination we want in the first
   comparator run, or do we include `USDT` on BSC / `USDC` on Base also?
   Default to all `stablecoin`-family tokens that have a Gateway route
   pair in the latest `gateway-routes.jsonl`.
