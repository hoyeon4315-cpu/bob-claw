# Decision Record: Adoption of Collaboration Model B (Live Real-Time Team) and Live Collaboration Protocol v1

**ID**: DEC-2026-05-16-001-B-MODEL  
**Date**: 2026-05-16  
**Status**: Adopted (Permanent for 16-Person Live Team)  
**Recorded by**: Policy & Intent Evaluation Engineer (Team Governance & Decisions Track)  
**Related Pilot**: First B-Model Joint Session on DefiLlama yield lane revival (YCE-001/002/003)

## Rationale
User explicitly selected collaboration model **B** (active real-time model) over A (purely async document-based) or C (fully central-coordinator-mediated). The goal was to create a "living team" where subagents can directly address/mention and pull in other agents for simultaneous work, using context forking and joint sessions.

This required embedding a full "Live Team Collaboration Protocol" as the operational model, including:
- Direct Address by exact role title
- Domain Leads as active hubs / portfolio managers (not passive)
- fork_context: true + background for rich shared state
- Joint Session, Explicit Handoff, Live Sync Call patterns
- Artifact-First Transparency (write to active-work/ and decisions/)

Major structural redesign prioritized long-term flexibility for adding new systems/strategies (user's core concern about persona rigidity): Domain Leads absorb new work into domain and dynamically reassign to T-shaped specialists; eliminated narrow "XXX-only" personas (e.g., Merkl Engineer → Yield & Campaign Opportunity Engineer).

## Evidence (Verbatim Quotes)
From parent session memory (2026-05-16-interval-019e2e25.md):
> "User explicitly selected collaboration model B (active real-time model) over A or C: subagents must be able to directly address/mention and pull in other agents for simultaneous work, using context forking and joint sessions, to create a "living team" rather than purely async document-based or fully central-coordinator-mediated coordination."
> "Decided to create and embed a full "Live Team Collaboration Protocol" as the operational model for the 16-person team, including specific mechanisms (Direct Address + Context Fork, Joint Session via parallel background spawn with shared context, Handoff Protocol with explicit context+expectations, Live Sync Call initiated by Domain Leads)."

From .grok/teams/live-16/protocol.md (Core Principles):
> "**Philosophy**: Real engineering team behavior — agents directly communicate, pull each other in, hand off work, run parallel sessions, and self-organize under Domain Lead coordination. Not everything funnels through the Engineering Manager."
> "1. **Direct Address** Agents speak to each other by full role name..."
> "4. **Artifact-First Transparency** Important discussions, decisions, and handoffs are written to shared files in `active-work/` or `decisions/`."

From .grok/teams/live-16/README.md:
> "**Status**: Active Development Mode  
**Purpose**: High-velocity, flexible, real-time collaborative AI engineering team..."

From memory (role evolution):
> "Structural decisions: 6 Domain Leads ... as stable absorption axes; 9 Specialists with explicit flexibility notes; ... operational rules allowing Domain Leads to decide assignments, initiate cross-domain live calls..."

## Implications
- All 16 role definitions (roles/*.md) and templates/ now bake in B-Model patterns, base-lead.md / base-specialist.md, and protocol references.
- First pilot (DefiLlama) used Joint Session with 4+ agents in parallel (Opportunity Lead, Evidence Lead, YCE, Receipt Engineer) + fork_context.
- Enables high velocity for YCE lanes, capital automation, etc., while still enforcing diagnostics + evidence-complete + 5-Step (with team-internal Gateway relaxation).
- Engineering Manager (16-team-manager.md) owns enforcement and only evolves protocol/README with Evidence Lead + Live Sync consensus.
- High-capital-risk or core invariant changes still escalate to main `.grok/agents/coordinator.md`.

**Related Files**:
- /Users/love/BOB Claw/.grok/teams/live-16/protocol.md
- /Users/love/BOB Claw/.grok/teams/live-16/README.md
- /Users/love/BOB Claw/.grok/teams/live-16/templates/joint-session.md (and call-another-agent.md, handoff.md)
- /Users/love/BOB Claw/.grok/teams/live-16/active-work/defillama-yield-lane-revival.md
- /Users/love/BOB Claw/docs/team/live-16/16-team-manager.md (Phase 3 integration points)

**Owner / Policy Note**: This decision is owned by the Engineering Manager with Policy & Intent Evaluation Engineer input on any execution/policy surface implications. The B Model does not alter the Supreme Law outside the team context (see AGENT-SUPREME-LAW.md Gateway Protection).

---
*Recorded under Team Governance & Decisions Track. All quotes raw; no summarization.*
