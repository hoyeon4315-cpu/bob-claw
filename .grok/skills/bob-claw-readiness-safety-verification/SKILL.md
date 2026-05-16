---
name: bob-claw-readiness-safety-verification
description: Use when verifying readiness, live-safety state, blockers, payback status, or capital-state claims in Grok sessions. Follows docs/AGENT-SUPREME-LAW.md instead of embedding a separate rule set.
---

# BOB Claw Readiness Verification (Grok Native)

This skill follows `docs/AGENT-SUPREME-LAW.md` and exists to make Grok sessions
behave like Codex sessions for safety-sensitive status questions.

Follow the literal `Gateway` check as step 2 of the 5-step procedure and remain
in **Execution Mode** while collecting diagnostics.

## Use this skill for

- full automation readiness checks
- blocker identification
- pre-deploy or safety claims
- capital / payback / dashboard truth checks

## Required execution

1. Run the full 5-step procedure from `docs/AGENT-SUPREME-LAW.md`.
2. Execute the exact AGENTS diagnostic entry point for the question:
   - `npm run report:capital-audit -- --json`
   - `node src/cli/check-full-automation-readiness.mjs --json`
   - `node src/cli/plan-capital-manager-refill-jobs.mjs --json`
   - `npm run report:payback-status -- --json`
   - `dashboard/public/dashboard-status.json`
3. Quote the raw output directly.
4. If topology or caller analysis is needed, run `npm run graph:focus -- query|explain|path`.

## Boundaries

- Do not invent new status values or fill gaps from memory.
- Do not use `.claude/` prompts, `reviewer-agent`, `16-team-manager`, or
  `.grok/teams/live-16/`.
- If the task is no longer a readiness/safety/status question, return control to
  the parent session or verifier-agent.
