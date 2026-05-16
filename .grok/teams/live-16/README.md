# BOB Claw 16-Person Live Team (B Model)

**Status**: Phase 2 complete: 16/16 roles + harness bootstrap (Active Development Mode)  
**Purpose**: High-velocity, flexible, real-time collaborative AI engineering team for BOB Claw feature work, research, refactoring, and automation advancement.

This is a **specialized development squad** running on Grok Build native. It sits alongside (not replacing) the main `.grok/agents/coordinator.md`.

## Team Structure (Level 2 Hybrid)

- **1 Engineering Manager & Coordinator** (you in this mode)
- **6 Domain Leads** (high autonomy, portfolio responsibility)
- **9 Specialists** (T-shaped, fluid within/across domains)

See `roles/` for individual role definitions.

## How to Use This Team

### 1. Activate 16-Team Mode
Tell the main session:
- "16-team으로 시작해"
- "16인 라이브 팀으로 이 작업 해줘"
- "/16-team <task description>"

See `docs/16-team-operations.md` (full activation guide, when-to-use matrix, relaxed policy details, artifact map, integration with main coordinator) and `docs/16-team-quickstart.md` (copy-paste examples for YCE, multi-domain, verification flows) for the complete user-facing instructions.

The Engineering Manager (you) loads this README, `protocol.md`, the 16 role definitions from `roles/`, fresh raw diagnostics, and the relevant `active-work/` + `decisions/` context, then spawns Domain Leads and Specialists in parallel.

### 2. Core Operating Rules (B Model)
- Agents **directly address each other** by role name ("Capital Systems Domain Lead, ...").
- Domain Leads are active **hubs** — they pull specialists, coordinate, and make portfolio decisions.
- Use **fork_context** + rich handoff when bringing in another agent.
- All meaningful collaboration leaves a trace in `active-work/` or `decisions/`.
- **Relaxed Gateway Policy** applies **only inside this team** (see `protocol.md`).

### 3. Current 16 Roles (Summary)

**Domain Leads**
- Capital & Treasury Domain Lead
- Risk, Safety & Resilience Domain Lead
- Execution & Policy Domain Lead
- Payback & Gateway Settlement Domain Lead
- Opportunity & Research Domain Lead
- Evidence, Data & Quality Domain Lead

**Specialists**
- Refill & Capital Automation Engineer
- Allocation & Rebalancing Specialist
- Resilience & Self-Healing Engineer
- Policy & Intent Evaluation Engineer
- Signer & Audit Integrity Engineer
- Settlement & Proof Engineer
- Yield & Campaign Opportunity Engineer (very broad)
- Protocol Reader & On-chain Data Engineer
- Receipt & Reconciliation Engineer

Full definitions: `roles/<role-name>.md`

**All 16 role definitions complete (6 Domain Leads + 9 Specialists + Engineering Manager & Coordinator).**

**Domain Leads (6)**: `Capital-and-Treasury-Domain-Lead.md`, `Risk-Safety-and-Resilience-Domain-Lead.md` (new), `Execution-and-Policy-Domain-Lead.md` (new), `Payback-and-Gateway-Settlement-Domain-Lead.md` (new), `Opportunity-and-Research-Domain-Lead.md`, `Evidence-Data-and-Quality-Domain-Lead.md`

**Specialists (9)**: `Refill-and-Capital-Automation-Engineer.md`, `Allocation-and-Rebalancing-Specialist.md` (new), `Resilience-and-Self-Healing-Engineer.md` (new), `Policy-and-Intent-Evaluation-Engineer.md`, `Signer-and-Audit-Integrity-Engineer.md`, `Settlement-and-Proof-Engineer.md`, `Yield-and-Campaign-Opportunity-Engineer.md`, `Protocol-Reader-and-On-chain-Data-Engineer.md`, `Receipt-and-Reconciliation-Engineer.md`

All role files now exist in `roles/` with consistent B-Model structure (Type, Core Mission, Key Areas, Collaboration Expectations, How to Call, Flexibility & Evolution Rule, Operating Style, Evidence alignment, and protocol.md references). Stream D role scaffolding task complete under Evidence, Data & Quality Domain Lead.

## Harness & Verification

**The 16-team harness is now live.** All 16 roles (1 Engineering Manager/Coordinator orchestration + 6 Domain Leads including the 5 newly created + 9 Specialists) have activation paths and self-test procedures.

- **`harness/activate-role.mjs`** — Executable ES module for role activation/validation/spawn.  
  Commands: `--help`, `--list` (all 15 + EM), `--validate "Exact Role Name"`, `--validate-all` (15/15 PASS per bootstrap), `--spawn-example "Role Name"` (prints ready-to-paste Direct Call prompt using `templates/call-another-agent.md` + `protocol.md` + `fork_context: true`).

- **`harness/verification-matrix.md`** — Complete Role Activation Matrix (all 16 roles with file paths, activation status, key responsibilities excerpts, basic activation tests), Role Self-Test Checklists (8-item for Domain Leads, 9-item for Specialists, EM notes), and the full **Internal Readiness-Safety-Verification Procedure** (5-step mandatory for 16-team before any Direct Call, Joint Session, handoff, claim in `active-work/`/`decisions/`, or surface work). Requires re-reading protocol + role def + `activate-role.mjs` validation + raw AGENTS.md diagnostics + shared artifact.

