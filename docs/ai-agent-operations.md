# AI Agent Operations

Verified against the repository state on 2026-05-16.

## Runtime model

- **Codex main session is the default coding harness** in this repo.
- **Grok is supported as a secondary runtime** through `.grok/`.
- Both runtimes must follow the same operating law:
  `AGENTS.md` → `docs/AGENT-SUPREME-LAW.md` → `docs/system-map.md` →
  `docs/harness-engineering.md` → `docs/skill-usage-guidelines.md`.
- `CLAUDE.md` is legacy/bootstrap material only. It is not part of the active
  agent routing model.

## Grok entrypoint

- Launch Grok from the repository root so it picks up `.grok/config.toml`.
- Verify the project-facing Grok setup with:

```bash
npm run ai:grok:inspect
```

- Grok sessions should start work the same way Codex sessions do: checklist
  first, direct execution by default, graphify before broad reads, diagnostics
  quoted raw, verifier after meaningful edits.

## Active Grok surfaces

- `.grok/agents/coordinator.md`
- `.grok/agents/verifier-agent.md`
- `.grok/skills/bob-claw-readiness-safety-verification/SKILL.md`

These are intentionally thin wrappers. They should not invent a parallel
operating system, role swarm, or alternate law set.

## Removed from the active runtime

- `reviewer-agent`
- `16-team-manager`
- `.grok/teams/live-16/`
- old `.claude/agents/*` and `.claude/skills/*` role-swarm delegation flows

## Superpowers interaction

`docs/superpowers/**` may provide useful plans or historical specs, but those
files are advisory only. They can supply task checklists; they must not add new
runtime rules, force deleted agent systems back into use, or override the
harness verification flow.

## Default Grok workflow

1. Read the authority docs listed above.
2. Start with a markdown checklist for non-trivial work.
3. Use direct execution unless the task clearly maps to the readiness skill or
   verifier-agent.
4. Use `npm run graph:focus -- query|explain|path` before broad code reads.
5. Run the narrow harness checks before broader validation.

## Ownership note

There is no active multi-role Grok hierarchy anymore. The coordinator may route
to the readiness skill or verifier-agent, but complex implementation work stays
in the main session unless a future prompt file is explicitly added and
documented here.
