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

## Sources

- Ollama Claude Code integration: https://docs.ollama.com/integrations/claude-code
- Ollama Kimi K2.6 model page: https://ollama.com/library/kimi-k2.6
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
