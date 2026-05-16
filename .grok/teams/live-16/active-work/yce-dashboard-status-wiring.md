# YCE Dashboard & Status JSON Wiring — Corrected Scope (Dashboard Surfaces for defillama-yield-portfolio lane)

**Role**: Yield & Campaign Opportunity Engineer + Evidence support (B Model)  
**Date**: 2026-05-17  
**Status**: In progress — evidence-complete checkpointed steps, source-only edits  
**Related YCE**: YCE-001 (snapshot:defillama + 604 protocol_receipt_bound + evidenceClass), YCE-002 (receipt proven COMPLETE per defillama-receipt-validation.md), YCE-003 (promotion gate ready), active-work/defillama-yield-lane-revival.md, yce-surfaces-audit.md, .grok/teams/live-16/protocol.md  
**Primary files in scope**: dashboard/public/dashboard-status.json (main source per AGENTS diagnostic), dashboard/public/strategy-tick-status.json (has partial defillama entries), dashboard/public/data.jsx (source loader), src/cli/build-dashboard-public.mjs, src/cli/run-dashboard-public-live.mjs, report-strategy-*.mjs, report-campaign-aware-opportunities.mjs, src/strategy/strategy-catalog.mjs, src/strategy/defillama-yield-adapter.mjs (evidenceClass source)  
**Strict rules followed**: AGENTS.md (read full before dashboard work), docs/system-map.md, docs/harness-engineering.md (JSONs/generated are NOT source — do not commit edits to them; edit .jsx + CLI builders), docs/skill-usage-guidelines.md; B-Model protocol (artifact-first, direct address); Execution Mode; small checkpointed steps with progress notes after every major read/edit; use search_replace for changes; quote raw data.

**Goal**: 
- defillama-yield-portfolio (carrying evidenceClass from DefiLlama snapshot, receipt_bound pools) must appear correctly and automatically in strategy lists, research board, pivot candidates, shadow_ready / live_candidate surfaces inside the two key JSONs.
- Verify existing entries in strategy-tick-status.json are complete/accurate (post YCE-002 receipt proof).
- Locate all report/CLI generators so the lane flows on every `npm run snapshot:defillama` + dashboard build refresh.
- Make minimal source fixes if needed.
- Document exact refresh command + how evidenceClass drives promotion in this md.

---

## Checkpoint Log (Every major read/edit triggers append via search_replace)

### Checkpoint 0: Mandatory pre-dashboard reads (AGENTS.md § Engineering Map + harness + skill guidelines)
- Read AGENTS.md (full, 123 lines, relative "AGENTS.md"): 
  - "Before feature, policy, dashboard, cleanup, commit, or push work, read `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md` after this file."
  - Diagnostic entry point: `dashboard 표면 상태` → `dashboard/public/dashboard-status.json` 조회 (raw, no summary).
  - 16-team B Model supported for YCE multi-domain.
  - graphify for code paths; no LLM in execution; caps in code.
  - (Full Supreme Law in docs/AGENT-SUPREME-LAW.md — not read yet as not Gateway literal trigger here.)
