# AI Agent Operations

For cross-tool work, `AGENTS.md` is the top-level operating law. Shared docs
such as `docs/skill-usage-guidelines.md` and this file are supporting source
surfaces. `.grok/**` and `.claude/**` are tool-specific prompt surfaces and
should not be mixed across tools unless the task explicitly targets that
compatibility layer.

Verified on 2026-04-24 against Ollama and Claude Code docs.

## Recommended Launch

Use Kimi K2.6 through Ollama for long-context Claude Code work:

```bash
npm run ai:claude:kimi
```

Equivalent direct command:

```bash
ollama launch claude --model kimi-k2.6:cloud
```

Headless mode for one-shot prompts:

```bash
npm run ai:claude:kimi:headless -- -p "summarize this repo"
```

Ollama documents `ollama launch claude --model ...` for Claude Code and notes Claude Code needs a large context window, with at least 64K recommended. The Ollama model page lists `kimi-k2.6:cloud` as a 256K-context, tool-capable cloud model updated on 2026-04-21.

## Subagent Model Policy

- Project subagents keep `model: inherit`. This lets the main session model control the stack, so `ollama launch claude --model kimi-k2.6:cloud` automatically gives the same model to subagents.
- Use `CLAUDE_CODE_SUBAGENT_MODEL=kimi-k2.6:cloud` only when you must force every subagent to that model regardless of the main session.
- Keep role agents narrow. They should read/write only their declared ownership area and use graphify before broad source reads.
- Use `bob-claw-coordinator` as the session agent when you want Claude Code to delegate to the role agents and verifier:

```bash
npm run ai:claude:kimi:coordinator
```

## Role Agents

Use this document for ownership/routing boundaries first. Then use the active
tool's own prompt surface (`.grok/**` for Grok sessions, `.claude/**` for
Claude sessions). Do not let `.claude/**` compatibility files steer Grok or
other tool sessions.

- `bob-claw-coordinator` - planning and delegation only; routes work to specialized agents and may claim progress/completion only after verifying each child returned proof (diff/file list, command output, or artifact path). Proofless child output is treated as `child output lacks proof`, remains `[ ]` or blocked, and must be re-run or replaced.
- `strategy-agent` - strategy modules, receipt-backed evidence, strategy reports.
- `policy-agent` - deterministic policy and risk gates.
- `payback-agent` - BTC-denominated payback scheduler, accumulator, KPI slice.
- `treasury-agent` - capital movement planning, refills, Gateway consolidation intents.
- `infra-agent` - CLI wiring, graphify, dashboard slices, package scripts, test harness.
- `verifier-agent` - read-only diff inspection, targeted checks, graphify status, residual-risk report, and unsupported-progress-claim detection when completion text lacks matching proof.
- New specialized ownership (via defi-portfolio-accounting skill + infra/coordinator): Aggressive Velocity Sleeve DeFi accounting (plan Section 8). Thin SKILL.md + pure `src/ledger/aggressive-sleeve-accounting.mjs` (TDD first). Read-only on core surfaces; write limited to `data/aggressive-yield/`. 4 subagents (Scanner, Strategist, Risk&Exit, Cost Optimizer) call the pure library directly. No Gateway, no core payback mutation, no signer, no conservative core. Declared in skill frontmatter + skill-usage matrix row 13.

## Memory Policy

- Role agents use Claude Code `memory: project` so they can preserve repo-specific locations and recurring patterns under `.claude/agent-memory/<agent>/`.
- Source-code edits must stay inside each agent's declared ownership scope. Memory writes are only for compact notes in that agent's memory directory.
- `verifier-agent` has no project memory and no write tools, so verification remains read-only.

## Efficient Default Flow

