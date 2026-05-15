# BOB Claw Documentation Map

This page is the documentation entry point. Keep `AGENTS.md` small enough to load as operating law; move runbooks and implementation notes here.

## Read First

1. `AGENTS.md` - source of truth for product model, safety rules, risk limits, reporting style, and current operator memory pointers.
2. `docs/system-map.md` - canonical engineering map for runtime, strategies, dashboard, generated artifacts, and known historical contradictions.
3. `docs/harness-engineering.md` - required checklist before feature, policy, dashboard, cleanup, commit, or push work.
4. `docs/skill-usage-guidelines.md` - automatic skill judgment for coding agents under Execution Mode (Master Decision Matrix for 12 BOB Claw situations, BOB Gateway Protection, graphify-first rule, subagent patterns, and 5-step Mandatory Verification with diagnostic re-execution).
5. `CLAUDE.md` - short bootstrap for Claude Code sessions.
6. `docs/operator-memory.md` - dated implementation/status memory archive. Read only when historical context is needed.
7. `docs/ai-agent-operations.md` - Ollama + Claude Code + subagent setup.
8. `docs/current-status.md` - generated/local status snapshot when present. Treat it as operational output, not policy.

## Active Runbooks / Role-Specific Workflows

- `docs/codex-playbook.md` - coding-agent prompt discipline and repo-specific traps.
- `docs/system-map.md` - current architecture and source/generated/audit boundaries.
- `docs/harness-engineering.md` - testing, staging, cleanup, and dashboard harness rules.
- `docs/skill-usage-guidelines.md` - enables automatic skill judgment for coding agents under Execution Mode (12-situation Master Decision Matrix routes to graphify skill, readiness-safety-verification skill, bob-claw-coordinator parallel subagents, or direct Execution Mode; enforces BOB Gateway literal protection and diagnostic CLI re-execution).
- `docs/reference/agent-automation-reference.generated.md` - generated command and source-area reference for agent sessions (`npm run docs:generate`).
- `docs/operator-memory.md` - dated operator memory archive kept out of the always-loaded operating law.
- `docs/merkl-protocol-bindings.md` - Merkl protocol binding registry and orchestrator details.
- `docs/dashboard-context.md` - required reading before dashboard UI changes.
- `docs/known-failures-2026-04-22.md` - known test failure context.
- `docs/research/README.md` - research source index.

## Hygiene Rules

- Put durable rules in `AGENTS.md`.
- Put tool setup, launch commands, and role-specific workflows in a focused `docs/*.md` runbook.
- Put generated status and dashboard JSON in generated artifacts, not in policy docs.
- Archive superseded plans under `docs/_archive/` instead of leaving several competing “current” plans.
