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

This document provides the detailed operating procedures for Claude Code skills (files under `.claude/skills/*/SKILL.md`) and all subagent/role-agent delegation patterns used in BOB Claw development and operations sessions.

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

2. **Immediate full refusal on match:** When the word is detected, the skill/subagent MUST output _exactly_ the following block (no preamble, no summary, no additional analysis, no "I can still help with...", and no further tool calls):

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

**Mandatory Verification Procedure (5 steps — execute in order on every skill/subagent activation; no shortcuts; integrate then continue):**

1. Re-read in full: `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md` (BOB Gateway Protection section). Quote the `updated_at`/version headers to prove freshness.
2. Run the BOB Gateway Protection literal-word check (`\bGateway\b` or equivalent) against `Original Task Name:` and the full user request. If the word appears, emit the exact refusal block from `docs/skill-usage-guidelines.md` and halt. Absolute priority over later steps.
3. Enforce file scope: confirm task is 100% inside this skill/agent's declared ownership (frontmatter + Role Agents table in `docs/ai-agent-operations.md`). Any other ownership or Gateway surface → refuse and return to parent/coordinator.
4. Execute the AGENTS.md Diagnostic Entry Point(s) appropriate to the question type plus any graphify `query/explain/path` needed to keep reads minimal. Paste the _exact raw command output_ (never summarized or paraphrased).
5. Perform final hygiene verification (`git diff --stat`, `git diff --name-only`, `rg` caller search for deleted/renamed symbols, and the narrow targeted test row from `docs/harness-engineering.md` Verification Matrix). Only then produce the deliverable. **Never emit an unprompted multi-item checklist or Lx-style status report**; integrate the results and keep working.

The parent coordinator prompt and all role-agent prompts must contain an explicit instruction to prefix every delegation with the `Original Task Name:` line and to require the child to run the full 5-step procedure (with Gateway check as step 2).

Any skill or agent definition that omits, reorders, weakens, or adds escape language around step 2 is non-compliant and must be repaired before the skill or agent is used.

This BOB Gateway Protection, combined with the file-scope + diagnostic-re-execution + priority requirements of the Coding Agent Operating Mode, guarantees that the BOB Gateway transport and settlement lane — the foundation of every native-BTC payback and capital movement — can only ever be touched by the highest-context main session under direct operator instruction, never through any delegated skill or subagent path.

---

**End of BOB Gateway Protection section (the strictest rule).**

All other content in this document is subordinate to the rules above.

## Core Principles of Skill and Subagent Usage

**Coding Agent Operating Mode (Execution Mode First) is the universal default.**

- Every coding agent, skill, and subagent invocation begins in **Execution Mode**: the agent reads the required sources (via the 5-step procedure), runs the mandated diagnostics and graphify calls, then immediately performs the implementation work (edits, new code, tests, config diffs, harness updates).
- Subagent and skill outputs are **raw material to be integrated** by the parent. The parent applies the results, runs verification, and continues the implementation without pausing the session to produce summaries.
- **No unsolicited Lx-style status reports or multi-item checklists.** The AGENTS.md short termination format (`현재 단계: Ln`, `이번에 한 일`, `왜 아직 그 단계인지`, `다음 체크리스트` — 3 items max) is emitted **only** at the natural completion of the user's requested unit of work or when the user explicitly asks for status. Intermediate delegation results are never turned into Lx reports.
- This mode aligns all agent activity with the long-term goal of an unattended, deterministic, receipt-backed native-BTC payback capital system. The agent behaves as a disciplined senior engineer who finishes the job with minimal ceremony.

**Evidence-Complete Confidence (no cached assumptions, no "data 부족" filled by guesswork).**

- The AGENTS.md Diagnostic Entry Points table is the ground truth for any status, capital, payback, readiness, or NAV question. The exact CLI is run and its raw `--json` (or file) output is quoted verbatim in every response that touches the topic.
- New modules or CLIs are never proposed until `ls src/cli | grep <keyword>` (or equivalent) confirms no similar tool already exists.
- graphify is the mandatory first tool for any question involving code topology, callers, paths, or "X depends on Y".

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
4. `docs/skill-usage-guidelines.md` (this file, especially BOB Gateway Protection, Source Vs Generated for AI Agent Surfaces table, Master Decision Matrix, and the "Before editing..." rule below)
5. `docs/ai-agent-operations.md` (Role Agents table and ownership)

