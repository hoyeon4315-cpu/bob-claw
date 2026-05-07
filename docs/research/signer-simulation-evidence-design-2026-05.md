# Signer Simulation Evidence Design

Status: design accepted before source changes
Date: 2026-05-07

## Goal

Attach signer-adjacent `eth_call` simulation evidence to signed or rejected EVM intent audit records without moving RPC calls into `evaluateIntentPolicies()`.

## Non-Goals

- No RPC calls inside `src/executor/policy/index.mjs`.
- No policy approval based solely on a successful simulation.
- No cap raise, `autoExecute` flip, payback decision, or signer bypass.
- No raw private key, signed transaction bytes, or secret-bearing calldata in public reports.
- No live transaction broadcast, no gas-spending test, and no retry loop that can burn failed-gas budget.

## Proposed Shape

```json
{
  "simulation": {
    "status": "ok",
    "source": "signer_prebroadcast_eth_call",
    "chain": "base",
    "blockTag": "latest",
    "returnDataLength": 2,
    "class": null,
    "error": null,
    "observedAt": "2026-05-07T00:00:00.000Z"
  }
}
```

## Placement

The signer daemon may call `simulateTransactionCall()` after deterministic policy allows an intent and before broadcast. The result is attached to the audit row. A simulation failure records `simulation.status = "error"` and `simulation.class = classifySimulationError(error)`. Broadcast behavior remains governed by policy, signer, kill-switch, caps, and failed-gas guards.

`evaluateIntentPolicies()` must remain pure. It may consume an already-provided simulation result in a future deterministic rule only after that result is part of the typed intent or signer audit context, but it must not perform RPC.

## Confidence Loop

| Loophole | Fix |
| --- | --- |
| Simulation success becomes approval | Policy approval remains separate; simulation is evidence metadata only. |
| Simulation failure causes repeated gas burn | No live broadcast retries are introduced by this design. |
| RPC enters pure policy | `src/executor/policy/index.mjs` stays free of `eth_call` and provider imports. |
| Sensitive calldata leaks | Public reports store status, class, and length, not raw signed tx bytes or secrets. |
| BNB/BSC bias enters simulation | Chain comes from the already-approved intent; no default to BSC or BNBAgent SDK. |

## Verification For A Future Source Diff

```bash
node --test test/transaction-read.test.mjs test/evm-local-signer.test.mjs test/executor-signer-daemon.test.mjs test/executor-policy-index.test.mjs
rg -n "eth_call|JsonRpcProvider|simulateTransactionCall" src/executor/policy
```

Expected:

```text
fail 0
No RPC/provider imports in src/executor/policy.
```
