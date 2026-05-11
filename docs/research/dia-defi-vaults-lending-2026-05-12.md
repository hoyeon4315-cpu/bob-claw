<!-- ==================================================================== -->
<!-- PROMPT FOR CODING TOOL — copy from this fence to the closing fence    -->
<!-- ==================================================================== -->

```prompt
You are a coding tool with commit/PR authority on the BOB Claw repo.

Read this entire markdown file end-to-end BEFORE any action.

Reading order:
  1. §0 Reviewer/Implementer Brief — purpose, authority, decision scope.
  2. §5 Hard Limits — non-negotiable; violation = stop + operator report.
  3. §4 Open Questions — your first deliverable is a review report against this list.
  4. §1 / §2 / §3 — PR specs (PR1 = DefiLlama deepen, PR2 = DIA quotation oracle source, PR3 = Merkl↔DefiLlama lookup consistency).
  5. §7–§16 — analysis / comparison / risk; drill down only as needed.
  6. §17 — reporting template you must follow on every turn close.

Hard rules:
  - Re-read /Users/love/BOB Claw/AGENTS.md at task start. AGENTS.md is operating law.
  - You MAY propose committed diffs to AGENTS.md, src/config/*, this doc itself, etc. if it
    unblocks automation. Every such diff needs a rationale paragraph in the commit body
    and must not violate §5 Hard Limits.
  - You may NOT bypass §5 Hard Limits via any committed diff, runtime path, or side channel.
  - First action = REVIEW, not implementation:
      a. Walk §4 checklist top to bottom.
      b. Verify every factual claim in §7–§16 with `grep` / `curl` / `ls`.
      c. Tag every newly-confirmed item; for each falsified item, fix the doc inline AND
         append a §6 Decision Log row.
      d. If your review uncovers a new Hard Limit risk, stop and report.
  - After review, decide PR order/scope yourself within §0 authority. Append §6 Decision
    Log row per decision. Split or merge PRs as the evidence warrants.
  - For every committed PR: AGENTS.md Workspace Hygiene applies — small, frequent commits,
    regression tests, audit-log entries where relevant. Do not skip pre-commit hooks.
  - Stop and report (do not proceed) when any of:
      * Hard Limit (§5) reachable under proposed change.
      * Doc factual claim falsified AND your fix would change a PR's scope materially.
      * External API behavior different from what the doc records (rate limit, auth, fields).
      * You judge full work item should be deferred — explain why.
  - End-of-turn output MUST use AGENTS.md reporting format (현재 단계 / 이번에 한 일 /
    왜 / 다음 체크리스트).

Inputs you control:
  - Branch naming, PR description, commit messages.
  - Regression test fixture filenames and locations (follow repo conventions).
  - Whether to land DefiLlama deepen as one PR or split (e.g., adapter vs ranker vs blocker).

Inputs you do NOT control:
  - Cap values, autoExecute flags, payback ratios/timing — operator-committed only.
  - Hard Limits in §5.
  - Live signer / kill-switch policy.

Start by writing your §6 Decision Log entry: "YYYY-MM-DD | <tool-name> | review begun | <one-line scope> | —".
Then complete the §4 checklist. Then propose PR plan. Then implement.
```

<!-- ==================================================================== -->
<!-- END PROMPT — everything below is the spec the tool reads             -->
<!-- ==================================================================== -->

# DIA DeFi-Vaults-Lending — Spec & Playbook (2026-05-12)

> Format: front-loaded playbook for a coding tool with autonomous PR-decision authority. Analysis sections moved to the back (§7+). All factual claims marked with verification status from `2026-05-12` smoke-test (see §16.1).

## §0 Reviewer/Implementer Brief

**Purpose.** Decide how the BOB Claw repo should consume DIA / DefiLlama / Merkl free data feeds to (a) close the `supply_apr_missing` / `borrow_apr_missing` blocker in proxy-spread, (b) add a third independent oracle source to the `oracle_divergence` auto-kill trigger, and (c) tighten Merkl-candidate to DefiLlama-pool lookup so campaign-decay baselines are reliable. Then implement the parts you judge ready.

**Audience.** Coding tool (not human). Self-contained — assume no session memory.

**Authority granted.**
- Choose PR order, scope, split, merge, defer.
- Propose committed diffs to `AGENTS.md`, `src/config/*`, dashboard slices, this doc.
- Add new external HTTP dependencies if free + audit-logged + AGENTS.md-compliant.
- Restructure files when current shape blocks the work (follow AGENTS.md "small, focused files" principle).

**Authority denied.** Every item in §5.

**First deliverable.** A `data/reviews/dia-defi-vaults-lending-review-<YYYY-MM-DD>-<tool>.md` (or equivalent path that fits repo convention; create the dir if missing) containing your §4 checklist results. No code changes in this first commit.

