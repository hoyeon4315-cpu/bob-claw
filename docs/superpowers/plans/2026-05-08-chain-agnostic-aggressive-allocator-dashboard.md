# Chain-Agnostic Aggressive Allocator And Live Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove current-chain overfit from capital allocation while keeping live-cap safety unchanged, then prove the system is operating normally through deterministic reports and a dashboard that shows fresh, non-duplicated, chain-aware assets and exact no-trade reasons.

**Architecture:** Keep the existing proposer -> policy -> signer path. Add receipt-driven scoring and exploration as pure inputs to existing Capital Manager and dispatcher surfaces. Keep payback reserve proof separate from strategy-chain allocation. Dashboard remains read-only and consumes generated JSON slices only.

**Tech Stack:** Node `.mjs`, `node:test`, existing BOB Claw config/policy modules, dashboard public JSON/JSX, no new runtime dependency.

---

## Confidence Boundary

Literal 100% confidence about future DeFi markets is impossible. The implementation target is the repo's evidence-complete confidence standard: no known safety-law loophole, no known dashboard accounting blind spot, source tests pass, live reports explain no-trade states, and remaining market uncertainty is explicitly represented as score confidence or blockers.

---

## Review Verdict

Claude's plan is directionally correct, but it needs three corrections before implementation.

1. `src/strategy/scored-capital-allocation.mjs` has real static `chainScore` bias, but production refill targets also flow through `src/executor/capital/scored-target-balances.mjs`. Both surfaces must report the score source.
2. `src/config/sleeve-profile.mjs` has hardcoded `reserveChain: "base"`, but payback reserve proof is not the same thing as strategy allocation primary. Keep payback reserve pinned to the proven path until another official destination has full off-ramp proof; make the hypothesis explicit instead of making reserve dynamic too early.
3. Dashboard work must go beyond `lastTickDenyCount`. The acceptance target is live asset tracking: wallet balances, protocol-position marks, stale/failure attribution, chain score source, and deny-by-reason must reconcile without double counting.

Do not change these safety surfaces: signer custody, kill-switch, capless reject, unlimited-approval reject, HF/liquidation buffers, payback ratio/timing rules, `autoExecute` runtime behavior, committed canary ladder rungs, and nominal transport compatibility caps.

---

## Loophole Audit Delta

This pass adds hardening items that were not strict enough in the first plan.

| Severity | Loophole | Fix |
|---|---|---|
| HIGH | `exploreSharePct: 0.25` can exceed the small-cap micro-test/radar/campaign budgets when applied to unknown chains. | Exploration allocation must be clamped by committed small-cap sleeve budgets, radar lane caps, per-campaign caps, and per-unproven-protocol caps before any strategy cap is considered. |
| HIGH | A fixed `$0.50` edge floor in non-primary EV can still kill `$5-$10` tiny canaries. | Make the edge floor rung-aware: probe/tiny use chain dust and bps floors; pilot/operating may use a larger fixed floor. |
| HIGH | Chain score can overcount weak evidence if any confirmed signer audit row is treated as alpha. | Chain scoring must ingest only reconciled, finality-safe, signer-backed records and must split `execution_evidence_cost` from `strategy_realized_pnl`. |
| HIGH | Local chain aliases are scattered (`berachain` vs `bera`, `bnb` vs `bsc`), so scoring can split evidence. | Add one canonical Gateway chain normalizer and replace ad hoc normalizers in new code paths. |
| HIGH | An expired primary hypothesis being "advisory only" can still leave stale primary-chain cap overrides in place. | Expiry must not block live policy, but it must remove score boosts and evidence-primary cap overrides until a committed renewal diff. |
| MED | Receipt-driven scoring can chase a recent lucky lane. | Add Bayesian shrinkage to prior, score delta clamps, failure-rate penalty, variance penalty, and distinct opportunity/campaign count fields. |
| MED | Dashboard `generatedAt` can refresh while underlying inventory, marks, or prices are stale. | Material slices must expose `sourceObservedAt`, `oldestMaterialSourceObservedAt`, stale counts, and dashboard verdict must use the oldest material source. |
| MED | Asset USD values can be wrong when price data is stale or divergent. | Wallet/protocol rows must include `priceSource`, `priceObservedAt`, and price freshness/divergence status; stale price value is marked yellow, not hidden. |
| MED | Cost-efficient chains can be overweighted even when exit liquidity is unproven. | `routeAvailability` must include exit-liquidity proof and reward-token conversion proof at the candidate notional. |
| MED | Modifying `run-strategy-tick.mjs` near generated intent logic can accidentally affect broadcast behavior. | Task 1 must add logging-only tests and must not call `run-strategy-tick` in verification; use fixture logs for slice tests. |
| LOW | Audit logs are append-only by convention, not cryptographically immutable. | Scoring output must include `auditIntegrityStatus`; unknown integrity falls back to conservative prior or `widePosterior=true`. |
| LOW | Dashboard can show "unknown" external balances as if usable inventory. | Unknown/unclassified balances remain visible but are excluded from deployable capital and require committed whitelist diffs. |

