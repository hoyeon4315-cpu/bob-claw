# BOB Claw 16-Person Live Team (B Model) — Operations & Activation Guide

**Status**: Active (full 16/16 roles defined and operational)  
**Canonical Source**: `.grok/teams/live-16/` (Grok Build native role definitions, protocol, and runtime artifacts)  
**Documentation Mirror**: `docs/team/live-16/` (for repo visibility, AGENTS.md references, harness consumption)  
**Related**: `docs/16-team-quickstart.md` (copy-paste examples), `.grok/teams/live-16/protocol.md`, `.grok/teams/live-16/README.md`

---

## Overview

The **16-Person Live Team (B Model)** is a specialized, high-velocity, real-time collaborative AI engineering squad purpose-built for BOB Claw development. It runs on native Grok Build `spawn_subagent` + `fork_context: true` + `background: true` mechanics.

It enables Domain Leads and Specialists to **directly address each other**, run **parallel streams by default**, use explicit handoffs and joint sessions, and leave transparent artifacts — exactly like a real high-performing engineering team.

It operates **alongside** (never replacing) the main `.grok/agents/coordinator.md`, verifier-agent, and single-ownership role agents. The main coordinator remains the top-level router and final integrator for high-risk or production-bound work.

**Core Philosophy** (from Live Collaboration Protocol v1):
- Direct Address by exact full role title
- Domain Leads as active portfolio hubs (pull specialists, make assignment decisions)
- Live context via `fork_context`
- Artifact-First transparency (`active-work/`, `decisions/`)
- Relaxed but Responsible Gateway Policy (team-internal only)
- Parallel Execution as Default
- Evidence-Complete + 5-Step discipline still enforced (with protocol-specific nuance on Gateway)

---

## When to Use 16-Team vs Main Coordinator

### Use the 16-Team (B Model) for:
- Multi-domain work spanning 2+ ownership areas (e.g. Opportunity & Research + Evidence + Capital + Payback + Risk for a new yield campaign lane)
- High-velocity feature streams: YCE (Yield & Campaign Opportunity) development, dashboard/surfaces wiring, receipt validation, on-chain snapshot integration, E2E harness expansion
- Large refactors or verification campaigns that benefit from simultaneous specialist work (e.g. allocation math + risk model + receipt proof + payback impact)
- Explicit user requests for "parallel", "live team", or "16인 팀"
- Pilot explorations where live cross-domain consensus (Live Sync Calls) accelerates decisions

**Typical triggers** (from skill-usage-guidelines Master Decision Matrix row 5 and current practice):
- YCE-style feature (new yield source + receipt + dashboard promotion + capital allocation impact)
- Multi-domain refactor (e.g. new capital allocator affecting risk caps, payback accumulator, and treasury gas)
- Verification / harness campaign (full E2E tick + surfaces + 16-team verification matrix)
- Role or protocol evolution inside the team (only Manager + Evidence Lead may propose)

### Use Main Coordinator / Single Role Agents when:
- The change is clearly owned by one existing agent (treasury-agent, payback-agent, policy-agent, etc.)
- Any task containing the literal whole word `Gateway` (strict Supreme Law applies — see below)
- High real capital risk, production execution policy changes, signer mutations, cap adjustments, or kill-switch logic
- Quick single-file diagnosis, small bugfix, or one-off CLI/report generation
- You need the strictest possible 5-Step + full BOB Gateway Protection without any team-internal relaxation

**Decision Rule**: If the work clearly benefits from 3+ T-shaped specialists working in parallel with Domain Lead coordination and live handoffs → activate 16-team. Otherwise delegate directly from main coordinator or use a focused role agent.

Real capital-loss-risk or invariant-weakening decisions always escalate back to the main non-16-team coordinator for final review + verifier + harness.

---

## Activation Commands (Copy-Paste Ready)

From the **main Grok session** (user speaks to the primary coordinator):

- `16-team으로 시작해`
- `16인 라이브 팀으로 이 작업 해줘`
- `16-Person Live Team (B Model)으로 DefiLlama YCE-003 dashboard wiring과 receipt validation을 완성해`
- `/16-team <full task description>`
- `16인 팀으로 capital + opportunity + evidence 교차 작업을 parallel로 진행해줘`