**Subsequent deliverables.** PR1, PR2, PR3 (or your re-ordered/re-scoped set). Each with regression tests, audit-log discipline, and a §6 Decision Log row.

---

## §1 PR1 — DefiLlama Deepen + on-chain borrow rate

**Goal.** Eliminate `supply_apr_missing` / `borrow_apr_missing` blockers in `src/strategy/proxy-spread-expansion-adapter.mjs:113-114`. Enrich `opportunity-ranker` and `merkl-opportunity-policy` with already-free DefiLlama fields. No new external paid dependency.

### 1.1 Files to touch
| File | Change kind | Reason |
|---|---|---|
| [src/strategy/defillama-yield-adapter.mjs](../../src/strategy/defillama-yield-adapter.mjs) | modify | Expose new fields from `/pools` response (already free). |
| [src/strategy/proxy-spread-expansion-adapter.mjs](../../src/strategy/proxy-spread-expansion-adapter.mjs) | modify | Wire supply APR from DefiLlama `apyBase`; wire borrow APR from on-chain RPC (see 1.3). |
| [src/strategy/opportunity-ranker.mjs](../../src/strategy/opportunity-ranker.mjs) | modify | Use `ilRisk`, `exposure`, `apyPct30D`, `sigma` as risk multiplier inputs. |
| `src/protocol-readers/readers/aave-v3.mjs` (new helper) | extend | Add `getReserveData()` borrow-rate exposure for proxy-spread lookup, if not already there. |
| Regression fixtures (test dir per repo convention) | new | Snapshot tests for ranker score + blocker resolution. |

### 1.2 DefiLlama `/pools` — confirmed free fields (verified §16.1)
- `apyBase` (supply APR base, %)
- `apyReward` (reward APR, %)
- `apy` (total)
- `apyPct1D`, `apyPct7D`, `apyPct30D` (Δ%, NOT a mean — see §16.1 correction)
- `mu`, `sigma`, `count` (statistical moments of historical APY)
- `ilRisk` (`yes`/`no`)
- `exposure` (`single`/`multi`)
- `rewardTokens` (array | null)
- `tvlUsd`, `pool`, `project`, `chain`, `symbol`, `stablecoin`
- `predictions.predictedClass`, `predictions.predictedProbability`, `predictions.binnedConfidence`
- `outlier`, `underlyingTokens`, `poolMeta`
- `apyMean30d` is currently present in the free `/pools` response; treat as optional because prior smoke notes observed shape drift.

### 1.3 Borrow rate path (CORRECTED — `/poolsBorrow` is paid)
- `https://yields.llama.fi/poolsBorrow` returns **HTTP 402** ("Upgrade to the paid API plan"). Verified §16.1.
- Free borrow APR comes from on-chain RPC per protocol:
  - Aave V3: `IPool.getReserveData(asset)` → `currentVariableBorrowRate`, `currentLiquidityRate` (ray, divide by 1e27).
  - Compound V3: `Comet.getUtilization()`, `Comet.getBorrowRate(utilization)`, `Comet.getSupplyRate(utilization)`.
  - Moonwell (Compound V2 fork): `mToken.borrowRatePerBlock()`, `mToken.supplyRatePerBlock()` (× blocks/year).
  - Morpho Blue: `IIrm.borrowRateView(marketParams, market)` per market.
- Reuse existing protocol-readers under `src/protocol-readers/readers/`. Add minimal helpers if a reader already exposes share data but not rate data.

### 1.4 AGENTS.md impact
- Adds no new external paid dependency.
- No cap / autoExecute / payback change.
- `policy_engine_only` runtime authority unchanged — DefiLlama remains scoring/reporting input only.
- Live-read mandate respected — borrow rate from same-tick on-chain RPC.

### 1.5 Regression
- Snapshot for `proxy-spread-expansion-adapter` blocker absence when supply+borrow present.
- Snapshot for ranker score with `ilRisk: "yes"` vs `"no"`, `exposure: "single"` vs `"multi"`.
- Mock DefiLlama response fixture to keep tests offline.

### 1.6 Rollback
- All changes additive at field level. Revert by reverting the commit; no state migration.

---

## §2 PR2 — DIA quotation as oracle_divergence N+1 source

**Goal.** Add a third independent off-chain price source to `evaluateOracleDivergence` so the `oracle_divergence` auto-kill trigger has an N+1 source for BTC/USD, ETH/USD, and cbBTC/USD-style USD checks. Current committed default is `minSourceCount=2`; do not change that policy threshold in this PR unless a separate committed policy diff is explicitly reviewed. Strictly an additional sample — DIA cannot alone trip or suppress the trigger.

