# BSC -> BTC Live Transfer Findings And Rollout Plan

Updated: 2026-04-22

## Scope

This note records the live findings for the operator request to:

1. hold `wrapped-btc-loop-base-moonwell`
2. move about USD 320 of BSC-held assets into the operator's Bitcoin wallet
3. use the first successful Bitcoin delivery as the trigger for broader live rollout work

## Operator Decision Locked

- `wrapped-btc-loop-base-moonwell` is on hold by operator judgment.
- The economics are currently treated as insufficient.
- Runtime promotion work on that lane should stop until an explicit committed diff reopens it.

## Live Ground Truth

### Treasury inventory

Live treasury scan at `2026-04-22T12:01:23.384Z` showed:

- BSC `USDT = 320.29490039689136`
- BSC `BNB = 0.04860412944335887`
- signer EVM address = `0x96262b...3b0AE4`
- signer BTC address available = `bc1p80...hkyww0`
- payback destination env `PAYBACK_BTC_DEST_ADDR` is not set in the current shell

### What was tested

The following plans were built against the live Gateway / DEX surface on 2026-04-22.

Direct BSC -> Bitcoin attempts:

- `BSC USDT -> BTC`: blocked with `NO_ROUTE`
- `BSC wBTC.OFT -> BTC`: blocked with `NO_ROUTE`
- `BSC ETH(token) -> BTC`: blocked with `NO_ROUTE`

DEX conversions on BSC that do work:

- `BSC USDT -> wBTC.OFT`: plan ready
  - input: `320 USDT`
  - quoted output: `409438` sats of `wBTC.OFT`
- `BSC USDT -> ETH(token 0x2170...)`: plan ready
  - input: `320 USDT`
  - quoted output: `0.133287400214625296 ETH`

Gateway follow-on paths tested after conversion:

- `BSC wBTC.OFT -> Base wBTC.OFT`: blocked with `NO_ROUTE`
- `BSC wBTC.OFT -> BOB wBTC.OFT`: blocked with `NO_ROUTE`

Bob offramp check:

- `BOB wBTC.OFT -> BTC` returned a quote and order for `409438` sats
- preflight failed with `execution_reverted`
- strongest inference: the route exists, but the current Bob wallet balance is insufficient for that order path

### Historical proof vs current surface

Historical delivered receipts exist for:

- `Base wBTC.OFT -> BTC` at `5000` sats on `2026-04-16`
- `Avalanche wBTC.OFT -> BTC` at `5000` sats on `2026-04-16`
- `Sonic wBTC.OFT -> BTC` at `5000` sats on `2026-04-16`
- `Base native ETH -> BTC` on `2026-04-16`

Important distinction:

- historical delivered proof exists
- current live quote surface for the tested BSC paths does not currently provide an executable route

## Current Conclusion

As of 2026-04-22, the repo-safe deterministic path to move the current BSC-held USD 320 into Bitcoin L1 is **not executable** from the current wallet inventory and current Gateway quote surface.

This is blocked by **route availability**, not by missing signing code.

Most direct statement:

- the assets exist on BSC
- the signer and Bitcoin destination exist
- the conversion code exists
- but the currently tested BSC -> BTC and BSC -> supported intermediate chain routes are not live-quotable

## What Must Be True Before Live Transfer Can Succeed

At least one of the following must become true:

1. Gateway restores a live BSC -> BTC route for a token we can actually source on BSC
2. Gateway restores a live BSC -> Base or BSC -> BOB route for a BTC-family asset we can create on BSC
3. a committed diff introduces an explicitly allowed non-Gateway fallback path for BSC capital exit

## Rollout Plan After First BTC Delivery

The operator wants the first confirmed Bitcoin delivery to become the trigger for broad live rollout work. The implementation plan below assumes that trigger.

### P0. Freeze the operator decision

- keep `wrapped-btc-loop-base-moonwell` on hold in both docs and runtime config
- archive the current BSC -> BTC findings with exact commands and timestamps

### P1. Build a route capability matrix from live probes

Add a deterministic artifact that records, per chain/token pair:

- quote available or not
- order creation available or not
- gas preflight pass or fail
- source-chain broadcast pass or fail
- destination delivery proof pass or fail

This must be generated from live probes, not from historical memory or docs claims.

### P2. Add a transfer-first execution lane

Implement a narrow live workflow whose only goal is capital delivery proof:

1. source-chain asset normalization
2. bridge or offramp
3. Bitcoin destination proof
4. receipt ingest

This lane should stay independent from strategy-alpha logic.

### P3. Build a full-chain live canary sweep

After the first BTC delivery lands:

- run tiny canaries across all Gateway-supported executable chain/token surfaces
- record which chains fail at quote, gas, broadcast, or destination proof
- write all failures as a blocker taxonomy instead of hand-written notes

### P4. Build a full-strategy live blocker sweep

For every strategy family and candidate:

- run the smallest policy-valid live or signer-backed canary
- classify blockers into:
  - inventory
  - route availability
  - gas
  - approval hygiene
  - policy caps
  - protocol execution
  - unwind path
  - delivery proof
  - economics

### P5. Operator-facing artifacts

Produce two artifacts after the sweep:

1. `live-rollout-matrix.json`
   - one row per chain/strategy
   - latest blocker code
   - latest successful stage
   - next action
2. `live-rollout-findings.md`
   - short operator summary in Korean first
   - blocker counts by category
   - what is truly executable now
   - what is blocked by economics vs plumbing

## Coding Plan

### Code changes to make next

1. Add `src/status/live-route-capability-slice.mjs`
   - live probe summary for quote/order/gas/delivery
2. Add `src/cli/report-live-route-capability.mjs`
   - writes a JSON artifact for dashboard and operator review
3. Add `src/cli/run-transfer-proof-canary.mjs`
   - minimal transfer-only runner with receipt ingestion
4. Add `src/cli/run-live-rollout-sweep.mjs`
   - executes chain sweep then strategy sweep in tiny-canary mode
5. Add `src/prelive/live-rollout-matrix.mjs`
   - normalizes blocker taxonomy into one machine-readable report

### Safety rules for that code

- no private key handling outside signer daemon
- no LLM decision in runtime signing path
- no cap raises at runtime
- no strategy promotion from a single positive receipt
- transfer proof and economics proof remain separate labels

## Recommended Next Action

Near-term next action is not "force live anyway".

Near-term next action is:

1. preserve the BSC findings
2. treat the BSC -> BTC path as currently blocked by route availability
3. build the live route-capability matrix so future attempts fail fast with objective evidence