Then execute the **5-Step Mandatory Verification Procedure** (reproduced in BOB Gateway Protection section) on every skill activation and every delegation.

## Source Vs Generated for AI Agent Surfaces

Modeled directly on the Source Vs Generated table in `docs/harness-engineering.md`. AI agent definitions and the guidelines that govern them are **source of truth**; their runtime outputs are generated/operational artifacts.

| Treat As Source                                   | Treat As Generated / Operational                                    |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `.claude/agents/*.md` (role agent prompts)        | `logs/codex-audit.jsonl`, `logs/codex-budget-lock-audit.jsonl`      |
| `.claude/skills/*/SKILL.md` (all skill bodies)    | `data/codex/**`, `data/auto-research-refresh-latest.json`           |
| `docs/skill-usage-guidelines.md`                  | `data/health/**`, `logs/position-monitor-audit.jsonl`               |
| `docs/ai-agent-operations.md` (Role Agents table) | session handoff files, Lx-style transcripts (unless user-requested) |
| `scripts/check-skills-config.mjs`                 | any `*-handoff*.md` or generated agent scratch / preview outputs    |
| `test/skills-config.test.mjs`                     | temporary Codex/research scaffold files under `data/` or `/tmp`     |

Agent surface source files (prompts, SKILL.md, this guidelines doc, the Role Agents table) must be edited under the same 5-step + diagnostics + harness Final Review Loop discipline as policy or strategy code. Generated agent outputs are never treated as ground truth for decisions; they are advisory scaffolds only and follow the same "do not stage unless explicit publish" rule as dashboard public JSON.

## Master Decision Matrix (Automatic Judgment Centerpiece)

This matrix is the primary mechanical reference that allows future coding agents and the bob-claw-coordinator to decide **without user prompting** which skill, agent combination, or direct Execution Mode path to take.

**Usage rule:** Match the current user task (title + description + implied scope) against the Detection column. The first row that matches is authoritative. Safety rows (Gateway, readiness, graphify) have precedence ordering as listed. After matching, the parent always prefixes the delegation (if any) with `Original Task Name: <verbatim>` and requires the child to execute the full 5-step procedure with Gateway check as step 2. The parent integrates results and stays in Execution Mode.