---

## Normal Operation Definition

The system is considered normal only when all of these are true:

- `status:dashboard` and dashboard live refresh produce fresh `dashboard/public/dashboard-status.json`, `dashboard/public/wallet-holdings.json`, `dashboard/public/strategy-tick-status.json`, and protocol-position marks without schema errors.
- Every tracked strategy row has `liveEligibility.blockers`, `lastTickDenyByReason`, `topBlocker`, and score-source metadata, even when no transaction is sent.
- Wallet free balances and protocol positions are separated; protocol-reader-covered share tokens are not counted twice.
- Capital allocation output separates `exploit` and `explore` budgets and shows whether chain scores came from ledger evidence or a conservative prior.
- Dashboard stale/fresh verdict uses the oldest material source timestamp, not only the JSON generation time.
- No code path raises caps, flips `autoExecute`, signs, or changes payback decisions at runtime.

---

## Task 0: Baseline And Generated Artifact Guard

**Files:**
- Generated output: `dashboard/public/*.json`
- Read-only: `logs/strategy-tick.jsonl`
- Read-only: `logs/signer-audit.jsonl`
- Read-only: `data/protocol-position-marks.jsonl`

- [ ] Record current generated-artifact dirtiness with `git status --short`.
- [ ] Do not stage generated dashboard JSON while implementing source changes unless the task explicitly publishes refreshed snapshots.
- [ ] Run non-broadcast baseline checks. Some of these refresh generated dashboard JSON by design; treat that as runtime output, not source evidence:

```bash
npm run report:wallet-holdings-slice -- --json
npm run report:strategy-tick-slice -- --json
npm run status:protocol-position-marks -- --json
npm run report:payback-status -- --json
```

- [ ] Save the observed blockers in the implementation notes, not by editing audit logs.

Expected bug to watch: `report-wallet-holdings-slice` and `report-strategy-tick-slice` write generated JSON by default. Use direct CLI paths with temp output for tests where supported, or intentionally refresh only in the verification phase.

---

## Task 1: Tick Deny Reasons And Dashboard Schema V3

**Files:**
- Modify: `src/cli/run-strategy-tick.mjs`
- Modify: `src/cli/report-strategy-tick-slice.mjs`
- Modify: `src/status/current-dashboard-context.mjs`
- Modify: `dashboard/public/data.jsx`
- Modify: `dashboard/public/app.jsx`
- Test: `test/report-strategy-tick-slice.test.mjs`
- Test: `test/dashboard-live-slices.test.mjs`
- Test: `test/dashboard-app.test.mjs`

- [ ] Add a failing test where a tick record includes dispatcher intents:

```js
dispatchIntents: [
  { strategyId, chain: "base", decision: "deny", reason: "negative_post_cost_edge" },
  { strategyId, chain: "bsc", decision: "deny", reason: "feed_stale" },
  { strategyId, chain: "bsc", decision: "deny", reason: "feed_stale" },
]
```

- [ ] Expect the slice row to include:

