---
name: bob-claw-readiness-safety-verification
description: [LEGACY - Claude Code only] Use when verifying BOB Claw readiness, live-safety status, or blocker state. Grok Build primary users should use the native version under .grok/skills/. This is the Claude Code compatibility version.
---

# BOB Claw Readiness And Safety Verification

`AGENTS.md` is the operating law (including the new "Automatic Judgment System for Coding Agents" section, which automatically routes readiness/blocker queries to this skill). If this skill conflicts with any repo doc or task request, follow `AGENTS.md`.

## BOB Gateway Protection, 5-Step Mandatory Verification Procedure, and Execution Mode Rules (Full Verbatim — Absolute Highest-Priority Opening Instructions)

**Verbatim Embedder compliance:** The blocks below are embedded **in full and verbatim** as the opening / highest priority instructions of this skill (immediately after frontmatter and title), per the user's task and the strict MUST requirements in the BOB Gateway Protection Hard Rules. The literal-word "Gateway" check (string-only, no LLM reasoning) is the **very first internal action** this skill must perform on every activation, before any file read, CLI, or reasoning. This skill (readiness-safety-verification) and **every new or existing skill and agent** must do this.

### Full Verbatim: BOB Gateway Protection Section (Hard Rules + Enforcement Procedure + Refusal Block)
## BOB Gateway Protection

**This is the strictest section in this document.** It takes precedence over every other instruction, example, workflow, or "helpful" behavior described anywhere in skill bodies, subagent definitions (`.claude/agents/*.md`), coordinator prompts, or user requests. It protects the single most critical surface in the entire system: the BOB Gateway BTC onramp, cross-chain transport, offramp, settlement, and payback delivery paths. Any error, hallucination, incomplete analysis, or unauthorized edit on these paths can destroy operator capital safety, break payback settlement proofs, and violate the native-BTC product model.

The presence of the literal word "Gateway" in a task name or description is a hard, deterministic, non-negotiable trigger. No context, no "read-only", no "planning only", no "verification", and no "I am the main agent" claim inside a delegated context can override it.

### Exact Language Referenced from AGENTS.md

This section implements the subagent inheritance prevention requirements stated in the **Subagent Usage** and **Coding Agent Operating Mode** sections of `AGENTS.md`:

- Subagent inheritance prevention requires: file scope, diagnostic re-execution, **Gateway protection**, and priority of this section in all subagent tasks.
- The Coding Agent Operating Mode defines default Execution Mode, reporting discipline (explicitly prohibits unprompted Lx-style status reports with checklists), execution expectation (integrate subagent results and continue implementation rather than pause for summaries), and alignment with long-term automated capital system goals while preserving safety.
- All subagent and skill activity must respect the 5-step Mandatory Verification Procedure (detailed below) with the Gateway literal-word check as an early mandatory step.

### Hard Rules (MUST / Do not / Never)

**MUST:**

- Every skill MUST, as its very first internal action upon any activation (whether triggered by `/<skillname>`, subagent dispatch, or direct prompt), deterministically inspect the full original user task title, the delegated task string, and the complete user query for the literal whole-word occurrence of `Gateway` (capital G, bounded by start-of-string, end-of-string, whitespace, or punctuation; e.g. regex `/\bGateway\b/` or equivalent string split check). This check uses only string operations — no LLM reasoning or "understanding" step is permitted for the detection itself.
- Every skill body and every subagent definition MUST embed (verbatim) the refusal template, the literal-word detection instruction, and the full 5-step Mandatory Verification Procedure as the opening instructions.
- When constructing any subagent or skill task prompt, the parent (coordinator or main agent) MUST include the exact line `Original Task Name: <verbatim copy of the user's request>` and the instruction: "Execute BOB Gateway Protection check from docs/skill-usage-guidelines.md (literal word 'Gateway' in task name) as the second step of the Mandatory Verification Procedure before reading any file or calling any tool."
- The 5-step Mandatory Verification Procedure defined in the Coding Agent Operating Mode of `AGENTS.md` (and reproduced here) MUST be performed in full by the skill/subagent on every invocation; the Gateway check is not optional and cannot be moved, weakened, or made conditional.

**Do not:**

- Do not invoke, trigger, or delegate to any skill (including the readiness-safety-verification skill or any future skill) when the task name or description contains the literal word "Gateway".
- Do not allow the bob-claw-coordinator or any parent agent to dispatch a task containing "Gateway" to strategy-agent, policy-agent, payback-agent, treasury-agent (even for "Gateway consolidation"), infra-agent, verifier-agent, or any other role.
- Do not perform preparatory graphify queries, diagnostic CLI runs, or partial file reads "to understand the context" once the literal word has been detected in the originating task.

