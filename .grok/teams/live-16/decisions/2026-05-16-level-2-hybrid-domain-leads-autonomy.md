# Decision Record: Level 2 Hybrid Structure — Domain Leads as Autonomous Portfolio Managers + T-Shaped Specialists (9)

**ID**: DEC-2026-05-16-003-LEVEL2-HYBRID  
**Date**: 2026-05-16 (defined in README; implemented via parallel role creation by Evidence Lead / Role Scaffolder)  
**Status**: Adopted (16/16 roles complete; all reference B-Model + Flexibility Rule)  
**Recorded by**: Policy & Intent Evaluation Engineer (Team Governance & Decisions Track)

## Rationale
To deliver the flexibility the user requested (avoiding rigid narrow personas that can't absorb new yield sources, campaigns, or strategies), the 16-person team was structured as **Level 2 Hybrid**:

- **1 Engineering Manager & Coordinator** (stable hub, owns .grok/teams/live-16/ + mirror + protocol evolution + Phase 3 integration with main coordinator)
- **6 Domain Leads** (high autonomy; "portfolio managers" who know capacity, proactively pull specialists, absorb new work into their domain, decide assignments, initiate cross-domain calls)
- **9 Specialists** (T-shaped: deep ownership in one area + stretch/adaptability across domain and to adjacent; e.g. Yield & Campaign Opportunity Engineer handles *any* yield/campaign, not just Merkl)

This replaced earlier narrower thinking. Domain Leads (not the central coordinator) make most portfolio decisions. Specialists are stretched first before new roles created.

First 3 core Specialists (YCE, Receipt & Reconciliation Engineer, Refill & Capital Automation Engineer) were defined before any pilot, per user approval.

## Evidence (Verbatim Quotes)
From .grok/teams/live-16/README.md ("Team Structure (Level 2 Hybrid)"):
> "## Team Structure (Level 2 Hybrid)
- **1 Engineering Manager & Coordinator** (you in this mode)
- **6 Domain Leads** (high autonomy, portfolio responsibility)
- **9 Specialists** (T-shaped, fluid within/across domains)"

From memory (2026-05-16-interval-019e2e25.md):
> "Major redesign of the 16-person structure to prioritize long-term flexibility when adding new systems/strategies (addressing user's core concern about persona rigidity): Domain Leads redefined as "portfolio managers" who absorb new work into their domain and dynamically reassign to specialists; specialists designed as T-shaped (deep expertise + adaptability within domain); eliminated narrow "XXX-only" personas (e.g., "Merkl Engineer" → "Yield & Campaign Opportunity Engineer" to handle any future yield/campaign sources)."
> "User approved recommendation to first define 3 core Specialist roles (Yield & Campaign Opportunity Engineer, Receipt & Reconciliation Engineer, Refill & Capital Automation Engineer) before running a pilot."

From role-definition-completion.md (active-work/, 2026-05-16, Evidence Lead):
> "**Status**: Complete — 5 missing role files created in `.grok/teams/live-16/roles/`, README updated to 16/16, all in consistent B-Model format referencing `protocol.md`."
> "New Domain Lead Roles Created: Risk, Safety & Resilience Domain Lead; Execution & Policy Domain Lead; Payback & Gateway Settlement Domain Lead"
> "New Specialist Roles Created: Allocation & Rebalancing Specialist; Resilience & Self-Healing Engineer"
> "**Verification**: All new files follow the exact structure, tone, T-shaped expertise description, B-Model collaboration patterns ... Flexibility & Evolution Rule..."

From protocol.md (Role Evolution & New Work Absorption):
> "When a completely new strategy, data source, or system appears:
1. The relevant Domain Lead declares "This belongs in my domain."
2. The Lead decides which existing Specialist(s) will absorb it (or temporarily borrows someone from another domain).
3. If the work is truly novel and doesn't fit well, the Engineering Manager can authorize a role evolution or temporary specialist reallocation.
4. No new role is created lightly — we prefer stretching existing T-shaped people first."

From Policy & Intent role (example of T-shaped + collaboration):
> "**Flexibility & Evolution Rule** New policy factors (yield-specific APY haircut rules, multi-sleeve rotation policies, new EV components from receipt freshness, intent types for autonomous discovery...) — these are all absorbed by you first. The Execution & Policy Domain Lead and Engineering Manager will only authorize a split ... when the policy surface demonstrably exceeds what one T-shaped engineer can keep at evidence-complete quality..."

## Implications
- **Autonomy**: Domain Leads (e.g. Opportunity & Research for YCE/DefiLlama, Execution & Policy for me, Capital for allocation/refill) operate with high independence; Engineering Manager only intervenes on conflicts or escalation.
- **Role files now 16/16**: All in .grok/teams/live-16/roles/ + mirrored to docs/team/live-16/roles/ (including the 3 new Leads + Allocation + Resilience + prior Signer/Settlement/Policy/YCE/Receipt/etc.).
- **Pilot success enabler**: The hybrid allowed the DefiLlama Joint Session to pull exactly the right 2 Leads + 2 Specialists without central bottleneck.
- **Evolution**: Future lanes (RWA, restaking, new on-chain radar) absorbed by existing Domain Lead + stretch one Specialist first.
- **My ownership (Policy)**: Execution & Policy Domain Lead + I (Policy & Intent Evaluation Engineer) + Signer & Audit Integrity Engineer form the unbreakable policy spine. All new surfaces (DefiLlama evidenceClass promotion, yield intent) route through us.

**Related Files**:
- /Users/love/BOB Claw/.grok/teams/live-16/README.md (16-person map)
- /Users/love/BOB Claw/.grok/teams/live-16/roles/ (all 10+ files, especially *Domain-Lead.md and Policy-and-Intent-Evaluation-Engineer.md)
- /Users/love/BOB Claw/.grok/teams/live-16/active-work/role-definition-completion.md
- /Users/love/BOB Claw/docs/team/live-16/16-team-manager.md (Engineering Manager owns the map + evolution)
- /Users/love/BOB Claw/.grok/teams/live-16/active-work/defillama-yield-lane-revival.md (first use of hybrid in practice)

**Owner / Policy Note**: As the Policy specialist under Execution & Policy Domain Lead, I enforce that the hybrid autonomy never bypasses policy gates. Domain Leads propose; my engine + audit record decides.

---
*Recorded under Team Governance & Decisions Track. 16/16 roles complete as of 2026-05-16.*