1. Start with `AGENTS.md` and this document.
2. For code topology questions, run `npm run graph:focus -- query "<question>"` before reading many files.
3. Classify the task first: direct main-session work, single-role delegation, or parallel multi-role orchestration.
4. Treat superpowers, skills, and process frameworks as amplifiers, not default ceremony. Invoke them when they clearly improve reasoning, execution discipline, or coverage; skip them for simple factual questions and direct, obvious edits where they only add overhead.
5. Delegate by ownership: one write agent per independent area. Do not overlap file ownership across child agents unless the extra agent is read-only verification.
6. Every child prompt must state objective, owned files/ownership area, out-of-scope boundaries, required proof (`command output`, `diff/file list`, or `artifact path`), and the exact handoff condition back to the coordinator.
7. Default child execution target is the main repository worktree. If a child works in any separate worktree, require a raw patch or commit SHA that is directly applicable to the main worktree, plus proof from that target worktree (`pwd`, current branch, `git diff`, and changed file content) before accepting completion.
8. Ask `verifier-agent` to inspect the diff before committing meaningful changes and to flag any completion claim that lacks matching proof. When a child response lacks proof, keep that parent item `[ ]` or blocked and re-delegate with an explicit proof request before claiming completion.
9. Run targeted checks before broad `npm test`.
10. Keep generated operational artifacts out of code commits unless the task explicitly asks for refreshed outputs.
11. For blocker-remediation work, do not accept a child response that stops at the code diff. Require the full loop: direct blocker identified, fix applied, relevant command or refresh path re-run, and the governing status fields or blocker list checked again.
12. For blocker-driven tasks, keep secondary cleanup (UI polish, docs cleanup, wider refactors) behind the direct blocker path unless that extra work is required to complete the re-run or expose the updated state.
13. Treat freshness fields in generated artifacts (`generatedAt`, `observedAt`, `ageMinutes`, similar timestamps) as semantic state. Do not accept timestamp-only refreshes; require the real builder or recomputation path to run so the content and its freshness move together.
14. Do not accept a blocker as "fixed" when one downstream surface merely hides, renames, or reprioritizes the blocker while other official entry points still report the same underlying condition. Fix the source-of-truth state or producer path instead.
15. If blocker semantics intentionally change, require the same change to be reflected across all official dashboard/readiness/runtime surfaces and the affected tests in the same work unit. Mixed blocker codes across official surfaces mean the blocker is still unresolved.
16. If a diagnostic or read path mutates source-of-truth state, require explicit proof that the persisted state, audit trail, and returned status all changed together. Do not accept recovery claims that delete or rewrite runtime state while leaving one of those three surfaces inconsistent.
17. Do not accept broad catch-and-continue handling around state-mutation steps that are part of the claimed fix. If file deletion, audit append, or returned-state transition can fail, the child must prove success for each step or report the blocker as unresolved.
18. Do not accept "the blocker will clear on the next refresh/receipt/runtime recovery" as completion. Until the blocker is gone in the current official outputs, it is still unresolved.
19. Do not accept ad hoc policy relaxation (lowered EV floors, broadened bypass detection, reduced fallback costs, similar) as a blocker fix unless the new policy semantics are intentional, justified, and covered by targeted tests for both the newly allowed case and the still-blocked case. A failing blocker-path test is regression evidence.
20. When an official output has both a top-level summary and a more specific nested blocker field, require the child to clear the more specific blocker field. Do not accept a green/ready top-level summary as proof while a deeper official field still reports the target blocker.
21. Require blocker-remediation reports to cite the exact field path or output line that defines success and show that exact field changed. A different summary field turning green is not substitute evidence.
22. When the task defines exact governing blocker fields (for example `allChainAutopilot ... blocker:...` or `liveAutomation.refillBlockers[*].reason`), accept `resolved` only if those exact fields no longer contain the target blocker in the current official outputs. If any governing field still carries it, the child must report `unresolved`.
23. Treat narrow cost caps, per-key EV overrides, broadened bypass detection, and similar one-off suppressions as policy relaxation too. Do not accept them as blocker fixes unless the changed semantics are intentional, justified, preserved by targeted tests, and proven in the current official outputs.
24. Reject future-tense blocker verdicts such as "will clear", "should disappear after refresh", or "directionally fixed". Current raw outputs decide the verdict; if the governing fields still carry the blocker, the report remains `unresolved`.
25. Require producer proof in blocker-remediation reports: name the function or code path that emits the blocker, show the exact condition that fired in the current run, and show what changed in that producer path or its inputs. Surface-only status diffs are not enough when producer evidence is missing.
26. If a governing diagnostic run returns `error`, `Command timed out`, or similar execution failure text, do not accept that run as final blocker evidence on its own. Re-run the same governing command until it returns usable output, or report the verdict as blocked by diagnostic failure.
27. Do not mix governing evidence from different rerun bundles, refresh cycles, or timestamps into one verdict. The quoted `status-dashboard`, `check-full-automation-readiness`, and related governing outputs must come from the same rerun bundle.
28. If refreshed planner output or rebuilt jobs show viable candidate methods (`blocker:null`, different `selectedMethod`, or lower-cost legal routes) while the governing blocker surface still points at an older blocked method, treat that mismatch as a synchronization/refresh/persistence/method-selection bug to investigate. Do not close it as `NO_LEGITIMATE_FIX` or infrastructure-only yet.
29. While that planner-vs-governing mismatch remains unresolved, require the child to report `UNRESOLVED`, not `NO_LEGITIMATE_FIX`.
30. Do not accept `NO_LEGITIMATE_FIX` unless the child proves, with exact-copy raw evidence, that the governing surface and refreshed planner now agree on the same selected method or candidate set, and includes numeric EV inputs for the still-blocked path (`expectedNetUsd`, `requiredNetUsd`, `p90CostUsd`, effective floor or equivalent).
31. If the original target blocker disappears from its governing fields and a different blocker becomes active in the same surfaces, require the child to close the old blocker slice as resolved with exact-copy raw proof of disappearance, then open a new slice under the replacement blocker name. Do not let the child keep the old slice open by describing the new blocker under the old name.
32. When a blocker slice names a specific governing line (for example `allChainAutopilot=... blocker:...`), require that exact line. Do not accept a nearby top-level summary such as `blockers=...` as substitute proof.
33. Require governing lines and field values quoted in the report to be exact-copy strings from the current raw output. Reject paraphrases, normalized summaries, trimmed values, or lines reused from an earlier run.
34. When the task or delegated prompt specifies a constrained terminal format for blocker verdicts, enforce it literally. If the prompt says `UNRESOLVED` or `BLOCKED_BY_DIAGNOSTIC_FAILURE` must contain only the verdict plus exact-copy raw lines, reject any extra checklist, producer commentary, or future-state explanation.
35. When a constrained blocker verdict asks for exact raw offending lines only, accept only the requested governing lines. Reject adjacent non-governing lines such as `blockers=none`, status counters, or explanatory context unless the prompt explicitly requested them.
36. If the task or delegated prompt explicitly forbids a technique class (for example per-key cost caps, broad EV relaxation, bypass widening, or one-off suppressions), do not accept a fix or report that preserves that technique, cites it as progress, or relies on it in the rationale.
37. Separate blocker work into **Fix mode** and **Judge mode**. Fix mode is the default for investigation, producer tracing, implementation, and validation. Judge mode is only the final verdict pass.
38. In Fix mode, accept detailed diagnosis and evidence-backed explanation: producer proof, rejected hypotheses, targeted test results, remaining blockers, and state-path analysis. Do not reject a Fix mode report merely because it is longer than a Judge mode terminal verdict.
39. Apply constrained terminal verdict formats (`UNRESOLVED` + exact lines only, `BLOCKED_BY_DIAGNOSTIC_FAILURE` + exact lines only, similar) only in Judge mode or when the prompt explicitly asks for final-verdict-only output.

