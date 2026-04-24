# BOB Claw Documentation Map

This page is the documentation entry point. Keep `AGENTS.md` small enough to load as operating law; move runbooks and implementation notes here.

## Read First

1. `AGENTS.md` - source of truth for product model, safety rules, risk limits, reporting style, and current operator memory.
2. `CLAUDE.md` - short bootstrap for Claude Code sessions.
3. `docs/ai-agent-operations.md` - Ollama + Claude Code + subagent setup.
4. `docs/current-status.md` - generated/local status snapshot when present. Treat it as operational output, not policy.

## Active Runbooks

- `docs/codex-playbook.md` - coding-agent prompt discipline and repo-specific traps.
- `docs/merkl-protocol-bindings.md` - Merkl protocol binding registry and orchestrator details.
- `docs/dashboard-context.md` - required reading before dashboard UI changes.
- `docs/known-failures-2026-04-22.md` - known test failure context.
- `docs/research/README.md` - research source index.

## Hygiene Rules

- Put durable rules in `AGENTS.md`.
- Put tool setup, launch commands, and role-specific workflows in a focused `docs/*.md` runbook.
- Put generated status and dashboard JSON in generated artifacts, not in policy docs.
- Archive superseded plans under `docs/_archive/` instead of leaving several competing “current” plans.
