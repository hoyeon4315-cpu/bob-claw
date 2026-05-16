# .grok/agents/

Grok uses a **minimal, Codex-aligned** agent layer in this repo.

Active agents:

- `coordinator` — thin Grok entry point for checklist-first routing
- `verifier-agent` — read-only post-edit verification

The Grok runtime is **not** a separate operating system. These prompts are thin
wrappers around `AGENTS.md`, `docs/AGENT-SUPREME-LAW.md`,
`docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md`.

Removed from the active Grok runtime:

- `reviewer-agent`
- `16-team-manager`
- `.grok/teams/live-16/`

Use `npm run ai:grok:inspect` to verify the local Grok runtime and
`npm run check:skills-config` to validate the tracked Grok agent surfaces.
