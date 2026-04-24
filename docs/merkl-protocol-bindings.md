# Merkl Protocol Binding Registry

This documents the centralized dispatch system for Merkl portfolio protocol bindings. `AGENTS.md` keeps only the operator-memory summary; this file carries the implementation runbook.

## Registry

Registry file: `src/executor/protocol-binding-registry.mjs`

| bindingKind | family | intentType | entry plan builder | plan executor | exit executor |
|---|---|---|---|---|---|
| `erc4626_vault_supply_withdraw` | `erc4626` | `erc4626_deposit` | `buildErc4626ProtocolCanaryPlan` | `executeErc4626ProtocolCanaryPlan` | `executeErc4626PortfolioExit` |
| `euler_evault_deposit_withdraw` | `erc4626` | `erc4626_deposit` | `buildErc4626ProtocolCanaryPlan` | `executeErc4626ProtocolCanaryPlan` | `executeErc4626PortfolioExit` |
| `aave_v3_pool_supply_withdraw` | `aave` | `aave_supply` | `buildAaveProtocolCanaryPlan` | `executeAaveProtocolCanaryPlan` | `executeAavePortfolioExit` |

## Add An ERC4626-Compatible Protocol

```js
import { registerErc4626LikeBinding } from "./protocol-binding-registry.mjs";

registerErc4626LikeBinding("morpho_vault_supply_withdraw");
```

That wires `erc4626-protocol-canary.mjs` for entry, `executeErc4626PortfolioExit` for exit, and `erc4626_deposit` as the intent type. No allocator, exit, or autopilot edits are required.

## Add A Custom-Interface Protocol

1. Create `src/executor/helpers/<protocol>-protocol-canary.mjs` with `buildXxxProtocolCanaryPlan` and `executeXxxProtocolCanaryPlan`.
2. Create the exit executor in `src/executor/helpers/merkl-portfolio-exit-executors.mjs` or a protocol-specific helper.
3. Register it with `registerBinding({ bindingKind, planBuilder, planExecutor, exitExecutor, intentType, family })`.

## Orchestrator

- Core: `src/executor/merkl-portfolio-orchestrator.mjs`
- CLI: `src/cli/run-merkl-portfolio-orchestrator.mjs`
- Single tick: `npm run executor:merkl-portfolio-orchestrator`
- Loop: `npm run executor:merkl-portfolio-orchestrator:loop`

The orchestrator sequences stale-position exit, treasury inventory refresh, and allocation into the highest-scoring eligible opportunity.