The main session (or the Engineering Manager & Coordinator persona) then:
1. Loads `.grok/teams/live-16/README.md` (current 16-person map + status)
2. Loads `.grok/teams/live-16/protocol.md`
3. Loads the 16-team-manager.md (or directly the relevant Domain Lead + specialist roles)
4. Executes fresh raw diagnostics per AGENTS.md (capital-audit, readiness, refill plan, payback-status, dashboard-status.json)
5. Spawns the appropriate Domain Lead(s) and/or Specialists in parallel using `fork_context: true` + `background: true` + rich shared context (active-work/ file + verbatim diagnostics + "Original Task Name: <exact user request>")

Once inside 16-team context, agents self-organize using Direct Call, Joint Session, and Handoff patterns.

---

## Domain Leads, Direct Call, and Collaboration Patterns

### Current Complete Team (16/16 roles — all files present in canonical location)

**6 Domain Leads** (portfolio managers, active hubs — pull specialists, own domain decisions):

- **Capital & Treasury Domain Lead** — `.grok/teams/live-16/roles/Capital-and-Treasury-Domain-Lead.md`
- **Risk, Safety & Resilience Domain Lead** — `.grok/teams/live-16/roles/Risk-Safety-and-Resilience-Domain-Lead.md`
- **Execution & Policy Domain Lead** — `.grok/teams/live-16/roles/Execution-and-Policy-Domain-Lead.md`
- **Payback & Gateway Settlement Domain Lead** — `.grok/teams/live-16/roles/Payback-and-Gateway-Settlement-Domain-Lead.md`
- **Opportunity & Research Domain Lead** — `.grok/teams/live-16/roles/Opportunity-and-Research-Domain-Lead.md`
- **Evidence, Data & Quality Domain Lead** — `.grok/teams/live-16/roles/Evidence-Data-and-Quality-Domain-Lead.md`

**9 Specialists** (T-shaped, absorb work within/across domains per Lead decision):

- Refill & Capital Automation Engineer — `.grok/teams/live-16/roles/Refill-and-Capital-Automation-Engineer.md`
- Allocation & Rebalancing Specialist — `.grok/teams/live-16/roles/Allocation-and-Rebalancing-Specialist.md`
- Resilience & Self-Healing Engineer — `.grok/teams/live-16/roles/Resilience-and-Self-Healing-Engineer.md`
- Policy & Intent Evaluation Engineer — `.grok/teams/live-16/roles/Policy-and-Intent-Evaluation-Engineer.md`
- Signer & Audit Integrity Engineer — `.grok/teams/live-16/roles/Signer-and-Audit-Integrity-Engineer.md`
- Settlement & Proof Engineer — `.grok/teams/live-16/roles/Settlement-and-Proof-Engineer.md`
- Yield & Campaign Opportunity Engineer (YCE) — `.grok/teams/live-16/roles/Yield-and-Campaign-Opportunity-Engineer.md`
- Protocol Reader & On-chain Data Engineer — `.grok/teams/live-16/roles/Protocol-Reader-and-On-chain-Data-Engineer.md`
- Receipt & Reconciliation Engineer — `.grok/teams/live-16/roles/Receipt-and-Reconciliation-Engineer.md`

**Engineering Manager & Coordinator** (top of the 16-team, only role that may address the full map or evolve protocol): defined in `docs/team/live-16/16-team-manager.md` (mirrored from .grok operational context).

**All 15 role definition files** were completed by the Role Scaffolder subagent. Domain Lead files and the final specialists (including Settlement & Proof, Signer & Audit Integrity) are fully present. New work is absorbed by the relevant Domain Lead deciding which Specialist(s) handle it (flexibility rule — no new roles created lightly).

**Docs-visible mirror** (for AGENTS / harness / human readers): `docs/team/live-16/roles/` (currently contains the subset created during Stream D; always cross-reference the canonical `.grok/teams/live-16/roles/` for the complete up-to-date prompt modules).

### How "Direct Call" Works (Most Common Pattern)

Any participant writes a short note in the relevant `active-work/<task>.md` then addresses the exact full title(s):

> "Evidence, Data & Quality Domain Lead + Receipt & Reconciliation Engineer + Yield & Campaign Opportunity Engineer, the DefiLlama yield lane receipt validation for pairDefiLlamaYieldEntryExit is the current blocker for YCE-003 promotion. Current state and open questions are in active-work/defillama-yield-lane-revival.md. Please validate against real snapshot data, produce proof artifact, and confirm E2E path to dashboard surface update."

The Engineering Manager (or the addressed Domain Lead) immediately spawns the requested agents via `spawn_subagent`:
- `fork_context: true` (rich recent context)
- `background: true`
- Prompt includes: exact role definition + protocol.md + joint or handoff template snippet + shared active-work file + verbatim raw diagnostics (capital-audit --json etc.) + "Original Task Name: <verbatim>"

