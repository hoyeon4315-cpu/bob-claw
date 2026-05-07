---
status: canonical
updated_at: 2026-05-08
source_of_truth: AGENTS.md
graph_inputs:
  - src/graphify-out/GRAPH_REPORT.md
  - graphify-out/GRAPH_REPORT.md
report_inputs:
  - npm run report:strategy-catalog -- --json
  - npm run graph:focus -- status
---

# BOB Claw System Map

This is the canonical engineering map for BOB Claw. It exists to keep coding
agents, dashboard work, and future feature work aligned with the actual system
instead of old snapshots or generated status files.

## Operating Law

- `AGENTS.md` is the operating law. If any doc, report, dashboard copy, or
  memory file disagrees with `AGENTS.md`, `AGENTS.md` wins.
- Product model: native BTC enters from the operator wallet, is deployed into
  destination-chain strategies, and realized positive PnL funds deterministic
  native-BTC payback.
- Accounting is BTC/sats first. USD is display and policy projection only.
- Runtime execution is deterministic. Coding-session LLMs may edit code,
  configs, docs, and run operator-requested commands, but policy code decides
  approval and signer daemons hold keys.
- Caps are committed config under `src/config/`, not env vars or dashboard
  runtime state.
- Gateway destinations are exactly the 11 chains in
  `src/config/gateway-destinations.mjs`: Ethereum, BOB, Base, BSC, Avalanche,
  Unichain, Berachain, Optimism, Soneium, Sei, and Sonic. Bitcoin is the
  native on/offramp side. Arbitrum and Polygon are fallback/manual bridge
  surfaces only, not Gateway destinations.

## Runtime Architecture

```mermaid
flowchart TD
  A["Strategy/report modules"] --> B["Execution intents"]
  B --> C["Policy engine"]
  C -->|ALLOW| D["Signer daemon"]
  C -->|BLOCK| E["Signer audit log"]
  D --> F["Broadcast"]
  F --> G["Receipt ingestor"]
  G --> H["Audit/data artifacts"]
  H --> I["Dashboard/report builders"]
  H --> J["Payback accumulator"]
  J --> K["Payback scheduler"]
  K --> C
  L["Kill-switch / auto-kill / watchdog"] --> C
  L --> K
```

| Layer | Primary Files | Responsibility | Must Not Do |
| --- | --- | --- | --- |
| Operating law | `AGENTS.md` | Product rules, safety invariants, current overrides | Store volatile status |
| Config | `src/config/*.mjs` | Caps, chains, policy thresholds, protocol bindings | Read keys or audit logs |
| Strategy evidence | `src/strategy/**/*.mjs` | Build candidates, reports, adapters, evidence surfaces | Sign or decide runtime approval |
| Capital manager | `src/executor/capital/*.mjs` | Build target balances, refill/drain plans | Raise caps at runtime |
| Policy | `src/executor/policy/*.mjs`, `src/risk/*.mjs` | Pure approval and halt gates | Hold keys |
| Signer | `src/executor/signer/*.mjs` | Local socket, key-backed signing, audit append | Bypass policy |
| Receipt ingestion | `src/executor/ingestor/*.mjs`, `src/ledger/*.mjs` | Receipt normalization and reconciliation | Rewrite audit history |
| Payback | `src/executor/payback/*.mjs` | Sats-first accumulator, scheduler, payback dashboard slice | Choose ratio/timing by LLM |
| Dashboard | `src/status/*.mjs`, `src/dashboard/*.mjs`, `dashboard/public/*.jsx` | Read-only public slices and visual UI | Execute trades or hold secrets |

## Functional Owners

