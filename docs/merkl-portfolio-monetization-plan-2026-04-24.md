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
- Candidate groups: Ethereum stable carry is the deepest surface, mostly Morpho; Base YO, Ethereum Morpho USDC, Ethereum Morpho USDT, Ethereum Euler RLUSD, and Ethereum Aave RLUSD now have live-capital receipts.
- Queue executable now: 40+ candidates when Ethereum USDC/USDT/RLUSD inventory is present; many remaining candidates are blocked by missing PYUSD/USDS/XAUt/USDY/rsETH inventory or unsupported protocol binding.
- Wallet slice after live deployment: most usable stable inventory has been converted into open Merkl positions. The current bottleneck is refill inventory and Ethereum gas, not lack of Merkl candidates.

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

- `maxActiveUsd=300`
- `perOpportunityMaxUsd=75`
- `allowTopUps=true`
- `maxNewPositionsPerRun=8`
- `maxOpenPositions=20`
- chain caps: Base 80, Ethereum 200, smaller expansion-chain caps until route inventory is proven
- protocol caps: YO 80, Morpho 170, Euler 60, Aave 40
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
6. verify share/aToken balance delta; for Aave-style assets with opaque share-token accounting, accept successful supply receipt plus asset-balance-decrease proof
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
- Ethereum USDT funded from BSC USDT through LI.FI: approve tx `0x806646934a7cefd01b3fdcdcdfd1adbf7c7aac0442fb071f5044ffcb9b5c9c2f`, bridge tx `0x86ca7937296e7e5f054821e9001ccf51565b98c5f1b6187216a04066c3fc3bf4`, delivered `65.722882` USDT. Realized cost: `-365` sats.
- Ethereum RLUSD funded from BSC USDT through LI.FI: approve tx `0xa372fa133b71dcd600de5ac3e498e9f03c8275a4f0c1a178c4554ccd660910b9`, bridge tx `0x5b99743959d0355e52b8af5a8e90530c8727986d79a913ce695ddc420ba8999d`, delivered `38.362240814168466` RLUSD. Realized cost: `-1655` sats.
- Ethereum USDC funded from BSC USDT through LI.FI: approve tx `0x999201ad49a2f1c3bdbe7df70f112ecd60e8482c37035853cea8eeb6d993d597`, bridge tx `0x137a2497e8b50488c5a0005bc2d0c76ff0895685a7fca6ea72ed936794d06112`, delivered `98.350675` USDC delta. Realized cost: `-703` sats.
- Base YO additional top-up opened to the active Base cap: approve tx `0xf905ac40bb23eedcd8d6d5bb2e5d1aa0b9b4b3c4e2609ea7787f5c098eeb4762`, deposit tx `0x393c5505016ec425ee3b3374a1e4b84498f5ac01187a9b5fcffa2fe23380d436`, amount `47.856712` USDC.
- Base YO final cap-fill opened: approve tx `0x1c7625b04dfd0b199d12c5436e28bf0e7ac8dd248cf658f1bc3bb2a3c5dbc715`, deposit tx `0x0ed67404cb60ce704e1d8dc528861be3ec193c769a773e7952d512cecf9c753d`, amount `2.143287` USDC.
- Ethereum Aave Horizon RLUSD hold opened: approve tx `0x21c2e6b741900be74eadeab0b1add389bb41a3366d707c62fbd735ca6f7a62ac`, supply tx `0x9c6c662c43ad104e5c8f760d14062952e131bbbbc99e24ea6636ac055b2ce1f7`, amount `25` RLUSD. Share-token delta was opaque, so the open-position proof is the `25` RLUSD asset-balance decrease plus successful Aave supply receipt.
- Ethereum Morpho Clearstar USDC Core V2 hold opened: approve tx `0x309314b231c1a6ae67d337b4d39b987db74c610f04713ef00de29fa32836d9d3`, deposit tx `0x3ffa4e3a9aa58594a57f64fc7928fcb95189c0fbd2a1e8c98945f973f4af3de9`, amount `75` USDC.
- Ethereum Morpho Steakhouse Prime Instant V2 hold opened: reused existing USDT allowance from the prior policy-blocked attempt, deposit tx `0xa6aec9a4557e9f0811c5b89f9dcec954462df6247ff4a3cd7598699e480706f7`, amount `50` USDT.

Current open allocation after these receipts:

- Base / YO / USDC: about `75` USD active
- Ethereum / Aave Horizon / RLUSD: `25` USD active
- Ethereum / Morpho Clearstar USDC Core V2: `75` USD active
- Ethereum / Morpho Steakhouse Prime Instant V2: `50` USD active
- Total active Merkl book: about `225` USD

## Stage Definition

- L5: live canary proof exists and allocator can open a real hold position inside caps.
- L6: allocator loop runs unattended, opens multiple positions, monitors active positions, and exits automatically.
- L7: capital routing keeps target chain/asset inventory filled so the allocator can consume most of the profitable opportunity surface without manual refill.

Current target: finish L6 by letting the allocator loop run on schedule and by refilling the next entry assets. The live book is no longer single-opportunity: Base YO, Ethereum Aave RLUSD, and two Ethereum Morpho vaults are open. Remaining blockers are mostly refill inventory, Ethereum gas, and unsupported protocol bindings for lower-readiness opportunities.
