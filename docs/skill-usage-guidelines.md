---
status: canonical
updated_at: 2026-05-15
policy_authority: AGENTS.md
derived_from:
  - AGENTS.md
  - docs/system-map.md
  - docs/harness-engineering.md
  - docs/ai-agent-operations.md
---

# Skill Usage Guidelines

This document provides the shared operating procedures for agent/skill
delegation across coding tools, plus the compatibility expectations for
tool-specific prompt surfaces such as `.grok/**` and `.claude/**`.

`AGENTS.md` is the operating law and source of truth for all product, safety, LLM, subagent, and execution rules. This document is the implementation map for skill and subagent usage only. In any conflict, `AGENTS.md` wins.

Before using or authoring any skill or performing subagent delegation:

1. Read `AGENTS.md` in full.
2. Read `docs/system-map.md` and `docs/harness-engineering.md`.
3. Read this document.

**Before editing this doc or any skill/agent (including SKILL.md, .claude/agents/\*.md, check-skills-config, this guidelines file, or ai-agent-operations.md):**

- Run the 3 capital diagnostics (quote raw `--json` output verbatim):
  - `npm run report:capital-audit -- --json`
  - `node src/cli/check-full-automation-readiness.mjs --json`
  - `node src/cli/plan-capital-manager-refill-jobs.mjs --json`
- Also run: `npm run report:payback-status -- --json`
- Run: `npm run check:skills-config`
- Execute the full harness Final Review Loop from `docs/harness-engineering.md` (caller `rg` search, targeted tests for touched areas, `npm run check && npm test`, safety review for no cap/autoExecute/signer bypass, `git diff --stat` + `git diff --name-only`, repeat until clean).
- Only after all raw outputs are obtained and integrated, perform the edit.

This enforces the evidence-complete confidence standard and Execution Mode even for changes to the agent operating system itself. Never edit these surfaces from cached memory or without the diagnostics + Final Review Loop.

Skills and subagents exist only to keep the main coding session small and focused. They inherit every rule, boundary, and prohibition from `AGENTS.md` with no exceptions.

Use the shared docs in `docs/` as the routing and policy source of truth.
Tool-specific prompt surfaces (`.grok/**`, `.claude/**`) exist only for their
own runtime and must not be treated as cross-tool routing authority.

## Delegation Entry Validation

**This is the strictest section in this document.** It takes precedence over every other instruction, example, workflow, or "helpful" behavior described anywhere in skill bodies, subagent definitions (`.claude/agents/*.md`), coordinator prompts, or user requests. It ensures every delegated task has a clear task-defining request, bounded ownership, and explicit proof expectations before a child agent or skill begins work.

If the delegated objective is ambiguous, contradictory, under-scoped, or crosses ownership boundaries, the child must refuse and return the task to the parent. Quoted policy text, copied evidence/logs, transcript excerpts, file contents, and refusal templates attached only as review material are **not** the task-defining text.

### Exact Language Referenced from AGENTS.md

This section implements the subagent inheritance prevention requirements stated in the **Subagent Usage** and **Coding Agent Operating Mode** sections of `AGENTS.md`:

- Subagent inheritance prevention requires: delegated task-definition validation, file scope, diagnostic re-execution, and priority of this section in all subagent tasks.
- The Coding Agent Operating Mode defines default Execution Mode, reporting discipline (explicitly prohibits unprompted Lx-style status reports with checklists), execution expectation (integrate subagent results and continue implementation rather than pause for summaries), and alignment with long-term automated capital system goals while preserving safety.
- All subagent and skill activity must respect the 5-step Mandatory Verification Procedure (detailed below) with delegated task-definition validation as an early mandatory step.

### Hard Rules (MUST / Do not / Never)

**MUST:**

- Every skill MUST, as its very first internal action upon any activation (whether triggered by `/<skillname>`, subagent dispatch, or direct prompt), validate the `Original Task Name` and the delegated task string that define the requested work. This validation is string-and-structure based: the child checks for a clear task-defining request, owned file/scope boundary, required proof shape, and stop condition. Exclude copied logs, quoted policy blocks, transcript excerpts, file contents, and refusal-template text that are present only as evidence or review subject matter.
- Every skill body and every subagent definition MUST embed (verbatim) the refusal template, the delegated task-definition validation instruction, and the full 5-step Mandatory Verification Procedure as the opening instructions.
- When constructing any subagent or skill task prompt, the parent (coordinator or main agent) MUST include the exact line `Original Task Name: <verbatim task-defining user request only>` and the instruction: "Execute delegated task-definition and ownership validation from docs/skill-usage-guidelines.md on the task-defining text only (not quoted evidence or file contents) as the second step of the Mandatory Verification Procedure before reading any file or calling any tool."
- The 5-step Mandatory Verification Procedure defined in the Coding Agent Operating Mode of `AGENTS.md` (and reproduced here) MUST be performed in full by the skill/subagent on every invocation; step 2 is not optional and cannot be moved, weakened, or made conditional.

**Do not:**

- Do not invoke, trigger, or delegate to any skill (including the readiness-safety-verification skill or any future skill) when the task-defining request is missing, contradictory, or not ownership-safe.
- Do not allow the bob-claw-coordinator or any parent agent to dispatch a task without explicit objective, owned file/scope, out-of-scope boundary, proof requirement, and stop condition.
- Do not perform preparatory graphify queries, diagnostic CLI runs, or partial file reads "to understand the context" until delegated entry validation has passed.

**Never:**

