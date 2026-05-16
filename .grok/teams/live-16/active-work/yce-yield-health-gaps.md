# YCE Yield Health Gaps — Self-Healing & Health Monitoring for defillama-yield-portfolio

**Date**: 2026-05-17  
**Owner**: Resilience & Self-Healing Engineer (Risk, Safety & Resilience Domain Lead)  
**Status**: First output from new specialist role (B Model activation)  
**Related**: 
- .grok/teams/live-16/roles/Resilience-and-Self-Healing-Engineer.md (read first)
- .grok/teams/live-16/protocol.md (read first)
- .grok/teams/live-16/active-work/defillama-receipt-validation.md (read first, YCE-002 proven: yieldProof + entryExitProven + YIELD_KINDS)
- .grok/teams/live-16/active-work/defillama-yield-lane-revival.md (YCE-001/002/003 context)
- src/executor/health/{position-bleed-detector.mjs, position-action-engine.mjs, operator-absence-engine.mjs, dead-strategy-detector.mjs, self-healing-rebuild.mjs, position-monitor-loop.mjs, position-reconciler.mjs}
- src/executor/watchdog/{watchdog-loop.mjs, heartbeat.mjs}
- src/strategy/defillama-yield-adapter.mjs (evaluate, receiptEvidence, liveReady, apyBps, tvlUsd, evidenceClass=protocol_receipt_bound)
- src/ledger/receipt-reconciliation.mjs (pairDefiLlamaYieldEntryExit → rich yieldProof with entryApy/entryTvlUsd/exitApy/exitTvlUsd/holdingPeriodHours/realizedNetUsd/entryExitProven)
- src/executor/ingestor/execution-receipt-ingest.mjs (yieldContext for defillama_yield_* kinds)
- Evidence: grep across src/executor/health/ + watchdog/ (only 1 tvlDrainRatio ref + 1 comment; 0 yield/defillama/apy/ reward references), grep for aprDecayRatio/tvlDrainRatio (defined in engine only, never populated on any position object), position-reconciler (aaveV3 reader limited to balance, no APY/sharePrice accrual/TVL/rewards; no Beefy/generic), position-monitor-loop (only calls planActions; bleed detector + dead-strategy + absence never auto-wired for yield), policy files (no defillama-yield-portfolio specific positionActionPolicy or yieldHealth thresholds)

**Evidence-Complete Confidence**: All required reads completed before analysis. Codebase sweeps (grep + list_dir + targeted reads of 9 health/watchdog files + adapter + receipt + catalog + reconciler) confirm zero yield-specific health paths for the new lane. No assumptions; all gaps are direct absences of code paths, fields, and wiring.

---

## 1. Specific Gaps in Current Health Engines for defillama-yield-portfolio Positions

Yield positions (Aave-v3 / Beefy / Moonwell / ERC4626 receipt_bound pools on Gateway chains) introduce novel failure modes not covered by existing engines (APY decay, TVL erosion of underlying pool, reward claim failures or unclaimable accrual, pool deprecation/paused status, share-price accrual reversal on open holdings). Current engines are lending/CL/expiry/campaign/gas-bleed oriented.

### position-bleed-detector.mjs
- **Only** computes `if (cumulativeGasUsd > realizedYieldUsd * bleedToYieldRatio) → exit "position_bleed"`.
- Ignores yield-native bleed: opportunity cost of APY collapse (e.g. entry 5% → current 1%), TVL drain reducing liquidity/exit quality, unclaimed rewards losing value, negative net accrual from fees/gas on small positions.
- `realizedYieldUsd` source undefined for open yield positions (only post-exit from receipt pair).
- **Not wired anywhere** (0 imports/callers outside its own file + graphify cache). position-monitor-loop only does planActions.
- No "yield_bleed" variant using projected opportunity cost from snapshot APY.

