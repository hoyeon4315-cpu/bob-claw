# Decision Record: Parallel Execution as Default Principle for 16-Person Live Team (B Model)

**ID**: DEC-2026-05-16-004-PARALLEL-DEFAULT  
**Date**: 2026-05-16 (added to protocol.md after user confirmation "진행해"; reinforced in multiple sessions)  
**Status**: Adopted (Enforced in all spawns, templates, role definitions, 16-team-manager.md)  
**Recorded by**: Policy & Intent Evaluation Engineer (Team Governance & Decisions Track)

## Rationale
In the B Model, sequential single-agent work is inefficient for a 16-person team. Parallel work (multiple independent or loosely-coupled tasks via simultaneous `spawn_subagent` with `background: true` + `fork_context: true`) is the **default and strongly recommended** approach.

The Engineering Manager and Domain Leads must actively seek opportunities to run multiple subagents in parallel rather than processing work sequentially. This was explicitly requested by user and baked into the protocol as a permanent principle.

This directly enabled the first pilot (multiple agents on DefiLlama revival + concurrent role completion Stream D) and the current 7+ subagent total mobilization.

## Evidence (Verbatim Quotes)
From .grok/teams/live-16/protocol.md (Core Principles, #6):
> "**6. **Parallel Execution as Default**  
In the 16-person Live Team (B Model), parallel work is the default and strongly recommended approach.  
The Engineering Manager and Domain Leads must actively look for opportunities to run multiple independent or loosely coupled tasks simultaneously by spawning several subagents in parallel, rather than processing work sequentially.  
Use `background: true`, `fork_context: true`, and simultaneous multi-agent spawning whenever appropriate.  
This principle applies across all sessions."

From memory (2026-05-16-interval-019e2e25.md):
> "User reinforced request to encourage sub-agents to treat parallel work as standard/default practice, explicitly including enforcement in new sessions.
> Confirmed and executed addition of "Parallel Execution as Default" principle to protocol.md after user said "진행해", making it permanent for the 16-person Live Team (B Model) across all sessions.
> Background subagent (Yield Engineer review of YCE-002 schema) completed successfully in parallel, validating the approach of spawning multiple independent sub-agents."

From 16-team-manager.md (Invocation & Live Collaboration Protocol):
> "- Context Fork + Parallel Background Spawn (default)
> - Joint Session for evidence synthesis / cross-domain (multiple background subagents append to same active-work doc)
> - Parallel Execution as Default"

From current parent session context (7 subagents spawned in parallel for remaining work including this governance track, YCE-003 wiring, Phase 3, role scaffolding, E2E tests, etc.):
> "✅ 남은 작업 7개 subagent 병렬 총동원 완료.  
현재 live subagent: **7개** ... Parallel Execution as Default in action."

From active-work/role-definition-completion.md and defillama files: multiple parallel contributions and Stream D finalization concurrent with pilot.

## Implications
- **Spawn pattern**: Every non-trivial task looks for parallelizable sub-tasks (e.g. one agent on receipt validation, one on surfaces/policy, one on capital impact, one on docs/decisions).
- **Monitoring**: Parent uses repeated `get_command_or_subagent_output` + wait_commands_or_subagents to track without blocking.
- **Artifact convergence**: All append to shared active-work/*.md or decisions/ with timestamps + role + evidence.
- **My work (this track)**: This governance decisions population was run as an independent parallel task ("Your new parallel task (independent of the 7 already running)").
- **Performance**: First pilot + role completion + YCE-001/002/003 E2E + Phase 3 doc all advanced concurrently in <1 day.
- **Templates**: base-lead.md, base-specialist.md, joint-session.md all instruct "parallel default".

**Related Files**:
- /Users/love/BOB Claw/.grok/teams/live-16/protocol.md
- /Users/love/BOB Claw/.grok/teams/live-16/16-team-manager.md (and templates/base-*.md)
- /Users/love/BOB Claw/.grok/teams/live-16/active-work/defillama-yield-lane-revival.md (Joint Session with 4 parallel agents)
- /Users/love/BOB Claw/.grok/teams/live-16/active-work/role-definition-completion.md (parallel role creation)
- All current background subagent task_ids (e.g. 019e2e9a-* series for YCE-003, Phase 3, etc.)

**Owner / Policy Note**: Parallelism increases surface area for policy evaluation. As Policy & Intent Evaluation Engineer I must ensure every parallel branch still runs full diagnostics, attaches policy verdicts, and converges on consistent intent/state before any execution surface change. No parallel path may bypass the policy spine.

---
*Recorded under Team Governance & Decisions Track. Parallelism is now the operating default.*