### 2.1 Files to touch
| File | Change kind | Reason |
|---|---|---|
| `src/risk/dia-quotation-fetcher.mjs` (new) | create | HTTP client for DIA quotation endpoint. |
| [src/risk/auto-kill-triggers.mjs](../../src/risk/auto-kill-triggers.mjs) | modify | Caller that populates `$AUTO_KILL_ORACLES_PATH` JSON `samples` (or wherever the existing builder lives — locate via grep). |
| [src/config/auto-kill.mjs](../../src/config/auto-kill.mjs) | modify | Add DIA endpoint base URL constant; keep `maxDivergencePct` unchanged. |
| `logs/dia-feed-audit.jsonl` (created at runtime, .gitignore) | new | Append-only audit. |
| Regression fixtures | new | N=2 vs N=3 divergence behaviour. |

### 2.2 DIA quotation endpoint — verified free (§16.1)
- `GET https://api.diadata.org/v1/quotation/{symbol}` → 200 OK, no key, no registration.
- Sample response (verified, BTC): `{ "Symbol":"BTC", "Name":"Bitcoin", "Address":"0x0...0", "Blockchain":"Bitcoin", "Price":<float>, "PriceYesterday":<float>, "VolumeYesterdayUSD":<float>, "Time":"<ISO8601>", "Source":"diadata.org" }`.
- Also available: `GET /v1/assetQuotation/{blockchain}/{address}` for chain-qualified lookup.
- Rate limit: documented as "free tier rate limit applies" — exact number undisclosed [미확인, tool to measure].

### 2.3 Sample shape into `evaluateOracleDivergence({ samples, config })`
- `evaluateOracleDivergence` lives at `src/risk/auto-kill-triggers.mjs:104` (verified §16.1).
- It groups `samples` by `pair || "unknown"` and trips when `(max-min)/min ≥ maxDivergencePct` once finite `priceUsd` count for that pair is at least `minSourceCount`.
- Add at the divergence layer: `{ source: "dia", pair: "BTC/USD", priceUsd: <Price>, observedAt: <Time> }`.
- If threading through `src/market/prices.mjs` first, preserve the existing sample fields `{ source, observedAt, namespace, key, priceUsd }`; add `pair` only where the auto-kill layer consumes it.
- Tool must verify minSourceCount and divergence threshold defaults in `src/config/auto-kill.mjs`.

### 2.4 AGENTS.md impact
- DIA does not become a single-source authority. AND-with existing sources.
- DIA fetch failure → omit sample, do not throw. Existing N-source guard unchanged.
- Mask logs; never log full DIA URL params with token amounts.
- Per AGENTS.md key-management pattern: DIA needs no API key today, so no `*_PATH` env required. If DIA later requires keys, follow `BURNER_*_KEY_PATH` pattern; do not inline.

### 2.5 Regression
- Mock DIA fetcher returning a known price, prove divergence calc includes it.
- Failure mode: mock fetch throws, prove guard still evaluates with remaining sources.

### 2.6 Rollback
- Revert. The audit log file persists (append-only AGENTS.md rule); leave it.

---

## §3 PR3 — Merkl ↔ DefiLlama lookup consistency

**Goal.** Make Merkl-candidate-to-DefiLlama-pool lookup reliable for the lending protocols our strategies actually touch (Morpho, Aave V3, Compound V3, Euler, Moonwell, Pendle). Today the Merkl matching code is in `src/cli/report-campaign-aware-opportunities.mjs` (`getDefiLlamaPool`); `src/strategy/defillama-yield-adapter.mjs` has DefiLlama pool evaluation but no `getDefiLlamaPool` export. Protocol identifiers are scattered across `src/config/strategy-caps/registry.mjs`, `src/config/protocol-trust-tiers.mjs`, `src/config/destination-venues.mjs`, `src/config/merkl-portfolio.mjs`, `src/config/stable-venues.mjs`, `src/strategy/auto-capital-allocator.mjs`, and related strategy files (verified §16.1). There is **no** single mapping table to extend.

### 3.1 Files to touch
| File | Change kind | Reason |
|---|---|---|
| [src/strategy/defillama-yield-adapter.mjs](../../src/strategy/defillama-yield-adapter.mjs) | modify | Normalise protocol-id matching for the six lending protocols above if adapter-side matching is introduced. |
| [src/cli/report-campaign-aware-opportunities.mjs](../../src/cli/report-campaign-aware-opportunities.mjs) | modify | Existing Merkl→DefiLlama `getDefiLlamaPool` matching lives here. |
| `src/config/protocol-id-aliases.mjs` (new, if absent) | create | Single source for `merkl-name ↔ defillama-project ↔ canonical-id` aliases. |
| [src/config/merkl-opportunity-policy.mjs](../../src/config/merkl-opportunity-policy.mjs) | optional modify | Reference the new alias table for the existing `minTvlUsdByFamily` and family resolution. |
| Regression fixtures | new | Merkl opportunity object → expected DefiLlama pool resolution. |

