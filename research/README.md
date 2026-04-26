# Research sidecar

Dual-track research lives here and stays outside live-fund execution.

- **Track A** uses an external agent runner through `RESEARCH_AGENT_CMD` and optional `RESEARCH_AGENT_ARGS`.
- **Track B** runs deterministic factor search with no model dependency.
- **Promotion** is evidence-only. Passing candidates write promotion intents that request a committed canary diff; they never deploy, sign, or raise runtime caps.

## Commands

- `npm run research`
- `npm run research:track-b`
- `npm run research:score`
- `npm run research:daily`
- `npm run research:launchd:write`
- `npm run research:launchd:install`
- `npm run research:launchd:status`

## Layout

- `candidates/_example.mjs` tracked template
- `fixtures/recorded-rpc.json` tracked read-only fixture coverage for the 11 Gateway destination chains
- `results.tsv` ignored score ledger
- `data/` ignored run artifacts

## Read-only RPC

Research defaults to tracked fixtures. Optional archive endpoints may be supplied through `RESEARCH_ARCHIVE_RPC_<CHAIN>`, but the client remains read-only and rejects broadcast-style methods.