**Never:**

- Never proceed with any tool use, code edit, proposal, analysis, or even a single Read call on a task whose name contains the literal word "Gateway" inside a skill or subagent context.
- Never create workarounds such as "the task is about Gateway policy only", "Gateway is mentioned but the real work is X", splitting the task, or asking the user to rephrase to remove the word.
- Never edit or propose changes to any Gateway surface (`src/gateway/**`, `src/executor/policy/gateway-availability.mjs`, `src/config/gateway*.mjs`, `src/executor/helpers/*gateway*`, payback scheduler Gateway offramp leg, treasury Gateway BTC consolidation, or any code that calls BOB Gateway quote/onramp/offramp/createOrder endpoints) from within a skill or subagent.
- Never claim "I am acting as the main agent" or "this is not a subagent" to bypass the check when the invocation path was a skill or delegated agent.

### Enforcement Procedure

1. **Entry-time detection (non-skippable):** Upon skill or subagent activation, the model is instructed (and the system prompt of the skill enforces) to run the deterministic literal-word `Gateway` check on the raw `Original Task Name` and full user message before emitting any reasoning, function call, or `Read`/`Bash`/etc. The check is pure string match.

2. **Immediate full refusal on match:** When the word is detected, the skill/subagent MUST output *exactly* the following block (no preamble, no summary, no additional analysis, no "I can still help with...", and no further tool calls):

   ```
   BOB GATEWAY PROTECTION TRIGGERED

   The task name or description contains the literal word "Gateway".

   Per docs/skill-usage-guidelines.md (BOB Gateway Protection section — the strictest rule in the skill system) and AGENTS.md (Subagent Usage and Coding Agent Operating Mode — subagent inheritance prevention clause requiring Gateway protection, file scope, diagnostic re-execution, and priority of this section in all subagent tasks), delegation to this skill or subagent is strictly forbidden.

   Re-issue the complete, unmodified original task directly to the primary bob-claw-coordinator (or main coding session) with no subagent delegation and no /skill trigger.

   This skill will now terminate without performing any further work.
   ```

3. **Parent-level guard (coordinator / main agent responsibility):** Before any delegation, the parent MUST run the same literal "Gateway" word check on the task it intends to delegate. If present, it must refuse to delegate and must handle the task itself (or escalate to operator). The parent records the guard decision in its own session log.

4. **Post-facto detection and incident response:** If a skill or subagent is later discovered (via git history, session transcript review, or `git log -S Gateway -- .claude/skills`) to have operated on a task containing the literal word, this constitutes a safety-procedure violation:
   - All changes produced must be reverted via committed diff.
   - The affected skill's `SKILL.md` must be updated to harden the check.
   - The incident must be noted in the next operator review of `docs/operations/*`.
   - If any live capital path, policy, or payback code was touched, the live kill-switch must be evaluated.

5. **Priority and no-inheritance-escape:** This BOB Gateway Protection rule has absolute priority. It is inherited by every child subagent and every skill invocation with no escape clauses ("unless verification", "unless the user says it is safe", "for docs only", "coordination", etc.). The Coding Agent Operating Mode explicitly removes narrative explanations and escape clauses.

6. **Mandatory re-execution of diagnostics:** Even after passing the Gateway word check, every skill must still execute the AGENTS.md Diagnostic Entry Points (e.g., `npm run report:capital-audit -- --json`, `node src/cli/check-full-automation-readiness.mjs --json`, etc.) where relevant and quote the raw command output verbatim — never substitute with cached knowledge.

### Integration into Subagent Task Prompts and the Mandatory Verification Procedure

Every subagent prompt (in `.claude/agents/*.md`) and every skill `SKILL.md` body MUST contain the following as the opening "Required Start" or "Mandatory Verification Procedure" block (5 steps, matching the style and numbered-MUST discipline of `docs/harness-engineering.md` and the Coding Agent Operating Mode in `AGENTS.md`):

**Mandatory Verification Procedure (5 steps — execute in order, no shortcuts, integrate results and continue):**

