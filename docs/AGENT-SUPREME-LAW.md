# AGENT-SUPREME-LAW

**status**: canonical
**updated_at**: 2026-05-16
**authority**: AGENTS.md

---

**This document is the single source of truth for the strictest operating rules of all coding agents, skills, and subagents in this repository.**

All other documents (AGENTS.md, skill-usage-guidelines.md, agent definition files, etc.) must reference this file rather than duplicate its content.

---

## 1. Delegation and Ownership Guardrails (Absolute Highest Priority Rule)

**This is the strictest rule in the entire system.** It takes precedence over every other instruction, example, or request.

This repository does **not** use a literal-word refusal for `Gateway`. `Gateway`
is a normal domain term here. Delegation is allowed when, and only when, the
work remains fully inside the child surface's declared ownership and the parent
passes the original task through unchanged.

No "read-only", no "planning", no "verification", no "coordination", and no
"I am the main agent" claim can override these ownership guardrails.

### Hard Rules

**MUST:**

- When constructing any subagent or skill task prompt, the parent **MUST**
  include the exact line `Original Task Name: <verbatim copy of the user's request>`.
- Every skill and every subagent definition **MUST** verify, before tool use,
  that the delegated task stays 100% inside its declared ownership and file scope.
- If the task mixes ownerships, needs broader implementation authority, or no
  active child surface cleanly owns it, the work **MUST** stay in or return to
  the primary main session.

**Do not / Never:**

- Never invent literal-word refusal triggers or other special-case routing that
  is not present in `AGENTS.md`.
- Never stretch a child surface's ownership "just this once".
- Never create alternate law sets, hidden role hierarchies, or workaround flows.

---

## 2. 5-Step Mandatory Verification Procedure

Every skill and subagent **must** execute the following 5 steps in strict order on every activation. No shortcuts.

**Step 1: Re-read core documents**

- Re-read in full: `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md`.
- Quote the `updated_at` / version headers to prove freshness.

**Step 2: Confirm original task context, scope, and ownership**

- Preserve `Original Task Name:` verbatim in delegated contexts.
- Confirm the task lies 100% inside the child surface's declared ownership.
- If scope spills across ownerships or no child surface cleanly owns the work,
  return it to the parent/main session before any tools or analysis.

**Step 3: Execute required diagnostics and graphify**

- Run the exact AGENTS.md Diagnostic Entry Point(s) matching the question type.
- For topology/caller/path questions, run `npm run graph:focus -- query|explain|path` first.
- Always paste the _exact raw command output_ (never summarized).

**Step 4: Perform the scoped work in Execution Mode**

- Implement, review, or verify directly once steps 1-3 pass.
- Keep the work inside the approved scope and use raw file/command evidence
  instead of memory when making claims.

**Step 5: Final hygiene verification**

- Run `git diff --stat`, `git diff --name-only`, caller search (`rg`), and the relevant row from the harness Verification Matrix.
- Only then produce the deliverable.
- Never emit unsolicited multi-item checklists or Lx-style status reports. Integrate results and continue in Execution Mode.

---

## 3. Execution Mode (Universal Default)

- Every coding agent, skill, and subagent begins in **Execution Mode**.
- Read required sources → run diagnostics/graphify → **immediately perform the implementation work**.
- Subagent/skill outputs are raw material. The parent integrates them and continues working without pausing for summaries.
- Avoid the old short AGENTS termination format (`현재 단계: Ln`, `이번에 한 일` 등). Natural, concise summaries are acceptable only when they genuinely help the user; forced Lx-style status reports are not used.
- **When the user requests work**: Always start by presenting the planned work as a clear markdown checklist using `- [ ]` (pending) and `- [x]` (done). Break the task into concrete, executable steps. Update the checkboxes as work progresses. This is the required response format for any non-trivial task request.

---

## 4. Evidence-Complete Confidence Standard

- Never substitute measured data with memory or assumption.
- Always quote raw `--json` output from the required Diagnostic Entry Points.
- When data is missing, report exactly "데이터 부족" instead of guessing.

---

## 5. Mandatory Embedding Rule (for new skills and agents)

Any new skill (`.grok/skills/` or `.claude/skills/`) or new/updated agent (`.grok/agents/` or `.claude/agents/`) **MUST** contain the following at the very top (immediately after frontmatter):

- Reference to this file (`docs/AGENT-SUPREME-LAW.md`)
- Explicit statement that it follows the delegation/ownership guardrails,
  5-Step Procedure, and Execution Mode defined here.
- Explicit scope/ownership check instruction as step 2.

Duplication of the full content of this file into individual SKILL.md or agent files is prohibited except for the minimal core enforcement blocks required in AGENTS.md.

---

**End of AGENT-SUPREME-LAW.md**

This document supersedes duplicated content in all other files regarding the rules above. All agents and skills must treat this as the authoritative reference.