The receiving agent replies in the shared artifact and/or continues the work.

### Other Standardized Patterns (see protocol.md §2 for full detail)
- **Joint Session** (2–4 agents, shared goal, simultaneous, all append to same active-work doc)
- **Explicit Handoff** (write "Handoff from: X To: Y Why: ... Open questions: ...", receiver confirms "Received — continuing")
- **Proactive Pull-In** (Domain Lead monitors active-work/ and pulls needed specialists)
- **Live Sync Call** (real-time consensus across Leads for cross-domain decisions)
- **Escalation** (rare — only for unresolvable Lead disagreement or high capital risk → back to main coordinator)

**Reusable templates** live in `.grok/teams/live-16/templates/` (call-another-agent.md, handoff.md, joint-session.md). The docs mirror (`docs/team/live-16/templates/`) contains the base-lead.md / base-specialist.md + lead-sync.md used to construct full spawn prompts.

---

## Relaxed Gateway Policy (Team-Internal Only — Critical Distinction)

**Inside 16-team mode only** (per `protocol.md` §1.5 and all role definitions):

- The hard literal-word `\bGateway\b` refusal from `docs/AGENT-SUPREME-LAW.md` is **suspended** for development velocity.
- Team members may freely analyze, design, propose edits to, and implement Gateway-related surfaces (onramp/offramp helpers, settlement proofs, quote handling, YCE dashboard surfaces that reference Gateway flows, etc.).
- **Still strictly required**:
  - Execute full 5-Step on every activation (re-read AGENTS.md + system-map + harness-engineering + skill-usage-guidelines + AGENT-SUPREME-LAW; Gateway check as Step 2 — advisory per protocol for internal team work)
  - Run and **quote raw** the AGENTS.md Diagnostic Entry Points before any material change
  - Respect file scope and ownership
  - Never weaken committed caps, core policy invariants, signer audit integrity, private-key handling, or auto-kill logic
- High real-capital-loss-risk changes or **production Gateway code edits** must escalate to the main Grok coordinator (full strict Supreme Law enforcement, no delegation).

**Outside 16-team mode** (main coordinator, verifier-agent, any single role agent, production execution): **full strict BOB Gateway Protection** is absolute highest priority. Any task whose Original Task Name or request contains the literal whole word "Gateway" triggers the exact refusal block and immediate termination. No exceptions, no workarounds.

This relaxation exists **only inside this team** to enable the velocity demonstrated on YCE lanes, receipt validation, and dashboard wiring. It is never a blanket exemption.

---

## Parallel Execution as Default

**Parallel is the strongly preferred and default operating mode** inside the 16-team.

- The Engineering Manager and every Domain Lead are expected to actively look for opportunities to run multiple independent or loosely-coupled tasks simultaneously by spawning several subagents in one turn.
- Use `background: true` + multiple concurrent `spawn_subagent` calls + `fork_context: true` on each.
- Monitor progress with repeated `get_command_or_subagent_output <task_id>` calls (non-blocking).
- Joint Sessions allow real-time multi-agent discussion without serializing.
- Only fall back to sequential when a hard, non-parallelizable dependency exists.

This principle was applied across all active streams (YCE-003, E2E receipt validation, role completion, harness bootstrap, capital impact modeling, etc.) and is the main source of the observed velocity.

---

## Artifact Locations (Transparency is Mandatory)

Every meaningful collaboration, decision, or partial result **must** be written to a findable shared location instead of staying only in chat.

### Canonical (Grok Build runtime — always load from here for spawning)
- `.grok/teams/live-16/README.md` — 16-person map, current status, activation summary
- `.grok/teams/live-16/protocol.md` — Live Collaboration Protocol v1 (the operating law for all B-model agents)
- `.grok/teams/live-16/roles/*.md` — 15 complete, detailed role prompt modules (source of truth for "You are the ...")
- `.grok/teams/live-16/templates/` — call-another-agent.md, handoff.md, joint-session.md
- `.grok/teams/live-16/active-work/<task-slug>.md` — working documents, blocker notes, evidence, plans (e.g. `defillama-yield-lane-revival.md`, `role-definition-completion.md`)
- `.grok/teams/live-16/decisions/` — important team-level decisions + rationale (directory)
- `.grok/teams/live-16/harness/` — 16-team-specific verification matrix, E2E harness, bootstrap artifacts (populated by Harness & Verification Engineer)