| System | Function |
| --- | --- |
| Operating law and maps | `AGENTS.md` defines product, risk, LLM, payback, and runtime authority rules. This file and `docs/harness-engineering.md` explain implementation shape only. |
| Config and caps | `src/config/` stores official chains, per-strategy caps, payback policy, auto-kill thresholds, tiny-canary sizing, and concentration limits. Runtime cap raises through env, dashboard, or chat are forbidden. |
| Proposer | Strategy modules, Merkl/radar queues, payback scheduler, and capital manager emit typed intents or allocation plans. They do not hold keys or decide signing. |
| Policy engine | `src/executor/policy/index.mjs` composes the live signer checks. It is the source of deterministic execution truth before signer broadcast. |
| Signer | `src/executor/signer/` owns local key custody, policy-approved signing, nonce handling, and append-only signer audit rows. |
| Capital manager | `src/executor/capital/`, refill helpers, and score-weighted target builders allocate committed-cap inventory, refill/drain chains, and preserve concentration caps. `destination-promotion-gate.json` is a score source only. |
| Gas, inventory, and receipts | Gas keepers, treasury inventory, inbound attribution, transaction ledger, receipt reconciliation, and protocol position marks explain what happened and what is held. They do not authorize execution. |
| Payback | `src/executor/payback/` computes sats-first realized PnL, plans deterministic BTC payback, and requires Gateway/Bitcoin settlement proof. |
| Dashboard and reporting | `src/status/`, report CLIs, and `dashboard/public/` render read-only, public-safe state. They may expose policy eligibility but cannot sign, change caps, or act as gates. |
| Dev automation | `src/llm/`, `src/cli/codex-*`, auto-research, and route-remediation surfaces scaffold and validate code under budget/masking/audit limits. `evaluateAutoPromotion` is a coding-session commit guard, not a runtime gate. |
| Protocol and position health | `src/protocol-readers/`, `src/treasury/protocol-position-*`, and `src/executor/health/` report positions and produce protective descriptors; Capital Manager remains the owner of rebalance intents. |

## Strategy Lanes

| Lane | Representative Modules | Current Purpose | Admission Evidence |
| --- | --- | --- | --- |
| Gateway wrapped-BTC loops | `strategy-catalog`, `btc-proxy-spreads`, Gateway helpers | Transport and wrapped-BTC route measurement | Quote, fee, latency, execution, receipt |
| Destination BTC yield/lending | `destination-*`, `wrapped-btc-*`, `recursive-*`, Moonwell helpers | Evidence-primary and official-destination yield surfaces | Unwind path, HF/liquidation policy, receipt-backed cost |
| Campaign/Merkl/radar canaries | `merkl-*`, `strategy/radar/*`, `config/sizing.mjs` | Tiny live canary discovery and queueing | EV helper, reward haircut, exit liquidity proof, tiny cap |
| Stable loops and reserve sleeves | `stable-*`, `tokenized-reserve-*`, treasury rotation | Stable entry/exit and deterministic yield sleeves | Realized net after gas, claim/swap, bridge/exit cost |
| ETH-family deployment | `ethereum-route-*`, mixed triangle/flash modules | Allowed when measured positive EV clears fees | Ethereum gas/slippage and unwind proof |
| Payback lane | `executor/payback/*`, Gateway BTC offramp helpers | Convert realized positive PnL share to native BTC | Three-way settlement proof: source tx, Gateway order, BTC txid |

Important distinction: reporting, shadow, prelive, and plan files can rank or
describe a lane, but they do not authorize signing. Runtime approval still
requires committed caps, policy approval, signer isolation, kill-switch checks,
and receipt/audit behavior.

Stage/readiness/admission fields are advisory metadata. `liveTrading` and
`policyLiveTrading` mean deterministic policy/signer eligibility, not a Stage C
or manual approval milestone.

Route remediation autopilot (`src/strategy/route-remediation-autopilot.mjs`,
`npm run report:route-remediation-autopilot`) is dev-lane only. It consumes
blocked strategy/campaign candidates and emits code work orders after
overfit, official-Gateway-scope, cost-variance, and no-runtime-authority
checks. Its output is a committed-diff planning surface, not a live execution
approval.

## Config And Policy Owners