### 3.2 Scope note (reframed from prior draft)
- The 2026-05-11 draft assumed a single mapping table inside `merkl-opportunity-policy.mjs`. Verification (§16.1) shows no such table — protocol keys are scattered. Therefore the correct work is *introducing* a small alias config + threading the lookup through it.
- Keep the alias config tiny. Do not over-design.

### 3.3 AGENTS.md impact
- Pure refactor + config. No cap / autoExecute / payback / oracle gate change.
- Touches scoring inputs only; runtime authority unchanged.

### 3.4 Regression
- Fixture: Merkl opportunity {project: "morpho", chain: "base", tokens: ["cbBTC", "USDC"]} → DefiLlama pool record present.
- Repeat for each of the six protocols above.

### 3.5 Rollback
- Pure additive; revert commit.

---

## §4 Open Questions / 검토 체크리스트

The coding tool must answer every line below before opening any PR. Fix the doc inline as findings come in.

### 4.1 Fact-checks (file-level)
- [ ] `proxy-spread-expansion-adapter.mjs:113-114` still emits exactly `supply_apr_missing` / `borrow_apr_missing`? (verified 2026-05-12; re-verify before PR)
- [ ] `auto-kill-triggers.mjs:104` still exports `evaluateOracleDivergence({ samples, config })`? (verified 2026-05-12)
- [ ] `src/config/auto-kill.mjs` default `minSourceCount` value? Confirm `oracle_divergence` shape.
- [ ] `src/cli/report-campaign-aware-opportunities.mjs` current `getDefiLlamaPool` matching algorithm — does it already key off `project` + `chain` + `symbol`?
- [ ] `src/protocol-readers/readers/aave-v3.mjs` already exposes `getReserveData`? If not, add minimally.
- [ ] `merkl-opportunity-policy.mjs` truly lacks a protocol mapping table? (verified 2026-05-12 — no `Morpho|Aave|Compound` matches.)

### 4.2 External API behaviour (free tier)
- [ ] `GET https://yields.llama.fi/pools` — still free, response shape unchanged? (verified 2026-05-12 with sample of fields.)
- [ ] `GET https://yields.llama.fi/poolsBorrow` — still HTTP 402? (verified 2026-05-12.)
- [ ] `GET https://api.diadata.org/v1/quotation/BTC` — still 200 OK, key-less? (verified 2026-05-12.)
- [ ] Measure DIA quotation rate limit empirically (e.g., 60 sequential requests, record 429 onset). Record result in §16.1 update.
- [ ] DefiLlama `/pools` rate limit — undocumented number; measure if you intend per-minute polling.
- [ ] Merkl 10 req/sec — re-confirm from `https://developers.merkl.xyz/integrate-merkl/quickstart`. The 2026-05-12 fetch did not directly verify this number.

### 4.3 AGENTS.md alignment
- [ ] §5 Hard Limits — re-read; confirm no proposed change reaches any limit.
- [ ] Live-read mandate (2026-05-11) — confirm no proposed change uses recorded snapshot as ground truth.
- [ ] Caps-are-code — confirm no cap edit (PR2 must not add a numeric kill threshold; reuse existing).
- [ ] No-LLM-in-decision-path — confirm no proposed change inserts inference between policy and signer.
- [ ] ERC4626 auto-register exception — confirm no proposed change touches it.
- [ ] Payback never escalates sizing — confirm no proposed change passes DIA/DefiLlama data into payback ratio/timing.
- [ ] Append-only audit logs — confirm any new log files are append-only and never rotated in place.
- [ ] Workspace Hygiene — small commits, no mixed code+artifact commits.

### 4.4 Decision-authority handshakes
- [ ] If review finds a PR is fully blocked, append §6 row with rationale and stop.
- [ ] If review reveals a Hard Limit (§5) risk, stop entirely and surface to operator before writing any code.
- [ ] If review suggests a *committed* AGENTS.md edit unblocks automation safely, draft the diff with rationale and surface BEFORE landing the unrelated PRs.

### 4.5 Coverage sanity
- [ ] DIA `/v1/quotation/{symbol}` returns price for our actual cross-check pairs: cbBTC/USD, WETH/USD, USDC/USD, LBTC/USD? Smoke each symbol.
- [ ] DefiLlama `/pools` includes pools for the six protocols listed in §3.1 on the chains we use (ethereum, base, optimism, bsc, avalanche, plus any others in `merkl-opportunity-policy.mjs:eligibleEntryChains`).

---

## §5 Hard Limits (non-negotiable, no committed-diff path either)

These rules cannot be relaxed by a committed diff. If any proposed change reaches one of them, **stop and report**:

1. **No runtime cap raise.** Per-strategy per-tx / per-day / per-chain / `maxDailyLossUsd` are config-only; no LLM/dashboard/Telegram/side-channel path.
2. **No autoExecute toggle via side-channel.** `autoExecute: true` lives in committed strategy config.
3. **No signer-path bypass.** Every broadcast goes through the policy engine; no raw-tx route from this work.
4. **No private key exposure.** Keys live in OS keystore via `*_KEY_PATH` envs; never in logs, dashboards, prompts, repo, tool args, or audit files.
5. **No audit log deletion / in-place rotation / rewrite.** `logs/signer-audit.jsonl`, `logs/kill-switch-audit.jsonl`, `logs/dev-lock-audit.jsonl`, and any audit file this work creates are append-only forever.
6. **No payback runtime change.** Payback ratio / timing / trigger from `src/config/payback.mjs` only; no DIA / DefiLlama / Merkl signal allowed into payback decisions.
7. **No single external source as sole authority on any gate.** DIA / DefiLlama / Merkl are scoring/cross-check inputs. Trip / suppression decisions remain multi-source.
8. **No non-ERC4626 token auto-whitelist.** ERC4626-with-known-underlying remains the only exception. DIA/DefiLlama risk scores do not unlock new auto-whitelists.
9. **`policy_engine_only` runtime authority is final.** Surface-admission / scoring / oracles are commit-time / reporting inputs.
10. **No LLM in the trade/payback decision path.** This work writes code; runtime decisions remain deterministic policy + signer.
11. **No skipping pre-commit hooks** (`--no-verify`) and no bypassing signing.

Any of the above reachable through a proposed change = stop, file an operator report, do not commit.

---

## §6 Decision Log (append-only)

```
YYYY-MM-DD | actor                | decision                                                     | rationale (short)                              | linked PR / commit
2026-05-12 | author (initial doc) | doc v1 + PR1/PR2/PR3 spec drafted                            | DIA vault map unfree → free-only integration   | —
2026-05-12 | author               | corrected /poolsBorrow paid, apyMean30d nonexistent, PR3 reframed | smoke tests vs assumptions, §16.1               | —
2026-05-12 | codex                | review begun                                                 | §4 checklist + §16.1 smoke re-run before code  | —
2026-05-12 | codex                | factual corrections from review                              | apyMean30d present; PR2 sample uses priceUsd; PR3 matcher file was wrong | —
2026-05-12 | codex                | stop before implementation                                   | PR3 file/scope correction materially changes spec scope | —
2026-05-12 | codex                | implementation resumed after operator approval               | operator said 끝까지 진행해                    | —
2026-05-12 | codex                | PR order selected: PR3 → PR1 → PR2                           | fix matcher scope before enrichment/risk source | —
2026-05-12 | codex                | PR3 scope set to alias config + campaign matcher             | actual Merkl matcher owner is report-campaign-aware-opportunities | —
2026-05-12 | codex                | PR1 scope set to additive DefiLlama fields + on-chain rate helper | no cap/autoExecute/payback change; same-tick RPC helper only | —
2026-05-12 | codex                | PR2 scope set to DIA as optional third price source          | keep existing oracle thresholds; failure omits sample | —
```

Tool: append one row per decision (PR start, PR split, PR defer, doc edit, AGENTS.md proposal, Hard-Limit stop).

---

## §7 DIA Vault Map — Surface Summary

Source: https://www.diadata.org/map/defi-vaults-lending and https://www.diadata.org/map/defi-vaults-lending/about/.