| #   | Situation Category                                                                                      | Detection / Trigger Conditions (keywords, file count estimate, query type, ownership)                                                                        | Automatic Action                                                                                                                                                 | Mandatory Sequence (after 5-step Verification)                                                                                                                                                                                                                     | Execution Mode Continuation Rule                                                                                                                                                                           | Minimum Verification (harness + skill-specific)                                                                           |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Isolated single-ownership edit (≤2 files, no symbol cross-ref, no status/readiness query, no "Gateway") | "edit src/strategy/foo.mjs", "add test for bar", "small fix in one module", implied single ownership, no readiness/status/capital words                      | Direct main session (or single role-agent if already delegated). No /skill trigger.                                                                              | Run `npm run graph:focus -- status` + ls src/cli check if new file proposed.                                                                                                                                                                                       | Implement the change immediately. Apply any later subagent output. Emit short AGENTS termination format **only** on task completion.                                                                       | Module-specific test + `git diff --stat` hygiene.                                                                         |
| 2   | Symbol / caller / path / topology question ("what calls X", "path from A to B", "who imports this")     | "explain the callers of", "dependency path", "how does Y reach Z", architecture diagram request, ≥3 files implied                                            | **graphify skill first** (`/graphify` or `python3 -m graphify query/explain/path --graph src/graphify-out/graph.json`). Then targeted direct or role-agent work. | graphify query/explain/path **before** any broad Read. Use output to limit subsequent file reads to <3.                                                                                                                                                            | Use graphify output to scope minimal edits. Continue implementation.                                                                                                                                       | Confirm graphify report cited; no over-broad file reads.                                                                  |
| 3   | Readiness / blocker / "is it safe" / full-automation / pre-deploy safety question                       | "is the system ready", "readiness blocker", "what is blocking", "can I claim live", "safety status", "pre-commit safety review", "full automation readiness" | **Automatically invoke bob-claw-readiness-safety-verification skill** (per Automatic Judgment System).                                                           | The skill itself executes the exact Diagnostic Entry Points (readiness CLI, capital-audit, payback-status, dashboard/public/dashboard-status.json, etc.) and quotes raw output.                                                                                    | Skill returns compact evidence-first summary (`current stage`, `exact blocker`, `next safest step`). Parent integrates into ongoing Execution and continues.                                               | Skill-internal checks + harness Verification Matrix row for "Any source refactor" or "Dashboard UI/status".               |
| 4   | Capital / payback / NAV / gas burn / slippage / refill / carry status query                             | "payback status", "capital audit", "NAV delta", "gas burn", "how much accrued", "refill decision", "carry 사유"                                              | **First** run the exact AGENTS.md Diagnostic Entry Point CLI for the question type. Only then consider readiness skill if deeper analysis required.              | Run and quote verbatim: `npm run report:capital-audit -- --json`, `npm run report:payback-status -- --json`, `node src/cli/plan-capital-manager-refill-jobs.mjs --json`, or `dashboard/public/dashboard-status.json` as appropriate. Never substitute with memory. | After verbatim quote, continue any implementation work if the original task was more than pure query.                                                                                                      | Raw CLI / JSON output must appear in the final answer.                                                                    |
| 5   | Large feature spanning multiple ownership areas (strategy + policy + treasury + infra + payback)        | "add new capital allocator across chains", "unify protocol readers", "new radar + dashboard + policy lane", "multi-area refactor"                            | **bob-claw-coordinator** spawns parallel specialized subagents (strategy-agent + policy-agent + treasury-agent + infra-agent + verifier-agent at end).           | Coordinator runs Gateway check on task, then delegates with `Original Task Name` + "Execute 5-step... stay in Execution Mode, integrate and continue, no unsolicited Lx reports." Each child limited to its declared ownership.                                    | Coordinator remains in Execution Mode: launches parallel delegations, collects raw outputs, applies code changes to working tree, runs verification, and keeps working until the feature unit is complete. | verifier-agent residual-risk report + full relevant rows from harness Verification Matrix + `npm test` for touched areas. |
| 6   | Dashboard UI, status schema, or public JSON slice change                                                | "update the dashboard to show X", "add field to dashboard-status", "new UI component for Y"                                                                  | Direct (main or infra-agent). **Always** read `docs/dashboard-context.md` first.                                                                                 | Read dashboard-context.md + status builder source. Never stage generated `dashboard/public/*.json` unless the explicit task is "publish refreshed dashboard artifact".                                                                                             | Prefer source JSX / .mjs changes. Generated bundles stay out of normal commits.                                                                                                                            | `node --test test/dashboard-*.test.mjs && npm run dashboard:build`.                                                       |
| 7   | New CLI, script, or automation tool                                                                     | "create src/cli/new-foo.mjs", "add a command for Z", "new diagnostic entry point"                                                                            | `ls src/cli                                                                                                                                                      | grep <keyword>` **before** any proposal. Then infra-agent or direct.                                                                                                                                                                                               | Existing similar tool check is mandatory. New CLI must include test + docs update in the same unit.                                                                                                        | `node --test test/repo-hygiene.test.mjs` + new CLI-specific test + harness "Git hygiene" row.                             |
| 8   | Policy, risk gate, cap config, or executor-policy change (no literal "Gateway" word)                    | "update policy for healthFactor", "change maxDailyLoss", "new auto-kill trigger", "modify cap in strategy-caps"                                              | policy-agent (or direct if single-file).                                                                                                                         | Related Diagnostic Entry Point (capital-audit or readiness) + graphify on the policy module.                                                                                                                                                                       | Policy change **always** ships with unit test addition in the executor-policy or risk test family.                                                                                                         | `node --test test/executor-policy-index.test.mjs test/auto-kill-triggers.test.mjs test/gateway-availability.test.mjs`.    |
| 9   | Architecture investigation, system-map update, or research-heavy question                               | "how does the entire payback flow work", "update docs/system-map.md for new lane", "end-to-end receipt path"                                                 | graphify + read system-map/harness + relevant `docs/research/*.md`. Direct or infra-agent.                                                                       | graphify first to map the code surface. Then docs. Facts from code win over narrative.                                                                                                                                                                             | Update docs only after code facts + harness checks are confirmed.                                                                                                                                          | graphify report + harness "Docs only" + "Any source refactor" rows.                                                       |
| 10  | Bug whose root cause is unknown or spans files (revert, wrong behavior, missing receipt)                | "payback not triggering on Base", "why does this intent get rejected", "gas cost higher than expected"                                                       | **graphify path/explain first** to identify the minimal file set, then targeted role-agent or direct fix.                                                        | graphify mandatory before reading >2 files. Add regression test that would have caught the bug.                                                                                                                                                                    | Fix + test + (if capital path) run capital-audit diagnostic after the fix.                                                                                                                                 | Targeted regression test + relevant harness row (payback, policy, etc.).                                                  |
| 11  | Any task whose name or description contains the literal whole word "Gateway" (capital G, word-bounded)  | "Gateway consolidation", "fix Gateway offramp", "update gateway-availability", "BOB Gateway policy", any occurrence                                          | **Immediate refusal of all skill and subagent delegation.** Only the primary bob-claw-coordinator or main coding session may handle it.                          | Step 2 of 5-step fires the exact refusal block. No preparatory tools.                                                                                                                                                                                              | Handled exclusively in the highest-context main session under direct operator instruction. No delegation path of any kind.                                                                                 | Full main-session harness Verification Matrix + manual operator sign-off if capital surface touched.                      |
| 12  | Post-edit verification, diff review, "check my work", residual risk, or hygiene audit                   | "verify the changes I just made", "review this diff", "is the implementation complete", "residual risk report"                                               | verifier-agent (read-only, no memory). If safety or readiness claim is involved, also bob-claw-readiness-safety-verification skill.                              | `git diff --stat` + `git diff --name-only` + rg caller search first. Then delegate.                                                                                                                                                                                | After receiving verifier output, integrate any required fixes in Execution Mode and re-verify before claiming completion.                                                                                  | verifier-agent report + exact harness Verification Matrix row for the change type + `npm test` exit code known.           |

