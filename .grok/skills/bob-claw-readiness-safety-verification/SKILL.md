---
name: bob-claw-readiness-safety-verification
description: Use when verifying BOB Claw readiness, live-safety status, or blocker state before making code, dashboard, deploy, or operational claims in this repo. This is the Grok Build native version. References docs/AGENT-SUPREME-LAW.md for Supreme Law instead of embedding full verbatim blocks.
---

# BOB Claw Readiness Verification (Grok Native)

This skill follows the rules defined in `docs/AGENT-SUPREME-LAW.md`.

**Key differences from legacy version:**

- Does not embed the full Supreme Law verbatim (to reduce duplication).
- Must read `docs/AGENT-SUPREME-LAW.md` in Step 1 of the 5-step procedure.
- Uses the canonical version of BOB Gateway Protection, 5-Step, and Execution Mode.

When activated, follow the 5-Step Mandatory Verification Procedure from `docs/AGENT-SUPREME-LAW.md` exactly.

## 5-Step Mandatory Verification Procedure (detailed)

**Step 1: Re-read core documents**

- Re-read in full: `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, `docs/skill-usage-guidelines.md`.
- Quote the `updated_at` / version headers to prove freshness.

**Step 2: BOB Gateway Protection literal-word check**

- Perform deterministic string match for `\\bGateway\\b` against `Original Task Name:` and the full user request.
- If detected → immediately output the exact refusal block and halt. This step has absolute priority.

**Step 3: Enforce file scope and ownership**

- Confirm that 100% of the task lies inside the declared ownership (per frontmatter `description` and the Role Agents table in `docs/ai-agent-operations.md`).
- If any part touches another agent's ownership or a Gateway surface → refuse and return the task to the parent.

**Step 4: Execute required diagnostics and graphify**

- Run the exact AGENTS.md Diagnostic Entry Point(s) matching the question type.
- For topology/caller/path questions, run `npm run graph:focus -- query|explain|path` first.
- Always paste the _exact raw command output_ (never summarized).

**Step 5: Final hygiene verification**

- Run `git diff --stat`, `git diff --name-only`, caller search (`rg`), and the relevant row from the harness Verification Matrix.
- Only then produce the deliverable.
- Never emit unsolicited multi-item checklists or Lx-style status reports.

## Usage

Use this skill for:

- Full automation readiness checks
- Blocker identification
- Pre-deploy safety verification
- Capital flow / payback readiness

Can dispatch to native agents under `.grok/agents/` (verifier-agent, coordinator) when needed.

This is the recommended version for Grok Build sessions.

All output must be evidence-first and compact. No unsolicited status reports.
