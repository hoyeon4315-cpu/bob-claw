# PR 0 — Gas-Safety Foundation + L1→Destination Bridge EV Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 7 highest-severity gas-safety gaps identified in Phase 1 Audit before any later PR can broadcast live.

**Architecture:** Seven independent modules that each defend against a specific gas-burn vector, plus integration wiring into the existing policy engine (`src/executor/policy/index.mjs`) and signer admission path. Every new module exports a `featureEnabled(profile)` predicate defaulting to `false` under `safety_first`.

**Tech Stack:** Node.js ESM, ethers v6 (JsonRpcProvider, staticCall), existing `src/executor/policy/` patterns, `src/executor/signer/` nonce management.

**Hard Constraints (unchanged):**
- Do NOT modify `src/config/payback.mjs` formula constants.
- Do NOT touch signer keystore env paths.
- Do NOT set any strategy `autoExecute: true`.
- Do NOT modify or delete audit logs.
- Every commit passes `npm run check`, `npm test`, `npm run dashboard:build`.
- Each commit ≤ 1500 lines.

---

## File Map (PR 0)

| File | Responsibility |
|---|---|
| `src/executor/policy/pre-broadcast-simulator.mjs` | `eth_call` / `staticCall` simulation against destination contract before signer admission. Revert → BLOCK + audit append. |
| `src/executor/signer/nonce-monitor.mjs` | Per-chain nonce drift tracking, gap detection, RBF helper, empty-self-tx fill helper. |
| `src/executor/portfolio-allocator/slot-mutex.mjs` | In-process file-lock mutex per slot id. Prevents double-allocation of same slot. |
| `src/executor/health/position-bleed-detector.mjs` | Detects positions where cumulative gas > yield × ratio. Emits `exit` action descriptor. |
| `src/executor/policy/gas-price-ceiling.mjs` | Reads `data/gas-history-<chain>.jsonl` p90(7d), compares current gasPrice, defers if above ceiling. |
| `src/executor/helpers/gas-history-writer.mjs` | Append-only writer for per-tick gas samples to `data/gas-history-<chain>.jsonl`. |
| `src/executor/helpers/gateway-btc-onramp.mjs` (modify) | Attach `expectedNetUsd` (post-haircut, post-gas, post-bridge) to intent metadata using `src/config/sizing.mjs`. |
| `src/cli/run-approval-reaper.mjs` (modify) | Extend to scan all approval-emitting intents; use `aggression-profile.mjs` `approvalMaxIdleHours` default. |
| `test/pre-broadcast-simulator.test.mjs` | Revert-caught fixture, success-pass fixture, feature-flag-off fixture. |
| `test/nonce-monitor.test.mjs` | Gap detection fixture, RBF fixture, empty-fill fixture. |
| `test/slot-mutex.test.mjs` | Acquire/release fixture, double-acquire-block fixture, stale-lock-timeout fixture. |
| `test/position-bleed-detector.test.mjs` | Bleed-exceeded fixture, below-ratio fixture, missing-data fixture. |
| `test/gas-price-ceiling.test.mjs` | Above-ceiling-defer fixture, below-ceiling-allow fixture, missing-history fixture. |
| `test/gateway-onramp-ev.test.mjs` | Positive-EV allow fixture, negative-EV reject fixture. |

---

## Task 1: Pre-Broadcast Simulator

**Files:**
- Create: `src/executor/policy/pre-broadcast-simulator.mjs`
- Test: `test/pre-broadcast-simulator.test.mjs`

- [ ] **Step 1: Write the failing test — revert caught**

```js
import { test } from "node:test";
import assert from "node:assert";
import { evaluatePreBroadcastSimulation } from "../../src/executor/policy/pre-broadcast-simulator.mjs";

test("revert in static call blocks broadcast", async () => {
  const result = await evaluatePreBroadcastSimulation({
    intent: {
      intentHash: "abc",
      strategyId: "test-strat",
      chain: "base",
      to: "0x0000000000000000000000000000000000000001",
      data: "0x",
      value: "0",
    },
    provider: {
      call: async () => { throw new Error("execution reverted: insufficient balance"); },
    },
    now: new Date().toISOString(),
  });
  assert.strictEqual(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("pre_broadcast_simulation_revert"));
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `node --test test/pre-broadcast-simulator.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement minimal module**