```js
lastTickDenyByReason: { negative_post_cost_edge: 1, feed_stale: 2 },
topDenyReason: "feed_stale",
lastTickAllowByChain: {},
lastTickDenyByChain: { base: 1, bsc: 2 }
```

- [ ] In `run-strategy-tick.mjs`, append a safe `dispatchIntents` summary to the tick record:

```js
dispatchIntents: (result.dispatch?.intents || []).map((intent) => ({
  strategyId: intent.strategyId,
  chain: intent.chain,
  protocol: intent.protocol,
  decision: intent.decision,
  reason: intent.reason || null,
  detail: intent.detail || null,
  expectedNetSats: intent.expectedNetSats ?? null,
  observedAt: intent.observedAt || result.observedAt,
}))
```

- [ ] Add a regression test proving this is logging-only: adding `dispatchIntents` must not change `generatedIntents`, signer client calls, broadcast count, or execution guard behavior.
- [ ] In `report-strategy-tick-slice.mjs`, count deny reasons from `dispatchIntents`, not from free-form logs.
- [ ] Keep old fields (`lastTickDenyCount`, `lastTickBlockers`) for dashboard compatibility.
- [ ] Bump slice `schemaVersion` to `3`.
- [ ] Surface a compact no-trade panel in the dashboard: top deny reason, top blocker, and generated intent count. Do not add explanatory feature text in the UI.

Expected bugs to prevent:
- Global deny reasons can affect multiple strategies; count only intents with matching `strategyId`.
- `adapter_blocked` skipped candidates live in `result.builder.skipped`, not dispatcher intents. Add `lastTickSkippedByReason` separately so adapter gaps are visible.
- Free-form blockers like `same_chain_unprofitable:need_$5_on_base` should preserve raw text and also expose normalized code `same_chain_unprofitable`.
- Tests must use fixture tick logs. Do not call a live `run-strategy-tick` command as a reporting shortcut because it can build broadcastable intents in a live environment.

Verification:

```bash
node --test test/report-strategy-tick-slice.test.mjs test/dashboard-live-slices.test.mjs test/dashboard-app.test.mjs
```

---

## Task 2: Receipt Distribution And Regime Breakdown

**Files:**
- Create: `src/strategy/strategy-receipt-distribution.mjs`
- Create: `src/cli/report-strategy-receipt-distribution.mjs`
- Modify: `package.json`
- Modify: `src/status/current-dashboard-context.mjs`
- Test: `test/strategy-receipt-distribution.test.mjs`

- [ ] Write tests for 7d, 30d, 90d receipt counts by strategy and chain.
- [ ] Include realized PnL fields separately:

```js
{
  strategyId,
  chain,
  receiptCount7d,
  receiptCount30d,
  receiptCount90d,
  realizedNetPnlSats7d,
  realizedNetPnlSats30d,
  realizedNetPnlSats90d,
  sampleShare90d,
  concentrationWarning: sampleShare90d > 0.60,
}
```

- [ ] Add a regime dimension by injecting a pure `regimeForTimestamp()` dependency. Default to existing regime detector if available; tests should use a fixture function.
- [ ] Filter out dry-run, preview, normalization-error, and non-broadcast marker records. Only signer-backed confirmed or delivered records count as live evidence.
- [ ] Add dashboard summary fields:

```js
receiptDistribution: {
  topConcentratedStrategyId,
  concentrationWarningCount,
  receiptPoorStrategyCount,
  byRegime,
}
```

Expected bugs to prevent:
- A canary proof marker can look like a receipt but has no broadcast receipt. Do not count it as live realized evidence.
- Negative realized PnL must remain negative in distribution; only payback accumulator decides payback eligibility.
- Strategy id aliases must not split the same lane unless an explicit alias map says so.

Verification:

```bash
node --test test/strategy-receipt-distribution.test.mjs
npm run report:strategy-receipt-distribution -- --json
```

---

## Task 3: Receipt-Driven Chain Score Ledger