- Never proceed with any tool use, code edit, proposal, analysis, or even a single Read call until delegated entry validation has passed inside a skill or subagent context.
- Never create workarounds such as vague objectives, implicit file scope, "handle whatever seems related", or missing proof requirements.
- Never edit or propose changes outside the child agent's declared ownership.
- Never claim "I am acting as the main agent" or "this is not a subagent" to bypass step 2 when the invocation path was a skill or delegated agent.

### Enforcement Procedure

1. **Entry-time validation (non-skippable):** Upon skill or subagent activation, the model is instructed (and the system prompt of the skill enforces) to validate the raw `Original Task Name` and delegated task objective before emitting any reasoning, function call, or `Read`/`Bash`/etc. Ignore quoted evidence blocks, copied transcripts, file contents, and policy/refusal text attached only for review.

2. **Immediate full refusal on match:** When the word is detected, the skill/subagent MUST output _exactly_ the following block (no preamble, no summary, no additional analysis, no "I can still help with...", and no further tool calls):

   ```
   DELEGATION ENTRY VALIDATION FAILED

   The delegated task definition is missing, ambiguous, contradictory, or outside this agent's ownership.

   Per docs/skill-usage-guidelines.md (Delegation Entry Validation section — the strictest rule in the skill system) and AGENTS.md (Subagent Usage and Coding Agent Operating Mode — subagent inheritance prevention clause requiring delegated task-definition validation, file scope, diagnostic re-execution, and priority of this section in all subagent tasks), this skill or subagent may not continue until the parent supplies a scope-safe delegated task.

   Re-issue the task with explicit objective, ownership/file scope, out-of-scope boundary, required proof, and stop condition, or handle it directly in the parent session.

   This skill will now terminate without performing any further work.
   ```

3. **Parent-level guard (coordinator / main agent responsibility):** Before any delegation, the parent MUST validate that the task it intends to delegate has explicit objective, ownership/file scope, out-of-scope boundary, required proof, and stop condition. If not, it must refuse to delegate and either tighten the task or handle it itself. The parent records the guard decision in its own session log.

4. **Post-facto detection and incident response:** If a skill or subagent is later discovered (via git history, session transcript review, or review of delegated prompts) to have operated without a valid delegated task definition, this constitutes a safety-procedure violation:
   - All changes produced must be reverted via committed diff.
   - The affected skill's `SKILL.md` must be updated to harden step-2 entry validation.
   - The incident must be noted in the next operator review of `docs/operations/*`.
   - If any live capital path, policy, or payback code was touched, the live kill-switch must be evaluated.

5. **Priority and no-inheritance-escape:** This Delegation Entry Validation rule has absolute priority. It is inherited by every child subagent and every skill invocation with no escape clauses. The Coding Agent Operating Mode explicitly removes narrative explanations and escape clauses.

6. **Mandatory re-execution of diagnostics:** Even after passing delegated entry validation, every skill must still execute the AGENTS.md Diagnostic Entry Points (e.g., `npm run report:capital-audit -- --json`, `node src/cli/check-full-automation-readiness.mjs --json`, etc.) where relevant and quote the raw command output verbatim — never substitute with cached knowledge.

### Integration into Subagent Task Prompts and the Mandatory Verification Procedure

Every subagent prompt (in `.claude/agents/*.md`) and every skill `SKILL.md` body MUST contain the following as the opening "Required Start" or "Mandatory Verification Procedure" block (5 steps, matching the style and numbered-MUST discipline of `docs/harness-engineering.md` and the Coding Agent Operating Mode in `AGENTS.md`):

**Mandatory Verification Procedure (5 steps — execute in order on every skill/subagent activation; no shortcuts; integrate then continue):**

1. Re-read in full: `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md` (delegation and verification sections). Quote the `updated_at`/version headers to prove freshness.
2. Validate delegated task definition and ownership scope using `Original Task Name:` plus the parent's explicit objective/scope text only. Exclude quoted logs, copied policy blocks, file contents, transcript excerpts, and refusal-template text attached only as evidence or review subject matter. If the requested work is ambiguous, contradictory, or outside the child agent's ownership, emit the exact refusal block from `docs/skill-usage-guidelines.md` and halt. Absolute priority over later steps.
3. Enforce file scope: confirm task is 100% inside this skill/agent's declared ownership (frontmatter + Role Agents table in `docs/ai-agent-operations.md`). Any other ownership or out-of-scope surface → refuse and return to parent/coordinator.
4. Execute the AGENTS.md Diagnostic Entry Point(s) appropriate to the question type plus any graphify `query/explain/path` needed to keep reads minimal. Paste the _exact raw command output_ (never summarized or paraphrased).
5. Perform final hygiene verification (`git diff --stat`, `git diff --name-only`, `rg` caller search for deleted/renamed symbols, and the narrow targeted test row from `docs/harness-engineering.md` Verification Matrix). Only then produce the deliverable. Any claimed implementation, progress, or completion must cite same-response proof (exact command output, changed file paths/diff evidence, or artifact path). **Never emit an unprompted Lx-style status report**; child skill/subagent outputs stay compact unless the parent explicitly requests a checklist. Integrate the results and keep working.

The parent coordinator prompt and all role-agent prompts must contain an explicit instruction to prefix every delegation with the `Original Task Name:` line and to require the child to run the full 5-step procedure (with delegated task-definition validation as step 2).

Any skill or agent definition that omits, reorders, weakens, or adds escape language around step 2 is non-compliant and must be repaired before the skill or agent is used.

This Delegation Entry Validation section, combined with the file-scope + diagnostic-re-execution + priority requirements of the Coding Agent Operating Mode, guarantees that child agents only receive explicit, ownership-safe, proof-backed work.

---

**End of Delegation Entry Validation section (the strictest rule).**

All other content in this document is subordinate to the rules above.

## Core Principles of Skill and Subagent Usage

