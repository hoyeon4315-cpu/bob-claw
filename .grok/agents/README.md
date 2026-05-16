# .grok/agents/

Grok Build native agents (slim post-2026-05 cleanup).

Only the minimal set remains:
- coordinator (lightweight router + diagnostics first for capital questions)
- verifier-agent (read-only post-edit hygiene + graph + readiness dispatch)

Heavy machinery removed:
- 16-team-manager + entire .grok/teams/live-16/ (B-Model 16-person simulation)
- reviewer-agent (Benjamin + Lucas forced adversarial review)

Legacy .claude/agents/ completely purged.

All remaining agents follow `docs/AGENT-SUPREME-LAW.md` (Gateway literal protection + 5-Step on delegation, Evidence-Complete).

Run `npm run check:skills-config` or `ls .grok/agents .grok/skills` to inspect current state.