| Item | Value |
|---|---|
| Coverage (marketing) | 3,907 vaults, 81 chains |
| Pipeline | 30-phase cron, 16 chains direct on-chain read + DefiLlama + DIA Oracles + protocol APIs |
| Protocols | Morpho, Aave V3, Compound V3, Euler V2, Fluid, Silo V2, Yearn, Beefy, MetaMorpho, Pendle, Kamino |
| Fields surfaced (UI) | TVL+history, borrow rate, utilization, whale activity, depeg, capital flow, audit/hack history, oracle config, timelock, multisig, owner type |
| Derived oracle | `DIA Value` — yield-bearing intrinsic fair value (custom subscription path) |
| Free API includes? | **No** — DIA free API ([free-crypto-api](https://www.diadata.org/free-crypto-api/)) exposes token-price quotations only (`/v1/quotation/{symbol}`, `/v1/assetQuotation/{blockchain}/{address}`). Vault map data requires paid/custom oracle subscription [미확인 단가]. |
| Differentiation vs DefiLlama / Pyth | Governance metadata first-class; lending-rate index as separate surface; intrinsic-value oracle for yield-bearing tokens |

---

## §8 Current BOB Claw data flow (verified file paths)

| Area | Source today | File |
|---|---|---|
| On-chain position read | Aave V3 / ERC4626 / Pendle / Venus / Beefy / Aerodrome NFT direct RPC | [src/protocol-readers/readers/aave-v3.mjs](../../src/protocol-readers/readers/aave-v3.mjs), [erc4626.mjs](../../src/protocol-readers/readers/erc4626.mjs), [pendle.mjs](../../src/protocol-readers/readers/pendle.mjs), [venus.mjs](../../src/protocol-readers/readers/venus.mjs) |
| Campaign data | Merkl API + DefiLlama yields | [src/watch/merkl-opportunity-watch.mjs](../../src/watch/merkl-opportunity-watch.mjs), [src/strategy/defillama-yield-adapter.mjs](../../src/strategy/defillama-yield-adapter.mjs) |
| Radar discovery | Merkl queue sync → binding registry | [src/cli/radar-promote.mjs](../../src/cli/radar-promote.mjs), [src/strategy/radar/radar-candidate-router.mjs](../../src/strategy/radar/radar-candidate-router.mjs) |
| Opportunity scoring | APR + log10(TVL) + audit + chain + reward haircut | [src/strategy/opportunity-ranker.mjs](../../src/strategy/opportunity-ranker.mjs), [src/config/merkl-opportunity-policy.mjs](../../src/config/merkl-opportunity-policy.mjs) |
| Risk / chain score | Static prior (`DEFAULT_VENUE_METADATA`) or ledger | [src/strategy/scored-capital-allocation.mjs](../../src/strategy/scored-capital-allocation.mjs) |
| Oracle divergence kill | `evaluateOracleDivergence({ samples, config })` | [src/risk/auto-kill-triggers.mjs:104](../../src/risk/auto-kill-triggers.mjs) |
| Campaign decay | entry-vs-now APR/TVL/reward-token thresholds | `auto-kill-triggers.mjs` `campaign_decay` |
| ERC4626 auto-register | `convertToAssets` probe → known underlying | [src/config/token-registry.mjs](../../src/config/token-registry.mjs) |
| Wrapped-BTC loop | Moonwell `exchangeRateStored()` at execution | [src/strategy/wrapped-btc-loop-bindings.mjs](../../src/strategy/wrapped-btc-loop-bindings.mjs) |
| Proxy-spread blocker | `supply_apr_missing`, `borrow_apr_missing` | [src/strategy/proxy-spread-expansion-adapter.mjs:113-114](../../src/strategy/proxy-spread-expansion-adapter.mjs) |
| Binding registry | erc4626 / aave-v3 / euler | [src/executor/protocol-binding-registry.mjs](../../src/executor/protocol-binding-registry.mjs) |
| Protocol-id locations (scattered) | strategy-caps / trust-tiers / destination-venues / merkl-portfolio / stable-venues / auto-capital-allocator | grep `morpho` for full list (verified §16.1) |

---

## §9 Gap analysis (compressed)

| # | Gap | Today | DIA can | DIA can't (free) |
|---|---|---|---|---|
| 1 | Cross-chain APR/TVL standard | Merkl + DefiLlama stitched | uniform schema (paid) | Free tier has no vault data |
| 2 | Lending rate freshness | on-chain read at exec only | min-level rates (paid) | Free = token price only |
| 3 | Governance risk metadata | Static `DEFAULT_VENUE_METADATA` | first-class (paid) | Free = none |
| 4 | Reward exit liquidity | Merkl + manual canary | capital-flow signals (paid) | Free = none |
| 5 | Campaign-decay early warning | post-threshold | whale outflow (paid) | Free = none |
| 6 | ERC4626 share-price cross-check | `convertToAssets` only | `DIA Value` (paid likely) | Free = unclear |
| 7 | `supply/borrow_apr_missing` blocker | data absent | not via DIA free | Free = none — fix via on-chain RPC instead (§1.3) |

Net: DIA free contribution is limited to §2 (token-price oracle 3rd source). All other gaps need either paid DIA or alternative free sources (on-chain RPC, DefiLlama deeper use).

---

## §10 Legal integration patterns

1. **Discovery feed pre-filter.** Use DefiLlama/DIA data upstream of `radar-candidate-router.mjs`. Thresholds in `radar-policy.mjs` stay committed; external feeds are inputs only.
2. **Cross-check oracle.** DIA quotation joins `evaluateOracleDivergence` samples. Mandatory: multi-source guard preserved.
3. **Risk-score input.** Audit-history / timelock metadata (paid DIA, future) into `scored-capital-allocation.mjs:riskScore` prior. Final weights remain committed code.
4. **Campaign-decay early warning** (deferred to paid). DIA whale-flow + Merkl baseline AND-gated for `review` action. Not exit.
5. **Lending-rate feed.** PR1 path — on-chain RPC primary, DefiLlama enriched fields secondary. DIA not needed for free.
6. **ERC4626 share-price cross-check** (deferred to paid). `DIA Value` vs `convertToAssets` spread → pending-whitelist.

---

## §11 Forbidden uses (§5 in narrative form)

- DIA/DefiLlama/Merkl response as NAV / current balance ground truth → violates live-read mandate (2026-05-11).
- Single source decides cap raise → violates caps-are-code.
- DIA risk score auto-whitelists unknown token → violates no-auto-whitelist (ERC4626 exception only).
- External feed reaches signer path without policy → violates no-LLM-in-decision-path isolation principle.
- Single source fills both arms of `oracle_divergence` → semantically void.
- Any DIA input into `payback.mjs` ratio/timing/trigger → violates payback isolation.
- DIA Value used to *waive* ERC4626 auto-register's known-underlying gate → exception is strict.

---

## §12 11 Gateway destination coverage

| Chain | DIA token-price quotation reach |
|---|---|
| Ethereum | confirmed |
| Base | likely confirmed [추측] |
| BSC, Avalanche, Optimism | likely |
| Unichain, Berachain, Sei, Sonic, Soneium | unclear [미확인] |
| BOB L2 | unlikely [미확인] |

Vault-map data (paid) coverage of BOB L2 / Sei / Sonic / Soneium is unverified — assume not covered until confirmed.

---

## §13 Key / call hygiene

- DIA quotation: free, no API key today. If DIA later requires a key, place file path behind `DIA_API_KEY_PATH` env (mirrors `BURNER_*_KEY_PATH`). Never inline.
- DefiLlama free: no key.
- Merkl free: no key.
- New audit log `logs/dia-feed-audit.jsonl` (append-only). Schema mirrors `logs/codex-audit.jsonl`: `{ ts, endpoint, paramsMasked, status, responseHash, decision }`.
- Snapshot caches under `data/dia/snapshot-*.json` may exist for debug but are NEVER ground truth (live-read mandate).
- Cost guard: not currently needed (free). If paid added later, mirror Codex `data/codex/budget-lock.json` pattern.

---

## §14 DIA / DefiLlama / Merkl 3-way comparison

| Area | DIA (vault map) | DefiLlama | Merkl |
|---|---|---|---|
| Governance metadata | first-class (paid) | partial (hacks API) | none |
| Vault TVL | yes (paid) | yes (free) | campaigns only |
| Supply/borrow rate | yes (paid) | partial; `/poolsBorrow` is **PAID** ($300/mo Pro) | none |
| Campaign incentives | no | no | yes (free) |
| Whale / capital-flow | yes (paid) | partial via TVL delta | no |
| ERC4626 share-price intrinsic | `DIA Value` (paid likely) | TVL only | no |
| Free token price feed | yes — `/v1/quotation/{symbol}` | yes — `/prices/current/{coins}` | no |
| Free, no key | yes (quotation only) | yes (pools, prices) | yes (10 req/sec default [미확인]) |

Best-fit free sources by need:
- Pool TVL / APR → DefiLlama `/pools` (already in use).
- Campaign incentives → Merkl (already in use).
- Supply/borrow APR → **on-chain RPC** (DefiLlama free `/poolsBorrow` blocked, paid only).
- Third price source → DIA `/v1/quotation/{symbol}`.

---

## §15 DIA oracle taxonomy

| Kind | Access | Cost | Fit for us |
|---|---|---|---|
| Free REST quotation | `GET https://api.diadata.org/v1/quotation/{symbol}`, `/v1/assetQuotation/{chain}/{addr}` | 0, key-less | Yes — PR2 path |
| On-chain push oracle | DIA-deployed contract, smart-contract `read()` | Custom paid + gas | No — our signer/policy is off-chain; on-chain liquidation oracles are not us |
| `DIA Value` intrinsic | Either channel, exposure ambiguous | Likely paid | Deferred — share-price cross-check candidate (§9 row 6) |

Free path is REST only. On-chain oracle contracts out of current scope.

---

## §16 Risk & verification log

### 16.1 Verification evidence (2026-05-12 smoke tests)

Commands run and recorded — re-run before any PR commit.

```text
curl -sS "https://yields.llama.fi/pools" | head
  → 200 OK; first record fields include:
    chain, project, symbol, tvlUsd, apyBase, apyReward, apy, rewardTokens, pool,
    apyPct1D, apyPct7D, apyPct30D, stablecoin, ilRisk, exposure,
    predictions{predictedClass,predictedProbability,binnedConfidence},
    poolMeta, mu, sigma, count, outlier, underlyingTokens, il7d, apyBase7d,
    apyMean30d, volumeUsd1d, volumeUsd7d, apyBaseInception
  → NOTE: `apyMean30d` is present in the 2026-05-12 Codex re-run. Treat it as
    optional/free-field input, not a required blocker-clear field.

curl -sS -o /dev/null -w "%{http_code}" "https://yields.llama.fi/poolsBorrow"
  → 402; body: "Upgrade to the paid API plan at https://defillama.com/subscription"
  → `/poolsBorrow` is PAID. Free fallback for borrow APR = on-chain RPC.

curl -sS "https://api.diadata.org/v1/quotation/BTC"
  → 200 OK; body: { Symbol, Name, Address, Blockchain, Price, PriceYesterday,
                    VolumeYesterdayUSD, Time, Source }

grep -n "supply_apr_missing\|borrow_apr_missing" src/strategy/proxy-spread-expansion-adapter.mjs
  → line 113: if (supplyAprBps == null) blockers.push("supply_apr_missing");
  → line 114: if (borrowAprBps == null) blockers.push("borrow_apr_missing");

grep -nE "oracle_divergence|samples|AUTO_KILL_ORACLES_PATH" src/risk/auto-kill-triggers.mjs src/config/auto-kill.mjs
  → src/risk/auto-kill-triggers.mjs:104 export function evaluateOracleDivergence({ samples = [], config })
  → src/risk/auto-kill-triggers.mjs:106 minSourceCount gate
  → src/risk/auto-kill-triggers.mjs:126 trigger: "oracle_divergence"
  → src/config/auto-kill.mjs:29 minSourceCount: 2
  → evaluateOracleDivergence reads `sample.priceUsd`, not `sample.value`.

grep -nE "Morpho|Aave|Compound" src/config/merkl-opportunity-policy.mjs
  → no matches. No single mapping table in merkl-opportunity-policy.

grep -rn "morpho" src/config/ src/strategy/
  → scattered keys across strategy-caps/registry, protocol-trust-tiers,
    destination-venues, protocol-addresses, merkl-portfolio,
    stable-venues, auto-capital-allocator.

rg -n "getDefiLlamaPool|DefiLlamaPool" src test docs package.json
  → src/cli/report-campaign-aware-opportunities.mjs:87:function getDefiLlamaPool(merklItem, defiLlamaPools)
  → no `getDefiLlamaPool` function in src/strategy/defillama-yield-adapter.mjs.

node DIA quotation smoke for cbBTC/WETH/USDC/LBTC
  → cbBTC 200, WETH 200, USDC 200, LBTC 404.

node DIA BTC quotation rate smoke, 60 sequential requests
  → { requests: 60, counts: { "200": 60 }, first429: null, firstNon200: null }

curl Merkl quickstart + grep rate limit
  → "Anonymous requests work at a default rate limit of 10 req/sec"
```

### 16.2 Open / unconfirmed
- DIA quotation rate limit exact published number [미확인]; empirical 60 sequential BTC requests returned 60×200 and no 429.
- DefiLlama `/pools` per-IP rate limit (number) [미확인].
- Merkl 10 req/sec exact figure [미확인].
- DIA paid vault-map subscription pricing & SLA [미확인].
- DIA `DIA Value` free vs paid surface [미확인].
- 81-chain exact list incl. our 11 Gateway destinations [미확인].
- DIA quotation availability for cbBTC/WETH/USDC/LBTC symbols: cbBTC, WETH, USDC returned 200; LBTC returned 404 in Codex smoke.

### 16.3 Single-point-of-failure risk
Adding DIA as a third oracle source is an explicit *addition*; the divergence guard already tolerates source loss when `samples.length < minSourceCount`. PR2 must verify graceful-degradation tests.

---

## §17 보고 형식 (every turn close)

```
현재 단계: <0~7단계>

이번에 한 일
- <1~3 lines>

왜 아직 그 단계인지
- <blocker, evidence-based>

다음 체크리스트
- [ ] <1>
- [ ] <2>
- [ ] <3>
```

Initial author entry:

**현재 단계: 0~1단계 (analysis + spec, no live impact, no code change)**

### 이번에 한 일
- Restructured doc: prompt block at top, playbook (§0–§6) front-loaded, analysis (§7–§16) compressed to back.
- Verified factual claims via curl + grep; fixed 3 errors:
  - `/poolsBorrow` PAID (not free) — PR1 borrow path rewritten to on-chain RPC.
  - `apyMean30d` field does not exist — replaced with `apyPct30D` + `apy` + `mu/sigma`.
  - merkl protocol mapping table assumed-but-absent — PR3 reframed as alias-config introduction.
- Added Hard Limits (§5) explicitly inviolable by any committed diff.
- Added §6 Decision Log skeleton + verification evidence (§16.1).

### 왜 아직 그 단계인지
- Document only. Zero code / config / cap / autoExecute changes.
- DIA vault-map data not free → most analysis-driven integrations deferred.
- Coding tool not yet invoked; review-first contract held.

### 다음 체크리스트
- [ ] Hand prompt block (top of file) to coding tool.
- [ ] Coding tool runs §4 review checklist and writes review report.
- [ ] Coding tool decides PR1/2/3 ordering and proceeds.