**Files:**
- Create: `src/config/chain-scoring.mjs`
- Create or extend: `src/config/gateway-destinations.mjs`
- Create: `src/strategy/chain-score-ledger.mjs`
- Modify: `src/strategy/scored-capital-allocation.mjs`
- Modify: `src/executor/capital/scored-target-balances.mjs`
- Test: `test/chain-score-ledger.test.mjs`
- Create test: `test/scored-capital-allocation.test.mjs`
- Test: `test/scored-target-balances.test.mjs`

- [ ] Write failing tests where Base has stale losing receipts and BSC has fresh positive receipts; BSC must receive the higher ledger score without any hardcoded chain preference.
- [ ] Implement config:

```js
export const CHAIN_SCORING_POLICY = Object.freeze({
  halfLifeHours: 168,
  priorScore: 0.5,
  minObservedSamplesForConfidentScore: 10,
  weights: Object.freeze({
    realizedNetBtc: 0.45,
    receiptFreshness: 0.25,
    routeAvailability: 0.15,
    costEfficiency: 0.15,
  }),
});
```

- [ ] Build ledger output:

```js
{
  chain,
  chainScore,
  scoreSource: "ledger" | "prior",
  widePosterior,
  observedAt,
  sampleCount,
  realizedNetPnlSats7d,
  receiptFreshnessHours,
  p90RoundTripUsd,
  decayFactor,
  auditIntegrityStatus: "ok" | "unknown" | "failed",
  evidenceClassBreakdown: {
    strategyRealizedPnlCount,
    executionEvidenceCostCount,
    failedReceiptCount,
  },
  blockers: ["chain_score_unobserved"]
}
```

- [ ] Add one exported canonical chain helper:

```js
canonicalGatewayChain("BNB Chain") === "bsc"
canonicalGatewayChain("berachain") === "bera"
canonicalGatewayChain("avax") === "avalanche"
```

- [ ] Use the ledger in `scored-capital-allocation.mjs` while preserving a conservative static prior fallback.
- [ ] Add optional `chainScoreLedger` input to `buildScoredTargetBalances()`. Output per-strategy rows must include `chainScore`, `chainScoreSource`, `widePosterior`, and `chainScoreBlockers`.
- [ ] Score only finality-safe evidence:
  - tx hash present
  - signer-backed source
  - receipt status known
  - reconciliation status is `reconciled` or final `failed`
  - confirmation/finality depth meets chain policy
  - execution mode is not dry-run, preview, or marker-only
- [ ] Split scoring terms:
  - alpha/return term uses only `strategy_realized_pnl`
  - reliability/cost term may use `execution_evidence_cost`
  - failed/reverted receipts reduce reliability and cost efficiency
- [ ] Add Bayesian shrinkage and rate limits:
  - shrink sparse observed scores toward `priorScore`
  - clamp score movement per day
  - penalize high variance and high failed-receipt rates
- [ ] Do not let ledger score override caps, diversification ceilings, kill-switch, inventory, or signer policy.

Expected bugs to prevent:
- Sample count can dominate too early. Use prior score with `widePosterior=true` until the sample threshold clears.
- Chain aliases (`bnb`/`bsc`, `avax`/`avalanche`, `berachain`/`bera`) can split evidence. Normalize through the Gateway destination chain ids before scoring.
- A chain with no receipts must not be interpreted as bad; it is unknown and should receive exploration, not full exploit allocation.
- Evidence-cost canaries are useful for reliability and cost but must not be misclassified as profitable alpha.

Verification:

```bash
node --test test/chain-score-ledger.test.mjs test/scored-capital-allocation.test.mjs test/scored-target-balances.test.mjs
```

---

## Task 4: Non-Primary EV Policy Uses Shared P90 Costs

**Files:**
- Create: `src/strategy/non-primary-entry-policy.mjs`
- Modify: `src/config/sizing.mjs`
- Modify: `src/config/sleeve-profile.mjs`
- Modify: `src/strategy/strategy-execution-surfaces.mjs`
- Test: `test/non-primary-entry-policy.test.mjs`
- Test: `test/strategy-execution-surfaces.test.mjs`