**Matrix precedence notes:**

- Row 11 (Gateway) is absolute and checked first on every entry.
- Row 3 (readiness) and Row 2 (graphify) are high-priority automatic triggers.
- Row 5 (multi-ownership) is the only situation that routinely uses parallel subagents.
- For any situation not clearly matching a row, default to Row 1 (direct Execution) or escalate to coordinator for matrix re-evaluation.

## Detailed Situation-Based Decision Guide (Situations 1–11; Situation 12 is defined in the Master Decision Matrix table above)

Each situation below gives the practical trigger list, example user queries that map to it, the exact delegation prompt prefix the parent must use, the output contract expected from the skill/agent, and the integration rule for the parent.

**Situation 1 – Isolated single-ownership edit**  
Triggers: task mentions one specific .mjs file or module, "small", "quick fix", "add X to Y", no status/readiness/capital words, no cross-ownership language, <3 files estimated.  
Examples: "add a new constant to src/config/sizing.mjs", "fix the typo in the comment in payback-accumulator.mjs".  
Action: Direct Execution Mode (or the already-delegated role-agent).  
Delegation prefix (if any): `Original Task Name: <verbatim>. You are operating in Execution Mode. After the 5-step Verification Procedure (Gateway check mandatory as step 2), immediately implement the requested change. Integrate any results and continue. Emit the short AGENTS termination format only when the unit of work is finished.`  
Output contract: The code change + test (if applicable) + `git diff --stat`.  
Parent rule: Apply the patch, run the narrow test, continue.

**Situation 2 – Symbol / caller / path / topology**  
Triggers: "callers of", "path", "depends on", "who imports", "explain the relationship", any query that would benefit from the knowledge graph, or task likely to touch ≥3 source files.  
Examples: "what calls evaluateIntentPolicies", "trace the path from capital rebalance to signer", "explain how payback scheduler reaches Gateway offramp".  
Action: graphify skill (or direct `python3 -m graphify query/explain/path --graph src/graphify-out/graph.json`) **first**. Only after graph output, perform targeted reads or delegation.  
Delegation prefix (if further delegation needed): `Original Task Name: <verbatim>. Execute the full 5-step Mandatory Verification Procedure (Gateway literal check as step 2). Use graphify output to limit all file reads. Stay in Execution Mode: integrate results and continue implementation. No unsolicited Lx reports.`  
Output contract: Graph report excerpt + minimal targeted source excerpts + proposed minimal edit (if any).  
Parent rule: Use the graph to keep subsequent work to ≤2 additional files. Continue execution.