**Coding Agent Operating Mode (Execution Mode First) is the universal default.**

- Every coding agent, skill, and subagent invocation begins in **Execution Mode**: the agent reads the required sources (via the 5-step procedure), runs the mandated diagnostics and graphify calls, then immediately performs the implementation work (edits, new code, tests, config diffs, harness updates).
- Subagent and skill outputs are **raw material to be integrated** by the parent. The parent applies the results, runs verification, and continues the implementation without pausing the session to produce summaries.
- **No unsolicited Lx-style status reports.** Child skill/subagent outputs stay compact and do not emit multi-item checklists unless the parent explicitly asks for one. The legacy AGENTS.md short termination format (`현재 단계: Ln`, `이번에 한 일`, `왜 아직 그 단계인지`, `다음 체크리스트`) is deprecated and must not be emitted by skills or subagents. Intermediate delegation results are never turned into Lx reports.
- This mode aligns all agent activity with the long-term goal of an unattended, deterministic, receipt-backed native-BTC payback capital system. The agent behaves as a disciplined senior engineer who finishes the job with minimal ceremony.

**Evidence-Complete Confidence (no cached assumptions, no "data 부족" filled by guesswork).**

- The AGENTS.md Diagnostic Entry Points table is the ground truth for any status, capital, payback, readiness, or NAV question. The exact CLI is run and its raw `--json` (or file) output is quoted verbatim in every response that touches the topic.
- New modules or CLIs are never proposed until `ls src/cli | grep <keyword>` (or equivalent) confirms no similar tool already exists.
- graphify is the mandatory first tool for any question involving code topology, callers, paths, or "X depends on Y".

**Proof-Backed Progress Only (anti-fake-progress rule).**

- For any tool-using, code-changing, or delegation-integrating task, an agent may claim progress or completion only when the same response includes at least one concrete proof item: exact command output, changed file paths or diff evidence, or a produced artifact path.
- Empty progress language is prohibited: "working on it", "I handled it", "automatic", "done", "fixed", "implemented", "applied", or checked `[x]` items without same-response proof count as non-compliant output.
- If no action has happened yet, leave the item `[ ]` and say only that it is pending or blocked. Do not use qualifiers like "almost", "final", "remaining", or "integration" that imply prior work. If blocked, state the exact blocker and the failing command, tool result, or missing prerequisite. Never convert a blocked or no-op state into progress wording.
- Parent/coordinator sessions must reject child outputs that lack proof. Before integrating or claiming completion, the coordinator MUST verify that every child response contains at least one of: exact command output, changed file paths/diff evidence, or a produced artifact path. If none are present, the coordinator records `child output lacks proof`, keeps the parent item `[ ]` or blocked, and re-runs or replaces that child with an explicit proof request. Partial progress may be claimed only for child tasks that include proof.

**Strict File Scope and Ownership.**

- Every skill and role agent declares its exact ownership in frontmatter `description` and in `docs/ai-agent-operations.md` Role Agents table.
- A delegated task that touches any file or concern outside that ownership is refused and returned to the coordinator with the exact ownership boundary cited.

**graphify Enforcement Rule (token and accuracy optimization).**

- If the task is likely to require reading 3 or more source files, or involves symbol relationships, callers, "explain the path", or architecture topology, the agent **MUST** run `npm run graph:focus -- query|explain|path` (or direct `python3 -m graphify`) **before** broad `Read` or `Glob` operations.
- graphify is **not** used for exact numeric/config values, pure .md research documents, or when the task explicitly says "read the full source of X".
- The `src/graphify-out/GRAPH_REPORT.md` and `graphify-out/GRAPH_REPORT.md` provide the high-level map when full-repo topology is needed.

**Zero Fluff, Actionable Only.**

- All skill and subagent output is compact, evidence-first, and directly usable for the next implementation step.
- "I can help with...", narrative explanations of what the agent "understands", or unrequested plans are prohibited.
- Completion wording without proof is prohibited. If a skill marks an item `[x]` or says a task is done, the same response must cite the supporting output, diff/file list, or artifact path.

## Fast Start (Any Session Involving Skills or Subagents)

```bash
git status --short --branch
npm run graph:focus -- status
npm run report:strategy-catalog -- --json
node src/cli/check-full-automation-readiness.mjs --json
```

**Mandatory read order (quote headers to prove freshness):**

1. `AGENTS.md` (Core Context, Diagnostic Entry Points, graphify, Reporting Style, Coding Agent Operating Mode)
2. `docs/system-map.md`
3. `docs/harness-engineering.md` (especially Verification Matrix, Source Vs Generated table, and Final Review Loop)
4. `docs/skill-usage-guidelines.md` (this file, especially Delegation Entry Validation, Source Vs Generated for AI Agent Surfaces table, Master Decision Matrix, and the "Before editing..." rule below)
5. `docs/ai-agent-operations.md` (Role Agents table and ownership)

Then execute the **5-Step Mandatory Verification Procedure** (reproduced in Delegation Entry Validation section) on every skill activation and every delegation.

## Source Vs Generated for AI Agent Surfaces

Modeled directly on the Source Vs Generated table in `docs/harness-engineering.md`. AI agent definitions and the guidelines that govern them are **source of truth**; their runtime outputs are generated/operational artifacts.

