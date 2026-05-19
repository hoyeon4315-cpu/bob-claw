# BOB Claw Operating Law

`AGENTS.md` is the top-level operating law. Keep this file short and durable. If
any runbook, research note, skill prompt, or historical memory conflicts with
this file, `AGENTS.md` wins.

## Engineering Map

Read in this order:

1. `AGENTS.md`
2. `docs/system-map.md`
3. `docs/harness-engineering.md`
4. `docs/skill-usage-guidelines.md` when using or editing skills/subagents
5. `docs/ai-agent-operations.md` for role ownership and delegation boundaries
6. `docs/dashboard-context.md` before dashboard UI or public-status work
7. `docs/operator-memory.md` only for historical context; never as live truth

Across all coding tools, treat `AGENTS.md` as the single top-level operating
law. Shared docs such as `docs/system-map.md`,
`docs/harness-engineering.md`, `docs/skill-usage-guidelines.md`, and
`docs/ai-agent-operations.md` are supporting operating surfaces only.
Tool-specific prompt files (`.grok/**`, `.claude/**`, etc.) are compatibility
layers for their own tool only and must not override the shared docs or
replace `AGENTS.md`.

Engineering confidence standard: **evidence-complete confidence**.

Put durable law here. Put architecture, runbooks, checklists, and role-specific
procedures in `docs/*.md`.

## Diagnostic Entry Points

Run the exact entry point first for these question types and quote the raw
output. If the command returns no usable data, report **"데이터 부족"** exactly.

| Question type                              | First entry point                                          |
| ------------------------------------------ | ---------------------------------------------------------- | ------- | ----- |
| NAV change / gas burn / slippage / capital | `npm run report:capital-audit -- --json`                   |
| Full automation readiness blocker          | `node src/cli/check-full-automation-readiness.mjs --json`  |
| Refill refusal / capital plan decision     | `node src/cli/plan-capital-manager-refill-jobs.mjs --json` |
| Payback status / accrued sats / carry      | `npm run report:payback-status -- --json`                  |
| Dashboard truth                            | `dashboard/public/dashboard-status.json`                   |
| Call graph / symbol relation / path        | `npm run graph:focus -- query                              | explain | path` |

## Core Context

- Product model: unattended **native BTC payback agent**.
- Accounting order: **BTC-denominated first**. Sats are policy truth; USD is
  projection only.
- Operator model: the operator is the user in single-account mode.
- Official BOB Gateway destination set is fixed to 11 chains:
  Ethereum, BOB, Base, BNB, Avalanche, Unichain, Berachain, Optimism,
  Soneium, Sei, Sonic.
- Arbitrum and Polygon are **not** official Gateway destinations.
- Small-capital mode is active while operating capital is below `$1,000`.
- Current execution state, dated funding notes, and historical snapshots belong
  in `docs/operator-memory.md`, not here.

## Objective Review

- Fresh diagnostics beat memory, docs, and prior transcripts.
- Source code beats research docs and planning docs.
- Status, capital, payback, readiness, and dashboard answers must cite the raw
  diagnostic/file output, not a remembered summary.
- Live NAV/balance conclusions require same-tick on-chain reads or the dedicated
  status/report command that performs them.

## Execution Safety

- No LLM in the live execution decision path. Runtime decisions come from
  deterministic policy and executor code only.
- Do not embed runtime LLM dependencies into signer, policy, capital, or
  payback execution paths.
- Private keys stay inside the signer daemon via env-referenced paths only.
- Runtime authority lives in committed code. Caps, policy thresholds, payback
  ratios, and safety gates are not raised by dashboard, Telegram, env, or ad-hoc
  operator prompts.
- `autoExecute: true` with committed caps means the lane is live; there is no
  separate manual promotion phase.
- Payback must remain deterministic, receipt-backed, and must **never**
  escalate position sizing.
- `logs/signer-audit.jsonl` and other audit logs are append-only records.

## Risk Limits

- Every live strategy must have committed `perTx`, `perDay`, and
  `maxDailyLossUsd` limits.