```js
import { getChainRpcUrls } from "../../config/env.mjs";
import { JsonRpcProvider } from "ethers";
import { appendFileSync } from "node:fs";
import { resolveAggressionProfile } from "../../config/aggression-profile.mjs";

export const PRE_BROADCAST_SIMULATION_AUDIT_PATH = "logs/pre-broadcast-simulation-audit.jsonl";

export function featureEnabled(profile = resolveAggressionProfile()) {
  return profile?.preBroadcastSimulationEnabled === true;
}

function ensureAuditDir() {
  try {
    const { mkdirSync, existsSync } = await import("node:fs");
    if (!existsSync("logs")) mkdirSync("logs", { recursive: true });
  } catch {}
}

export async function evaluatePreBroadcastSimulation({
  intent = {},
  provider = null,
  now = new Date().toISOString(),
  profile = resolveAggressionProfile(),
} = {}) {
  if (!featureEnabled(profile)) {
    return {
      policy: "pre_broadcast_simulation",
      observedAt: now,
      decision: "ALLOW",
      blockers: [],
      metrics: { enabled: false },
    };
  }

  const blockers = [];
  let simulationError = null;
  let simulationResult = null;

  try {
    const simProvider = provider || new JsonRpcProvider(getChainRpcUrls()[intent.chain]);
    simulationResult = await simProvider.call({
      to: intent.to,
      data: intent.data,
      value: intent.value,
      from: intent.from,
    });
  } catch (error) {
    simulationError = error?.message || String(error);
    blockers.push("pre_broadcast_simulation_revert");
  }

  try {
    appendFileSync(PRE_BROADCAST_SIMULATION_AUDIT_PATH, JSON.stringify({
      schemaVersion: 1,
      observedAt: now,
      intentHash: intent.intentHash,
      strategyId: intent.strategyId,
      chain: intent.chain,
      decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
      blockers,
      simulationError,
      simulationResult,
    }) + "\n");
  } catch {}

  return {
    policy: "pre_broadcast_simulation",
    observedAt: now,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers,
    metrics: { enabled: true, simulationError },
  };
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `node --test test/pre-broadcast-simulator.test.mjs`
Expected: PASS

- [ ] **Step 5: Add feature-flag-off fixture**

```js
test("feature flag off returns ALLOW", async () => {
  const result = await evaluatePreBroadcastSimulation({
    intent: { intentHash: "abc", strategyId: "test", chain: "base" },
    provider: { call: async () => { throw new Error("revert"); } },
    profile: resolveAggressionProfile("safety_first"),
  });
  assert.strictEqual(result.decision, "ALLOW");
});
```

Run: `node --test test/pre-broadcast-simulator.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/executor/policy/pre-broadcast-simulator.mjs test/pre-broadcast-simulator.test.mjs
git commit -m "feat(gas-safety): pre-broadcast simulator (D1)

- eth_call / static-call simulation before signer admission
- Revert → BLOCK with 'pre_broadcast_simulation_revert'
- Append-only audit to logs/pre-broadcast-simulation-audit.jsonl
- featureEnabled(profile) predicate, default false under safety_first
- Tests: revert-caught, feature-flag-off

AGENTS.md: Risk Limits (Capital-Audit-Pair), Execution Safety (no LLM signing)
Gas-safety invariants: D1 (pre-broadcast simulation), D3 (feature flag default-OFF), T2 (pre-broadcast revert fixture), T4 (feature-flag-off fixture)"
```

---

## Task 2: Nonce Monitor + Gap Repair

**Files:**
- Create: `src/executor/signer/nonce-monitor.mjs`
- Test: `test/nonce-monitor.test.mjs`

- [ ] **Step 1: Write failing test — gap detection**

```js
test("nonce gap detected when pending > next", () => {
  const { detectNonceGap } = await import("../../src/executor/signer/nonce-monitor.mjs");
  const result = detectNonceGap({ onChainNonce: 5, pendingNonces: [5, 6, 8] });
  assert.deepStrictEqual(result.gaps, [7]);
});
```

- [ ] **Step 2: Run test — fails**

- [ ] **Step 3: Implement module**

```js
import { resolveAggressionProfile } from "../../config/aggression-profile.mjs";

export function featureEnabled(profile = resolveAggressionProfile()) {
  return profile?.nonceMonitorEnabled !== false; // default ON for safety
}

export function detectNonceGap({ onChainNonce = 0, pendingNonces = [] } = {}) {
  if (!featureEnabled()) return { gaps: [], needsRepair: false };
  const sorted = [...pendingNonces].sort((a, b) => a - b);
  const gaps = [];
  let expected = onChainNonce;
  for (const nonce of sorted) {
    if (nonce < onChainNonce) continue;
    while (expected < nonce) {
      gaps.push(expected);
      expected++;
    }
    expected = nonce + 1;
  }
  return { gaps, needsRepair: gaps.length > 0 };
}