| Treat As Source                                                  | Treat As Generated / Operational                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `AGENTS.md`, `docs/skill-usage-guidelines.md`                    | `logs/codex-audit.jsonl`, `logs/codex-budget-lock-audit.jsonl`      |
| `docs/ai-agent-operations.md` (shared ownership/routing map)     | `data/codex/**`, `data/auto-research-refresh-latest.json`           |
| `.grok/agents/*.md` (Grok-only prompt surfaces)                  | `data/health/**`, `logs/position-monitor-audit.jsonl`               |
| `.grok/skills/*/SKILL.md` (Grok-only prompt surfaces)            | session handoff files, Lx-style transcripts (unless user-requested) |
| `.claude/agents/*.md` (Claude-only compatibility prompts)        | any `*-handoff*.md` or generated agent scratch / preview outputs    |
| `.claude/skills/*/SKILL.md` (Claude-only compatibility prompts)  | temporary Codex/research scaffold files under `data/` or `/tmp`     |
| `scripts/check-skills-config.mjs`, `test/skills-config.test.mjs` |                                                                     |

Agent surface source files (prompts, SKILL.md, this guidelines doc, the Role Agents table) must be edited under the same 5-step + diagnostics + harness Final Review Loop discipline as policy or strategy code. Generated agent outputs are never treated as ground truth for decisions; they are advisory scaffolds only and follow the same "do not stage unless explicit publish" rule as dashboard public JSON.

## Master Decision Matrix (Automatic Judgment Centerpiece)

This matrix is the primary mechanical reference that allows future coding agents and the bob-claw-coordinator to decide **without user prompting** which skill, agent combination, or direct Execution Mode path to take.

**Usage rule:** Match the current user task (title + description + implied scope) against the Detection column. The first row that matches is authoritative. Safety rows (direct-only handling, readiness, graphify) have precedence ordering as listed. After matching, the parent always prefixes the delegation (if any) with `Original Task Name: <verbatim>` and requires the child to execute the full 5-step procedure with delegated task-definition validation as step 2. The parent integrates results and stays in Execution Mode.

