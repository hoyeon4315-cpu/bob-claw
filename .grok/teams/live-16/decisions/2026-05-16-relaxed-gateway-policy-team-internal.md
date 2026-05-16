# Decision Record: Relaxed but Responsible Gateway Policy (Team-Internal Only) for 16-Team B Model

**ID**: DEC-2026-05-16-002-GATEWAY-RELAX  
**Date**: 2026-05-16 (embedded in protocol v1; confirmed in README and all role defs)  
**Status**: Adopted (Strictly Team-Internal; Full Supreme Law outside)  
**Recorded by**: Policy & Intent Evaluation Engineer (Team Governance & Decisions Track; owner of policy surfaces per role definition)  
**Related**: YCE-003 dashboard/surfaces wiring, DefiLlama yield adapter + strategy-execution-surfaces.mjs edits

## Rationale
To achieve high-velocity development inside the 16-person Live Team (B Model) without the rigid literal-word blocking on every "Gateway" mention (which would halt all work on 11-destination onramp/offramp helpers, settlement proofs, quotes, yield surfaces, etc.), the hard BOB Gateway Protection refusal is **suspended for this team context only**.

This enables agents (especially YCE, Protocol Reader, Settlement & Proof, Policy & Intent, Execution & Policy Domain Lead) to freely analyze, design, and edit Gateway-related surfaces during team sessions.

**Responsible constraints remain**:
- Must still execute required diagnostics before material changes (capital-audit, readiness, payback-status, refill-plan, dashboard).
- Must **not** weaken committed caps, core policy invariants, or signer audit integrity.
- High real capital loss risk changes escalate immediately to main coordinator.
- Outside 16-team mode (main coordinator, production execution, any non-team task), the **full strict Supreme Law** (literal \bGateway\b check as absolute first action + refusal block) remains in force with zero exceptions.

This was a deliberate policy exception decision to support the pilot and 16/16 role completion without stalling on every surface touching the 11 Gateway destinations.

## Evidence (Verbatim Quotes)
From .grok/teams/live-16/protocol.md (Core Principles, #5):
> "**Relaxed but Responsible Gateway Policy (Team-Only)**  
Inside this 16-team mode:
- The hard literal-word "Gateway" refusal is **suspended**.
- Agents may freely analyze, design, and edit Gateway-related surfaces (onramp/offramp helpers, settlement proofs, quotes, etc.).
- They **must** still run the required diagnostics before material changes (`report:capital-audit -- --json`, readiness check, payback status, etc.).
- They may **not** weaken committed caps, core policy invariants, or signer audit integrity.
- High real capital loss risk changes escalate to the main coordinator.
Outside this mode (main coordinator, production execution) the full strict Supreme Law remains in force."

From .grok/teams/live-16/README.md:
> "- This team uses a **strongly relaxed** Supreme Law for development speed (Gateway word no longer hard-blocks).
- Real high-capital-risk or core invariant changes still escalate to the main Grok coordinator.
- All work still follows diagnostics + evidence-complete standard (just without the rigid literal-word refusal inside the team)."

From docs/AGENT-SUPREME-LAW.md (still authoritative for main path; 2026-05-17):
> "**This is the strictest rule in the entire system.** ... The presence of the literal whole-word "Gateway" (capital G, word-bounded) in the `Original Task Name:` or the full user request is a hard, deterministic, non-negotiable trigger."
> "Never invoke, trigger, or delegate any skill or subagent when the task contains the literal word "Gateway"."

From memory session (B model operational):
> "B model now operational with relaxed Gateway policy, enabling direct agent-to-agent communication and on-demand specialist calls during sessions."

From Policy & Intent Evaluation Engineer role definition (owning surfaces/policy side):
> "During YCE-003 and DefiLlama revival work, you are the owner of the surfaces/policy side of the dynamic promotion gate lift."
> (Note: YCE-003 touches strategy-execution-surfaces.mjs which has Gateway dest logic.)

## Implications
- **Inside 16-team spawns**: Prompts include protocol.md + "Execute the full 5-Step ... (Gateway check as step 2)" but the team context suspends the hard refusal for analysis/editing of related code. Diagnostics still mandatory (quoted raw in active-work).
- **Policy ownership**: Any change to policy/ surfaces (my owned `src/executor/policy/*`, `strategy-execution-surfaces.mjs`) must still go through my gates + Signer & Audit Integrity Engineer (no policy → no signature invariant).
- **Escalation path**: If a proposed edit risks caps/invariants (e.g., changing maxDailyLossUsd or kill-switch), the Domain Lead or I escalate via handoff to Engineering Manager → main coordinator.
- **YCE / DefiLlama specific**: Enabled the adapter edits, receipt wiring (YCE-002), and YCE-003 promotion gate lift for defillama-yield-portfolio without literal-word blocks. 604 receipt_bound pools now proven.
- **Mirror sync**: Both .grok/teams/live-16/ and docs/team/live-16/ must reflect this (per 16-team-manager.md).
- **No change to production**: The main `.grok/agents/coordinator.md` and all non-16-team tasks continue strict Gateway Protection.

**Related Files**:
- /Users/love/BOB Claw/docs/AGENT-SUPREME-LAW.md (updated_at: 2026-05-17)
- /Users/love/BOB Claw/.grok/teams/live-16/protocol.md
- /Users/love/BOB Claw/.grok/teams/live-16/README.md
- /Users/love/BOB Claw/.grok/teams/live-16/roles/Policy-and-Intent-Evaluation-Engineer.md (and Execution-and-Policy-Domain-Lead.md)
- /Users/love/BOB Claw/.grok/teams/live-16/active-work/defillama-yield-lane-revival.md (and defillama-receipt-validation.md)
- /Users/love/BOB Claw/src/strategy/strategy-execution-surfaces.mjs (policy surface touched by YCE-003)

**Owner / Policy Note (Critical)**: As Policy & Intent Evaluation Engineer, I am the primary guardian that this relaxation never leaks outside team mode or weakens any core invariant. All YCE-003 wiring and future Gateway-surface edits inside team must attach full policy provenance (intent hash, verdict) and pass my engine + audit pairing with Signer & Audit Integrity Engineer. Any drift will be surfaced immediately.

---
*Recorded under Team Governance & Decisions Track. Evidence-complete; raw quotes preserved.*