- [ ] Write tests proving the old fixed `$10 or 5%` floor no longer blocks a tiny canary when p90 measured cost and uncertainty show positive EV.
- [ ] Keep the old profile values as legacy fields only if needed for migration; do not let them be runtime blockers.
- [ ] Implement:

```js
requiredEdgeUsd =
  p90RoundTripCostUsd
  + uncertaintyPenaltyUsd
  + rungAwareEdgeFloorUsd
```

- [ ] Compute `rungAwareEdgeFloorUsd` from committed sizing policy:

```js
rungAwareEdgeFloorUsd =
  candidate.rung === "probe" || candidate.rung === "tiny"
    ? Math.max(chainDustFloorUsd, notionalUsd * minEdgeBps)
    : Math.max(pilotOrOperatingFloorUsd, notionalUsd * minEdgeBps)
```

- [ ] Use `buildRadarCostLedger()` and existing tiny-canary sizing helpers instead of duplicating cost logic.
- [ ] Report both raw and normalized blockers:

```js
{
  code: "non_primary_ev_below_required_edge",
  expectedNetEvUsd,
  requiredEdgeUsd,
  p90RoundTripCostUsd,
  uncertaintyPenaltyUsd,
}
```

Expected bugs to prevent:
- Reward-token claim/swap costs apply only when an explicit reward token exists.
- Same-chain share-price/native-yield canaries should count deposit/withdraw gas, not fake reward exit costs.
- Generic min-position floors must not override committed tiny-canary ladder rungs.
- A fixed dollar floor must not silently reintroduce the exact tiny-canary blocker this task removes.

Verification:

```bash
node --test test/non-primary-entry-policy.test.mjs test/strategy-execution-surfaces.test.mjs
```

---

## Task 5: Chain Hypothesis Expiry, Not Payback Reserve Drift

**Files:**
- Create: `src/config/chain-hypothesis.mjs`
- Create: `src/strategy/chain-hypothesis-evaluator.mjs`
- Create: `src/cli/report-chain-hypothesis.mjs`
- Modify: `package.json`
- Modify: `src/status/current-dashboard-context.mjs`
- Test: `test/chain-hypothesis.test.mjs`

- [ ] Model two separate concepts:

```js
strategyPrimaryHypothesis: "chain used for allocation preference",
paybackReserveProof: "chain proven for profit reserve -> BOB L2 -> Bitcoin L1"
```

- [ ] Keep Base as the current payback reserve proof until another chain has committed proof. Do not auto-switch reserve chain.
- [ ] Add expiry and renewal candidate output:

```js
{
  chain: "base",
  role: "strategy_primary_reference",
  assertedAt: "2026-04-27T00:00:00.000Z",
  expiresAt,
  status: "fresh" | "expires_soon" | "expired",
  daysUntilExpiry,
  autoRenewCandidate,
  committedDiffRequired: true
}
```

- [ ] Add dashboard summary for expired hypotheses and reserve-proof gaps.
- [ ] When a strategy-primary hypothesis expires, remove only score boosts and evidence-primary cap-share overrides inside allocator target calculation until renewal. Do not edit strategy caps and do not block deterministic live policy for a cap-valid strategy.

Expected bugs to prevent:
- Expired hypothesis is advisory/reporting only; it must not block a cap-valid `autoExecute` strategy outside deterministic policy.
- "Advisory only" must not mean stale primary-chain boosts remain active forever.
- Payback reserve proof failure must pause payback reserve use, not global strategy discovery.
- Renewal candidate output must not edit config automatically.

Verification:

```bash
node --test test/chain-hypothesis.test.mjs
npm run report:chain-hypothesis -- --json
```

---

## Task 6: Explore And Exploit Budget Split

**Files:**
- Create: `src/config/capital-allocator.mjs`
- Modify: `src/executor/capital/scored-target-balances.mjs`
- Modify: `src/cli/report-destination-allocation-plan.mjs`
- Test: `test/scored-target-balances.test.mjs`
- Test: `test/destination-allocation-distribution.test.mjs`