| #   | Situation Category                                                                                                                                      | Detection / Trigger Conditions (keywords, file count estimate, query type, ownership)                                                                                                                                                          | Automatic Action                                                                                                                                                 | Mandatory Sequence (after 5-step Verification)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Execution Mode Continuation Rule                                                                                                                                                                                                                                                                                                                                                                                       | Minimum Verification (harness + skill-specific)                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Isolated single-ownership edit (≤2 files, no symbol cross-ref, no status/readiness query)                                                               | "edit src/strategy/foo.mjs", "add test for bar", "small fix in one module", implied single ownership, no readiness/status/capital words                                                                                                        | Direct main session (or single role-agent if already delegated). No /skill trigger.                                                                              | Run `npm run graph:focus -- status` + ls src/cli check if new file proposed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Implement the change immediately. Apply any later subagent output. Emit short AGENTS termination format **only** on task completion.                                                                                                                                                                                                                                                                                   | Module-specific test + `git diff --stat` hygiene.                                                                                                                                                                                                                     |
| 2   | Symbol / caller / path / topology question ("what calls X", "path from A to B", "who imports this")                                                     | "explain the callers of", "dependency path", "how does Y reach Z", architecture diagram request, ≥3 files implied                                                                                                                              | **graphify skill first** (`/graphify` or `python3 -m graphify query/explain/path --graph src/graphify-out/graph.json`). Then targeted direct or role-agent work. | graphify query/explain/path **before** any broad Read. Use output to limit subsequent file reads to <3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Use graphify output to scope minimal edits. Continue implementation.                                                                                                                                                                                                                                                                                                                                                   | Confirm graphify report cited; no over-broad file reads.                                                                                                                                                                                                              |
| 3   | Readiness / blocker / "is it safe" / full-automation / pre-deploy safety question                                                                       | "is the system ready", "readiness blocker", "what is blocking", "can I claim live", "safety status", "pre-commit safety review", "full automation readiness"                                                                                   | **Automatically invoke bob-claw-readiness-safety-verification skill** (per Automatic Judgment System).                                                           | The skill itself executes the exact Diagnostic Entry Points (readiness CLI, capital-audit, payback-status, dashboard/public/dashboard-status.json, etc.) and quotes raw output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Skill returns compact evidence-first summary (`current stage`, `exact blocker`, `next safest step`). Parent integrates into ongoing Execution and continues.                                                                                                                                                                                                                                                           | Skill-internal checks + harness Verification Matrix row for "Any source refactor" or "Dashboard UI/status".                                                                                                                                                           |
| 4   | Capital / payback / NAV / gas burn / slippage / refill / carry status query                                                                             | "payback status", "capital audit", "NAV delta", "gas burn", "how much accrued", "refill decision", "carry 사유"                                                                                                                                | **First** run the exact AGENTS.md Diagnostic Entry Point CLI for the question type. Only then consider readiness skill if deeper analysis required.              | Run and quote verbatim: `npm run report:capital-audit -- --json`, `npm run report:payback-status -- --json`, `node src/cli/plan-capital-manager-refill-jobs.mjs --json`, or `dashboard/public/dashboard-status.json` as appropriate. Never substitute with memory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | After verbatim quote, continue any implementation work if the original task was more than pure query.                                                                                                                                                                                                                                                                                                                  | Raw CLI / JSON output must appear in the final answer.                                                                                                                                                                                                                |
| 5   | Large feature spanning multiple ownership areas (strategy + policy + treasury + infra + payback)                                                        | "add new capital allocator across chains", "unify protocol readers", "new radar + dashboard + policy lane", "multi-area refactor"                                                                                                              | **bob-claw-coordinator** spawns parallel specialized subagents (strategy-agent + policy-agent + treasury-agent + infra-agent + verifier-agent at end).           | Coordinator validates delegated task shape, classifies independent ownership slices, then delegates with `Original Task Name` + objective + owned scope + out-of-scope + required proof + stop condition. Each child is limited to its declared ownership.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Coordinator remains in Execution Mode: launches only the role agents whose slices are truly independent, collects raw outputs, applies code changes to working tree, re-summons or re-scopes proofless children, runs verification, and keeps working until the feature unit is complete.                                                                                                                              | verifier-agent residual-risk report + full relevant rows from harness Verification Matrix + `npm test` for touched areas.                                                                                                                                             |
| 6   | Dashboard UI, status schema, or public JSON slice change                                                                                                | "update the dashboard to show X", "add field to dashboard-status", "new UI component for Y"                                                                                                                                                    | Direct (main or infra-agent). **Always** read `docs/dashboard-context.md` first.                                                                                 | Read dashboard-context.md + status builder source. Never stage generated `dashboard/public/*.json` unless the explicit task is "publish refreshed dashboard artifact".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Prefer source JSX / .mjs changes. Generated bundles stay out of normal commits.                                                                                                                                                                                                                                                                                                                                        | `node --test test/dashboard-*.test.mjs && npm run dashboard:build`.                                                                                                                                                                                                   |
| 7   | New CLI, script, or automation tool                                                                                                                     | "create src/cli/new-foo.mjs", "add a command for Z", "new diagnostic entry point"                                                                                                                                                              | `ls src/cli                                                                                                                                                      | grep <keyword>` **before** any proposal. Then infra-agent or direct.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Existing similar tool check is mandatory. New CLI must include test + docs update in the same unit.                                                                                                                                                                                                                                                                                                                    | `node --test test/repo-hygiene.test.mjs` + new CLI-specific test + harness "Git hygiene" row.                                                                                                                                                                         |
| 8   | Policy, risk gate, cap config, or executor-policy change                                                                                                | "update policy for healthFactor", "change maxDailyLoss", "new auto-kill trigger", "modify cap in strategy-caps"                                                                                                                                | policy-agent (or direct if single-file).                                                                                                                         | Related Diagnostic Entry Point (capital-audit or readiness) + graphify on the policy module.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Policy change **always** ships with unit test addition in the executor-policy or risk test family.                                                                                                                                                                                                                                                                                                                     | `node --test test/executor-policy-index.test.mjs test/auto-kill-triggers.test.mjs test/gateway-availability.test.mjs`.                                                                                                                                                |
| 9   | Architecture investigation, system-map update, or research-heavy question                                                                               | "how does the entire payback flow work", "update docs/system-map.md for new lane", "end-to-end receipt path"                                                                                                                                   | graphify + read system-map/harness + relevant `docs/research/*.md`. Direct or infra-agent.                                                                       | graphify first to map the code surface. Then docs. Facts from code win over narrative.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Update docs only after code facts + harness checks are confirmed.                                                                                                                                                                                                                                                                                                                                                      | graphify report + harness "Docs only" + "Any source refactor" rows.                                                                                                                                                                                                   |
| 10  | Bug whose root cause is unknown or spans files (revert, wrong behavior, missing receipt)                                                                | "payback not triggering on Base", "why does this intent get rejected", "gas cost higher than expected"                                                                                                                                         | **graphify path/explain first** to identify the minimal file set, then targeted role-agent or direct fix.                                                        | graphify mandatory before reading >2 files. Add regression test that would have caught the bug.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Fix + test + (if capital path) run capital-audit diagnostic after the fix.                                                                                                                                                                                                                                                                                                                                             | Targeted regression test + relevant harness row (payback, policy, etc.).                                                                                                                                                                                              |
| 11  | Direct-only parent handling required                                                                                                                    | user explicitly says "don't delegate", scope cannot be cleanly split by ownership, or multiple children would need overlapping writes                                                                                                          | **Keep the task in the main session / coordinator.** No skill or subagent delegation until the parent can produce independent scope slices.                      | Step 2 of the 5-step procedure keeps the task in the parent when objective/scope/proof cannot be delegated cleanly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Handled in the parent until ownership boundaries become explicit and independently writable.                                                                                                                                                                                                                                                                                                                           | Full main-session harness Verification Matrix for the touched area.                                                                                                                                                                                                   |
| 12  | Post-edit verification, diff review, "check my work", residual risk, or hygiene audit                                                                   | "verify the changes I just made", "review this diff", "is the implementation complete", "residual risk report"                                                                                                                                 | verifier-agent (read-only, no memory). If safety or readiness claim is involved, also bob-claw-readiness-safety-verification skill.                              | `git diff --stat` + `git diff --name-only` + rg caller search first. Then delegate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | After receiving verifier output, integrate any required fixes in Execution Mode and re-verify before claiming completion.                                                                                                                                                                                                                                                                                              | verifier-agent report + exact harness Verification Matrix row for the change type + `npm test` exit code known.                                                                                                                                                       |
| 13  | Aggressive sleeve accounting report, backtest, or reconciliation audit (new DeFi Portfolio Accounting skill for Diversified Aggressive Velocity Chaser) | "aggressive sleeve", "defi-portfolio-accounting", "velocity chaser accounting", "sleeve ledger", "aggressive yield PnL", "backtest exit rule for velocity", "sleeve payback attribution", "aggressive asset tracker", "aggressive-velocity-v1" | **defi-portfolio-accounting skill** (once registered) or infra-agent + coordinator for initial creation/review.                                                  | Before any edit: 3 capital diagnostics (`report:capital-audit -- --json`, `check-full-automation-readiness --json`, `plan-capital-manager-refill-jobs --json`) + `report:payback-status -- --json` + `check:skills-config` + `graph:focus -- status` + full harness Final Review Loop. Update this matrix first + harness "Any new skill added" row. Create both .grok/ and .claude/ SKILL.md with verbatim delegated-entry validation + 5-step + BOB Gateway Protection (literal "Gateway" word refusal) + thin orchestrator (no financial logic). Add to REQUIRED_TRACKED_FILES + test/skills-config.test.mjs. TDD pure lib `src/ledger/aggressive-sleeve-accounting.mjs` first (property tests for conservation + 15 pitfalls). Update `docs/ai-agent-operations.md` Role Agents if new ownership declared. | Parent (coordinator) integrates domain + architecture subagent reports from plan Section 8.9 + 8.6/8.8, creates thin SKILL.md + thick pure accounting library (TDD order), registers the skill, then delegates sleeve-specific operator queries/audits/backtests to the skill while 4 subagents call the pure lib directly for hot decisions. Sleeve attribution additive only; core payback/Gateway/signer untouched. | New skill row in harness Verification Matrix + `node --test test/skills-config.test.mjs` + `npm run check:skills-config` (exit code known) + capital-audit on sleeve scenario + verifier-agent residual-risk report + `git diff --stat` clean of generated artifacts. |