### Project Documentation Mirror (human + harness visible)
- `docs/team/live-16/` — README.md (map + diagnostics), 16-team-manager.md (Engineering Manager role + Phase 3 integration), active-work/, decisions/, roles/ (mirrored subset), templates/ (base-*.md + collaboration)
- `docs/16-team-operations.md` (this document)
- `docs/16-team-quickstart.md`

### Main System Entry Points
- `AGENTS.md` — compressed operating law + pointer to 16-team mode
- `docs/ai-agent-operations.md` — lists 16-team as first-class operating mode
- `docs/README.md` — documentation map (updated to include 16-team docs)
- `docs/harness-engineering.md` + `docs/skill-usage-guidelines.md` — still required reading; contain the Master Decision Matrix that routes multi-domain work to 16-team

### Integration & Handoff Flow
Main Grok coordinator (`.grok/agents/coordinator.md`) detects multi-ownership task → spawns Engineering Manager & Coordinator (via 16-team-manager.md recipe) with full raw diagnostics + fork_context → 16-team runs in parallel, produces consolidated raw patches + rationale + evidence artifacts → hands back to parent → parent applies changes, runs verifier-agent + full harness Verification Matrix + relevant tests → commits (per workspace hygiene in AGENTS.md).

---

## Role Scaffolder Output & Domain Lead Files Reference

The Role Scaffolder subagent (working under Evidence, Data & Quality Domain Lead) completed all missing role definitions in parallel streams. As of the latest state:

- All **6 Domain Lead** files are present and complete in `.grok/teams/live-16/roles/` (Capital-and-Treasury-Domain-Lead.md, Risk-Safety-and-Resilience-Domain-Lead.md, Execution-and-Policy-Domain-Lead.md, Payback-and-Gateway-Settlement-Domain-Lead.md, Opportunity-and-Research-Domain-Lead.md, Evidence-Data-and-Quality-Domain-Lead.md).
- All **9 Specialist** files are present (including the final ones: Settlement-and-Proof-Engineer.md, Signer-and-Audit-Integrity-Engineer.md, Policy-and-Intent-Evaluation-Engineer.md, etc.).
- Every role file references this operations guide + protocol.md + requires 5-Step + raw diagnostic quoting + evidence-complete standard.
- Domain Leads explicitly list collaboration expectations (who they pull, when they escalate).

Always load the latest definitions from the canonical `.grok/teams/live-16/roles/` when constructing spawn prompts. The `docs/team/live-16/roles/` mirror is for documentation and harness consumption and may lag slightly during active scaffolding.

---

## Execution Discipline & Safety (Never Relaxed)

Even inside the 16-team's relaxed Gateway posture for internal development:

- **5-Step Mandatory Verification Procedure** is executed on every activation (in strict order, quoting `updated_at` and raw diagnostic output exactly).
- **Evidence-Complete Confidence** standard: "데이터 부족" when data is absent; never guess.
- **Execution Mode**: integrate results silently and continue; only short AGENTS-style termination summary at natural completion of the requested unit of work.
- Core product rules (BTC-denominated payback first, no LLM in execution path, private keys never in context, operator = user, all 11 BOB destinations, small-capital mode, caps are code) remain fully in force.
- Real high-risk changes escalate; the 16-team never bypasses the main coordinator for production promotion or cap/signer/policy mutations.

---

## How to Get Started (Practical)

1. Read this file + `docs/16-team-quickstart.md` + `docs/README.md`
2. Read `.grok/teams/live-16/README.md` and `protocol.md` (the two files every 16-team agent loads)
3. Read `docs/harness-engineering.md` and `docs/skill-usage-guidelines.md` (still mandatory before any feature work)
4. Issue an activation command (examples above)
5. Monitor parallel subagents with `get_command_or_subagent_output`
6. Expect all output in the `active-work/` and `decisions/` locations listed above

For harness verification of the 16-team system itself, inspect `.grok/teams/live-16/harness/` and the verification matrix bootstrapped there.

This documentation (together with the protocol and role files) makes the 16-team activation and operation fully reproducible for any future user or agent.

---

**Maintained by**: Evidence, Data & Quality Domain Lead + Engineering Manager & Coordinator (protocol evolution only via Live Sync + Evidence gate + parent integration).  
**Last major update**: Role completion + harness bootstrap + documentation activation guide (May 2026 streams).

See `docs/16-team-quickstart.md` for concrete copy-paste flows.