- [ ] Add config:

```js
export const CAPITAL_ALLOCATOR_POLICY = Object.freeze({
  exploitSharePct: 0.75,
  exploreSharePct: 0.25,
  exploreCandidateMaxUsd: 25,
  exploreMaxConcurrent: 4,
  exploreCooldownHours: 24,
  smallCapitalMicroTestHardCapPct: 0.10,
});
```

- [ ] Split allocation result:

```js
summary: {
  exploitAllocationUsd,
  exploreAllocationUsd,
  exploreCandidateCount,
  priorScoreCandidateCount,
}
perStrategy[].allocationBucket = "exploit" | "explore"
```

- [ ] Exploration eligibility: `sampleCount < 30`, `receiptFreshnessHours > 168`, or `scoreSource === "prior"`.
- [ ] Clamp every explore allocation by existing strategy caps, per-chain caps, daily caps, `exploreCandidateMaxUsd`, small-cap micro-test budget, radar lane caps, per-campaign caps, and per-unproven-protocol caps.
- [ ] Ensure exploit allocation cannot starve all official Gateway destinations forever; unknown destinations get small samples when policy and inventory allow.

Expected bugs to prevent:
- Explore budget must not bypass inventory. If the wallet lacks source inventory or gas float, show `explore_blocked_inventory_absent`.
- Explore budget is not a cap raise. It only routes within committed caps.
- Per-chain diversification scaling must run after the exploit/explore split so both buckets respect final ceilings.
- Unknown protocol exploration must remain inside the stricter small-cap micro-test and unproven-protocol caps, even if the global explore share has room.

Verification:

```bash
node --test test/scored-target-balances.test.mjs test/destination-allocation-distribution.test.mjs
npm run report:destination-allocation-plan -- --json
```

---

## Task 7: Live Asset Tracking Accuracy

**Files:**
- Modify: `src/cli/report-wallet-holdings-slice.mjs`
- Modify: `src/status/protocol-position-marks-slice.mjs`
- Modify: `src/status/capital-summary-slice.mjs`
- Modify: `src/status/current-dashboard-context.mjs`
- Modify: `dashboard/public/data.jsx`
- Modify: `dashboard/public/app.jsx`
- Test: `test/report-wallet-holdings-slice.test.mjs`
- Test: `test/protocol-position-marks-slice.test.mjs`
- Test: `test/dashboard-live-server.test.mjs`
- Test: `test/dashboard-live-slices.test.mjs`
- Test: `test/dashboard-app.test.mjs`

- [ ] Add item-level freshness and source fields to wallet holdings:

```js
{
  sym,
  chain,
  family: "native" | "token" | "protocol",
  usd,
  source: "whole_wallet_inventory" | "protocol_position_mark",
  sourceObservedAt,
  priceSource,
  priceObservedAt,
  priceFreshness,
  priceDivergenceStatus,
  freshness,
  confidence,
  countedInWalletTotal,
}
```

- [ ] Add totals that cannot double count:

```js
totals: {
  freeWalletUsd,
  protocolUsd,
  staleProtocolUsd,
  unknownUsd,
  reconciledTotalUsd,
}
```

- [ ] Add dashboard warnings:

```js
assetTracking: {
  staleItemCount,
  stalePriceItemCount,
  failedProtocolMarkCount,
  doubleCountPreventedCount,
  unknownAssetBalanceCount,
  oldestMaterialSourceObservedAt,
  coverage: "full_external" | "full_rpc" | "partial_supported" | "pending",
}
```

- [ ] Ensure dashboard UI shows stale/failed state without hiding the asset row.
- [ ] Preserve mobile-first layout and prevent row text overflow.
- [ ] Add tests for protocol-reader-covered share token not being counted twice, stale marks staying visible, and external provider scan errors not hiding supported wallet totals.