**Matrix precedence notes:**

- Row 11 (direct-only parent handling) is checked first whenever delegation would create overlapping ownership or violate an explicit no-delegation request.
- Row 3 (readiness) and Row 2 (graphify) are high-priority automatic triggers.
- Row 5 (multi-ownership) is the only situation that routinely uses parallel subagents.
- For any situation not clearly matching a row, default to Row 1 (direct Execution) or escalate to coordinator for matrix re-evaluation.
- The matrix is authoritative for default routing, but it does not ban discretionary parent summons. The coordinator may add ownership-aligned child agents when needed to reduce uncertainty, gather proof, or unblock reintegration, as long as delegated task-definition validation, ownership, and proof rules remain intact.

## Adaptive Orchestration Protocol (Main Session / Coordinator)

This protocol defines how the parent decides whom to summon, when to widen the
swarm, and how to recover from weak child output.

1. **Classify first.** Decide whether the task is direct, single-role, or parallel multi-role work before launching any child.
2. **Split by ownership, not by hope.** A child is summonable only when its write scope is independent or its task is read-only. Never split the same write file set across multiple children.
3. **Summon with a complete contract.** Every child prompt must include:
   - objective
   - owned files / ownership area
   - explicit out-of-scope boundary
   - required proof shape (`command output`, `diff/file list`, or `artifact path`)
   - stop condition for returning control
4. **Use the minimum viable swarm.** Default to `1 coordinator + 1-6 workers + verifier-agent`. Wider fan-out is for genuinely independent investigations, report gathering, or read-only review lanes only.
5. **Reintegrate mechanically.** The parent does not treat a child as complete until the child returns proof and stays inside scope. Proofless or cross-scope output becomes `child output lacks proof` or blocked, and must be re-summoned with a tighter contract, routed to another role, or absorbed back into the main session.
6. **Summon incrementally.** Do not launch all potential roles up front. Call the next role only when its slice is ready and its output has a clear reintegration path into the current working tree.
7. **Keep the parent accountable.** The coordinator stays responsible for user-facing progress reporting, checklist state, proof integration, verification, and final completion claims.
8. **Use discretionary summons carefully.** The parent may add a child outside the default matrix row when a new blocker, uncertainty pocket, proof gap, or specialized review need appears. The same contract still applies: ownership fit, independent scope, explicit proof requirement, and a clear return condition.

## Detailed Situation-Based Decision Guide (Situations 1–11; Situation 12 is defined in the Master Decision Matrix table above)

Each situation below gives the practical trigger list, example user queries that map to it, the exact delegation prompt prefix the parent must use, the output contract expected from the skill/agent, and the integration rule for the parent.

**Situation 1 – Isolated single-ownership edit**  
Triggers: task mentions one specific .mjs file or module, "small", "quick fix", "add X to Y", no status/readiness/capital words, no cross-ownership language, <3 files estimated.  
Examples: "add a new constant to src/config/sizing.mjs", "fix the typo in the comment in payback-accumulator.mjs".  
Action: Direct Execution Mode (or the already-delegated role-agent).  
Delegation prefix (if any): `Original Task Name: <verbatim>. You are operating in Execution Mode. After the 5-step Verification Procedure (delegated task-definition validation mandatory as step 2), immediately implement the requested change. Integrate any results and continue. Emit the short AGENTS termination format only when the unit of work is finished.`
Output contract: The code change + test (if applicable) + `git diff --stat`.  
Parent rule: Apply the patch, run the narrow test, continue.

**Situation 2 – Symbol / caller / path / topology**  
Triggers: "callers of", "path", "depends on", "who imports", "explain the relationship", any query that would benefit from the knowledge graph, or task likely to touch ≥3 source files.  
Examples: "what calls evaluateIntentPolicies", "trace the path from capital rebalance to signer", "explain how payback scheduler reaches Gateway offramp".  
Action: graphify skill (or direct `python3 -m graphify query/explain/path --graph src/graphify-out/graph.json`) **first**. Only after graph output, perform targeted reads or delegation.  
Delegation prefix (if further delegation needed): `Original Task Name: <verbatim>. Execute the full 5-step Mandatory Verification Procedure (delegated task-definition validation as step 2). Use graphify output to limit all file reads. Stay in Execution Mode: integrate results and continue implementation. No unsolicited Lx reports.`
Output contract: Graph report excerpt + minimal targeted source excerpts + proposed minimal edit (if any).  
Parent rule: Use the graph to keep subsequent work to ≤2 additional files. Continue execution.

