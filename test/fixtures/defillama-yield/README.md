# DefiLlama Yield Test Fixtures

Real, production-quality sample data for the `defillama-yield-portfolio` YCE lane (YCE-001/002/003).

Fixtures live under `test/fixtures/defillama-yield/` (source-tracked per harness-engineering.md; not generated data/).

## Current Samples

- **sample-aave-v3-usdt.json**  
  Exact real pool from `data/snapshots/defillama-yield-latest.json` (10,841 pools, 604 `protocol_receipt_bound`).  
  - poolId: `f981a304-bb6c-45b8-b0c5-fd2f515ad23a`  
  - project: `aave-v3`, chain: `ethereum`, symbol: `USDT`  
  - tvlUsd: 353430982, family: `stablecoin`, stablecoin: true  
  - **evidenceClass**: `"protocol_receipt_bound"` (from `RECEIPT_BOUND_PROJECTS` + `getDefiLlamaPoolEvidenceClass`)  
  - Full fields: apy/apyBase, apyPct*, predictions, mu/sigma, underlyingTokens, etc.  
  **Proven in**: `active-work/defillama-receipt-validation.md` (YCE-002: `pairDefiLlamaYieldEntryExit` + `loadYieldReceiptEvidence` + `yieldProof` with `entryExitProven: true`, `realizedNetUsd: 0.77` using this exact pool).  
  **Adapter fit**: Works with `normalizeDefiLlamaYieldPool`, `assessPool`, `policyGates` (evidenceClass blocks non-receipt), `receiptEvidence`, `evaluateDefiLlamaYieldAdapter` (liveReady requires receipt_bound + entryExitProvenCount >=1 + realizedNetUsd > 0).

## How to Add More Samples

1. Ensure fresh snapshot: `npm run snapshot:defillama` (writes `data/snapshots/defillama-yield-latest.json`).
2. Identify more `protocol_receipt_bound` pools on the 11 Gateway chains (filter by `evidenceClass === "protocol_receipt_bound"` and `SUPPORTED_CHAINS` + `SUPPORTED_FAMILIES` in adapter).
3. Extract the pool object (use `grep` for poolId or small node script).
4. Create `sample-<project>-<symbol>-<chain>.json` with:
   - `_meta` block (description, source, poolId, notes, usage)
   - `"pool": { ... exact snapshot entry ... }`
5. Update this README.md with the new entry.
6. Add corresponding test coverage in `test/strategy/defillama-yield-adapter.test.mjs` (or similar) exercising normalize/assess/evaluate + mock receipts.
7. Reference in YCE status docs under `active-work/`.

**Preferred pools**: Other aave-v3 / moonwell / compound-v3 / erc4626 / beefy receipt_bound stables or wbtc on official destinations (ethereum, base, bsc, etc.). Keep small-capital + tiny-canary friendly.

## Test Usage Example

```js
import { readFile } from 'fs/promises';
import { normalizeDefiLlamaYieldPool, evaluateDefiLlamaYieldAdapter } from '../../src/strategy/defillama-yield-adapter.mjs';

const fixture = JSON.parse(await readFile(new URL('./sample-aave-v3-usdt.json', import.meta.url), 'utf8'));
const pool = fixture.pool;

// With cost defaults from config
const normalized = normalizeDefiLlamaYieldPool(pool, {
  entrySlippageBps: 15,
  exitSlippageBps: 25,
  gatewayRoundTripCostBps: 40,
  offrampCostBps: 30
});

const report = evaluateDefiLlamaYieldAdapter({
  market: { pools: [normalized] },
  receipts: [ /* from loadYieldReceiptEvidence or synthetic matching YCE-002 */ ],
  config: { ...buildDefaultDefiLlamaYieldConfig(), perTradeCapUsd: 100 }
});
```

See `src/strategy/defillama-yield-adapter.mjs`, `src/ledger/receipt-reconciliation.mjs`, `active-work/defillama-receipt-validation.md`, and `active-work/defillama-yield-lane-revival.md`.

All per B-Model protocol, AGENTS.md, evidence-complete confidence.

— Protocol Reader & On-chain Data Engineer (Yield support, 2026-05-17)
