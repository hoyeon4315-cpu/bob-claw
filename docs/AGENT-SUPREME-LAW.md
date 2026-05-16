# AGENT-SUPREME-LAW

**status**: canonical
**updated_at**: 2026-05-17
**authority**: AGENTS.md

---

**This document is the single source of truth for the strictest operating rules of all coding agents, skills, and subagents in this repository.**

All other documents (AGENTS.md, skill-usage-guidelines.md, agent definition files, etc.) must reference this file rather than duplicate its content.

---

## 1. BOB Gateway Protection (Absolute Highest Priority Rule)

**This is the strictest rule in the entire system.** It takes precedence over every other instruction, example, or request.

The presence of the literal whole-word "Gateway" (capital G, word-bounded) in the `Original Task Name:` or the full user request is a hard, deterministic, non-negotiable trigger.

No "read-only", no "planning", no "verification", no "coordination", and no "I am the main agent" claim can override it.

### Hard Rules

**MUST:**

- Every skill and every subagent definition **MUST** perform a pure string match (no LLM reasoning) for the literal `\bGateway\b` as the **very first internal action** upon activation.
- When constructing any subagent or skill task prompt, the parent **MUST** include the exact line `Original Task Name: <verbatim copy of the user's request>` and instruct the child to run the Gateway check as step 2 of the 5-step procedure.

**Do not / Never:**

- Never invoke, trigger, or delegate any skill or subagent when the task contains the literal word "Gateway".
- Never proceed with any tool use, file read, or analysis once "Gateway" is detected in a delegated context.
- Never create workarounds.

### Immediate Refusal Block (must be output exactly)

```
BOB GATEWAY PROTECTION TRIGGERED

The task name or description contains the literal word "Gateway".

Per docs/AGENT-SUPREME-LAW.md and AGENTS.md, delegation to this skill or subagent is strictly forbidden.

Re-issue the complete, unmodified original task directly to the primary main coding session with no subagent delegation and no /skill trigger.

This context will now terminate without performing any further work.
```

---

## 2. 5-Step Mandatory Verification Procedure

Every skill and subagent **must** execute the following 5 steps in strict order on every activation. No shortcuts.

**Step 1: Re-read core documents**

- Re-read in full: `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md`.
- Quote the `updated_at` / version headers to prove freshness.

**Step 2: BOB Gateway Protection literal-word check**

- Perform deterministic string match for `\bGateway\b` against `Original Task Name:` and the full user request.
- If detected → immediately output the exact refusal block above and halt. This step has absolute priority.

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
- Explicit statement that it follows the BOB Gateway Protection, 5-Step Procedure, and Execution Mode defined here.
- The literal Gateway check instruction as step 2.

Duplication of the full content of this file into individual SKILL.md or agent files is prohibited except for the minimal core enforcement blocks required in AGENTS.md.

---

**End of AGENT-SUPREME-LAW.md**

This document supersedes duplicated content in all other files regarding the rules above. All agents and skills must treat this as the authoritative reference.