**Situation 3 – Readiness / blocker / safety**  
Triggers: readiness, blocker, "is it safe", "what is blocking", deploy, claim live, "full automation readiness", "pre-commit safety", safety status questions.  
Examples: "run the readiness check", "is the autopilot safe to leave running", "what is the current blocker for full automation".  
Action: **Automatically invoke bob-claw-readiness-safety-verification skill**.  
Delegation prefix: `Original Task Name: <verbatim>. You are the bob-claw-readiness-safety-verification skill. Execute the full 5-step... (Gateway check step 2). Run the exact Diagnostic Entry Points from AGENTS.md and quote raw output. Return only the compact evidence-first summary. Stay in Execution Mode.`  
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
Delegation prefix (repeated for every child): `Original Task Name: <verbatim>. Execute BOB Gateway Protection literal check as step 2 of the 5-step Mandatory Verification Procedure. You are the <role>-agent. Your ownership is strictly limited to <declared area from ai-agent-operations.md>. Stay in Execution Mode: produce the implementation diff for your area only, then return control. No Lx reports.`  
Parent (coordinator) rule: Remains in Execution Mode for the full duration. Collects raw patches from children, applies them to the working tree, runs the Verification Matrix, and only emits the short AGENTS termination format when the entire feature unit is complete and verified.

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

**Situation 8 – Policy, risk gate, cap config, or executor-policy change (no literal "Gateway")**  
Triggers: "update policy", "change cap", "new auto-kill", "healthFactor", "risk gate", "strategy-caps".  
Action: policy-agent (or direct for single-file).  
Delegation prefix: "Limit to src/executor/policy/** and src/risk/** and the exact config file. Run related capital-audit or readiness diagnostic. Graphify the policy module first. Always add or update the corresponding unit test in test/executor-policy* or test/auto-kill*."  
Parent rule: Policy change never ships without the test addition. Never touches Gateway surfaces.

**Situation 9 – Architecture investigation, system-map, or research-heavy**  
Triggers: "how does the entire ... flow work", "update system-map", "end-to-end", "architecture of X".  
Action: graphify first (to map the live code surface), then read `docs/system-map.md`, `docs/harness-engineering.md`, and relevant `docs/research/*.md`. Direct or infra-agent.  
Parent rule: Docs updates occur only after code facts are confirmed via graphify + source. Never let research docs override committed source.

**Situation 10 – Bug whose root cause spans files or is unknown**  
Triggers: "bug", "why does this", "revert", "not triggering", "higher than expected", "missing receipt".  
Action: **graphify path/explain first** to discover the minimal file set, then targeted role-agent or direct fix + regression test.  
Parent rule: The regression test that would have caught the bug is part of the same unit. After fix on any capital-related path, re-run the relevant capital-audit diagnostic and quote the result.

**Situation 11 – Gateway literal word (already covered in detail in the BOB Gateway Protection section)**  
Triggers: any whole-word occurrence of "Gateway" (capital G) in the Original Task Name or full user request.  
Action: Immediate, verbatim refusal block. No tools of any kind. Termination of the delegated context.  
Parent rule: The main bob-claw-coordinator (or primary coding session) handles the task directly under operator instruction. No skill or subagent path is ever permitted.