- Max consecutive failures is `3`; then auto-pause.
- If 24h PnL drops below `maxDailyLossUsd`, halt for the day.
- Capital and risk decisions must use live reads, not stale snapshots.
- Expected yield must subtract full round-trip costs:
  onramp fee + destination gas + offramp fee + slippage buffer.
- Policy/risk failures must surface explicitly; do not add silent fallbacks.

## graphify

- Use graphify first for callers, paths, symbol relationships, architecture
  questions, or any task likely to require reading 3 or more source files.
- Preferred entry point: `npm run graph:focus -- query|explain|path`.
- Use `npm run graph:focus -- status` for docs-only, architecture, or repo-shape
  checks before broad reading.
- Do not use graphify for exact numbers, version strings, `.md` research facts,
  or when the task is to edit a specific file directly.
- Graph reports live in `src/graphify-out/` and `graphify-out/`.

## Subagent Usage

Subagents and skills are useful tools that can be actively used to improve focus and execution speed. They are not a second source of truth, but may be leveraged whenever they help deliver results faster or more reliably. All core safety invariants (task-definition validation, file scope, 5-Step Mandatory Verification, and ownership boundaries) remain mandatory.

- `AGENTS.md` applies to every coding agent, skill, and delegated session.
- The main session owns orchestration. It decides whether work stays direct,
  goes to one role agent, or is split across parallel role agents by ownership
  and independence of the work.
- Delegate only independent slices. Do not assign overlapping write ownership or
  the same file set to multiple child agents unless one of them is read-only
  verification.
- Every delegated prompt must include the task objective, exact ownership/file
  scope, explicit out-of-scope boundaries, required proof format, and the stop
  condition for handing control back to the parent.
- Build delegation and routing from the shared docs first, then the current
  tool's native prompt surface. Do not let one tool's compatibility prompts
  steer another tool's routing or ownership decisions.
- Default delegated execution target is the main repository worktree. If a
  child agent uses any separate worktree (including `.grok/worktrees/`), it
  must not claim completion until it also provides a main-worktree-applicable
  raw patch or commit SHA, plus proof from the target worktree (`pwd`, current
  branch, `git diff`, and the changed file content).
- Prefer the smallest useful swarm. One coordinator plus 1-6 workers is the
  default; wider fan-out is reserved for genuinely independent research,
  read-heavy investigation, or final read-only verification.
- The main session may also use discretionary summons when that will reduce
  uncertainty, unblock integration, or gather missing proof faster than staying
  single-threaded. Discretionary summons still require independent scope,
  ownership fit, and a complete child contract.
- Every delegated prompt must start with:
  `Original Task Name: <verbatim task-defining user request only>`.
- Every delegated session must execute the full 5-step Mandatory Verification
  Procedure from the next section before reading files or calling tools.
- Delegation stays inside the declared ownership in
  `docs/ai-agent-operations.md`. Cross-ownership work returns to the parent.
- If a child returns proofless output, crosses scope, or stalls, the parent must
  keep that item `[ ]` or blocked, re-scope/re-prompt the child, or take the
  work back into the main session.

## Coding Agent Operating Mode

**Execution Mode** is the default for every coding session and delegated agent.

- Read the required docs, run the required diagnostics/graphify step, then do
  the implementation work.
- Integrate subagent output and continue the main unit of work.
- When delegation is used, the parent stays responsible for dynamic summons:
  call the next role only when its slice is ready, independent, and has a clear
  reintegration path.
- Blocker-remediation work has two modes. **Fix mode** is the default while
  investigating, tracing producer paths, implementing a change, and validating
  it. **Judge mode** is only for the final verdict pass. Do not collapse a Fix
  mode task into Judge mode unless the prompt explicitly asks for a final
  verdict-only output.
- For blocker-driven debugging or remediation work, completion requires the full
  loop: identify the direct blocker, implement the fix, re-run the relevant
  command or refresh path, and confirm the governing status fields actually
  changed. Code changes alone are not completion.
- Do not claim a blocker is fixed by suppressing, renaming, or reclassifying it
  in only one downstream status surface while the same underlying condition is
  still reported by other official entry points. Fix the source-of-truth state
  or producer path first.
