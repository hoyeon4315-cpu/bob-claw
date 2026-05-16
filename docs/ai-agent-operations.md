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

## Current Agents (Grok Build Native Only)

After the 2026-05 cleanup (complete removal of .claude/ legacy agents and the 16-Team B-Model):

- `coordinator` (in `.grok/agents/`) — lightweight main entry point for Grok sessions.
- `verifier-agent` (in `.grok/agents/`) — read-only post-change verification.
- `bob-claw-readiness-safety-verification` skill (in `.grok/skills/`) — runs the mandatory capital diagnostics and raw quotes before any readiness/safety claim.

Use `npm run check:skills-config` to see the current active set.

The old Claude role agents (bob-claw-coordinator, strategy-agent, policy-agent, payback-agent, treasury-agent, infra-agent) and all 15 B-Model roles have been deleted.

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

## Current Grok Native Agents (Post-2026-05 Slim)

After the major cleanup (removal of 16-Team B-Model, reviewer-agent, and all .claude/ legacy duplication), the active Grok Build native agents are:

- **coordinator** — lightweight main router. Prefers direct execution. Dispatches to readiness skill for safety/blocker/readiness questions and verifier-agent for post-edit hygiene.
- **verifier-agent** — read-only diff + graphify + harness + readiness dispatch for evidence-complete verification after non-trivial changes.
- **bob-claw-readiness-safety-verification** skill (in `.grok/skills/`) — the one that actually runs the AGENTS.md Diagnostic Entry Points (`report:capital-audit --json`, `check-full-automation-readiness --json`, `plan-capital-manager-refill-jobs --json`, `report:payback-status --json`, graph:focus, etc.) and quotes raw before any safety or readiness claim.

All three still strictly follow `docs/AGENT-SUPREME-LAW.md` (literal `Gateway` protection on delegation + 5-Step + Evidence-Complete).

The old 16-Person Live Team (B Model), 15 role definitions, `.grok/teams/live-16/`, `docs/16-team-*` docs, and Claude role agents have been removed.

## Sources

- Ollama Claude Code integration: https://docs.ollama.com/integrations/claude-code
- Ollama Kimi K2.6 model page: https://ollama.com/library/kimi-k2.6
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