All situations (1–11 detailed below; Situation 12 defined in the Master Decision Matrix table) enforce the same invariants: 5-step procedure (Gateway check #2), file-scope ownership, diagnostic/graphify first where required, Execution Mode continuation (integrate + keep working, no unsolicited Lx), and verbatim quoting of all diagnostic output.

## Skill Combination Patterns (Approved Only)

**Approved patterns (all others require explicit update to this matrix):**

- graphify (first) + bob-claw-readiness-safety-verification (when status + topology overlap).
- bob-claw-coordinator parallel launch of 2–6 role agents (Situation 5) followed by verifier-agent.
- graphify (first) + single role-agent (Situations 2, 9, 10).
- Direct Execution Mode + verifier-agent at the end of any non-trivial change (recommended hygiene).
- Single skill in isolation when the matrix row explicitly names it (readiness skill for Situation 3, graphify for Situation 2).

**Prohibited patterns:**

- Any skill or subagent on a task containing literal "Gateway".
- readiness-skill used to justify cap raises, signer bypass, or payback decisions (those are deterministic code paths only).
- Parallel subagents without a coordinator (ownership and Gateway checks would be missed).
- Unprompted Lx status reports generated from subagent outputs.
- Treating generated dashboard JSON or data/ snapshots as live truth.

## Verification Matrix for Skill and Subagent Work

| Skill / Delegation Type                  | Minimum Verification (in addition to the 5-step)                                                                                            | Must Pass Before Parent Claims Completion                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| graphify invocation                      | `npm run graph:focus -- status`, confirm focused output used to limit reads — exit code is known                                            | No broad file reads after graphify result                  |
| bob-claw-readiness-safety-verification   | Raw diagnostic CLI outputs present; `git diff --stat` clean of generated artifacts — exit code is known                                     | harness "Dashboard UI/status" + "Any source refactor" rows |
| Single role-agent (strategy/policy/etc.) | Ownership respected; relevant harness row + module test; `rg` caller search for deleted symbols — exit code is known                        | verifier-agent or direct hygiene check                     |
| Parallel multi-agent via coordinator     | All children passed their 5-step + Gateway guard; coordinator applied patches; full relevant harness rows + `npm test` — exit code is known | verifier-agent residual-risk report                        |
| verifier-agent review                    | Read-only (no edits); `git diff --stat` + `git diff --name-only` + exact harness row for change type — exit code is known                   | Parent must still run the tests                            |
| Any new skill added                      | New SKILL.md contains verbatim BOB Gateway Protection + 5-step; `npm run check:skills-config` passes; full `npm test` — exit code is known  | Matrix row added to this document first                    |

Do not claim completion of any skill-involved task until the verification output has been read and the exit code is known.

## Adding or Updating Skills and Role Agents

**Critical:** Before any edit to this document, any SKILL.md, or any .claude/agents/\*.md, the editor (human or agent) MUST first execute the "Before editing this doc or any skill/agent" procedure at the top of this file (3 capital diagnostics + payback-status + `npm run check:skills-config` + full harness Final Review Loop). Raw outputs quoted. This is non-negotiable for evidence-complete confidence on the agent judgment system.

1. Update this document first: add/update the row in the Master Decision Matrix (and add detailed situation description in the guide section for 1-11 if the new situation is not already covered by an existing matrix row).
2. Create or edit the `.claude/skills/<name>/SKILL.md` (or `.claude/agents/<role>.md`).
3. The file **MUST** contain:
   - Standard frontmatter (name, description = exact ownership scope).
   - Verbatim copy of the entire BOB Gateway Protection section (Hard Rules, Enforcement Procedure, Refusal block, Integration requirements).
   - Verbatim 5-step Mandatory Verification Procedure (exactly matching the wording in AGENTS.md Coding Agent Operating Mode).
   - Reference to this Master Decision Matrix, the Source Vs Generated for AI Agent Surfaces table, and the Coding Agent Operating Mode (Execution Mode first, integrate-and-continue, no unsolicited Lx reports).
   - Situation-specific workflow and Hard Safety Rules (modeled on the existing bob-claw-readiness-safety-verification skill).
4. Run `npm run check:skills-config` (or the script that validates SKILL.md frontmatter and required blocks).
5. Add or extend tests that exercise the new skill/agent invocation path.
6. Update `docs/ai-agent-operations.md` Role Agents table if a new role agent is introduced.
7. Pass the full harness Verification Matrix rows that the new skill touches + `npm test` (exit code is known).
8. Update the "To add a new skill" paragraph at the top of this document if the process itself changes.

Any skill or agent definition missing the BOB Gateway Protection block or the 5-step procedure will fail the skills config checker and must be repaired before use.

---

**This document, together with AGENTS.md, forms the complete Automatic Judgment System for Coding Agents.** Future coding agents (Claude Code, Codex, or any successor) are expected to consult the Master Decision Matrix on every non-trivial task and to stay in Execution Mode by default, using skills and subagents only as precision tools that keep the main thread small and the implementation moving forward.

All rules herein are derived from and subordinate to AGENTS.md. In any conflict, AGENTS.md is the operating law.
