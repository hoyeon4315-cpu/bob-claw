# Protocol-readers vs Treasury-adapters — Unification Map

> Phase 0 design note (referenced by AGENTS.md L42 dual-subsystem rule).
> Source of truth: this file. Implementation deltas land in their respective PRs.

## Two coexisting subsystems

| Subsystem | Path | Purpose | Caller |
|---|---|---|---|
| **PROTOCOL_READERS** (RPC balance) | `src/executor/health/position-reconciler.mjs` | Live RPC reads → `Position[]` for reconciliation | `realtime-portfolio.mjs`, monitor loop |
| **Treasury position adapters** (mark/snapshot) | `src/treasury/protocol-position-adapters/` | Mark a tracked position with current value, used for ledger writes | `protocol-position-marker.mjs`, ledger |

They look similar but **must not be merged** until both call-sites converge on the shared `ProtocolReader` spec
(`src/executor/health/protocol-reader-spec.mjs`).

## Reader coverage matrix (post-Phase 1)

| Protocol | Reader (executor) | Adapter (treasury) | Chains | Status |
|---|---|---|---|---|
| moonwell (Compound v2 fork) | ✅ moonwell | ✅ compound-v2 | base | merged pre-Phase 1 |
| yoProtocol | ✅ yoProtocol | — | base | merged pre-Phase 1 |
| aaveV3 | ✅ aaveV3 (Phase 1) | ✅ aave-v3 | ethereum + Gateway 11 | Phase 1 ✅ |
| ERC-4626 generic | ✅ via morphoMetaMorpho/beefy | ✅ erc4626 | multi | Phase 1 ✅ |
| morphoMetaMorpho | ✅ Phase 1 | (uses erc4626 adapter) | ethereum | Phase 1 ✅ |
| pendle | ✅ Phase 1 (PT/YT/LP + maturity ts) | — (treasury treats as ERC-20) | base, bsc | Phase 1 ✅ |
| beefy | ✅ Phase 1 (mooToken share→underlying) | (uses erc4626 adapter) | multi | Phase 1 ✅ |
| berachainBend | ✅ Phase 1 (aToken + BGT accrual) | — | bera | Phase 1 ✅ |
| gmxV2 | ✅ Phase 1 (GM token + position size) | — | avax | Phase 1 ✅ |
| Aerodrome CL / Uniswap v3 NFT | ✅ via `nft-position-indexer.mjs` | — | base, ethereum, op, bnb, avax | Phase 1.5 ✅ |

## Future unification (NOT in scope of current PR)

When both subsystems consume `protocol-reader-spec.mjs` directly:
1. Move RPC primitives to `src/protocol-readers/<protocol>.mjs` (single home).
2. `position-reconciler.mjs` becomes a thin dispatcher over the new dir.
3. `protocol-position-adapters/` keeps mark/snapshot logic but imports balance readers from `src/protocol-readers/`.
4. Remove duplicated ABIs / contract addresses.

Blockers preventing the move now:
- `protocol-position-marker.mjs` writes to ledger; mark logic is not idempotent across reads.
- `position-reconciler.mjs` returns null on chain mismatch (silent skip is forbidden by spec; reader rewrite per Phase 1.1 is the prerequisite).
- AGENTS.md ban-list scan must be extended to the new dir before any code moves.

## Mapping rule (operational, until unified)

| Symptom | Where to fix |
|---|---|
| Wrong balance in dashboard | PROTOCOL_READERS in `position-reconciler.mjs` |
| Wrong USD value in ledger snapshot | `protocol-position-adapters/<id>.mjs` |
| Position not auto-detected at all | Add binding entry in `protocol-position-adapter-registry.mjs` AND reader entry in `PROTOCOL_READERS` |
| New chain support | `EVM_CHAIN_CONFIGS` (rpc) + `token-registry.mjs` (per chain) + reader handles `chain` param |

## Verification (run after every reader/adapter change)

```bash
node src/cli/report-portfolio-coverage.mjs   # Phase 1.6 — exits 1 on >$1 mismatch
node --test test/position-reconciler.test.mjs
node --test test/nft-position-indexer.test.mjs
```