Expected bugs to prevent:
- `protocolPositions` can be included in inventory and protocol marks; de-duplicate by `positionId`, not by symbol.
- A stale mark with value should contribute to `staleProtocolUsd`, not to `verified` current value.
- External unclassified balances must remain visible as unknown/review, but must not auto-whitelist tokens.
- Stale or divergent price data must not produce a green asset-tracking verdict.
- Generated dashboard JSON can be re-dirtied by background live writers. Treat this as runtime output, not source drift.

Verification:

```bash
node --test test/report-wallet-holdings-slice.test.mjs test/protocol-position-marks-slice.test.mjs test/dashboard-live-slices.test.mjs test/dashboard-live-server.test.mjs test/dashboard-app.test.mjs
npm run dashboard:build
```

---

## Task 8: Runtime Observe And Dashboard Proof

**Files:**
- Read-only unless snapshots are intentionally refreshed.
- Dashboard generated JSON may change during this task.

- [ ] Run source checks:

```bash
npm run check
npm test
git diff --check
```

- [ ] Run live-readiness reports without forcing a trade:

```bash
npm run report:strategy-execution-surfaces -- --json
npm run report:destination-allocation-plan -- --json
npm run report:strategy-receipt-distribution -- --json
npm run report:chain-hypothesis -- --json
npm run report:payback-status -- --json
```

- [ ] Refresh dashboard slices intentionally:

```bash
npm run status:protocol-position-marks -- --write
npm run report:wallet-holdings-slice -- --json --write
npm run report:strategy-tick-slice -- --json
npm run status:dashboard
```

- [ ] Verify the refreshed dashboard JSON has:
  - `walletHoldings.pending === false` or an explicit pending reason.
  - `capitalSummary.currentTotalUsd` matches wallet/protocol totals within rounding.
  - `strategy.protocolPositionMarks.confidence` is visible.
  - `strategyTickStatus.schemaVersion === 3`.
  - deny reason counts exist for every tracked strategy.
  - chain score source is visible for allocated strategies.
  - `oldestMaterialSourceObservedAt` is not stale for a green verdict.
  - unknown/unclassified balances are visible but excluded from deployable capital.

- [ ] If a dashboard dev server is used, verify browser rendering and no visual overlap on desktop and mobile. Capture this only after source tests pass.

Expected bugs to prevent:
- Running `run-strategy-tick.mjs` can generate broadcastable intents if signer and inventory are live. Do not use it as a casual report command in verification.
- `status:dashboard` may rewrite tracked public JSON. Review generated changes separately from source changes.
- Dashboard can show stale generated data as fresh if `generatedAt` is refreshed while underlying inventory is old. Surface both `generatedAt` and `sourceObservedAt`.

---

## Task 9: Documentation And Final Safety Review

**Files:**
- Modify: `docs/system-map.md`
- Modify: `docs/harness-engineering.md`
- Modify: `docs/dashboard-context.md`
- Optional create: `docs/research/chain-agnostic-aggressive-allocator.md`

- [ ] Document the new scoring source, hypothesis expiry, explore/exploit allocation, and dashboard asset-tracking fields.
- [ ] State explicitly that payback reserve proof is separate from strategy primary selection.
- [ ] Add safety review notes:
  - no key values in logs or dashboard
  - no cap raise
  - no runtime `autoExecute` mutation
  - no signer bypass
  - no kill-switch bypass
  - no payback ratio/timing mutation
- [ ] Run targeted suites again after docs/source finalization.
- [ ] Inspect `git diff --stat` and `git diff --check`.
- [ ] Commit only source, tests, docs, and intentionally refreshed dashboard snapshots if publishing is requested.

---

## Final Acceptance Protocol

Run:

```bash
node --test \
  test/report-strategy-tick-slice.test.mjs \
  test/strategy-receipt-distribution.test.mjs \
  test/chain-score-ledger.test.mjs \
  test/scored-capital-allocation.test.mjs \
  test/scored-target-balances.test.mjs \
  test/non-primary-entry-policy.test.mjs \
  test/chain-hypothesis.test.mjs \
  test/report-wallet-holdings-slice.test.mjs \
  test/protocol-position-marks-slice.test.mjs \
  test/dashboard-live-slices.test.mjs \
  test/dashboard-live-server.test.mjs \
  test/dashboard-app.test.mjs
npm run dashboard:build
npm run check
npm test
git diff --check
```