export function buildRbfTransaction({ originalTx, newGasPrice }) {
  return {
    ...originalTx,
    maxFeePerGas: newGasPrice,
    maxPriorityFeePerGas: newGasPrice,
    nonce: originalTx.nonce,
  };
}

export function buildEmptySelfTx({ from, nonce, gasPrice, chainId }) {
  return {
    from,
    to: from,
    value: "0",
    data: "0x",
    nonce,
    gasLimit: "21000",
    gasPrice,
    chainId,
  };
}
```

- [ ] **Step 4: Run test — pass**

- [ ] **Step 5: Commit**

```bash
git add src/executor/signer/nonce-monitor.mjs test/nonce-monitor.test.mjs
git commit -m "feat(gas-safety): nonce monitor with gap detection and RBF helper (D9)

- detectNonceGap: compares on-chain nonce vs pending tx nonces
- buildRbfTransaction: replaces gas for stuck tx replacement
- buildEmptySelfTx: fills nonce gap with zero-value self-send
- featureEnabled predicate
- Tests: gap detection, RBF structure, empty-fill structure

AGENTS.md: Execution Safety (stuck-tx pile-up prevention)
Gas-safety invariants: D9 (nonce gap detection + repair)"
```

---

## Task 3: Slot Mutex

**Files:**
- Create: `src/executor/portfolio-allocator/slot-mutex.mjs`
- Test: `test/slot-mutex.test.mjs`

- [ ] **Step 1–4**: Same TDD pattern — acquire, release, double-acquire-block, timeout.
- [ ] **Step 5: Commit**

```bash
git add src/executor/portfolio-allocator/slot-mutex.mjs test/slot-mutex.test.mjs
git commit -m "feat(gas-safety): slot mutex for K-rotator (D13)

- In-process file-lock per slot id
- Prevents two in-flight intents from claiming same slot
- Auto-release on confirmed/rejected/error via timeout fallback
- Tests: acquire/release, double-block, stale-timeout

AGENTS.md: Risk Limits (K-rotator slot mutex)
Gas-safety invariants: D13 (slot mutex)"
```

---

## Task 4: Position Bleed Detector

**Files:**
- Create: `src/executor/health/position-bleed-detector.mjs`
- Test: `test/position-bleed-detector.test.mjs`

- [ ] **Step 1–4**: TDD — cumulative gas > yield × ratio → emit exit action.
- [ ] **Step 5: Commit**

```bash
git add src/executor/health/position-bleed-detector.mjs test/position-bleed-detector.test.mjs
git commit -m "feat(gas-safety): position bleed detector (D11)

- Triggers exit when cumulative gas accrual > yield × bleedToYieldRatio
- Consumes position-state from gas-budget-controller metrics
- Emits action descriptor compatible with position-action-engine
- featureEnabled predicate
- Tests: bleed-exceeded, below-ratio, missing-data

AGENTS.md: Risk Limits (idle position bleed exit)
Gas-safety invariants: D11 (idle position bleed exit)"
```

---

## Task 5: Gas-Price Ceiling + History Writer

**Files:**
- Create: `src/executor/policy/gas-price-ceiling.mjs`
- Create: `src/executor/helpers/gas-history-writer.mjs`
- Test: `test/gas-price-ceiling.test.mjs`

- [ ] **Step 1–4**: TDD — read p90 from JSONL, compare current gasPrice, defer if above.
- [ ] **Step 5: Commit**

```bash
git add src/executor/policy/gas-price-ceiling.mjs src/executor/helpers/gas-history-writer.mjs test/gas-price-ceiling.test.mjs
git commit -m "feat(gas-safety): gas-price ceiling per chain (D5,D6)

- Reads p90(7d) from data/gas-history-<chain>.jsonl
- Compares current gasPrice/maxFeePerGas; defers if above ceiling
- gas-history-writer appends samples each tick
- Tests: above-ceiling-defer, below-ceiling-allow, missing-history