1. Re-read in full: `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md` (especially the BOB Gateway Protection section). Quote the version/date headers to prove freshness.
2. Run the BOB Gateway Protection literal-word check (`\bGateway\b` or equivalent) against the `Original Task Name:` and the full user request provided by the parent. If the word appears, emit the exact refusal block above and halt. This step has priority over all later steps.
3. Enforce file scope: confirm the current task lies 100% inside the declared ownership of this skill/agent (per its frontmatter description and the Role Agents table in `docs/ai-agent-operations.md`). If any part of the task touches another agent's ownership or a Gateway surface, refuse and return the task to the coordinator.
4. Execute the appropriate AGENTS.md Diagnostic Entry Point(s) for the question type (capital-audit, full-automation-readiness, payback-status, etc.) and any graphify `query/explain/path` calls needed to keep file reads under limit. Paste the *exact raw command output* (never summarized or paraphrased).
5. Perform final hygiene verification (`git diff --stat`, `git diff --name-only`, caller search with `rg` for any deleted/renamed symbols, and the narrow targeted test suite from `docs/harness-engineering.md` Verification Matrix). Only then produce the final deliverable. Never emit an unprompted multi-item checklist status report; integrate the verification results and continue the implementation.

The parent coordinator prompt and all role-agent prompts must contain an explicit instruction to prefix every delegation with the `Original Task Name:` line and to require the child to run the full 5-step procedure (with Gateway check as step 2).

Any skill or agent definition that omits, reorders, weakens, or adds escape language around step 2 is non-compliant and must be repaired before the skill or agent is used.

This BOB Gateway Protection, combined with the file-scope + diagnostic-re-execution + priority requirements of the Coding Agent Operating Mode, guarantees that the BOB Gateway transport and settlement lane — the foundation of every native-BTC payback and capital movement — can only ever be touched by the highest-context main session under direct operator instruction, never through any delegated skill or subagent path.

---

**End of BOB Gateway Protection section (the strictest rule).**

All other content in this document is subordinate to the rules above.

### Execution Mode Rules (Full Verbatim from AGENTS.md — Coding Agent Operating Mode / Subagent Usage)

**Execution Mode is the universal default.** Every coding agent, skill, subagent, and coordinator invocation begins in Execution Mode: read required sources via the 5-step procedure, run mandated diagnostics/graphify, then **immediately perform the implementation work** (edits, tests, config diffs, harness updates). Subagent/skill outputs are raw material to be integrated by the parent; the parent applies results, runs verification, and continues implementation without pausing for summaries.

**Agents MUST consult `docs/skill-usage-guidelines.md` (its Master Decision Matrix) for automatic skill decisions.** The matrix supplies the deterministic, situation-driven logic that lets agents choose the correct skill or delegation pattern (or stay direct) with no extra user prompting. This consultation requirement, the matrix itself, and the resulting autonomous behavior are now part of the enforceable operating law for Execution Mode agents. `AGENTS.md` remains the final authority in any conflict.

**5-Step Mandatory Verification Procedure** (execute in order on every skill/subagent activation; no shortcuts; integrate then continue):

1. Re-read in full: `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md` (BOB Gateway Protection section). Quote the `updated_at`/version headers to prove freshness.
2. Run the BOB Gateway Protection literal-word check (`\bGateway\b` or equivalent) against `Original Task Name:` and the full user request. If the word appears, emit the exact refusal block from `docs/skill-usage-guidelines.md` and halt. Absolute priority over later steps.
3. Enforce file scope: confirm task is 100% inside this skill/agent's declared ownership (frontmatter + Role Agents table in `docs/ai-agent-operations.md`). Any other ownership or Gateway surface → refuse and return to parent/coordinator.
4. Execute the AGENTS.md Diagnostic Entry Point(s) appropriate to the question type plus any graphify `query/explain/path` needed to keep reads minimal. Paste the *exact raw command output* (never summarized or paraphrased).
5. Perform final hygiene verification (`git diff --stat`, `git diff --name-only`, `rg` caller search for deleted/renamed symbols, and the narrow targeted test row from `docs/harness-engineering.md` Verification Matrix). Only then produce the deliverable. **Never emit an unprompted multi-item checklist or Lx-style status report**; integrate the results and keep working.

**Reporting discipline:** The short AGENTS termination format (`현재 단계: Lx`, `이번에 한 일`, `왜 아직 그 단계인지`, `다음 체크리스트` — ≤3 items) is emitted **only** at natural completion of the user's requested unit of work or when the user explicitly asks for status. Intermediate delegation results never become Lx reports.

