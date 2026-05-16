# BOB Claw 16-Person Live Team (B Model) - Team README (Project Mirror)

**Status**: Active (Stream D finalization complete: all 16/16 roles defined + mirrored; base-lead.md + base-specialist.md + protocol.md + collaboration templates complete in both locations by Evidence, Data & Quality Domain Lead)
**Last Updated**: 2026-05-16 (Evidence, Data & Quality Domain Lead — Stream D finalization: Signer & Audit Integrity Engineer role definition created in docs mirror using exact detailed format of Allocation/Resilience/Settlement/Policy; 16-person map updated to 16/16; defillama-yield-lane-revival.md updated with final count; fresh diagnostics quoted: capital-audit complete_with_residual_checks + many low-sev tx/receipt_read_failed + gateway_quote_residual, readiness=attention_required (strategy_dispatch_not_ready + autopilot), REFILL_REQUIRED 3 jobs 2 manual, payback carry 587/4883/0.0234/8 periods, dashboard review/ALLOWED)
**Canonical Source**: `.grok/teams/live-16/` (Grok native); this is the mirrored copy under `docs/team/` for repo documentation, AGENTS.md, and harness references.

(See `.grok/teams/live-16/README.md` for full current content including 16-person map, progress, and diagnostics.)

## 16-Person Map Summary (for quick reference in BOB Claw docs)
- 1 Engineering Manager & Coordinator
- 6 Domain Leads: Capital & Treasury, Risk/Safety & Resilience, Execution & Policy, Payback & Gateway Settlement, Opportunity & Research, Evidence/Data & Quality
- 9 Specialists: Refill & Capital Automation Engineer (created), Allocation & Rebalancing Specialist (created), Resilience & Self-Healing Engineer (created), Policy & Intent Evaluation Engineer (Policy Engineer, created), Signer & Audit Integrity Engineer (created — Stream D finalization), Settlement & Proof Engineer (created), Yield & Campaign Opportunity Engineer (created), Protocol Reader & On-chain Data Engineer (created), Receipt & Reconciliation Engineer (created)

**Flexibility-First**: Domain Leads as portfolio managers absorb new work; specialists T-shaped. See full roles/*.md and protocol.md in `.grok/teams/live-16/`.

## Recent Progress (this update — Stream D finalization)
- Settlement & Proof Engineer + Policy & Intent Evaluation Engineer (Policy Engineer) role definitions created (prior continuation).
- Resilience & Self-Healing Engineer + Allocation & Rebalancing Specialist role definitions created in parallel (Risk/Capital domains, health/self-healing + allocation/rebalance math, evidence-aligned, full protocol baked in).
- Final specialist: Signer & Audit Integrity Engineer role definition created in `docs/team/live-16/roles/` (exact format match to Allocation-and-Rebalancing-Specialist.md / Resilience-and-Self-Healing-Engineer.md + Settlement/Policy content; incorporates YCE defillama-yield canary strategyId tagging, audit-policy binding, receipt proof handoff, evidenceClass alignment).
- Role files now 9/9 specialists + 2 bases + protocol + templates mirrored to `docs/team/live-16/` and canonical `.grok/teams/live-16/`.
- Team README 16-person map updated to **16/16 roles completed**.
- All per AGENTS.md: fresh raw diagnostics executed before write (capital-audit status "complete_with_residual_checks" + dozens of low-severity "transaction_read_failed"/"receipt_read_failed" on base/ethereum + 3x "gateway_quote_residual_unexplained"; readiness {"status":"attention_required","ready":false,"blockers":["strategy_dispatch_not_ready","all_chain_autopilot_running"],"capitalManager":{"rebalanceDecision":"REBALANCE_REQUIRED","capitalPlanDecision":"REFILL_REQUIRED","refillJobCount":3},"defillama-yield-portfolio":"shadow_ready" with "receipt_bound_pools_via_snapshot_evidenceClass"}; refill-plan decision "REFILL_REQUIRED" 3 medium jobs 2 manual review (bridge cost ceiling); payback-status "carry" accumulatorPendingSats:587 satsToMinimum:4883 requiredGross:25000 progress:0.0234 expansion:8 periods quoteProof 8 proven/3 missing; dashboard-status severity "review" live/shadow "ALLOWED"; skills-config passed).
- Evidence-complete confidence achieved; Signer role now enables full audit-to-receipt chain for defillama-yield-lane and future YCE promotions.

All work followed full diagnostic entry points (capital-audit, readiness, refill-plan, payback-status + dashboard-status quoted raw in the Grok-side progress file and this mirror), 5-Step, harness hygiene, and evidence-complete standard. The base + small collaboration templates (lead-sync.md, handoff.md) are now the standard reusable foundation for spawning any Domain Lead/Specialist or running Live Sync / handoff patterns in 16-team B-model sessions.

For operational use of the 16-team on BOB Claw development tasks (YCE lanes, capital automation, etc.), load from the .grok/teams canonical + protocol.

**User-facing activation & mode documentation**:
- `docs/16-team-operations.md` — complete guide (when to use 16-team vs main, activation phrases, Domain Leads & Direct Call mechanics, relaxed Gateway policy (team-internal), Parallel Execution default, full artifact locations, Role Scaffolder Domain Lead file references).
- `docs/16-team-quickstart.md` — short copy-paste examples for YCE feature, multi-domain refactor, verification campaign, Joint Session, Handoff, monitoring, escalation.
- `docs/README.md` and `docs/ai-agent-operations.md` now list 16-team as first-class mode.
- All 6 Domain Lead role definitions (Capital & Treasury, Risk/Safety & Resilience, Execution & Policy, Payback & Gateway Settlement, Opportunity & Research, Evidence/Data & Quality) + 9 Specialists are complete in the canonical `.grok/teams/live-16/roles/`.

This mirror (`docs/team/live-16/`) exists for AGENTS.md / harness / human visibility alongside the operational `.grok/teams/live-16/`.