**Situation 3 – Readiness / blocker / safety**  
Triggers: readiness, blocker, "is it safe", "what is blocking", deploy, claim live, "full automation readiness", "pre-commit safety", safety status questions.  
Examples: "run the readiness check", "is the autopilot safe to leave running", "what is the current blocker for full automation".  
Action: **Automatically invoke bob-claw-readiness-safety-verification skill**.  
Delegation prefix: `Original Task Name: <verbatim>. You are the bob-claw-readiness-safety-verification skill. Execute the full 5-step... (delegated task-definition validation step 2). Run the exact Diagnostic Entry Points from AGENTS.md and quote raw output. Return only the compact evidence-first summary. Stay in Execution Mode.`
Output contract: `current stage`, `what was checked`, `exact blocker or green path`, `why it is still blocked or ready`, `next safest verification step`.  
Parent rule: Quote the skill output verbatim, then integrate the blocker into the next implementation action. Never use the skill output to justify cap/signer/payback bypasses.

**Situation 4 – Capital / payback / NAV / audit status**  
Triggers: payback status, capital audit, NAV 변동, gas burn, slippage, refill 거부, carry 사유, accrued sats, "how much payback this period".  
Examples: "report payback status", "why is capital plan refusing refill", "latest capital-audit NAV delta".  
Action: **Direct execution of the exact AGENTS.md Diagnostic Entry Point CLI first** (never the skill unless the raw data is insufficient for the deeper question).  
Mandatory first command (quote verbatim):

- NAV/gas/slippage/payback accum: `npm run report:capital-audit -- --json`
- Readiness blocker: `node src/cli/check-full-automation-readiness.mjs --json`
- Refill/capital plan: `node src/cli/plan-capital-manager-refill-jobs.mjs --json`
- Payback status: `npm run report:payback-status -- --json`
- Dashboard truth: inspect `dashboard/public/dashboard-status.json`
- Latest autopilot: `data/all-chain-autopilot-latest.json`  
  Delegation only after the raw output if analysis beyond the table is required.  
  Parent rule: The raw command output appears in the answer. "데이터 부족" is reported exactly when the CLI returns no data or fails. Never fill gaps with guesses.

**Situation 5 – Multi-ownership large feature**  
Triggers: task language that crosses two or more Role Agent ownership boundaries (strategy + policy + treasury + infra + payback + dashboard), "new allocator", "unify across", "end-to-end lane for X".  
Examples: "implement the max-utilization allocator across all Gateway chains with policy and dashboard", "add radar live-canary support end-to-end".  
Action: **bob-claw-coordinator** launches parallel specialized subagents (one per ownership slice) + verifier-agent at the end.  
Delegation prefix (repeated for every child): `Original Task Name: <verbatim>. Execute delegated task-definition and ownership validation as step 2 of the 5-step Mandatory Verification Procedure. You are the <role>-agent. Objective: <exact child objective>. Your ownership is strictly limited to <declared area from ai-agent-operations.md>. Out of scope: <boundary>. Required proof: <command output, diff/file list, or artifact path>. Stop condition: <when to hand control back>. Stay in Execution Mode and return only scope-valid, proof-backed output.`
Parent (coordinator) rule: Remains in Execution Mode for the full duration. Summons only the children whose slices are truly independent, collects raw patches from children, applies them to the working tree, and re-summons or re-scopes any child that returns proofless or cross-scope output before running the Verification Matrix and claiming completion.

**Situation 6 – Dashboard UI, status schema, or public artifact**  
Triggers: "dashboard", "UI", "add field to status", "public JSON slice", "new component for X".  
Examples: "add a radar canary table to the dashboard", "change the status schema for protocol positions".  
Action: Direct (main or infra-agent). **Always read `docs/dashboard-context.md` before any edit.**  
Delegation prefix: include the dashboard-context read requirement + "Never stage generated dashboard/public/\*.json unless the task explicitly says publish refreshed artifact."  
Parent rule: Source changes (JSX, status builders) preferred. Generated files stay uncommitted except on explicit publish tasks. Run the dashboard test + build suite.

**Situation 7 – New CLI, script, or automation tool**  
Triggers: "create src/cli/...", "add a new command", "new diagnostic entry point", "new script under scripts/".  
Examples: "add cli for radar cap review".  
Action: `ls src/cli | grep <keyword>` (or equivalent under scripts/) **before** any file creation proposal. Then infra-agent or direct.  
Delegation prefix: "First run `ls src/cli | grep <keyword>` and report whether a similar tool already exists. If none, proceed in Execution Mode..."  
Parent rule: New CLI must ship with test + update to package.json + docs if user-facing. Same atomic unit.

**Situation 8 – Policy, risk gate, cap config, or executor-policy change**
Triggers: "update policy", "change cap", "new auto-kill", "healthFactor", "risk gate", "strategy-caps".  
Action: policy-agent (or direct for single-file).  
Delegation prefix: "Limit to src/executor/policy/** and src/risk/** and the exact config file. Run related capital-audit or readiness diagnostic. Graphify the policy module first. Always add or update the corresponding unit test in test/executor-policy* or test/auto-kill*."  
Parent rule: Policy change never ships without the test addition. Never escapes the declared policy ownership slice.

**Situation 9 – Architecture investigation, system-map, or research-heavy**  
Triggers: "how does the entire ... flow work", "update system-map", "end-to-end", "architecture of X".  
Action: graphify first (to map the live code surface), then read `docs/system-map.md`, `docs/harness-engineering.md`, and relevant `docs/research/*.md`. Direct or infra-agent.  
Parent rule: Docs updates occur only after code facts are confirmed via graphify + source. Never let research docs override committed source.

**Situation 10 – Bug whose root cause spans files or is unknown**  
Triggers: "bug", "why does this", "revert", "not triggering", "higher than expected", "missing receipt".  
Action: **graphify path/explain first** to discover the minimal file set, then targeted role-agent or direct fix + regression test.  
Parent rule: The regression test that would have caught the bug is part of the same unit. After fix on any capital-related path, re-run the relevant capital-audit diagnostic and quote the result.