## Coordinator Summon Discipline

- `bob-claw-coordinator` should summon the **minimum** number of child agents needed to keep slices independent and fast to reintegrate.
- Default pattern: `1 coordinator + 1-6 workers + verifier-agent`.
- Escalate beyond that only for genuinely independent investigations, broad read-only audits, or end-stage verification fans. Do not use wide fan-out for overlapping write work.
- The coordinator may issue discretionary summons mid-task when a new blocker, uncertainty pocket, or proof gap appears and an ownership-aligned child can resolve it faster than direct continuation.
- Good summon triggers: separate ownership areas, clearly separable bug hunts, independent report gathering, or read-only comparison tasks.
- Bad summon triggers: same-file edits, tightly coupled logic that needs one coherent patch, or work that is mostly sequencing rather than parallelism.
- If a child returns proofless, cross-scope, or low-signal output, the coordinator must either tighten the prompt and re-summon, route the slice to a different role, or absorb the work back into the main session.

## Dev-Agent Lifecycle

The dev-agent lifecycle is report-only. It may describe coding and research task progress with these stages:

- `proposed`
- `scoped`
- `submitted`
- `validated`
- `accepted`
- `rejected`

The lifecycle never grants live execution authority. A task with `runtimeAuthority: "none"` may propose source, tests, reports, or committed config diffs. It may not call the signer, sign transactions, bypass policy, raise caps at runtime, decide payback timing or ratio, mutate `autoExecute` through a side channel, or publish raw wallet/route/inventory artifacts.

## Sources

- Ollama Claude Code integration: https://docs.ollama.com/integrations/claude-code
- Ollama Kimi K2.6 model page: https://ollama.com/library/kimi-k2.6
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