Then run operational reports:

```bash
npm run report:strategy-execution-surfaces -- --json
npm run report:destination-allocation-plan -- --json
npm run report:strategy-receipt-distribution -- --json
npm run report:chain-hypothesis -- --json
npm run report:payback-status -- --json
npm run status:dashboard
```

The closeout report must include:

- 현재 단계
- 이번에 한 일
- 왜 아직 그 단계인지
- 남은 blocker와 deny reason top 5
- dashboard asset-tracking verdict: green, yellow, or red
- whether generated dashboard snapshots were intentionally refreshed

---

## Self-Review Checklist

- [ ] Did this add a new lane? It should not.
- [ ] Did this make Base less privileged for strategy allocation while keeping proven payback reserve logic safe?
- [ ] Are unknown chains explored conservatively instead of treated as permanently bad?
- [ ] Can the dashboard answer both "what assets do we own?" and "why did no trade happen?"
- [ ] Are stale protocol marks visible instead of hidden?
- [ ] Are generated dashboard artifacts separated from source edits?
- [ ] Do all capital movements still pass existing policy and signer gates?
- [ ] Is every score and allocation source machine-readable?

---

## Implementation Loophole Audit Log

Loop 1 closed the planned source, test, dashboard, and report surfaces without
changing signer custody, kill-switch, cap registry values, `autoExecute`, or
payback policy. Loop 2 re-audited the implementation against signer-audit
fixtures and live report callers, then closed these additional loopholes:

| Loophole | Root Cause | Risk | Fix |
| --- | --- | --- | --- |
| signer audit receipts ignored or misgrouped | receipt distribution required `source: "signer"` even though signer audit rows are signer-shaped without that field; chain aliases were not canonicalized | live receipts could look absent or split between `bnb`/`bsc`, hiding evidence gaps | infer signer-backed rows from audit schema, canonicalize Gateway chains, and count autoExecute strategies with no reconciled receipt |
| unreconciled tx hashes counted as evidence | receipt and chain-score filters accepted terminal status when reconciliation metadata was absent | chain scores could mature before final reconciliation | require `reconciliationStatus: "reconciled"` for confirmed/delivered rows and `final_failed` for failed/reverted rows |
| cost canaries treated like alpha | chain scoring used total samples for posterior shrink | evidence-cost probes could make a chain look statistically mature | add `alphaSampleCount`; cost-only records never count as realized PnL or confidence samples |
| route/exit proof omitted from score confidence | ledger score did not require current route, exit-liquidity, or reward conversion proof | profitable-looking chains could move out of explore without unwind proof | keep `widePosterior` and blockers until route availability, exit liquidity, and reward conversion proof exist |
| destination allocation bypassed receipt ledger | planner and bootstrap callers used promotion/static scores without the new chain ledger | stale promotion evidence could still drive allocations | build/pass chain score ledgers in bootstrap, Merkl allocator/exit, destination allocation, and strategy tick callers |
| explore caps not enforced in all allocators | `buildScoredAllocation()` used by `run-strategy-tick` lacked explore bucket caps | a wide-posterior chain could receive an oversized allocation if execution mode was enabled | add explore/exploit bucket metadata and clamp wide-posterior/prior candidates by small-cap micro-test, campaign, radar, and unproven-protocol caps |
| report tick could broadcast or hide no-broadcast evidence | `run-strategy-tick` broadcast by default and wrote tick JSONL before adding broadcast metadata | a report run could become live, or dashboard evidence could miss why no broadcast happened | make the tick report-only unless `--execute`; persist `executionMode` and `broadcastSummary` after broadcast decision |
| sensitive intent details in dashboard logs | dispatch detail copied arbitrary objects into summaries | raw tx/calldata/signature-like values could leak into dashboard JSON | sanitize dispatch detail to safe scalar key/value summaries with sensitive fields redacted |