This Execution Mode, the mandatory 5-step + Gateway guard, the required consultation of the Skill Usage Guidelines for automatic decisions, the integrate-and-continue rule, and the no-unsolicited-Lx discipline align all agent activity with the long-term goal of an unattended, deterministic, receipt-backed native-BTC payback capital system while preserving every safety invariant, cap rule, policy-engine authority, kill-switch, append-only audit, and evidence-complete confidence standard in this document.

### Mandatory Embedding Rule for Any New Skill or Agent

**This rule is added to this skill per the task requirements and the Hard Rules MUST ("Every skill body and every subagent definition MUST embed (verbatim)... as the opening instructions."):**

Any new skill (new directory + SKILL.md under `.claude/skills/`) or any agent (new/updated `.claude/agents/*.md`, including bob-claw-coordinator.md, strategy-agent.md, policy-agent.md, payback-agent.md, treasury-agent.md, infra-agent.md, verifier-agent.md) **MUST** embed the full verbatim BOB Gateway Protection section (including its Hard Rules, Enforcement Procedure, and the exact refusal block), the 5-step Mandatory Verification Procedure (both versions from guidelines and AGENTS for completeness), and the Execution Mode rules (from AGENTS.md Coding Agent Operating Mode) **as the opening / highest priority instructions** immediately after the YAML frontmatter — exactly as done in this file.

- The bob-claw-readiness-safety-verification skill is now the canonical reference implementation.
- When authoring a new skill/agent, the first action after frontmatter must be the heading + full BOB Gateway Protection paste + Execution Mode paste + this embedding rule.
- The 5-step step 2 (Gateway check) and the "Execute BOB Gateway Protection check ... as the second step" instruction for parents must be present verbatim.
- No escape language, reordering, or weakening is permitted.
- Future changes to this readiness skill or creation of new ones must pass the hygiene verification in the 5-step (rg search for "Gateway" protection in the new file, confirmation of verbatim blocks).
- Non-compliant skill/agent definitions must be repaired before use; violations trigger the post-facto incident response in the embedded Enforcement Procedure (revert, harden SKILL.md, operator review, kill-switch eval if capital touched).

All other content in this SKILL.md (Use This Skill For, Verification Workflow, Hard Safety Rules, Reporting Contract) is subordinate to the verbatim blocks and rules above.

## Use This Skill For

- Readiness or blocker checks
- "Is it safe/live/ready?" questions
- Dashboard truth or deploy-truth verification
- Pre-commit or pre-PR safety review for repo changes that touch ops surfaces

Do not use this skill to justify cap raises, signer bypass, kill-switch bypass, payback decisions, or policy exceptions. Those remain deterministic code-and-config responsibilities only.

## Required Read Order (Superseded by Embedded 5-Step)

The old Required Read Order is **superseded** by the 5-Step Mandatory Verification Procedure (step 1: Re-read in full `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md` quoting `updated_at`/version headers; step 2: Gateway literal check; etc.) embedded verbatim at the top of this file as highest priority. 

The 5-step + Execution Mode + BOB Gateway Protection blocks take absolute precedence and must be followed first on every activation. This superseded section is kept only as historical reference.

## Verification Workflow (Updated — Enforces Embedded Verbatim BOB Gateway Protection + 5-Step + Execution Mode as Highest Priority)

**This entire workflow is now subordinate to and must execute the full verbatim BOB Gateway Protection section, 5-Step Mandatory Verification Procedure, and Execution Mode rules embedded at the top of this file as the absolute opening/highest-priority instructions.** The Gateway literal-word check is the non-skippable **very first action** (string match only) on every skill activation. The 5-step (with Gateway as step 2) is mandatory; this section describes the readiness-specific specialization of its step 4 (after re-reads, Gateway check pass, and file-scope confirmation that the task is purely readiness verification and does not touch Gateway surfaces or other agent ownership).

