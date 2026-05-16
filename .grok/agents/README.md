# .grok/agents/

This directory contains Grok Build native role agents.

These agents are designed for the Grok Build `task` tool and subagent system.

Legacy Claude Code agents remain in `.claude/agents/` and are marked with [LEGACY].

Recommended agents to develop here:

- verifier-agent (implemented — robust sustained verification chain + todo + raw quote + matrix row 12)
- coordinator (implemented — persistent multi-turn router + spawn dispatch + integrate-and-continue + Master Decision Matrix + 5-step enforcement + 16-Team Mode Entry Point wiring)
- 16-team-manager (implemented — B-Model Live Team bridge: detects "16-team으로"/"/16-team" + opportunity/yield lane tasks, spawns full 16-person squad via .grok/teams/live-16/ protocol + roles + active-work/, hands high-risk back; Phase 3 integration complete)
- Other role agents as needed (e.g. payback, treasury, strategy when ownership expands)

These now contain the operational glue (todo_write at start, min 8-12 iterations, silent integrate after every spawn/result, only short AGENTS termination at natural end) required to prevent 15-18s "Turn completed" loops and enable deep Execution Mode progress in the Grok Build subagent system.

All agents in this directory must follow `docs/AGENT-SUPREME-LAW.md`.