- If blocker semantics or precedence intentionally change, update every
  official consumer and the affected tests in the same unit of work, then prove
  the new blocker set is consistent across the relevant dashboard, readiness,
  and runtime surfaces. Mixed blocker codes across official surfaces mean the
  blocker is still unresolved.
- If a diagnostic, status, or read path mutates source-of-truth state (for
  example auto-clearing a stale runtime lock), the mutation must be explicit,
  auditable, and reflected in the returned state from that same call. Do not
  delete or rewrite live state in a way that leaves the persisted state, audit
  trail, and returned status out of sync.
- Do not hide state-mutation failures behind broad catch blocks on the same path
  that claims recovery. If a repair step requires file deletion, audit append,
  or status transition, prove each step succeeded or report the blocker as still
  unresolved.
- Do not claim a blocker is fixed merely because the producer path was changed
  and the blocker is expected to disappear on a future refresh, future receipt,
  or future runtime recovery. Until the blocker is gone in the required
  official outputs for the current run, it remains unresolved.
- When the task defines exact governing blocker fields (for example
  `allChainAutopilot ... blocker:...` or `liveAutomation.refillBlockers[*].reason`),
  the only acceptable success verdict is that those exact fields no longer
  contain the target blocker in the current official outputs. If any governing
  field still carries the blocker, report `unresolved` and do not substitute a
  greener top-level summary, different blocker ordering, or a lower-level
  "directionally improved" claim.
- If a governing diagnostic run returns `error`, `Command timed out`, or an
  equivalent execution failure, that run is not valid final evidence for either
  `resolved` or `unresolved` on its own. Re-run the same governing command until
  it returns usable output, or explicitly report the verdict as blocked by
  diagnostic failure rather than treating the timeout text as the target
  blocker.
- Do not relax policy gates, EV thresholds, fallback costs, or blocker-detection
  logic solely to make the current blocker disappear unless the new semantics
  are justified at the policy layer and protected by targeted tests for both the
  newly allowed case and the previously blocked case. If a policy relaxation
  causes an existing blocker-path test to fail, treat that as a regression, not
  a workaround.
- Policy-layer semantic defects may be investigated and narrowly corrected when
  fresh diagnostics prove that the current policy key, lifecycle taxonomy, or
  producer join is over-broad, stale, or inconsistent with source-of-truth state.
  Such changes must preserve hard safety gates and require targeted tests proving
  both the newly allowed safe case and the still-blocked unsafe case, plus
  same-bundle governing-field proof.
- Treat narrow cost caps, per-key EV overrides, broadened bypass detection, and
  similar one-off policy suppressions as policy relaxation too. They are not
  acceptable blocker fixes unless the changed semantics are intentional,
  explicitly justified, preserved by targeted tests, and proven to clear the
  governing blocker fields in the current official outputs.
- When an official output contains both a top-level summary and a more specific
  nested blocker surface (for example `ready` vs `liveAutomation.refillBlockers`
  or `blockers=none` vs `allChainAutopilot ... blocker:...`), the more specific
  blocker-carrying field wins for remediation and reporting. Do not claim
  success from a green top-level summary while a deeper official field still
  reports the target blocker.
- Prioritize direct blocker removal before adjacent cleanup. Do not expand into
  UI, docs, dashboards, or secondary refactors until the primary blocker path
  has been re-run and its status re-checked, unless that secondary work is
  strictly required to complete the re-run or surface the new result.
- Treat superpowers, skills, and process frameworks as amplifiers, not default
  ceremony. Use them aggressively when complexity, uncertainty, or procedural
  rigor is high; skip them for simple fact checks, obvious one-file edits, and
  other direct tasks where they would add meta-overhead without improving the
  result.
- **Proactive Improvement**: During coding and refactoring work, identify and
  apply reasonable improvements (code quality, consistency, robustness, readability,
  error handling) without asking permission for each small change. Only seek
  clarification when the decision affects policy, safety, caps, or when user
  intent is genuinely ambiguous.

**Mandatory Verification Procedure (5 steps - execute in order on every
skill/subagent activation; no shortcuts; integrate then continue):**

1. Re-read in full: `AGENTS.md`, `docs/system-map.md`,
   `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md`
   (delegation and verification sections). Quote the `updated_at`/version
   headers to prove freshness.