**Bootstrap artifact & completion**: 
- `active-work/16-team-harness-verification-bootstrap.md` (Harness & Verification Engineer handoff to Evidence Lead + EM, with raw validation outputs and hygiene).
- `active-work/role-definition-completion.md` (Role Scaffolder task under Evidence, Data & Quality Domain Lead — 5 missing role files created and verified).
- `active-work/role-activation-tests.md` (activation test results).

**Ongoing YCE E2E + new Domain Lead memos** (in `active-work/`):
- YCE/DefiLlama yield lane revival: `defillama-yield-lane-revival.md`, `yce-status-consolidated.md`, `yce-surfaces-audit.md`, `yce-dashboard-status-wiring.md`, `defillama-receipt-validation.md`.
- New Domain Lead activations & memos (Risk, Safety & Resilience; Execution & Policy; Payback & Gateway Settlement; Allocation & Rebalancing; Resilience & Self-Healing) — first YCE risk, payback impact, health/self-healing, and governance inputs.
- Related: `active-work/phase3-governance-policy-input.md`.

The harness + matrix + self-test procedures make the entire 16-person Live Team (B Model) immediately usable by future users/agents. Every role is spawn-ready, self-testable, and evidence-traceable per the Live Collaboration Protocol v1. All work remains under the relaxed-but-responsible Gateway policy with full diagnostics required for any execution-surface impact.

This update reflects **Phase 2 complete: 16/16 roles + harness bootstrap**.

## Key Directories

- `roles/` — Role definition files (prompt modules) — all 15 complete (6 Domain Leads including the new ones from Role Scaffolder + 9 Specialists); see `docs/16-team-operations.md` for full list with paths
- `templates/` — Reusable collaboration prompt fragments (`call-another-agent.md`, `joint-session.md`, `handoff.md`, etc.)
- `active-work/` — Shared working documents for ongoing tasks (e.g. `defillama-yield-lane-revival.md`, `16-team-harness-verification-bootstrap.md`, `role-definition-completion.md`, `role-activation-tests.md`, `yce-status-consolidated.md`, `defillama-receipt-validation.md`, YCE E2E + new Domain Lead memos)
- `decisions/` — Team governance decisions log (index + dated DEC-*.md records)
- `harness/` — See "Harness & Verification" section above (`activate-role.mjs` + `verification-matrix.md` + bootstrap artifacts). Harness & Verification Engineer (under Evidence Lead).

## Decisions

See `decisions/decisions.md` (and the dated records in `decisions/`) for the authoritative catalog of all team-level governance decisions made during 16-person Live Team (B Model) setup and the first pilot (DefiLlama yield lane revival + YCE-001/002/003 + 16/16 role completion).

**Recorded decisions (as of 2026-05-15)**:
- DEC-2026-05-16-001: Adoption of Collaboration Model B + Live Collaboration Protocol v1
- DEC-2026-05-16-002: Relaxed but Responsible Gateway Policy (Team-Internal Only)
- DEC-2026-05-16-003: Level 2 Hybrid (6 Domain Leads with autonomy + 9 T-shaped Specialists)
- DEC-2026-05-16-004: Parallel Execution as Default
- DEC-2026-05-17-005: YCE `defillama-yield-portfolio` revival scope + receipt-backed MVP (analysis_only → shadow_ready; YCE phases proven)

All decisions are evidence-complete (raw quotes from protocol.md, active-work/, memory, diagnostics). New proposals require Live Sync Call or Direct Call to Engineering Manager + relevant Domain Lead(s) + Evidence, Data & Quality Domain Lead, then append to this log.

**Policy & Intent Note**: The Policy & Intent Evaluation Engineer (under Execution & Policy Domain Lead) maintains the governance track and is the owner of any policy/surface implications (e.g. YCE-003 promotion gate changes). High-risk decisions escalate to main `.grok/agents/coordinator.md`.

## Important Notes

- This team uses a **strongly relaxed** Supreme Law for development speed (Gateway word no longer hard-blocks).
- Real high-capital-risk or core invariant changes still escalate to the main Grok coordinator.
- All work still follows diagnostics + evidence-complete standard (just without the rigid literal-word refusal inside the team).

## Next

**User / Operator path**: Read `docs/16-team-operations.md` (activation, policy, Domain Lead reference, relaxed Gateway rules) + `docs/16-team-quickstart.md` (concrete flows) first.

**Inside the team**: Read `protocol.md` for the full Live Collaboration Protocol (B model) — this is the operating law for all agents.

Then start using the roles by spawning agents (via Engineering Manager or Domain Lead) with the templates in `templates/`, always forking context from latest `active-work/` + raw diagnostics + "Original Task Name".

All 6 Domain Lead role files (Capital-and-Treasury-Domain-Lead.md, Risk-Safety-and-Resilience-Domain-Lead.md, Execution-and-Policy-Domain-Lead.md, Payback-and-Gateway-Settlement-Domain-Lead.md, Opportunity-and-Research-Domain-Lead.md, Evidence-Data-and-Quality-Domain-Lead.md) and the full 9-specialist set are now available in `roles/` (Role Scaffolder complete).