### position-action-engine.mjs (evaluatePosition + planActions)
- Supports `aprDecayRatio > maxAprDecayRatio → unwind "campaign_decay"` and `tvlDrainRatio > maxTvlDrainRatio → pause "tvl_drain"`.
- These fields **never populated** on position objects (grep: only references are the if-checks themselves; no writer in portfolio snapshot, realtime-portfolio, protocol-position-ledger, or yield adapter).
- No yield equivalents: `apyDecayRatio` (currentNetApyBps / entryApyBps from yieldProof), `poolTvlChangeRatio`, `rewardAccrualStaleHours`, `sharePriceAccrualReversal`.
- Ignores `strategyId === "defillama-yield-portfolio"`. HF/expiry/timeInRange checks are irrelevant (yield supply has no HF or expiry).
- Policies come from `policiesByStrategy` (default {} in monitor-loop; no entry for yield strategy in small-capital-campaign-mode.mjs or strategy-caps/registry).

### operator-absence-engine.mjs
- Global only: heartbeatStale, harvestStale (generic), paybackStale, signerAudit.
- No per-yield-position or per-pool "reward_harvest_stale" (last defillama_yield_reward_claim receipt age per poolId > policy).
- No "yield_snapshot_stale" (DefiLlama fetch age for active poolIds in open positions).
- Absence state feeds self-healing but not position-level protective intents for yield degradation.

### watchdog/* (watchdog-loop, heartbeat, feed-freshness)
- Solely executor heartbeat TTL → kill-switch halt ("watchdog_heartbeat_stale").
- feed-freshness comment mentions "liquidity_tvl" but no implementation for yield pool TVL/APY freshness.
- No degradation of yield health signals → soft halt or protective descriptor emission.

### dead-strategy-detector.mjs
- Only: incidentFeed protocols OR any "position_bleed" exit action → "dead_strategy" pause.
- Incident feed is manual/static file; no auto-ingest of DefiLlama "pool removed" or "project paused" or Aave/Beefy deprecation events.
- No yield-specific: "pool_deprecated" if snapshot no longer returns the poolId that has open position + yieldProof.

### self-healing-rebuild.mjs + run-self-healing-check.mjs
- Only triggers on operator "absent": restart_signer_daemon, replay_audit_logs, rebuild_dashboard_slices, emit_alert.
- Zero yield-specific steps: e.g. "reconcile_yield_receipts_with_latest_snapshot", "refresh_defillama_pool_metadata_for_open_positions", "force_reward_claim_if_accrued_exceeds_threshold", "rebuild_yield_position_marks_from_aaveV3_reader + yieldProof baseline".

### position-reconciler.mjs + realtime-portfolio + protocol-position-ledger
- aaveV3 reader: only balanceOf + decimals + underlying (no exchangeRate, no current APY from on-chain or snapshot join, no TVL of pool, no accrued rewards).
- No Beefy vault reader, no generic ERC4626 yield reader, no DefiLlama snapshot join for currentApy/currentTvl per poolId of open positions.
- Positions passed to health lack `yieldProof`, `entryApyBps`, `entryTvlUsd`, `entrySharePrice`, `holdingPeriodHours`, `accruedRewardsUsd`.
- No continuous "position_marked" with yield health metrics for defillama-yield-portfolio.

### Overall Wiring & Policy Gaps
- position-monitor-loop.mjs runOnce only calls planActions (no bleed, no dead-strategy, no yield custom).
- No defillama-yield-portfolio entry in any positionActionPolicy or campaignEntry thresholds (aprDecayExitPct etc. exist only for Merkl/campaign in small-capital-campaign-mode).
- yieldProof (new from YCE-002) and entryExitProven are consumed only in adapter for liveReady gate and receiptEvidence; never fed forward as health baseline for open positions.
- No protective intent surfaces specific to yield (e.g. "yield_position_unwind", "yield_reward_claim_required").

---

## 2. Concrete New Protective Descriptors or Self-Heal Intents (Yield-Specific)

These should be emitted as action descriptors (same shape as position-action-engine: {type: "exit"|"unwind"|"pause"|"review", strategyId, positionId/poolId, reasonCode, reason, priority, estimated*Usd, dedupeKey}) and consumed by policy engine / Capital rebalancer / dashboard.

**Examples (ready for implementation in new yield-health-detector.mjs or extension of evaluatePosition)**:

- **APY decay**: `if (currentApyBps / entryApyBps < 0.5 && holdingPeriodHours > 24 && consecutiveTicks >= 2) → { type: "unwind", reasonCode: "yield_apy_decay_50pct", reason: "current APY 1.2% < 50% of entry 2.8% (yieldProof.entryApy) for 2 periods" }`
- **TVL drop (pool health)**: `if (currentTvlUsd / entryTvlUsd < 0.7) → { type: "pause", reasonCode: "yield_pool_tvl_drain_30pct", reason: "pool TVL $180M < 70% of entry $260M (yieldProof.entryTvlUsd)" }` (also feeds maxPoolSharePct re-check).
- **Negative realized / accrual reversal** (per task example): `if (realizedNetUsd < 0 || projectedRealizedFromSharePrice < -thresholdUsd) for X=3 periods → { type: "pause", reasonCode: "negative_yield_accrual", reason: "realizedNetUsd -1.23 on open position (from yieldProof baseline + current reader sharePrice); holding 48h" }`
- **Reward claim failure / stale**:
  - Track YIELD_KINDS "defillama_yield_reward_claim" receipts per poolId (via loadYieldReceiptEvidence extension).
  - `if (accruedRewardsUsd > 5 && lastClaimAgeHours > 168 && recentClaimFailures >= 2) → { type: "review", reasonCode: "reward_claim_stale_failing", reason: "accrued $12.4 unclaimed >7d; 3 failed claim attempts in ledger" }`
- **Pool deprecation / paused**:
  - `if (!currentSnapshotHasPool(poolId) || pool.paused || incidentFeed.includes(protocol)) → { type: "exit", reasonCode: "pool_deprecated_or_paused", reason: "aave-v3 pool f981a3... no longer in DefiLlama snapshot or marked paused" }` (auto via dead-strategy or new detector).
- **Snapshot staleness for active yield positions**: `if (defillamaSnapshotAgeMs > 3600_000 for any poolId with open yieldProof) → self-heal intent "refetch_defillama_snapshot" + re-evaluate`.
- **Generalized bleed for yield**: extend bleed-detector to `opportunityCostUsd = (entryApyBps - currentApyBps)/10000 * principal * days + unclaimedDecay + gas` → if > realized * ratio → "yield_opportunity_bleed".

**Self-heal intents** (in runSelfHealing or new yield healer):
- On "yield_position_health_degraded" → "re-pair_partial_yieldProof_with_fresh_snapshot" (extend pairDefiLlamaYieldEntryExit for open positions).
- On "reward_claim_stale" → "schedule_reward_claim_intent" (via Execution & Policy).
- On absence + yield positions open → "pause_all_yield_strategies" + "emit_yield_health_snapshot".

All must emit append-only audit + update `data/health/position-actions-latest.json` + dashboard.

---

## 3. How the New `yieldProof` + `entryExitProven` Can Be Used as Health Signals

From defillama-receipt-validation.md (proven on real aave-v3 USDT ethereum pool f981a304-bb6c-45b8-b0c5-fd2f515ad23a):

- **Partial (open position)**: pair returns `yieldProof: {poolId, protocol:"aave-v3", chain, strategyId:"defillama-yield-portfolio", entryTxHash, entrySharePrice:1.0005, entryAssetsUsd:100.25, entryApy, entryTvlUsd, entryExitProven:false, realizedNetUsd:null, rewardClaimTxHashes:[], source:"reconciliation_pair", observedAt, ...}` + top-level entryExitProven:false.
- **Full (post-exit)**: adds exit*, realizedNetUsd:0.77, realizedYieldBps, entryExitProven:true.

**Usage as health signals (Evidence-first, consume evidenceClass + sourceObservedAt + freshness)**:

1. **Baseline attachment**: In protocol-position-ledger / realtime snapshot for defillama-yield positions, join the latest partial yieldProof (by poolId/strategyId from receipt-reconciliations.jsonl) onto the position object. Health engines now have `position.yieldProof.entryApyBps`, `position.yieldProof.entryTvlUsd`, `position.yieldProof.entrySharePrice`.