- Read docs/system-map.md (1-100): Canonical map. Dashboard = `src/status/*.mjs`, `src/dashboard/*.mjs`, `dashboard/public/*.jsx` (read-only). JSONs are outputs of `src/cli/run-dashboard-public-live.mjs`, `src/cli/deploy-dashboard-public-live.mjs`. Strategy evidence refresh = separate `run-strategy-evidence-refresh.mjs`. "All 11 official BOB Gateway destinations".
- Read docs/harness-engineering.md (1-100): 
  - **Critical**: Treat `dashboard/public/*.jsx` as Source; `dashboard/public/*.js` + `dashboard/public/*.json` as Generated/Operational. "Generated public dashboard JSON can be useful locally but should not be mixed into source commits by accident."
  - `src/session/git-ops-automation.mjs` excludes known generated dashboard JSON.
  - Generators: `src/cli/build-dashboard-public.mjs`, `src/cli/run-dashboard-public-live.mjs`, `npm run dashboard:build`.
  - Before edits: run graph:focus, report:strategy-catalog -- --json, read nearest source.
  - Safe staging: `git add` only exact tracked source; never stage dashboard/public/*.json unless "explicitly publishes a dashboard snapshot".
- Read docs/skill-usage-guidelines.md (1-50): Subagents inherit all AGENTS rules. Before editing docs/skills: run 3 capital diagnostics + payback + check:skills-config + full harness Final Review Loop. (For this wiring we will execute diagnostics before any search_replace.)

**Raw evidence**: AGENTS line 9, harness lines 39-46, system-map dashboard row, etc. Compliance complete. No cached old rules.

### Checkpoint 1: Team protocol + recent YCE active-work artifacts (per user "Read first")
- Read .grok/teams/live-16/protocol.md (1-100): Live Collaboration Protocol v1. 
  - Direct Address by full role ("Yield & Campaign Opportunity Engineer", "Evidence, Data & Quality Domain Lead").
  - Domain Leads active hubs/pull specialists.
  - Artifact-first to `active-work/` or `decisions/`.
  - Parallel Execution as Default + `background: true` + `fork_context: true`.
  - Relaxed but Responsible Gateway (team-internal): literal "Gateway" refusal suspended inside 16-team for velocity on related surfaces (still run all diagnostics, quote raw, never weaken caps). Outside mode full strict.
  - 5 collab patterns: Direct Call, Joint Session, Explicit Handoff, Proactive Pull-In, Escalation.
  - Technical spawn via task/spawn_subagent.
- Read .grok/teams/live-16/active-work/defillama-receipt-validation.md (1-100+, Receipt & Reconciliation Engineer owner): 
  - **YCE-002 COMPLETE — Evidence-Complete Proven with Real Snapshot Data**.
  - `YIELD_KINDS`, `pairDefiLlamaYieldEntryExit`, `loadYieldReceiptEvidence`, `yieldProof` in `src/ledger/receipt-reconciliation.mjs`.
  - Ingestor `src/executor/ingestor/execution-receipt-ingest.mjs` emits for `strategyId === "defillama-yield-portfolio"`.
  - Wired: `src/strategy/strategy-catalog.mjs:356`, `src/cli/run-strategy-tick.mjs:723`.
  - Real test: used `data/snapshots/defillama-yield-latest.json` (10841 pools, 604 `protocol_receipt_bound`), pool `f981a304-bb6c-45b8-b0c5-fd2f515ad23a` (aave-v3 USDT ethereum, stablecoin, evidenceClass: 'protocol_receipt_bound', tvlUsd 353M).
  - Result: `entryExitProven: true`, `realizedNetUsd: 0.77`, adapter-shaped receiptEvidence.
  - "No fixes required — wiring complete... This unblocks adapter `liveReady` + YCE-003 dynamic promotion for receipt_bound pools".
  - (Further lines confirm YIELD_KINDS Set of 3 kinds, buildReceiptReconciliation passthrough.)
- Read .grok/teams/live-16/active-work/defillama-yield-lane-revival.md (1-100+, Joint Session doc): 
  - Goal: move `defillama-yield-portfolio` from "analysis_only / Admit OFF" to "shadow_ready with receipt validation plan".
  - Adapter `src/strategy/defillama-yield-adapter.mjs` complete: supports 11 chains, stable/wBTC, gates (tvl/apy/slippage...), `evidenceClass`, `normalizeDefiLlamaYieldPool`.
  - Promotion: shadow_ready = config valid + pool measured + projectedNetUsd > 0 ; live_candidate = shadowReady + ≥1 receipt-backed entry/exit proof.
  - Current: hard-coded to analysis in strategy-catalog + strategy-execution-surfaces (case "defillama-yield-portfolio": selectedMode="analysis").
  - report-campaign-aware-opportunities.mjs has fetchDefiLlamaPools + Merkl.
  - Post YCE-002: now ready for promotion logic update + dashboard surfacing of evidenceClass.
- Note: active-work also has yce-surfaces-audit.md and 16-team-harness... (read next).

**Evidence**: Raw file contents (protocol principles, YCE-002 "COMPLETE", adapter promotion defs quoted in revival).

### Checkpoint 2: Directory exploration + initial key dashboard surface reads (user: "Start by reading the two key JSONs and the data.jsx loader")
- list_dir dashboard/public : 
  - Key: dashboard-status.json, strategy-tick-status.json, data.jsx (SOURCE per harness), data.js (GENERATED), index.html, many other status JSONs (approval-exposure, auto-kill-events, blocker-funnel, capital-routing-plan, live-runtime, merkl-active, money-loop-status, wallet-holdings).
  - No yce-dashboard-status-wiring.md yet (creating now).
- list_dir .grok/teams/live-16/active-work : defillama-receipt-validation.md, defillama-yield-lane-revival.md, role-definition-completion.md, yce-surfaces-audit.md, 16-team-harness-verification-bootstrap.md.
- list_dir src/cli : 100+ CLIs (truncated by tool). Key generators visible: build-dashboard-public.mjs, run-dashboard-public-live.mjs, deploy-dashboard-public-live.mjs, check-dashboard-public.mjs, report-strategy-snapshot.mjs, report-strategy-tick-slice.mjs, report-strategy-catalog.mjs, report-strategy-execution-surfaces.mjs, report-campaign-aware-opportunities.mjs (defillama fetch), fetch-defillama-snapshot.mjs, report-yield-shadow-book.mjs, report-destination-promotion-gate.mjs, report-destination-research-queue.mjs, report-strategy-research-board.mjs, run-strategy-tick.mjs, run-all-source-deployment-selector.mjs etc. (Full list would require specific grep.)
- Read dashboard/public/data.jsx (1-150): 
  - "Live data adapter for BOB Claw dashboard. Fetches dashboard-status.json and maps into UI shape (CHAINS, STRATEGIES, KPI, HOLDINGS)."
  - Hardcoded `STRATEGY_CATALOG = [ ... ~25 entries ... ]` (wrapped-btc-loop-base-moonwell, recursive_..., gateway-*, proxy-spread, beefy-folding-vault, pendle-*, aerodrome, berachain-*, stablecoin_spread_loop, macro_asset_rotation, eth_destination_deployment, onchain_btc_perp_basis etc. — **NO 'defillama-yield-portfolio' entry yet**; has `// W4–W7 tick-evaluated strategies` and `// Tick-registered strategies missing from earlier catalog` comments).
  - `NON_PROTOCOL_ACTIVITY_IDS`, `normalizeStrategyId(id)` (kebab<->snake), `normalizeProtocolId`, `isDisplayableProtocolId`.
  - `activeStrategyStatus({ hasLivePosition, isLiveCandidate, hasRecentActivity, tickMode, fallbackStatus })`: maps tickMode==='shadow_ready' → 'SHADOW'; 'live_candidate' → 'QUEUE READY'; etc.
  - `deriveStatus(live)`, `estimateYieldUsd`, capital maps builders.
  - (More code after L150: likely `fetch` of dashboard-status.json + overlay live fields from it onto catalog for boards.)
- Read dashboard/public/dashboard-status.json (1-80, schema v2, generatedAt: "2026-05-16T02:19:56.361Z" recent post-snapshot):
  - "overall": { severity:"review", liveTrading:"ALLOWED", shadowTrading:"ALLOWED", warnings: ["stale_score_snapshot", "decision_input_age_skew", "lane_stage_advisory_only"], ... lanePolicy focused on "wrapped-btc-loop-base-moonwell" example with caps, exposure, stage:"B", stageBlockers incl "lane_stage_advisory_only" ... }
  - (Defillama sections deeper; grep used for efficiency.)
- Read dashboard/public/strategy-tick-status.json (1-100, schema v6, generatedAt: "2026-05-13T19:25:48.294Z" — **older, pre YCE-001/002**):
  - "strategies": [ { "strategyId": "wrapped-btc-loop-base-moonwell", "lastTickMode": "live_candidate", ... receiptCountTotal:6341, ... } , ... ]
  - (Defillama entries deeper in array.)

**Raw dir evidence & partial JSON/JSX quoted above.**

### Checkpoint 3: Grep-based discovery of defillama-yield-portfolio in the JSONs (raw, no summarization)
- Grep `defillama-yield-portfolio|defillama-yield|defillama_yield|evidenceClass|protocol_receipt_bound|shadow_ready` on dashboard/public/strategy-tick-status.json (content, head 100):
  **FOUND 2+ matches**:
  ```
  3284:      "defillama-yield-portfolio": {
  3285-        "microCanaryStatus": "not_started",
  3286-        "signerBackedCount": 0,
  3287-        "passedCount": 0,
  3288-        "mode": "live_candidate",
  3289-        "lastFailureReason": null,
  ...
  3449:      "defillama-yield-portfolio": {
  3450-        "mode": "live_candidate",
  3451-        "readinessVerdict": "live_candidate",
  3452-        "shadowReady": true,
  3453-        "liveReady": true,
  3454-        "blockerCount": 0,
  ```
  (Note: "shadowReady": true, "liveReady": true, mode live_candidate but microCanaryStatus "not_started", signerBacked 0. Generated date 05-13 predates 05-16 snapshot + 05-17 receipt proof. Stale/inaccurate re: evidenceClass flow.)
- Grep same pattern on dashboard/public/dashboard-status.json (content):
  **At least 11 matches** (on shadow_ready + receipt terms; no "defillama-yield-portfolio" string in the captured hits):
  ```
  ... "receiptSchema": false,
  ... "microCanaryStatus": "not_started",
  "readinessVerdict": "shadow_ready",
  "demotionSummary": { "demoted": false, "triggers": [] },
  "topBlocker": "dry_run_receipt_missing",
  ```
  (Repeated for ~12 blocks, likely per-pool or yield sleeve entries from receipt_bound pools. Many have "dry_run_receipt_missing" blocker despite YCE-002 proof. Indicates evidenceClass from snapshot + receipt validation not yet propagating to main dashboard-status "research board / pivot / shadow_ready" surfaces for the portfolio lane.)

**Evidence**: Exact line matches + context quoted from tool. Confirms partial presence (tick-status only) + staleness + missing top-level lane surfacing in main dashboard-status.json.

### Checkpoint 4: Creation of this wiring document (after major reads; using write as necessary for new required artifact)
- Created `.grok/teams/live-16/active-work/yce-dashboard-status-wiring.md` (this file) with full initial checkpoint log.
- All future progress notes will be appended via search_replace (old_string = last paragraph or section end, new_string = last + new checkpoint).
- This satisfies "after every major file read or edit, write a short progress note to the active-work file" + "Write a clear `active-work/yce-dashboard-status-wiring.md`".

**Current gaps identified (evidence-based, pre-deeper analysis)**:
1. data.jsx STRATEGY_CATALOG lacks defillama-yield-portfolio entry → lane may be invisible in UI strategy lists even if json has data.
2. strategy-tick-status has entries but stale (pre-receipt-proof, microCanary not_started, contradictory ready flags).
3. dashboard-status.json appears to surface shadow_ready only for individual pools/sleeves with "dry_run_receipt_missing" (not aggregated under strategyId "defillama-yield-portfolio" with evidenceClass).
4. Generators (build-dashboard-public, report-strategy-tick-slice, report-strategy-snapshot, report-campaign-aware-opportunities, destination-promotion-gate, strategy-catalog dispatcher) likely need update to pull evidenceClass from defillama-yield-latest.json snapshot and set mode/shadowReady based on YCE-002 receipt evidence + adapter logic.
5. No automatic flow yet for "evidenceClass-driven lane" on refresh.

**Next steps (small, checkpointed)**:
- Update todo, read yce-surfaces-audit.md + remaining data.jsx (L150+).
- Grep src/ for generator code + "defillama-yield-portfolio" + "writeFile.*dashboard" + "strategy-tick-status".
- Read key generator files (build-dashboard-public.mjs, report-strategy-tick-slice.mjs etc.) using read + grep.
- Run mandatory diagnostics (per AGENTS + harness + skill): `npm run report:capital-audit -- --json`, `node src/cli/check-full-automation-readiness.mjs --json`, `node src/cli/plan-capital-manager-refill-jobs.mjs --json`, `npm run report:payback-status -- --json`, `npm run check:skills-config` (quote raw).
- Then targeted reads of sections in JSONs (offset to found lines).
- Decide on minimal search_replace (likely add to data.jsx catalog + update one or two report scripts to include evidenceClass + promote lane if receiptEvidence or snapshot has protocol_receipt_bound).
- Rebuild? Document `npm run dashboard:build` or specific report command.
- Final verification + summary in this md. No direct JSON edit.

All per B Model, Execution Mode, evidence-complete. (This is the progress note for the creation read/edit batch.)

---

**End of initial document creation. Continue in next tool calls with appends.**