**Situation 11 – Direct-only parent handling**
Triggers: user explicitly forbids delegation, delegated scope cannot be split into independent ownership slices, or the parent cannot produce objective + owned files + out-of-scope + proof + stop condition without guessing.
Action: Keep the work in the parent session. No child launch until the parent can produce a scope-safe delegation contract.
Parent rule: The parent either handles the task directly or rewrites the delegated contract so every child owns an independent slice.

All situations (1–11 detailed below; Situation 12 defined in the Master Decision Matrix table) enforce the same invariants: 5-step procedure (delegated task-definition validation as step 2), file-scope ownership, diagnostic/graphify first where required, Execution Mode continuation (integrate + keep working, no unsolicited Lx), and verbatim quoting of all diagnostic output.

## Skill Combination Patterns (Approved Only)

**Approved patterns (all others require explicit update to this matrix):**

- graphify (first) + bob-claw-readiness-safety-verification (when status + topology overlap).
- bob-claw-coordinator parallel launch of 2–6 role agents (Situation 5) followed by verifier-agent.
- graphify (first) + single role-agent (Situations 2, 9, 10).
- Direct Execution Mode + verifier-agent at the end of any non-trivial change (recommended hygiene).
- Single skill in isolation when the matrix row explicitly names it (readiness skill for Situation 3, graphify for Situation 2).

**Prohibited patterns:**

- Any skill or subagent launched without a scope-safe delegated contract.
- readiness-skill used to justify cap raises, signer bypass, or payback decisions (those are deterministic code paths only).
- Parallel subagents without a coordinator (ownership and delegated-entry checks would be missed).
- Unprompted Lx status reports generated from subagent outputs.
- Treating generated dashboard JSON or data/ snapshots as live truth.

## Verification Matrix for Skill and Subagent Work

| Skill / Delegation Type                  | Minimum Verification (in addition to the 5-step)                                                                                                         | Must Pass Before Parent Claims Completion                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| graphify invocation                      | `npm run graph:focus -- status`, confirm focused output used to limit reads — exit code is known                                                         | No broad file reads after graphify result                  |
| bob-claw-readiness-safety-verification   | Raw diagnostic CLI outputs present; `git diff --stat` clean of generated artifacts — exit code is known                                                  | harness "Dashboard UI/status" + "Any source refactor" rows |
| Single role-agent (strategy/policy/etc.) | Ownership respected; relevant harness row + module test; `rg` caller search for deleted symbols — exit code is known                                     | verifier-agent or direct hygiene check                     |
| Parallel multi-agent via coordinator     | All children passed their 5-step + delegated-entry validation; coordinator applied patches; full relevant harness rows + `npm test` — exit code is known | verifier-agent residual-risk report                        |
| verifier-agent review                    | Read-only (no edits); `git diff --stat` + `git diff --name-only` + exact harness row for change type — exit code is known                                | Parent must still run the tests                            |
| Any new skill added                      | New SKILL.md contains delegated-entry validation + 5-step; `npm run check:skills-config` passes; full `npm test` — exit code is known                    | Matrix row added to this document first                    |

Do not claim completion of any skill-involved task until the verification output has been read and the exit code is known.

## Adding or Updating Skills and Role Agents

**Critical:** Before any edit to this document, any SKILL.md, or any .claude/agents/\*.md, the editor (human or agent) MUST first execute the "Before editing this doc or any skill/agent" procedure at the top of this file (3 capital diagnostics + payback-status + `npm run check:skills-config` + full harness Final Review Loop). Raw outputs quoted. This is non-negotiable for evidence-complete confidence on the agent judgment system.

1. Update this document first: add/update the row in the Master Decision Matrix (and add detailed situation description in the guide section for 1-11 if the new situation is not already covered by an existing matrix row).
2. Create or edit the `.claude/skills/<name>/SKILL.md` (or `.claude/agents/<role>.md`).
3. The file **MUST** contain:
   - Standard frontmatter (name, description = exact ownership scope).
   - Verbatim copy of the delegated-entry validation section (Hard Rules, Enforcement Procedure, Refusal block, Integration requirements).
   - Verbatim 5-step Mandatory Verification Procedure (exactly matching the wording in AGENTS.md Coding Agent Operating Mode).
   - Reference to this Master Decision Matrix, the Source Vs Generated for AI Agent Surfaces table, and the Coding Agent Operating Mode (Execution Mode first, integrate-and-continue, no unsolicited Lx reports).
   - Situation-specific workflow and Hard Safety Rules (modeled on the existing bob-claw-readiness-safety-verification skill).
4. Run `npm run check:skills-config` (or the script that validates SKILL.md frontmatter and required blocks).
5. Add or extend tests that exercise the new skill/agent invocation path.
6. Update `docs/ai-agent-operations.md` Role Agents table if a new role agent is introduced.
7. Pass the full harness Verification Matrix rows that the new skill touches + `npm test` (exit code is known).
8. Update the "To add a new skill" paragraph at the top of this document if the process itself changes.

Any skill or agent definition missing the delegated-entry validation block or the 5-step procedure will fail the skills config checker and must be repaired before use.

---

**This document, together with AGENTS.md, forms the complete Automatic Judgment System for Coding Agents.** Future coding agents (Claude Code, Codex, or any successor) are expected to consult the Master Decision Matrix on every non-trivial task and to stay in Execution Mode by default, using skills and subagents only as precision tools that keep the main thread small and the implementation moving forward.

All rules herein are derived from and subordinate to AGENTS.md. In any conflict, AGENTS.md is the operating law.
