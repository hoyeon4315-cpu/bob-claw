# 16-Person Role Definition Creation Progress (Project Mirror)

**Date**: 2026-05-16
**Updated by**: Evidence, Data & Quality Domain Lead (Stream D continuation, Full Parallel Execution Mode — Resilience & Allocation roles added; Phase 2 base-lead.md + base-specialist.md created + mirrored)

See the canonical version at `.grok/teams/live-16/active-work/16-person-role-creation-progress.md` for full raw diagnostic outputs and detailed rationale.

## Summary of This Continuation
- Created (parallel) Resilience & Self-Healing Engineer role (Risk domain; health/self-healing/position-action/auto-kill/watchdog ownership; evidence-aligned recovery)
- Created (parallel) Allocation & Rebalancing Specialist role (Capital domain; rebalancer/scored-targets/allocator-core/destination coverage; cap + evidence scoring)
- Mirrored both role *.md files to docs/team/live-16/roles/ + updated canonical + mirror README 16-person maps (now 15/16 created)
- Updated team README.md (both locations) with 16-person map, fresh status, and progress
- Shared working document updated (this file + .grok canonical progress + diagnostics quoted raw)
- All role files + updates follow existing format from Policy/Settlement examples; diagnostics executed first per AGENTS.md

**Phase 2 (Evidence Lead continuation)**:
- Created `base-lead.md` (reusable Domain Lead prompt base) and `base-specialist.md` (reusable Specialist prompt base) in `.grok/teams/live-16/templates/` + mirrored to `docs/team/live-16/templates/`.
- These bases embed Live Collaboration Protocol (B Model), full 5-Step (with Gateway literal check), Evidence alignment, Parallel-as-Default, flexibility, safety (no keys, policy-only execution, BTC first, 11 destinations, etc.), prompt construction recipes, and closure formats — making all 16 role definitions clean and reusable.
- **Phase 2 small templates (this sub-task)**: Created `lead-sync.md` (for Domain Lead-initiated sync calls: purpose, prompt recipe with agenda + evidence forks + raw diags + SYNC CONSENSUS) and `handoff.md` (explicit handoff format + receiver rules + 5 variations) in `.grok/teams/live-16/templates/` + mirrored to `docs/team/live-16/templates/`. Updated both README.md + both progress.md; fresh diagnostics (readiness="ready", 3 refill jobs, payback carry) quoted; 5-Step + scope (templates/ only) + hygiene followed before writes.
- Updated both README.md + both progress.md files; fresh diagnostics quoted below; all 5-Step + scope + hygiene followed.

**Raw Diagnostics Executed** (per AGENTS.md + skill-usage before any write; fresh this session):
- capital-audit: status "complete_with_residual_checks", currentNativeBtcSats ~233967, currentCombinedUsd ~877, treasury delta positive; many low-severity receipt_read_failed (base/ethereum) + gateway_quote_residual_unexplained (full residualChecks in terminal/.grok progress)
- full-automation-readiness: {"status":"ready","ready":true,"blockers":[],"capitalManager":{"rebalanceDecision":"REBALANCE_REQUIRED","capitalPlanDecision":"REFILL_REQUIRED","refillJobCount":3}}
- plan-refill-jobs: decision "REFILL_REQUIRED", 3 jobs (base wBTC.OFT), manualReview 2, one bridge cost > ceiling (review), others accepted (full in .grok progress + latest run)
- payback-status: carry, accumulatorPendingSats:587, satsToMinimumPayback:4883, requiredGrossProfitSats:25000, progressToMinimumRatio:0.0234, expansionGate:{"periodsRemaining":8}, quoteProofMatrix 8 proven/3 missing
- dashboard-status.json: severity "review", live/shadow "ALLOWED"
- check:skills-config: passed (16-team native .grok/teams)

**Next**: Create final specialist (Signer & Audit Integrity Engineer), populate protocol.md + remaining small templates/ (call-another-agent.md, joint-session.md), first 16-team B-model joint pilot (e.g. Allocation + Resilience + Leads on refill + YCE using base-*.md + lead-sync.md + handoff.md), verifier + harness review, commit.

This mirror (docs/team/) + canonical (.grok/teams/) ensures the 16-person team structure (6 Leads + 9 Specialists + Coordinator) + base + small collaboration templates (lead-sync.md, handoff.md) are visible in BOB Claw repo docs for all agents following AGENTS.md. 15/16 roles + 4 templates now defined.