AGENTS.md: Risk Limits (gas-price ceiling)
Gas-safety invariants: D5 (gas-price ceiling), D6 (slippage simulation related)"
```

---

## Task 6: Approval Reaper Extension

**Files:**
- Modify: `src/cli/run-approval-reaper.mjs`

- [ ] **Step 1**: Read current reaper to understand scan pattern.
- [ ] **Step 2**: Extend `extractApprovalWatchlist` to include all `approve_exact` intents from new modules (pre-broadcast, slot-mutex, etc. do not emit approvals; only strategy intents do — so this is wiring the existing reaper to the full signer-audit stream).
- [ ] **Step 3**: Add `approvalMaxIdleHours` lookup from `aggression-profile.mjs`.
- [ ] **Step 4**: Test with `test/approval-reaper.test.mjs` (already exists — extend it).
- [ ] **Step 5: Commit**

```bash
git add src/cli/run-approval-reaper.mjs test/approval-reaper.test.mjs
git commit -m "feat(gas-safety): extend approval reaper to all intent emitters (D10)

- Scans full signer-audit stream for approve_exact intents
- Uses aggression-profile approvalMaxIdleHours default
- Time-boxed auto-revoke for all new approval paths
- Tests: expiry-triggered revoke, non-approval ignored

AGENTS.md: Execution Safety (no unlimited approvals)
Gas-safety invariants: D10 (time-boxed approval auto-revoke)"
```

---

## Task 7: Gateway Onramp EV Wiring

**Files:**
- Modify: `src/executor/helpers/gateway-btc-onramp.mjs`
- Test: `test/gateway-onramp-ev.test.mjs`

- [ ] **Step 1**: Read `gateway-btc-onramp.mjs` (already done in audit — it lacks `expectedNetUsd`).
- [ ] **Step 2**: Add EV computation using `src/config/sizing.mjs` helpers (`computeTinyCanaryMinProfitablePositionUsd` or custom bridge EV helper).
- [ ] **Step 3**: Attach `expectedNetUsd` to intent metadata so policy `ev-gate.mjs` allows positive-EV onramps.
- [ ] **Step 4**: Tests — positive EV allows, negative EV rejects.
- [ ] **Step 5: Commit**

```bash
git add src/executor/helpers/gateway-btc-onramp.mjs test/gateway-onramp-ev.test.mjs
git commit -m "feat(gas-safety): attach expectedNetUsd to Gateway onramp intent (C1,D7)

- Computes post-haircut, post-gas, post-bridge expected net using sizing.mjs
- Positive EV → intent metadata carries expectedNetUsd
- Negative EV → intent blocked before signer
- Fixes observed 'expected_net_unmeasured' rejections in signer-audit
- Tests: positive-EV allow, negative-EV reject

AGENTS.md: Risk Limits (minimum net profit), Execution Safety (stale-quote rejection)
Gas-safety invariants: C1 (L1→destination bridge EV), D7 (stale-quote rejection related)"
```

---

## Task 8: Policy Engine Integration

**Files:**
- Modify: `src/executor/policy/index.mjs`

- [ ] **Step 1**: Import `evaluatePreBroadcastSimulation` and `evaluateGasPriceCeiling`.
- [ ] **Step 2**: Add them to the `results` array in `evaluateIntentPolicies`, after `evaluateStaleQuote` and before `evaluateConsecutiveFailures`.
- [ ] **Step 3**: Ensure they respect `featureEnabled` — when off, they return `ALLOW` with no blockers.
- [ ] **Step 4**: Run full test suite: `npm test`
- [ ] **Step 5**: Commit

```bash
git add src/executor/policy/index.mjs
git commit -m "feat(gas-safety): wire pre-broadcast simulator and gas-price ceiling into policy engine

- Hooks evaluatePreBroadcastSimulation and evaluateGasPriceCeiling into evaluateIntentPolicies
- Both respect featureEnabled predicates — safety_first profile sees no-op
- All existing tests remain green

AGENTS.md: Execution Safety (policy engine validation)
Gas-safety invariants: D1, D5 integration"
```

---

## Task 9: Full Verification

- [ ] **Step 1**: `npm run check`
- [ ] **Step 2**: `npm test` (expect 3089+ new tests pass, 0 fail)
- [ ] **Step 3**: `npm run dashboard:build`
- [ ] **Step 4**: `node src/cli/check-full-automation-readiness.mjs --json` — confirm no new blockers
- [ ] **Step 5**: Final commit if any fixes needed

---

## Execution Handoff

**Plan complete. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch 4 focused subagents in parallel for Tasks 1–7, integrate in Task 8.

**2. Inline Execution** — Execute tasks sequentially in this session.

Given the "don't stop" instruction, **Subagent-Driven** is faster and preserves quality through focused scope.