| Concern | Canonical Owner | Notes |
| --- | --- | --- |
| Official Gateway chains | `src/config/gateway-destinations.mjs` | Import this instead of copying arrays |
| Route remediation planning | `src/strategy/route-remediation-autopilot.mjs` | Work orders only; no signer, cap, daemon, or runtime mutation authority |
| Strategy caps | `src/config/strategy-caps.mjs` API, `src/config/strategy-caps/registry.mjs` data | Public imports stay on `strategy-caps.mjs` |
| Tiny-canary EV sizing | `src/config/sizing.mjs` | Shared by radar preview, Merkl sync, executor policy |
| Destination score source | `data/destination-promotion-gate.json` from `src/strategy/destination-promotion-gate.mjs` | Advisory score source for allocation; `runtimeAuthority: "none"` |
| Small-capital campaign rules | `src/config/small-capital-campaign-mode.mjs` | Evidence-led primary-chain two-lane policy |
| Gateway pause | `src/config/gateway.mjs`, `src/executor/policy/gateway-availability.mjs` | Signer policy is a backstop |
| Auto-kill | `src/config/auto-kill.mjs`, `src/risk/auto-kill-triggers.mjs` | Writes kill-switch and audit record |
| Payback policy | `src/config/payback.mjs` | Ratio, min, caps, schedule, emergency pauses |
| Concentration | `src/config/diversification.mjs`, `src/executor/risk/concentration-guard.mjs` | Keep units explicit when refactoring |

## Data And Audit Surfaces

| Path | Kind | Git Policy | Cleanup Policy |
| --- | --- | --- | --- |
| `logs/signer-audit.jsonl` | Append-only execution audit | Ignored | Never delete, rewrite, or rotate in place |
| `logs/kill-switch-audit.jsonl` | Append-only halt/resume audit | Ignored | Never delete during cleanup |
| `logs/dev-lock-audit.jsonl` | Append-only dev-lock audit | Ignored | Never delete during cleanup |
| `data/*.jsonl` | Observations, receipts, runs, failures | Ignored | Operational history; not trash by default |
| `data/*latest.json`, `data/*.json` | Local report/cache artifacts | Ignored | Regenerable unless used as receipt/evidence source |
| `dashboard/public/*.json` | Public-safe generated slices | Some tracked legacy snapshots | Do not stage with source refactors unless intentionally publishing |
| `src/graphify-out/*`, `graphify-out/*` | Graph navigation artifacts | Ignored | Regenerable, but useful for LLM navigation |

## Dashboard Generation

Source-like dashboard files:

- `dashboard/public/*.jsx`
- `dashboard/public/index.html`
- `dashboard/public/_headers`
- `src/status/*.mjs`
- `src/dashboard/*.mjs`

Generated dashboard files:

- `dashboard/public/*.js`
- `dashboard/public/dashboard-status.json`
- `dashboard/public/live-runtime.json`
- `dashboard/public/auto-kill-events.json`
- `dashboard/public/strategy-tick-status.json`
- `dashboard/public/wallet-holdings.json`
- `dashboard/public/merkl-active.json`

Generation commands:

- `npm run dashboard:build`
- `npm run status:dashboard`
- `npm run report:wallet-holdings-slice -- --json --write`
- `npm run report:strategy-tick-slice -- --json --write`
- `npm run risk:auto-kill-check:json` plus `report-auto-kill-events` through the live dashboard loop

`dashboard/public/live-runtime.json` controls whether the browser prefers a
remote live origin. Treat changes to it as deployment behavior, not cosmetic
status refresh.

## Known Historical Contradictions

- `docs/strategy-system-map-2026-04-15.md` is a historical snapshot. It says
  live trading was blocked and describes an older active canary. Do not use it
  as current policy.
- Dated prelive and plan docs can describe build order, not runtime phase
  gates. AGENTS.md forbids tiered manual promotion gates for live execution.
- Older destination "promotion/gate" wording refers to score readiness only.
  Current destination reports are advisory score sources and cannot approve
  signer execution.
- Older dashboard plans may say the dashboard reads only one JSON file. Current
  live overlay code also reads focused slices for wallet holdings, strategy
  ticks, Merkl activity, live runtime, and auto-kill events.
- Arbitrum/Polygon references in bridge or Merkl code are non-Gateway fallback
  surfaces unless a committed operating-law diff says otherwise.

## Change Checklist For Future Agents

Before changing strategy, policy, payback, dashboard, or generated artifacts:

1. Read `AGENTS.md`, this file, and `docs/harness-engineering.md`.
2. Run `git status --short --branch` and identify generated dirty files.
3. Use `rg` to find existing modules and imports before adding files.
4. Keep public imports stable when splitting large modules.
5. Add targeted tests for any safety/policy behavior change.
6. Run the relevant targeted command, then `npm run check` and `npm test`
   before committing.
7. Stage exact source/docs/test files only; leave generated dashboard JSON
   unstaged unless the task is explicitly a dashboard snapshot publish.