**Non-negotiable entry from embedded Hard Rules / Enforcement / 5-step (must happen before any diagnostic CLI or file read):**
- Deterministic `\bGateway\b` (or equivalent string split) check on Original Task Name + full user request as the **very first internal action**.
- On match: emit *exactly* the refusal block and halt (no preamble, no "I can still help...", no tool calls).
- Full 5-step in order (quote `updated_at`/version headers in step 1 from the 4 core docs; Gateway check step 2 priority; file scope step 3 limited to this skill's readiness ownership; diagnostics + graphify step 4; hygiene step 5 with harness Verification Matrix + `git diff --stat` / `rg` caller search). Integrate results and continue in Execution Mode. Never emit unsolicited Lx checklists.

**Readiness-specific execution of 5-step step 4 (original diagnostic entry points — raw output must be quoted verbatim per AGENTS Diagnostic Entry Points and embedded Enforcement #6):**

1. Start with the existing diagnostic entry point that already answers the question.
   - Readiness blockers: `node src/cli/check-full-automation-readiness.mjs --json`
   - Refill / capital plan blockers: `node src/cli/plan-capital-manager-refill-jobs.mjs --json`
   - Payback status: `npm run report:payback-status -- --json`
   - Capital audit / NAV deltas / gas burn: `npm run report:capital-audit -- --json`
   - Dashboard truth surface: inspect `dashboard/public/dashboard-status.json`
   - Latest autopilot run: inspect `data/all-chain-autopilot-latest.json`
2. Quote the relevant command output exactly in your report. If the command fails or returns no data, say that plainly and stop at `data insufficient` instead of guessing.
3. Distinguish clearly between:
   - advisory/reporting labels
   - deterministic execution authority in proposer -> policy -> signer
4. When checking dashboard or deploy truth, prefer the public status slices and explicit publish/deploy verification commands. Do not infer deploy success from a local build alone.
5. Before proposing a new module or CLI, check for an existing nearby tool first with `ls src/cli | grep <keyword>`.
6. Before finishing, inspect `git diff --stat` and `git diff --name-only` and confirm you did not pick up generated dashboard JSON, `data/`, `logs/`, coverage, cache, or other runtime artifacts unless the task explicitly required them.

The old "Required Read Order" section (still present below for reference) is **superseded** by the 5-step re-read + header quote requirement in the embedded blocks (step 1) and the full 5-step discipline. The original numbered list above is retained only as the exact readiness commands that step 4 of the 5-step must invoke for this skill's domain. All 5-step hygiene (harness-engineering Verification Matrix row for "Any source refactor" or readiness changes, plus no generated JSON staging) must pass before the deliverable.

## Hard Safety Rules (Updated — Enforces Embedded Verbatim BOB Gateway Protection + 5-Step + Execution Mode)

This section is now explicitly subordinate to and **enforces** the full Hard Rules (MUST / Do not / Never), Enforcement Procedure (including the exact refusal block), and priority rules from the **verbatim BOB Gateway Protection embedded at the top**.

**Key enforcements added/updated for this readiness skill:**

- The literal whole-word `Gateway` check (string-only, first action, per embedded Hard Rules MUST and Enforcement step 1-2) is **mandatory on every activation** of this skill — even for pure "readiness", "blocker", "is it safe", or "verification" tasks. Match → exact refusal block + immediate terminate. This skill must never operate on Gateway surfaces.
- The full 5-step (with Gateway check as absolute-priority step 2) and Execution Mode (integrate-and-continue, no unsolicited Lx, consult skill-usage-guidelines Master Decision Matrix) are non-negotiable.
- Even after Gateway check passes, mandatory re-execution of AGENTS.md Diagnostic Entry Points (e.g. the readiness CLI `node src/cli/check-full-automation-readiness.mjs --json`) with raw output quoted verbatim (embedded Enforcement #6 and 5-step step 4).
- File scope strictly limited to readiness verification ownership (per embedded 5-step step 3 + Role Agents table); any touch of Gateway code/config/policy or other agent's ownership → refuse and return to coordinator.

**Retained original hard safety rules (still apply, now under the embedded BOB protection):**

- Never present recorded JSONL snapshots as current balances when the task needs live balance truth.
- Never treat `preflight_clean` or queue readiness as proof that a broadcast happened.
- Never claim profitability without measured quote, fee, and receipt evidence.
- Never let dashboard fields, readiness labels, or stage names become runtime gates or runtime bypasses.
- Never expose private keys, API keys, wallet secrets, or Telegram tokens in skill content or reports.

The "Required Read Order" (still present in file above) is superseded by the 5-step re-read + header quote requirement in the embedded blocks (step 1) and the full 5-step discipline. All future updates to this skill or creation of new skills/agents must verify (via 5-step hygiene + rg) that the verbatim blocks remain at the opening and the first-action Gateway check is present.

## Reporting Contract

Return a compact evidence-first summary:

- `current stage`
- `what was checked`
- `exact blocker or green path`
- `why it is still blocked or ready`
- `next safest verification step`

When blocked, surface the first exact blocker verbatim instead of smoothing it into a generic summary.
