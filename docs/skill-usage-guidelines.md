---
status: canonical
updated_at: 2026-05-16
policy_authority: AGENTS.md
derived_from:
  - AGENTS.md
  - docs/AGENT-SUPREME-LAW.md
  - docs/system-map.md
  - docs/harness-engineering.md
  - docs/ai-agent-operations.md
---

# Skill Usage Guidelines

This document defines the **current** delegation model for optional agent and
skill use in BOB Claw. `AGENTS.md` remains the operating law; this file is the
implementation map for when delegation is actually helpful.

## Scope

- Codex main session remains the default place to do the work.
- Grok may use the thin prompt files under `.grok/`.
- There is no active 16-team system, reviewer-agent, or role-swarm workflow.
- `docs/superpowers/**` may provide planning aids, but not runtime authority.

## Before editing this doc or any Grok agent/skill surface

Run and quote the raw outputs of:

- `npm run report:capital-audit -- --json`
- `node src/cli/check-full-automation-readiness.mjs --json`
- `node src/cli/plan-capital-manager-refill-jobs.mjs --json`
- `npm run report:payback-status -- --json`
- `npm run check:skills-config`

Then run the narrow relevant checks from `docs/harness-engineering.md`.

## Non-negotiable law

The strictest rules live in `docs/AGENT-SUPREME-LAW.md`:

- Delegation and ownership guardrails
- 5-step Mandatory Verification Procedure
- Execution Mode
- Evidence-complete confidence

Every `.grok/agents/*.md` and `.grok/skills/*/SKILL.md` file must reference that
law and follow it.

There is **no** repo rule that treats the word `Gateway` as an automatic refusal
trigger. Gateway work follows the same ownership and verification rules as any
other task.

## Active Grok surfaces

| Surface                                                        | Purpose                                              | When to use                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| `.grok/agents/coordinator.md`                                  | Thin Grok router aligned to AGENTS                   | Only when a Grok session needs a small amount of routing help |
| `.grok/agents/verifier-agent.md`                               | Read-only post-edit verification                     | After meaningful edits or when user asks to review/check work |
| `.grok/skills/bob-claw-readiness-safety-verification/SKILL.md` | Raw readiness/capital/payback/dashboard truth checks | Safety, blocker, readiness, or status questions               |

## Delegation matrix

| Situation                                 | Action                                                  | Notes                          |
| ----------------------------------------- | ------------------------------------------------------- | ------------------------------ |
| Small isolated change                     | Direct execution in the main session                    | Default path                   |
| Caller / topology / path question         | Run `npm run graph:focus -- query\|explain\|path` first | Limit reads before delegating  |
| Readiness / blocker / capital-state claim | Use readiness skill                                     | Raw diagnostics must be quoted |
| Post-edit review / residual risk          | Use verifier-agent                                      | Read-only                      |
| Anything else                             | Stay in main session                                    | Do not invent extra agents     |

## Prohibited patterns

- Treating the word `Gateway` as a special refusal trigger
- Delegating work outside the child surface's declared ownership
- Referencing or spawning `reviewer-agent`
- Referencing or spawning `16-team-manager`
- Using `.grok/teams/live-16/`
- Re-activating `.claude/agents/*` or `.claude/skills/*` role swarms as the
  active runtime
- Embedding runtime-specific orchestration APIs as repo law when `AGENTS.md`
  already covers the rule

## Source vs generated agent surfaces

| Treat as source                   | Treat as generated / operational          |
| --------------------------------- | ----------------------------------------- |
| `.grok/agents/*.md`               | logs, audit JSON, scratch outputs         |
| `.grok/skills/*/SKILL.md`         | temporary reports under `data/` or `/tmp` |
| `docs/skill-usage-guidelines.md`  | ad-hoc handoff notes                      |
| `docs/ai-agent-operations.md`     | runtime transcripts                       |
| `scripts/check-skills-config.mjs` | generated reference docs                  |
| `test/skills-config.test.mjs`     | temp validation fixtures                  |

## Updating Grok agent surfaces

1. Update this document if the active runtime model changes.
2. Keep the prompt file narrow and reference `docs/AGENT-SUPREME-LAW.md`.
3. Run `npm run check:skills-config`.
4. Run `node --test test/skills-config.test.mjs`.
5. Run the narrow harness checks for the touched area.

If a prompt needs a new role hierarchy or a new runtime rule, that belongs in a
deliberate design change — not in an ad-hoc prompt edit.
