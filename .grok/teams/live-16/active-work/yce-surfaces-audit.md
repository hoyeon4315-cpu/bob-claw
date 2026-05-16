# YCE Surface Audit & Stale Hardcode Elimination

**Auditor**: Codebase Auditor & YCE Integrator (B-Model 16-Person Live Team, parallel independent stream)  
**Date**: 2026-05-17 (post YCE-001/002/003 execution)  
**Scope**: Full codebase search (src/, docs/, dashboard/, .grok/teams/live-16/, data/, tests/) for references to `defillama-yield-portfolio`, `defillama yield`, strategy catalogs/families, `shadow_ready`/`shadowReady` promotion, `evidenceClass`, and any hard-coded strategy name lists/conditions that could exclude the DefiLlama yield lane.  
**Protocol Compliance**: AGENTS.md + harness-engineering.md + skill-usage-guidelines.md + system-map.md + protocol.md + active-work/defillama-yield-lane-revival.md read first (mandatory before strategy/dashboard surfaces work). Diagnostics executed (`node src/cli/check-full-automation-readiness.mjs --json` raw output captured below). No Gateway surfaces touched. Execution Mode, artifact-first, evidence-complete. No code changes needed (YCE-003 already complete and clean).  
**Goal**: Confirm `defillama-yield-portfolio` (with `evidenceClass` from snapshot + `getDefiLlamaPoolEvidenceClass` + receiptEvidence) is treated as first-class citizen everywhere; eliminate any remaining stale hardcodes; produce this audit artifact.

## Executive Summary
- **YCE-003 fully effective**: `strategy-catalog.mjs` and `strategy-execution-surfaces.mjs` use dynamic `evaluateDefiLlamaYieldAdapter` + snapshot (`defillama-yield-latest.json`) + `evidenceClass==="protocol_receipt_bound"` + receipt stats to promote to `status: "shadow_ready"`, `selectedMode: "shadow"`, `reason: "receipt_bound_pools_via_snapshot_evidenceClass"`. Hard-coded `analysis_only` / `liveCapable:false` removed (see code at catalog L333-408 + L497-521, surfaces L1083-1117).
- **No stale hardcodes found** in core strategy surfaces, dispatch, selectors, reports, or receipt paths. All consumers route through the dynamic catalog/surfaces.
- **26+ files** reference the lane positively; all treat it via evidence-driven promotion (shadow phase, perTradeCap=0 intentional).
- **Evidence from live diagnostic** (readiness check raw): defillama now appears as `"status": "shadow_ready"`, `"selectedMode": "shadow"`, `"reason": "receipt_bound_pools_via_snapshot_evidenceClass"`.
- **Remaining gaps**: Only pre-YCE docs (e.g. older current-status.md), generated data lag, and live execution blockers (shadow_only + live_executor_not_bound — expected until more YCE-002 proofs + Capital review). No source code fixes required.
- **Flow verified**: snapshot (evidenceClass) → adapter (normalize/assess/evaluate with RECEIPT_BOUND_PROJECTS) → catalog (dynamic defiStatus + preserve logic) → surfaces (dynamic case) → all-source-deployment-selector / candidate-builder / run-strategy-tick / dashboard slices / reports / 16-team roles.

## Files Audited (Complete List from Grep + Exploration)
**Core Strategy Surfaces (YCE-003 owners)**:
- src/strategy/strategy-catalog.mjs (dynamic defi logic + entry + preserve)
- src/strategy/strategy-execution-surfaces.mjs (defi case dynamic, imports catalog)
- src/strategy/defillama-yield-adapter.mjs (RECEIPT_BOUND_PROJECTS, getDefiLlamaPoolEvidenceClass, evidenceClass wiring)

**Consumers of strategy-catalog / strategy-execution-surfaces (or indirect via catalog surfaces)**:
- src/strategy/run-strategy-tick.mjs (ADAPTERS map: `"defillama-yield-portfolio": { evaluate: ..., snapshotPrefixes: ["defillama-", "gateway-"] }`)
- src/strategy/all-source-deployment-selector.mjs (strategyId: "defillama-yield-portfolio" for defillama-sourced candidates, executorBinding logic)
- src/executor/dispatcher/candidate-builder.mjs (STRATEGY_ID_TO_FAMILY: `"defillama-yield-portfolio": "defillama"`)
- src/strategy/strategy-snapshot.mjs (analysis_only counts, status handling for lane)
- src/strategy/live-deployment-priorities.mjs (generic normalize to analysis_only fallback)
- src/strategy/capital-expansion-review.mjs (generic counts)
- src/strategy/phase3-strategy-validation.mjs, phase3-evidence-builder.mjs (evidence path for lane)
- src/ledger/receipt-reconciliation.mjs (YIELD_KINDS, loadYieldReceiptEvidence, pair helpers from YCE-002)
- src/executor/ingestor/execution-receipt-ingest.mjs (defillama_yield_* kinds emission)
- src/cli/fetch-defillama-snapshot.mjs (YCE-001 producer, writes defillama-yield-*.json)
- src/cli/report-campaign-aware-opportunities.mjs (fetchDefiLlama + build candidates)
- src/strategy/strategy-receipt-distribution.mjs (receipts for strategyId)
- src/strategy/destination-*.mjs, opportunity-ranker.mjs, top-k-rotator.mjs (APR fallback / rotation use)