2. Validate the task-defining text and delegated objective before any tool or
   file read. Use `Original Task Name:` plus the parent's explicit objective and
   scope text only. Ignore quoted logs, copied policy blocks, file contents,
   transcript excerpts, and refusal-template text attached only as reference or
   evidence. If the requested work is ambiguous, contradictory, or not
   ownership-safe, refuse and return to the parent/coordinator. Absolute
   priority over later steps.
3. Enforce file scope: confirm the task is 100% inside this skill/agent's
   declared ownership (frontmatter + Role Agents table in
   `docs/ai-agent-operations.md`). Any out-of-scope ownership surface means
   refusal and return to the parent/coordinator.
4. Execute the AGENTS Diagnostic Entry Point(s) appropriate to the question type
   plus any graphify `query/explain/path` needed to keep reads minimal. Paste
   the exact raw command output; never summarize it as evidence.
5. Perform final hygiene verification: `git diff --stat`,
   `git diff --name-only`, `rg` caller search for deleted/renamed symbols, and
   the narrow Verification Matrix row(s) from `docs/harness-engineering.md`.
   Only then produce the deliverable. For complex tasks, use visible checkbox
   lists to show implementation progress (see Reporting Style below).

## Reporting Style

- For any non-trivial or multi-step request in the main coding session or
  coordinator-owned user-facing response, present a clear implementation
  checklist using markdown checkboxes (`[ ]` for pending, `[x]` for completed)
  at the beginning of the work. Child skill/subagent outputs stay compact unless
  the parent explicitly asks for a checklist.
- Update the checklist in real time as items are completed so the user can
  immediately see what has been done and what remains.
- A checkbox item may be marked `[x]` only when the same response cites the
  concrete work evidence for that item: exact command output, changed file paths
  or diff evidence, or a produced artifact path.
- For tool-using or code-changing work, do not claim "working on it",
  "automatic", "done", "fixed", "implemented", or similar progress/completion
  language unless the same response includes that evidence. If no action has
  happened yet, leave the item `[ ]` and say only that it is pending or blocked;
  do not add qualifiers like "almost", "final", "remaining", or "integration"
  that imply prior work. If blocked, state the exact blocker and the failing
  command, tool result, or missing prerequisite.
- For blocker-remediation tasks, the response must report the re-run command,
  the before/after status fields or blocker list, and any remaining blocker.
  Do not stop at the code diff when the task definition is about changing a live
  status, readiness verdict, or dashboard state.
- In **Fix mode**, detailed diagnosis is required and allowed: producer proof,
  rejected hypotheses, targeted test results, state-path explanation, and any
  evidence-backed remaining blockers. Do not reject a Fix mode report merely
  because it contains more than the eventual Judge mode terminal verdict.
- A blocker is not removed if any other official diagnostic or status surface
  still reports the original blocker for the same underlying condition. In that
  case, report the blocker as unresolved and name the disagreeing surfaces
  explicitly.
- Do not mix governing evidence from different rerun bundles, different refresh
  cycles, or different timestamps into one blocker verdict. The quoted
  `status-dashboard`, `check-full-automation-readiness`, and related governing
  outputs must come from the same rerun bundle for that report.
- If the refreshed planner or job builder shows viable candidate methods
  (`blocker:null`, different `selectedMethod`, or lower-cost legal routes) while
  the governing blocker surface still points at an older blocked method, do not
  close the slice as `NO_LEGITIMATE_FIX` or infrastructure-only yet. Treat that
  mismatch as evidence of a synchronization, refresh, persistence, or method
  selection bug until the planner output and governing surface agree.
- While that planner-vs-governing mismatch remains unresolved, the correct
  verdict for the slice is `UNRESOLVED`, not `NO_LEGITIMATE_FIX`.
- Do not accept `NO_LEGITIMATE_FIX` until the report proves, with exact-copy raw
  evidence, that the governing surface and the refreshed planner now agree on
  the same selected method or candidate set, and includes the numeric EV inputs
  for the still-blocked path (`expectedNetUsd`, `requiredNetUsd`, `p90CostUsd`,
  effective floor or equivalent). A conclusion without those raw values and
  method-agreement proof is incomplete.