2. **Ongoing accrual health** (open position, entryExitProven=false): Use on-chain reader (extend aaveV3 to return current share/exchangeRate or use DefiLlama current apyBps/tvlUsd by poolId) to compute `currentRealizedNetUsd = (currentSharePrice / entrySharePrice * entryAssetsUsd) - entryAssetsUsd - cumulativeGas - unclaimedDecay`. If negative or decay > threshold over holdingPeriodHours (from yieldProof) → "negative_yield_accrual" or "yield_apy_decay" protective descriptor. Downgrade confidence if snapshot freshness low.

3. **Roundtrip validation as health score**: On exit (entryExitProven=true), the full yieldProof.realizedNetUsd + realizedYieldBps becomes post-facto health metric. If <0 → "lossy_yield_exit" review (even if proven). Feed into dead-strategy or future "yield_quality_score" for future candidate selection in adapter.

4. **Trend / multi-pair**: Multiple yieldProofs for same poolId (repeated canaries) → compute decay slope (entryApy → exitApy trend) for strategy-level health. If slope negative → pause new entries for that protocol/pool family.

5. **EvidenceClass leverage**: Only `protocol_receipt_bound` pools (YCE-001) have yieldProof at all. Health can require `position.evidenceClass === "protocol_receipt_bound" && position.yieldProof` before applying any auto-action; otherwise "review" (low confidence). New health evidenceClass values: "yield_healthy_accrual", "yield_bleed_detected", "yield_deprecated", "self_healed_yield_position" (after successful claim or re-pair) — to be co-defined with Evidence, Data & Quality Domain Lead + Protocol Reader.

6. **Integration points**:
   - receiptEvidence() in adapter already counts entryExitProvenCount + realizedNetUsd sum — extend to health: "proven_healthy_positions_count".
   - In position-action evaluate: add branch `if (position.strategyId === "defillama-yield-portfolio" && position.yieldProof) { checkYieldHealth(position.yieldProof, currentSnapshotPool) }`.
   - Self-heal: on degraded yieldProof signal → "reconcile_yield_receipts" step (re-run loadYieldReceiptEvidence + pair on fresh ledger).

This turns the YCE-002 receipt artifact from "liveReady gate only" into continuous health monitor baseline — exactly the missing link for safe tiny canary → shadow → live ramp without constant operator intervention.

---

## 4. Immediate Next Steps (for Domain Lead Coordination)

**Direct address**:
- "Evidence, Data & Quality Domain Lead + Protocol Reader & On-chain Data Engineer + Yield & Campaign Opportunity Engineer: extend yieldProof partials to open positions, add currentApy/currentTvl fields from snapshot join, define new evidenceClass for health states. Fork this gaps doc."
- "Execution & Policy Domain Lead: add yield-specific protective descriptors to policy engine surfaces; define positionActionPolicy for defillama-yield-portfolio (e.g. maxApyDecayRatio: 0.5, maxTvlDrainRatio: 0.3)."
- "Capital & Treasury Domain Lead + Allocation & Rebalancing Specialist: wire yield health actions into rebalance signals (pause yield sleeve on tvl_drain)."
- "Risk, Safety & Resilience Domain Lead: approve thresholds + review new yield-health-detector.mjs + wiring to position-monitor-loop + run-self-healing-check."

**Recommended artifacts** (to be created by this role + peers):
- src/executor/health/yield-position-health-detector.mjs (new, consumes yieldProof + snapshot)
- Update position-monitor-loop to include evaluatePositionBleed + new yield detector for yield strategyIds.
- Policy defaults in config/ for yield health.
- Test: synthetic yield position + partial yieldProof + current metrics → expected actions.

All changes keep kill-switch + policy engine as ultimate backstops. No LLM. Evidence-first. Append-only logs.

**Artifact location**: `/Users/love/BOB Claw/.grok/teams/live-16/active-work/yce-yield-health-gaps.md`

This completes the first output from the Resilience & Self-Healing Engineer. Ready for Live Sync Call or handoff per protocol.md.

— Resilience & Self-Healing Engineer
(Executed in Execution Mode, 16-team B Model pilot, after reading role + protocol + receipt validation first)