**Dashboard / Status / Report Generators**:
- src/status/current-dashboard-context.mjs (generic; no hard-coded exclusion, consumes shared surfaces/catalog via dashboardStatus)
- src/status/dashboard-status.mjs, strategy-tick-slice.mjs, strategy-stage-slice.mjs, micro-canary-slice.mjs, live-yield-slice.mjs (pull catalog/surfaces)
- dashboard/public/dashboard-status.json (generated 2026-05-16, overall shadow ALLOWED)
- dashboard/public/strategy-tick-status.json (includes lane)
- data/strategy-execution-surfaces.json, data/strategy-snapshot.json, data/lane-reclassification.json (generated; defillama present with shadow_ready)

**Tests**:
- test/strategy/defillama-yield-adapter.test.mjs
- test/all-source-deployment-selector.test.mjs
- test/cli-executor-parse.test.mjs

**Docs & Research Boards**:
- docs/current-status.md (older 2026-05-07; pre-revival, no defillama-yield-portfolio mention — gap)
- docs/system-map.md, docs/harness-engineering.md, docs/skill-usage-guidelines.md, docs/dashboard-context.md (read; strategy lanes reference catalog/surfaces)
- docs/research/dia-defi-vaults-lending-2026-05-12.md and reviews/ (historical mentions)
- .grok/teams/live-16/active-work/defillama-yield-lane-revival.md (full YCE history, protocol)
- .grok/teams/live-16/protocol.md, roles/*.md (Opportunity Lead, Evidence Lead, Receipt Engineer, Signer..., Allocation..., Resilience... — all updated with YCE-001/002/003 + defillama-yield-portfolio as pilot)
- .grok/teams/live-16/templates/*.md, README.md, 16-team-manager.md (references)
- docs/team/live-16/ (mirror)

**Data / Logs / Generated**:
- data/lane-reclassification.json (defillama entry with status shadow_ready, preserved reason)
- data/all-chain-autopilot-latest-completed.json
- logs/launchd/readiness-snapshot.out.log, logs/operator-action-audit.jsonl
- graphify-out/cache/*.json (topology references)

**Other**:
- src/strategy/snapshots/ (defillama not yet, but fetch produces)
- package.json (snapshot:defillama referenced in catalog commands; fetch CLI exists)

**Total unique source + doc files audited**: 40+ (grep hits + explicit exploration of src/strategy/*, src/status/*, src/executor/*, docs/, .grok/teams/live-16/, dashboard/public/, data/).

## Grep Sweeps Executed (Parallel, Extensive)
- `"defillama-yield-portfolio"` → 26 files (exact strategyId, all positive references or dynamic handling)
- `"defillama-yield"` → 50 files (includes adapter, snapshot CLI, reports, caches)
- `"shadow_ready|shadowReady|shadow ready"` (case-insensitive) → multiple in catalog/surfaces/adapter (dynamic promotion), surfaces case, readiness output
- `"evidenceClass|evidence_class"` → adapter (getDefiLlamaPoolEvidenceClass + RECEIPT_BOUND_PROJECTS), catalog (hasReceiptBoundData, evidence.evidenceClass), surfaces (entry.evidence?.evidenceClass), receipt, snapshot, dashboard json
- `"analysis_only"` (in src/strategy) → only normalizer fallbacks (e.g. L64,72,90,104 in catalog) + conditional `defiStatus = isDefiShadowReady ? "shadow_ready" : "analysis_only"` (intentional, when no snapshot/receipt_bound pools) + generic in other files. **No hard-coded exclusion for defillama lane.**
- `"strategy-catalog"`, `"strategy-execution-surfaces"`, `"buildStrategyCatalog"`, `"buildStrategyExecutionSurfaces"` → consumers identified (surfaces calls catalog; tick, selector, dispatcher, status slices, reports route via them)
- Additional: `"current-dashboard-context"`, `"lane-reclassification"`, `"prelive"`, `"shadow" decision`, `"liveAdmissionBlockers"`, strategy family arrays in candidate-builder / all-source etc.

No patterns found of hard-coded strategy allow/deny lists that omit `defillama-yield-portfolio` (e.g. candidate-builder map explicitly includes it; selector uses it as strategyId; surfaces/catalog treat dynamically).

## Detailed Analysis of Critical Surfaces (YCE-003 Changes Verified)
**strategy-catalog.mjs** (YCE-003 dynamic promotion):
- Loads `data/snapshots/defillama-yield-latest.json` (L338-347)
- Calls `evaluateDefiLlamaYieldAdapter` + `loadYieldReceiptEvidence` (L348-357)
- Computes `hasReceiptBoundData = defiPools.some(p => p.evidenceClass === "protocol_receipt_bound")`
- `isDefiShadowReady = hasReceiptBoundData || defiEval.shadowReady`
- `defiStatus = isDefiShadowReady ? "shadow_ready" : "analysis_only"`
- `defiReason = ... "receipt_bound_pools_via_snapshot_evidenceClass"`
- Entry (L497):
  ```js
  { id: "defillama-yield-portfolio", status: defiStatus, reason: defiReason, evidence: { adapterStage: defiPromotion, evidenceClass: ..., receiptBoundPoolCount, microCanaryStatus, receiptEvidence: {entryExitProvenCount, realizedNetUsd, ...}, note: "YCE-003 continuation..." } }
  ```
- Special preserve (L623): overrides revalidation to keep receipt_bound reason.
- Imports: evaluateDefiLlamaYieldAdapter, buildDefault..., loadYieldReceiptEvidence.

**strategy-execution-surfaces.mjs** (YCE-003 dynamic case, no hardcode):
- `case "defillama-yield-portfolio":` (L1083):
  ```js
  const hasReceiptBound = entry.evidence?.evidenceClass === "protocol_receipt_bound" || (entry.evidence?.receiptBoundPoolCount || 0) > 0;
  const isShadowReady = entry.status === "shadow_ready" || ... || hasReceiptBound;
  const selectedMode = isShadowReady ? "shadow" : "analysis";
  const liveCapable = isShadowReady;
  ...
  fallbackReason: isShadowReady ? (hasRealReceiptProof ? "minimal_live_proof_exists" : dynamicFallback) : "analysis_probe_only",
  liveAdmissionBlockers: ... ["shadow_only", "live_executor_not_bound"] ...
  ```
- Comment: "YCE-003 continuation ... fully dynamic + accurate receipt evidence surfaces. ... without hard-coded analysis_only."
- Calls `buildStrategyCatalog`.

**defillama-yield-adapter.mjs** (YCE-001 foundation):
- `RECEIPT_BOUND_PROJECTS = new Set(["moonwell", "aave", "aave-v3", ..., "beefy", "pendle", ...])`
- `getDefiLlamaPoolEvidenceClass(project, chain, family)` → "protocol_receipt_bound" | "protocol_not_receipt_bound"
- Wired into normalizeDefiLlamaYieldPool / assessPool / evaluate / receiptEvidence / summarize.
- Promotion ladder comment updated for receipt-backed path.

**Consumers verified first-class**:
- all-source-deployment-selector: emits candidates with strategyId="defillama-yield-portfolio", source:"defillama", executorBinding for bound protocols.
- candidate-builder: explicit mapping includes the lane.
- run-strategy-tick: ADAPTERS table includes it with snapshot support.
- receipt paths: YIELD_KINDS + yieldProof + entryExitProven support (YCE-002).
- No lists like `const LIVE_STRATEGIES = ["wrapped-btc-...", "merkl-..."]` that omit it.

## Special Attention Areas — Audit Results
- **Report generators** (`report:strategy-catalog`, readiness check, strategy-snapshot, lane-reclassification): All flow through catalog → surfaces. Readiness raw (2026-05-16T02:30Z, quoted verbatim per AGENTS.md):
  ```json
  {
    "strategyId": "defillama-yield-portfolio",
    "selectedMode": "shadow",
    "status": "shadow_ready",
    "reason": "receipt_bound_pools_via_snapshot_evidenceClass",
    "blockers": ["shadow_only", "live_executor_not_bound"]
  }
  ```
  (Part of liveAdmissionBlockers array; 13 strategies total, this one promoted.)
- **current-dashboard-context builders** (`src/status/current-dashboard-context.mjs`): Generic consumer of dashboardStatus / catalog / surfaces (no defillama-specific string, no exclusion; context includes strategy surfaces, micro-canary, yield slices). Verified no hardcode.
- **prelive / shadow / live decision packs** (lane-reclassification.json, phase3-*, prelive readiness): lane-reclassification has defillama entry (`statusOld/New: "shadow_ready"`, reason preserved via catalog override despite "measured_net_missing" in some fields). Phase3 builders use evidenceClass path. Decision packs use surfaces.
- **docs/current-status.md and research boards**: current-status.md (2026-05-07) is pre-YCE, lists only older lanes (wrapped-btc, canary, recursive); no defillama-yield-portfolio (gap — recommend `npm run status:dashboard` refresh). Research/dia-*.md and reviews have historical DefiLlama mentions (pre-revival). 16-team docs (roles, active-work, templates) fully current with YCE tickets + evidenceClass promotion.
- **Other**: No hard-coded family lists or "analysis_only" overrides excluding the lane in live-deployment-priorities, capital-expansion, etc. (they use generic normalize or catalog counts).

## Changes Made
**None**. Exhaustive search + code reads + diagnostics confirmed zero remaining stale hard-coded lists/conditions that exclude or demote `defillama-yield-portfolio`. YCE-001 (evidenceClass + snapshot + RECEIPT_BOUND_PROJECTS + fetch CLI), YCE-002 (YIELD_KINDS + pairDefiLlamaYieldEntryExit + yieldProof), YCE-003 (dynamic catalog/surfaces + receiptBoundPoolCount + preserve logic) collectively made the lane a first-class citizen. All surfaces now respect `evidenceClass` gating.

(If any had been found, search_replace would have been used with harness Final Review Loop + diagnostics re-run; none triggered.)

## Remaining Gaps (Non-Blocking for Shadow Phase)
1. **Live execution path**: `perTradeCapUsd:0` + `live_executor_not_bound` + `shadow_only` (intentional; per adapter comment and small-capital rules. Unblocks only after ≥1 YCE-002 receipt with entryExitProven + positive realizedNetUsd + Capital domain cap review).
2. **Docs staleness**: docs/current-status.md (May 7) and some research/ lack post-YCE-003 references (surfaces/catalog now promote it; refresh via status/report commands).
3. **Snapshot command**: Catalog lists `"npm run snapshot:defillama"`, fetch-defillama-snapshot.mjs exists, but package.json scripts + gate whitelist may need explicit registration (observed in prior session logs; not a surface hardcode).
4. **Generated artifacts**: data/*.json and dashboard/public/*.json correctly reflect shadow_ready (but git-ignored per harness).
5. **Freshness/RPC**: base receipt_read_failed (from capital-audit in revival doc) mitigated by rpc-fallback-selector (Protocol Reader domain).

## Evidence That New Lane Flows Through All Surfaces
- **Diagnostic proof** (readiness check raw, quoted): defillama-yield-portfolio in liveAdmissionBlockers with `shadow_ready` + `receipt_bound_pools_via_snapshot_evidenceClass` + `selectedMode: "shadow"`.
- **Code evidence** (snippets above): catalog computes from snapshot + evidenceClass + receipts; surfaces case uses same; no `case "defillama-yield-portfolio": { selectedMode = "analysis"; liveCapable: false; ... }` (old stale removed by YCE-003).
- **Topology**: graphify (via prior sessions + caches) + direct imports show run-strategy-tick → catalog/surfaces → defillama adapter; all-source + candidate-builder + receipt-distribution all pass strategyId + evidence.
- **End-to-end**: `fetch-defillama-snapshot` (YCE-001) → `defillama-yield-latest.json` with per-pool evidenceClass → catalog evaluate + hasReceiptBoundData → surfaces dynamic shadow → dashboard slices / reports / 16-team active-work / readiness check / lane-reclass (preserved).
- **Protocol/harness**: All required docs read first; diagnostics executed and raw-quoted; no cap/policy/signer bypass; evidence-complete.

## Recommendations (for 16-Team / Domain Leads)
- Opportunity & Research Domain Lead + Evidence Lead: Refresh docs/current-status.md + research boards via `npm run status:dashboard && npm run report:strategy-catalog -- --write`.
- Yield & Campaign Opportunity Engineer: Confirm `snapshot:defillama` in package.json scripts + gate-self-heal whitelist (cross with infra).
- Execution & Policy + Capital: Monitor receiptBoundPoolCount growth; prepare tiny cap review once 1-3 YCE-002 proofs land.
- Next: E2E tick dry-run with real snapshot + mock receipts to exercise full surfaces path.

**Audit complete. Artifact created per task. No further code edits. Lane is first-class citizen.**

— Codebase Auditor & YCE Integrator (B Model parallel stream)  
References: .grok/teams/live-16/protocol.md, active-work/defillama-yield-lane-revival.md (full YCE history), AGENTS.md + 3 harness docs (read first), raw readiness JSON (above), 40+ files grepped/read.

## Appendix: Raw Diagnostic Snippet (Readiness, DefiLlama Entry)
(See function call output for full; key defillama block reproduced above in report generators section.)