- When a fix auto-clears or mutates runtime state, the response must include the
  state-change proof itself (for example file absence/presence, audit record, or
  returned status payload) in addition to downstream status output. Downstream
  summaries alone are not enough evidence for state mutation.
- Do not present projected improvement ("will clear on next successful reads",
  "should drop after fresh receipts", similar) as before/after proof. Evidence
  must come from the current re-run outputs and current test results.
- For blocker-remediation tasks, do not use future-tense success language
  (`will clear`, `should disappear`, `expected to resolve`, `moves in the right
direction`, similar) as the verdict. If the current governing fields still
  carry the blocker, the report must say `unresolved`.
- For blocker-remediation tasks, the response must name the exact field path or
  output line that defines success (`allChainAutopilot ... blocker`, specific
  `refillBlockers[i].reason`, similar) and show that exact field changed. A
  different green summary elsewhere is not substitute evidence.
- If the original target blocker disappears from its governing fields and a
  different blocker becomes active in the same surfaces, close the old blocker
  slice as resolved once the disappearance is proven by exact-copy raw lines,
  then open a new slice for the replacement blocker. Do not keep the old slice
  open by describing the new blocker under the old name.
- When a blocker slice names a specific governing line (for example
  `allChainAutopilot=... blocker:...`), do not substitute a nearby top-level
  summary line such as `blockers=...` as proof of disappearance. The exact named
  governing line must be quoted.
- Governing lines and field values quoted in the report must be exact-copy
  strings from the current raw output. Do not paraphrase, normalize, trim into a
  different value, or reuse a line from an earlier run.
- In **Judge mode**, when a constrained blocker verdict asks for exact raw
  offending lines only,
  quote only the requested governing lines. Do not pad the output with adjacent
  non-governing lines such as summary counters, `blockers=none`, status labels,
  or explanatory context unless the prompt explicitly asks for them.
- When the task or delegated prompt explicitly enters **Judge mode** or
  specifies a constrained terminal format for blocker results, follow that
  format exactly. Do not append extra checklist items, producer commentary,
  future-state explanations, or test summaries after an `UNRESOLVED` or
  `BLOCKED_BY_DIAGNOSTIC_FAILURE` verdict if the prompt says the output must
  contain only the verdict plus exact-copy raw lines.
- If the task or delegated prompt explicitly forbids a technique class (for
  example per-key cost caps, broad EV relaxation, bypass widening, or one-off
  suppressions), do not preserve that technique in the claimed fix, do not cite
  it as part of the success rationale, and do not defend it as acceptable
  progress. Remove it or report unresolved without relying on that forbidden
  technique.
- For blocker-remediation tasks, the response must also include producer proof:
  name the function or code path that emits the blocker, state the exact
  condition that made it fire in this run, and show what changed in that
  producer path or its inputs. Surface-only before/after output is insufficient
  when the producer evidence is missing.
- Treat freshness fields (`generatedAt`, `observedAt`, `ageMinutes`, similar
  status timestamps) as semantic state, not cosmetic metadata. Do not refresh
  or rewrite them unless the underlying artifact has been recomputed from its
  real source-of-truth builder. If an artifact looks stale, fix the generation
  path instead of stamping a new timestamp onto old content.
- The old short termination format (`현재 단계: Ln`, `이번에 한 일`, `왜 아직
그 단계인지`, `다음 체크리스트`) is deprecated and should not be emitted by
  skills or subagents. Visible checkbox progress lists are now the primary way
  to communicate implementation status.

## Workspace Hygiene

- Source of truth: `src/**`, `test/**`, `scripts/**`, `docs/**`, `dashboard/**`
  source files, config, and agent definitions.
- Generated/operational artifacts: `dashboard/public/*.json`, `data/**`,
  `logs/**`, caches, coverage, temp outputs, and local scratch files.
- Do not stage generated artifacts unless the task explicitly says to publish a
  refreshed artifact.
- Do not delete audit histories as "cleanup".
- Use `docs/harness-engineering.md` for the Final Review Loop, Verification
  Matrix, Source Vs Generated rules, cleanup rules, and dashboard checklist.
