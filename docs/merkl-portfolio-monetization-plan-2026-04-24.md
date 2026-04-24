# Merkl Portfolio Monetization Plan (2026-04-24)

## Goal

Payback is downstream. The immediate goal is to put operator inventory into live yield positions by scanning as much of the Merkl surface as possible, scoring opportunities deterministically, allocating capital by score and risk budget, and exiting automatically when the edge decays.

The runtime rule stays unchanged: LLMs may write code and config, but signing decisions remain deterministic policy + signer daemon only.

## Current Snapshot

Generated on 2026-04-24 with:

```bash
npm run report:merkl-opportunities -- --write
npm run report:merkl-canary-queue -- --write
npm run report:wallet-holdings-slice -- --json --write
```

Observed surface:

- Merkl opportunities scanned: 400
- Live/relevant candidates after policy filter: 63
- Watchlist: 71
- Blocked: 266
- Candidate groups: Ethereum stable carry is the deepest surface, mostly Morpho; Base YO is the currently executable live path.
- Queue executable now: 1 (`13747891056392346282`, Base / YO / USDC ERC-4626-like vault)
- Wallet slice: about USD 386.86 total visible inventory, dominated by BSC USDT. The current yield-entry bottleneck is not total capital, but getting inventory onto the right chain/asset and executor surface.

Important live proof:

- Base YO tiny canary has already executed `approve -> deposit -> redeem` with destination proof.
- Latest realized canary PnL was negative by gas (`-4 sats`, about `-$0.0032`), which is expected for path proof. It is not the monetization position.

## Allocation Model

The allocator should not pick only the single top score. It should build a ranked book of every supported candidate, then allocate across all candidates that pass:

1. protocol binding ready
2. supported hold executor
3. live canary proof exists for the same opportunity
4. inventory and native gas are present
5. committed strategy caps pass
6. campaign has enough time left
7. either no duplicate active position or top-up remains below the per-opportunity cap

Default live policy is in `src/config/merkl-portfolio.mjs`:

- `maxActiveUsd=75`
- `perOpportunityMaxUsd=25`
- `allowTopUps=true`
- `maxNewPositionsPerRun=5`
- `maxOpenPositions=12`
- `minPositionUsd=0.25`
- source inventory reserve: 5%
- minimum canary proofs before hold: 1
- minimum hold time: 60 minutes

Score components:

- queue priority from Merkl opportunity scoring
- APR/native APR
- TVL liquidity
- campaign duration
- live canary proof bonus
- inventory ready bonus
- native gas ready bonus
- overfit penalty
- chain route gap penalty

This makes the system aggressive across the opportunity universe while still requiring a receipt-backed entry/exit proof before leaving funds in a protocol. As of 2026-04-24, the operator has explicitly moved this lane from paper validation to live-capital validation: if committed caps, executor support, inventory, canary proof, and policy checks pass, the allocator should execute instead of waiting for more paper tests.

## Execution Architecture

New execution lane:

```bash
npm run executor:merkl-portfolio-allocator -- --json --write
npm run executor:merkl-portfolio-allocator -- --json --write --execute
```

Files:

- `src/config/merkl-portfolio.mjs` — portfolio sizing and scoring policy
- `src/executor/merkl-portfolio-allocator.mjs` — builds ranked allocation book and opens hold positions
- `src/executor/merkl-portfolio-exit.mjs` — evaluates open positions and exits them when deterministic triggers fire
- `src/cli/run-merkl-portfolio-allocator.mjs` — CLI entry point
- `src/cli/run-merkl-portfolio-exit.mjs` — exit preview/execute entry point
- `data/merkl-portfolio-positions.jsonl` — append-only active-position ledger
- `data/merkl-portfolio-allocator-latest.json` — latest preview/execute report

Position entry:

1. refresh Merkl queue and live wallet inventory
2. rank all candidates
3. select all entry-ready candidates within portfolio/cap/inventory budgets
4. execute `approve_exact`
5. execute protocol entry (`erc4626_deposit` or `aave_supply`)
6. verify share/aToken balance delta
7. append an open position record

As of 2026-04-24, allocator runs refresh treasury inventory directly before sizing. `--no-refresh-inventory` is available for debugging stale snapshots only.

Position exit:

```bash
npm run executor:merkl-portfolio-exit -- --json --write
npm run executor:merkl-portfolio-exit -- --json --write --execute --force
```

The exit runner reads open positions and broadcasts `redeem` when:

- campaign enters exit lookahead window
- opportunity disappears from the Merkl queue
- score drops below the entry floor
- policy/kill-switch requests unwind
- operator caps or failed-gas budget force pause

The current implementation supports ERC-4626/eVault-style exits and Aave-style `withdraw`, so the allocator may leave either supported binding open when policy passes.

## Capital Routing Plan

Current queue readiness says most candidates are not blocked by lack of opportunity quality; they are blocked by entry inventory. The largest visible inventory is BSC USDT, while the deepest Merkl candidate set is Ethereum stable carry and the only currently executable hold surface is Base YO.

Priority capital jobs:

1. Maintain Base USDC and Base ETH gas for proven YO/USDC carry.
2. Build BSC USDT -> Base USDC and BSC USDT -> Ethereum USDC deterministic refill routes.
3. Expand protocol hold executors for Morpho/Euler vault-style opportunities on Ethereum only when gas-efficient notional is high enough.
4. Keep Ethereum entries blocked below the gas-efficiency notional floor; small Ethereum dust should not be spent on yield entry.

Implemented refill path:

- Primary Gateway refill is attempted first when the source is BTC-family.
- Non-BTC stable refill falls back to LI.FI when Gateway has no route.
- BSC USDT -> Base USDC is live-proven through LI.FI and writes a `lifi_bridge` receipt reconciliation.

Live execution receipts on 2026-04-24:

- Base YO old tiny position exited: redeem tx `0xf2eb9bcb980172b6939403635b9234636518b12195655d438b52d96b1c76e450`, USDC delta `249997`.
- Base YO first live hold opened: approve tx `0xf9f5c592527ed6410d449e005c9d9f7967b80a762e771258488aeb743e7332ef`, deposit tx `0x89afe5b4be06718b725cf5c85fdc70e4b0d879a4d5f406529b4e1b2e1fcd13f9`, amount `0.771367` USDC.
- BSC USDT -> Base USDC refill delivered through LI.FI: approve tx `0xc0680d8b06261b0163ec08f47f033e3fab049072687f834f60f7b4e5567ed50f`, bridge tx `0x7a8f2e74f3ba392ee1040e4cc05c29579fbae0e24f8859ff82b2a3c4f36d2e9a`, Base USDC delta `74563528`.
- Base YO top-up opened: approve tx `0xad8ec76c8cb2158893a8293a628972ebde2ae18924d9f1474281a1d3c26e5448`, deposit tx `0x62ebd0e77dde7b64a890177c594cdf72946e99cb04472446ea48538f880fe82e`, amount `24.228633` USDC, share delta `23164169`.

## Stage Definition

- L5: live canary proof exists and allocator can open a real hold position inside caps.
- L6: allocator loop runs unattended, opens multiple positions, monitors active positions, and exits automatically.
- L7: capital routing keeps target chain/asset inventory filled so the allocator can consume most of the profitable opportunity surface without manual refill.

Current target: finish L6 by letting the allocator loop run on schedule, expanding beyond the single Base YO opportunity only when inventory, protocol binding, canary proof, and cap checks all pass. Base YO is now filled to the `25` USD per-opportunity cap; the remaining blocker is not code for that opportunity, but additional ready inventory/proofs for the next opportunity.
