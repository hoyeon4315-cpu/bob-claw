# DIA DeFi-Vaults-Lending Review — Codex — 2026-05-12

## Decision

Stop before implementation.

Reason: the review falsified doc facts that materially change PR scope:

- PR3 named `src/strategy/defillama-yield-adapter.mjs` as the current Merkl `getDefiLlamaPool` owner, but the actual function is `src/cli/report-campaign-aware-opportunities.mjs:87`.
- PR2 sample text used `value`, but `evaluateOracleDivergence()` consumes `priceUsd`.
- PR2 text implied `minSourceCount=3`; committed default is `minSourceCount: 2`.

No §5 Hard Limit is currently reachable from the reviewed changes. The stop is the prompt's separate "doc factual claim falsified AND fix would change a PR's scope materially" condition.

## Required Reading

- Re-read `AGENTS.md`.
- Read `docs/system-map.md`.
- Read `docs/harness-engineering.md`.
- Read `src/graphify-out/GRAPH_REPORT.md`.
- Read `docs/research/dia-defi-vaults-lending-2026-05-12.md` prompt block and spec.

## §4 Checklist

### 4.1 Fact-checks

- `proxy-spread-expansion-adapter.mjs:113-114`: confirmed exact blockers.

```text
113	  if (supplyAprBps == null) blockers.push("supply_apr_missing");
114	  if (borrowAprBps == null) blockers.push("borrow_apr_missing");
```

- `auto-kill-triggers.mjs:104`: confirmed export.

```text
104	export function evaluateOracleDivergence({ samples = [], config }) {
106	  if (!Array.isArray(samples) || samples.length < config.minSourceCount) return null;
126	        trigger: "oracle_divergence",
```

- `src/config/auto-kill.mjs`: confirmed default `oracleDivergence.minSourceCount: 2`, `maxDivergencePct: 0.05`.
- DefiLlama Merkl matching: falsified doc owner. `getDefiLlamaPool()` is in `src/cli/report-campaign-aware-opportunities.mjs:87`, not `src/strategy/defillama-yield-adapter.mjs`.
- `src/protocol-readers/readers/aave-v3.mjs`: no `getReserveData`, `currentVariableBorrowRate`, or `currentLiquidityRate` exposure yet.
- `merkl-opportunity-policy.mjs`: confirmed no `Morpho|Aave|Compound|morpho|aave|compound|moonwell|euler|pendle` matches.

### 4.2 External API Behaviour

- DefiLlama `/pools`: 200. Current first record includes `apyMean30d`; prior doc claim "no field named apyMean30d" is stale.
- DefiLlama `/poolsBorrow`: 402 with body:

```text
Upgrade to the paid API plan at https://defillama.com/subscription
```

- DIA `/v1/quotation/BTC`: 200 key-less with keys:

```text
Symbol, Name, Address, Blockchain, Price, PriceYesterday, VolumeYesterdayUSD, Time, Source
```

- DIA 60 sequential BTC quotation requests: 60×200, no 429 observed.
- Merkl quickstart: confirmed anonymous default rate limit text says `10 req/sec`.
- DefiLlama `/pools` rate limit: not measured; current repo client has a 5-minute cache and review does not require per-minute polling.

### 4.3 AGENTS.md Alignment

- §5 Hard Limits re-read: no cap raise, no autoExecute toggle, no signer bypass, no key exposure, no audit rewrite, no payback runtime change, no single-source gate authority, no auto-whitelist, no LLM runtime decision path.
- Live-read mandate: PR1 borrow-rate path should use same-tick on-chain RPC, not recorded snapshots.
- Caps-are-code: no cap edit proposed.
- No-LLM-in-decision-path: proposed changes are deterministic fetch/scoring inputs only.
- ERC4626 auto-register exception: untouched.
- Payback never escalates sizing: untouched.
- Append-only audit logs: PR2 may create `logs/dia-feed-audit.jsonl` at runtime only; no in-place rotation.
- Workspace hygiene: review touched only the spec and this review artifact; dirty generated dashboard JSON was left alone.

### 4.4 Decision-Authority Handshakes

- Fully blocked PR: none by §5.
- Hard Limit risk: none found.
- AGENTS.md edit: none needed.
- Prompt stop condition reached: yes, because PR3 scope owner was materially wrong.

### 4.5 Coverage Sanity

- DIA symbol smoke:

```text
cbBTC: 200
WETH: 200
USDC: 200
LBTC: 404
```

- DefiLlama `/pools` protocol coverage on eligible chains:

```json
{
  "morpho": { "total": 1032, "chains": { "base": 179, "ethereum": 543 } },
  "aave-v3": { "total": 260, "chains": { "ethereum": 113, "base": 14, "avalanche": 15, "bsc": 8 } },
  "compound-v3": { "total": 150, "chains": { "ethereum": 63, "base": 18 } },
  "euler": { "total": 323, "chains": { "ethereum": 94, "avalanche": 15, "base": 33, "bsc": 25 } },
  "moonwell": { "total": 45, "chains": { "base": 20 } },
  "pendle": { "total": 212, "chains": { "ethereum": 146, "bsc": 6, "base": 10 } }
}
```

## Citation Verification

- All markdown-linked repo files in the DIA doc exist.
- Explicit label citations verified:
  - `src/risk/auto-kill-triggers.mjs:104` is the `evaluateOracleDivergence` export.
  - `src/strategy/proxy-spread-expansion-adapter.mjs:113-114` are the two APR blockers.
- Falsified citation/scope:
  - `src/strategy/defillama-yield-adapter.mjs` has DefiLlama pool evaluation, but not `getDefiLlamaPool`.
  - `src/cli/report-campaign-aware-opportunities.mjs:87` owns the current Merkl-to-DefiLlama pool matcher.

## Files Changed In Review Step

- `docs/research/dia-defi-vaults-lending-2026-05-12.md`: appended §6 rows and corrected falsified spec facts inline.
- `data/reviews/dia-defi-vaults-lending-review-2026-05-12-codex.md`: this review artifact.
