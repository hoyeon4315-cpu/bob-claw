# AI Agent Operations

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

- `bob-claw-coordinator` - planning and delegation only; routes work to specialized agents.
- `strategy-agent` - strategy modules, receipt-backed evidence, strategy reports.
- `policy-agent` - deterministic policy and risk gates.
- `payback-agent` - BTC-denominated payback scheduler, accumulator, KPI slice.
- `treasury-agent` - capital movement planning, refills, Gateway consolidation intents.
- `infra-agent` - CLI wiring, graphify, dashboard slices, package scripts, test harness.
- `verifier-agent` - read-only diff inspection, targeted checks, graphify status, and residual-risk report.

## Memory Policy

- Role agents use Claude Code `memory: project` so they can preserve repo-specific locations and recurring patterns under `.claude/agent-memory/<agent>/`.
- Source-code edits must stay inside each agent's declared ownership scope. Memory writes are only for compact notes in that agent's memory directory.
- `verifier-agent` has no project memory and no write tools, so verification remains read-only.

## Efficient Default Flow

1. Start with `AGENTS.md` and this document.
2. For code topology questions, run `npm run graph:focus -- query "<question>"` before reading many files.
3. Delegate by ownership: one agent per write area.
4. Ask `verifier-agent` to inspect the diff before committing meaningful changes.
5. Run targeted checks before broad `npm test`.
6. Keep generated operational artifacts out of code commits unless the task explicitly asks for refreshed outputs.

## Dev-Agent Lifecycle

The dev-agent lifecycle is report-only. It may describe coding and research task progress with these stages:

- `proposed`
- `scoped`
- `submitted`
- `validated`
- `accepted`
- `rejected`

The lifecycle never grants live execution authority. A task with `runtimeAuthority: "none"` may propose source, tests, reports, or committed config diffs. It may not call the signer, sign transactions, bypass policy, raise caps at runtime, decide payback timing or ratio, mutate `autoExecute` through a side channel, or publish raw wallet/route/inventory artifacts.

## 16-Person Live Team (B Model) — First-Class Parallel Operating Mode

Alongside the main `bob-claw-coordinator`, verifier-agent, and single-ownership role agents (strategy-agent, policy-agent, payback-agent, treasury-agent, infra-agent), BOB Claw now supports the **16-Person Live Team (B Model)** as a first-class high-velocity collaborative mode.

**When to activate**:
- Multi-domain tasks (2+ ownership areas) such as YCE (Yield & Campaign Opportunity) feature development, receipt validation, dashboard surfaces, capital + risk + payback co-evolution, E2E verification campaigns, or large refactors.
- User requests: "16-team으로 시작해", "16인 라이브 팀으로 ... 해줘", "/16-team <task>", or "16-Person Live Team (B Model)으로 parallel work 해줘".

**Structure**:
- 1 Engineering Manager & Coordinator (orchestrates via `.grok/teams/live-16/16-team-manager.md` integration point)
- 6 Domain Leads (active hubs): Capital & Treasury, Risk/Safety & Resilience, Execution & Policy, Payback & Gateway Settlement, Opportunity & Research, Evidence/Data & Quality
- 9 Specialists (T-shaped): Refill & Capital Automation, Allocation & Rebalancing, Resilience & Self-Healing, Policy & Intent Evaluation, Signer & Audit Integrity, Settlement & Proof, Yield & Campaign Opportunity (YCE), Protocol Reader & On-chain Data, Receipt & Reconciliation

**All 15 role definitions** (including the 6 Domain Lead files completed by the Role Scaffolder) live in the canonical `.grok/teams/live-16/roles/*.md`. See `docs/team/live-16/roles/` for the docs-visible mirror.

**Key operating principles** (detailed in `docs/16-team-operations.md`):
- Direct Address by exact full role title ("Evidence, Data & Quality Domain Lead + Receipt & Reconciliation Engineer, ...")
- Domain Leads proactively pull specialists and decide assignments (flexibility rule)
- `fork_context: true` + `background: true` + parallel spawning as default
- Standardized patterns: Direct Call, Joint Session (2–4 agents), Explicit Handoff, Live Sync Call, Proactive Pull-In
- Reusable templates in `.grok/teams/live-16/templates/` (joint-session.md, handoff.md, call-another-agent.md) and docs mirror base-*.md
- **Relaxed Gateway Policy (team-internal only)**: literal "Gateway" refusal suspended inside the team for dev velocity on related surfaces (still execute 5-Step, quote raw diagnostics from AGENTS.md entry points, never weaken caps/invariants). Full strict Supreme Law (`docs/AGENT-SUPREME-LAW.md`) applies outside the team and for production changes.
- Artifact transparency mandatory: all work in `.grok/teams/live-16/active-work/<slug>.md`, `decisions/`, `harness/` (canonical) and mirrored under `docs/team/live-16/`

**Activation & Monitoring**:
- Main coordinator detects multi-ownership via Master Decision Matrix (`docs/skill-usage-guidelines.md`) and spawns the 16-team manager or directly relevant Leads/Specialists.
- Monitor parallel streams with repeated `get_command_or_subagent_output <task_id>`
- All output returns to parent for integration + verifier-agent + harness Verification Matrix before commit.

**User guides**:
- `docs/16-team-operations.md` — complete activation, policy, team map, artifact locations, integration flow
- `docs/16-team-quickstart.md` — copy-paste examples for YCE feature, multi-domain refactor, verification campaign, Direct Call, Joint Session, handoff, escalation
- `.grok/teams/live-16/README.md` + `protocol.md` — the operational law loaded by every 16-team agent
- `docs/team/live-16/16-team-manager.md` — Engineering Manager role + Phase 3 main-coordinator delegation recipe

**Core invariants never relaxed**: BTC payback first, no LLM in execution path, private keys out of context, operator = user, evidence-complete confidence, 5-Step on every activation (Gateway check as step 2, treated per protocol inside team), diagnostic entry points with raw `--json` quotes.

This mode delivers the velocity demonstrated on DefiLlama yield lane revival, role definition completion, receipt E2E validation, dashboard wiring, and harness bootstrap streams.

## Sources

- Ollama Claude Code integration: https://docs.ollama.com/integrations/claude-code
- Ollama Kimi K2.6 model page: https://ollama.com/library/kimi-k2.6
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
