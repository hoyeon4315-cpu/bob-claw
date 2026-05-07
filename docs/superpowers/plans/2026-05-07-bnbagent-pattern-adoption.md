# BNBAgent Pattern Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt only the BNBAgent SDK patterns that improve BOB Claw's deterministic, BTC-first, multi-chain execution system, while blocking BNB/BSC brand bias, testnet bias, runtime LLM authority, and payback proof substitution.

**Architecture:** Keep BNBAgent SDK as a research comparator, not a runtime dependency. Translate selected ideas into small BOB Claw-native modules: signer retry classification, read-only Multicall3 observation, proof manifest hashing, dev-agent lifecycle reporting, and signer simulation evidence. Strategy authority remains in committed config, pure policy, isolated signer daemons, kill-switch checks, and receipt-backed accounting.

**Tech Stack:** Node `.mjs`, `node:test`, `ethers` v6, existing JSON-RPC helper, existing BOB Claw config/policy/signer/payback/radar modules, docs-only primary-source citations.

---

## Scope

This plan is intentionally not a "use BNB Chain" plan. It is a technical pattern adoption plan.

Adopt:

- Signer nonce and broadcast error hardening.
- Read-only Multicall3 availability reporting across the 11 official Gateway destinations.
- A small Multicall3 read helper gated by per-chain availability and explicit fallback.
- Internal proof manifest hashes for payback and radar evidence objects.
- Dev/research task lifecycle fields with `runtimeAuthority: "none"`.
- Signer simulation evidence as a signer-adjacent report field, not as a policy-engine RPC call.
- Keystore V3 signer backend design research before any key-custody code changes.

Reject:

- No BNBAgent SDK runtime dependency.
- No BSC or BNB default chain preference.
- No public job endpoint.
- No runtime LLM task execution.
- No UMA or external oracle as payback settlement proof.
- No public IPFS upload of raw wallet, route, inventory, or signed transaction artifacts.
- No paymaster, ERC-4337, or sponsored transaction assumption without a separate measured design.
- No cap raise, `autoExecute` flip, payback ratio change, or signer behavior change outside committed diffs and tests.

## Confidence Standard

"100% confident" in this plan means every named loophole has a concrete guard, test, or explicit non-adoption rule inside the scope of this plan. It does not mean every future market route is profitable or every chain RPC is reliable. Profitability still requires measured quote, fee, latency, execution, and receipt evidence.

Loop closure rules:

- Brand authority loophole closes only when no source file imports BNBAgent SDK or treats BNB/BSC as privileged.
- Testnet dismissal loophole closes only when the adopted pattern is tested against BOB Claw behavior, not against BNBAgent claims.
- BNB fixation loophole closes only when chain logic imports `OFFICIAL_GATEWAY_DESTINATION_CHAINS`.
- Safety theater loophole closes only when read-only/proof fields cannot approve policy, raise caps, sign, or decide payback.
- Measurement loophole closes only when every live-relevant claim has receipt, simulation, or RPC observation fields.
- Solo-operator complexity loophole closes only when each task can ship as a focused, reversible diff.

## File Map

- `src/executor/signer/evm-local-signer.mjs`: Extend already-broadcast classification for one known nonce replacement error.
- `test/evm-local-signer.test.mjs`: Lock the signer broadcast behavior with a failing-first test.
- `src/evm/multicall3-availability.mjs`: Build read-only availability observations for Multicall3 across official Gateway destinations.
- `src/cli/report-multicall3-gateway-matrix.mjs`: Report availability as JSON/text and optionally write a local data artifact.
- `test/multicall3-availability.test.mjs`: Test official chain coverage and status classification without live RPC.
- `package.json`: Add `report:multicall3-gateway-matrix`.
- `src/lib/multicall3.mjs`: Provide a tiny read-only `aggregate3` helper.
- `test/multicall3.test.mjs`: Test batching, per-call failure envelopes, and provider-call failure behavior.
- `src/treasury/evm-balance-batch-reader.mjs`: Batch ERC20 balance reads with Multicall3 when available, with explicit fallback.
- `test/evm-balance-batch-reader.test.mjs`: Test batch success, missing Multicall3 fallback, and no silent skip.
- `src/proof/manifest.mjs`: Build canonical internal proof manifests and SHA-256 hashes.
- `test/proof-manifest.test.mjs`: Test stable hashing and secret-field rejection.
- `src/strategy/radar/portable-packet-builder.mjs`: Add optional manifest hash to portable radar packets.
- `test/radar-portable-packet.test.mjs`: Assert manifest hash is additive and cannot replace existing portability blockers.
- `src/executor/payback/scheduler.mjs`: Add manifest fields to payback disbursement records after three-way proof is still present.
- `test/payback-scheduler.test.mjs`: Assert payback manifest is additive and Bitcoin L1 delivery proof remains required.
- `src/strategy/dev-agent-automation-bridge.mjs`: Add report-only task lifecycle fields.
- `test/dev-agent-automation-bridge.test.mjs`: Assert lifecycle does not create live authority.
- `docs/ai-agent-operations.md`: Document the dev/research lifecycle translation and forbidden runtime authority.
- `docs/research/evm-keystore-v3-signer-backend-design.md`: Research design for optional Keystore V3 backend with password-source constraints.

## Execution Order

1. Task 0: Guardrail baseline.
2. Task 1: Signer underpriced broadcast classifier.
3. Task 2: Multicall3 availability matrix.
4. Task 3: Multicall3 read helper.
5. Task 4: Batch ERC20 balance reader.
6. Task 5: Proof manifest helper.
7. Task 6: Manifest wiring into radar and payback.
8. Task 7: Dev-agent lifecycle reporting.
9. Task 8: Signer simulation evidence design.
10. Task 9: Keystore V3 research.
11. Task 10: Full verification and rollout decision.

Each source-changing task should end with a focused commit. Do not stage generated `dashboard/public/*.json`, `data/**`, or `logs/**`.

### Task 0: Guardrail Baseline

**Files:**
- Read: `AGENTS.md`
- Read: `docs/system-map.md`
- Read: `docs/harness-engineering.md`
- Read: `docs/research/bnbagent-sdk-bobclaw-deep-review-plan-2026-05-07.md`

- [ ] **Step 1: Check the worktree**

Run:

```bash
git status --short --branch
```

Expected:

```text
Exit code 0.
Unrelated generated dashboard JSON or existing research docs may be dirty.
Do not stage unrelated generated files.
```

- [ ] **Step 2: Confirm graph freshness**

Run:

```bash
npm run graph:focus -- status
```

Expected:

```text
Exit code 0.
If a root stale marker is present but app needs_update is no, keep going.
```

- [ ] **Step 3: Confirm source guardrails**

Run:

```bash
node --test test/audit-overfit.test.mjs test/operational-judgment-review.test.mjs test/executor-policy-index.test.mjs
```

Expected:

```text
fail 0
```

### Task 1: Signer Underpriced Broadcast Classifier

**Files:**
- Modify: `src/executor/signer/evm-local-signer.mjs`
- Modify: `test/evm-local-signer.test.mjs`

- [ ] **Step 1: Add the failing test**

Insert this test after `evm signer submits accepted raw transactions to fallback RPCs too` in `test/evm-local-signer.test.mjs`:

```js
test("evm signer treats replacement-underpriced broadcast errors as already propagated", async () => {
  const calls = [];
  const signer = buildSigner(buildProvider({
    broadcastError: new Error("replacement transaction underpriced"),
    calls,
  }));

  const signed = await signer.signIntent(intent(), { reserveNonce: true });
  const broadcast = await signer.broadcastSignedIntent(signed);

  assert.equal(broadcast.txHash, signed.txHash);
  assert.equal(broadcast.nonce, signed.metadata.nonce);
  assert.equal(broadcast.from, signed.metadata.from);
  assert.equal(broadcast.to, signed.metadata.to);
  assert.deepEqual(calls, [
    "provider:fee",
    "provider:balance",
    "provider:nonce",
    "provider:broadcast",
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails before implementation**

Run:

```bash
node --test test/evm-local-signer.test.mjs
```

Expected before implementation:

```text
FAIL evm signer treats replacement-underpriced broadcast errors as already propagated
broadcastSignedIntent failed for base: replacement transaction underpriced
```

- [ ] **Step 3: Implement the classifier change**

Replace `isLikelyAlreadyBroadcast` in `src/executor/signer/evm-local-signer.mjs` with:

```js
function isLikelyAlreadyBroadcast(error) {
  return /already known|already imported|known transaction|nonce too low|replacement transaction underpriced/iu.test(errorMessage(error));
}
```

- [ ] **Step 4: Run signer and raw transaction submit tests**

Run:

```bash
node --test test/evm-local-signer.test.mjs test/transaction-submit.test.mjs
```

Expected:

```text
fail 0
```

- [ ] **Step 5: Commit the signer hardening**

Run:

```bash
git add src/executor/signer/evm-local-signer.mjs test/evm-local-signer.test.mjs
git commit -m "fix: classify replacement-underpriced signer broadcasts"
```

Expected:

```text
Commit created with only the signer source and signer test staged.
```

### Task 2: Multicall3 Gateway Destination Matrix

**Files:**
- Create: `src/evm/multicall3-availability.mjs`
- Create: `src/cli/report-multicall3-gateway-matrix.mjs`
- Create: `test/multicall3-availability.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing availability tests**

Create `test/multicall3-availability.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../src/config/gateway-destinations.mjs";
import {
  MULTICALL3_ADDRESS,
  buildGatewayMulticall3Matrix,
  classifyContractCode,
  summarizeGatewayMulticall3Matrix,
} from "../src/evm/multicall3-availability.mjs";

test("multicall3 matrix covers official Gateway destinations exactly once", async () => {
  const report = await buildGatewayMulticall3Matrix({
    now: "2026-05-07T00:00:00.000Z",
    readCode: async ({ chain, address }) => ({
      chain,
      address,
      rpcUrl: `mock://${chain}`,
      code: "0x60016000",
    }),
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.observedAt, "2026-05-07T00:00:00.000Z");
  assert.deepEqual(report.items.map((item) => item.chain), OFFICIAL_GATEWAY_DESTINATION_CHAINS);
  assert.equal(report.items.every((item) => item.address === MULTICALL3_ADDRESS), true);
  assert.equal(report.summary.availableCount, OFFICIAL_GATEWAY_DESTINATION_CHAINS.length);
});

test("contract code classifier separates available, missing, and malformed code", () => {
  assert.equal(classifyContractCode("0x60016000"), "available");
  assert.equal(classifyContractCode("0x"), "missing");
  assert.equal(classifyContractCode(""), "missing");
  assert.equal(classifyContractCode(null), "rpc_error");
});

test("matrix records rpc errors without removing chains", async () => {
  const report = await buildGatewayMulticall3Matrix({
    chains: ["base", "bsc"],
    now: "2026-05-07T00:00:00.000Z",
    readCode: async ({ chain }) => {
      if (chain === "bsc") throw new Error("rate limited");
      return { rpcUrl: "mock://base", code: "0x60016000" };
    },
  });

  assert.deepEqual(report.items.map((item) => item.chain), ["base", "bsc"]);
  assert.equal(report.items[0].status, "available");
  assert.equal(report.items[1].status, "rpc_error");
  assert.equal(report.items[1].error, "rate limited");
  assert.deepEqual(report.summary.blockers, ["multicall3_unavailable_on_bsc"]);
});

test("summary never promotes BSC over other official Gateway chains", () => {
  const summary = summarizeGatewayMulticall3Matrix([
    { chain: "bsc", status: "available" },
    { chain: "base", status: "missing" },
    { chain: "ethereum", status: "rpc_error" },
  ]);

  assert.equal(summary.availableCount, 1);
  assert.equal(summary.missingCount, 1);
  assert.equal(summary.rpcErrorCount, 1);
  assert.deepEqual(summary.blockers, [
    "multicall3_unavailable_on_base",
    "multicall3_unavailable_on_ethereum",
  ]);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
node --test test/multicall3-availability.test.mjs
```

Expected before implementation:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Implement availability helper**

Create `src/evm/multicall3-availability.mjs`:

```js
import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../config/gateway-destinations.mjs";

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

function byteLengthOfCode(code) {
  if (typeof code !== "string" || !code.startsWith("0x")) return null;
  return Math.max(0, Math.floor((code.length - 2) / 2));
}

export function classifyContractCode(code) {
  if (typeof code !== "string") return "rpc_error";
  if (!code || code === "0x") return "missing";
  if (!/^0x[0-9a-f]*$/iu.test(code)) return "rpc_error";
  return "available";
}

export async function observeMulticall3Destination({
  chain,
  address = MULTICALL3_ADDRESS,
  readCode,
  now = new Date().toISOString(),
} = {}) {
  if (!chain) throw new Error("multicall3_chain_required");
  if (typeof readCode !== "function") throw new Error("multicall3_read_code_required");
  try {
    const observation = await readCode({ chain, address });
    const code = typeof observation === "string" ? observation : observation?.code;
    const status = classifyContractCode(code);
    return {
      chain,
      address,
      status,
      observedAt: now,
      rpcUrl: typeof observation === "object" ? observation?.rpcUrl || null : null,
      codeByteLength: byteLengthOfCode(code),
      error: status === "rpc_error" ? "invalid_contract_code_response" : null,
    };
  } catch (error) {
    return {
      chain,
      address,
      status: "rpc_error",
      observedAt: now,
      rpcUrl: null,
      codeByteLength: null,
      error: error.message,
    };
  }
}

export function summarizeGatewayMulticall3Matrix(items = []) {
  const availableCount = items.filter((item) => item.status === "available").length;
  const missingCount = items.filter((item) => item.status === "missing").length;
  const rpcErrorCount = items.filter((item) => item.status === "rpc_error").length;
  return {
    chainCount: items.length,
    availableCount,
    missingCount,
    rpcErrorCount,
    blockers: items
      .filter((item) => item.status !== "available")
      .map((item) => `multicall3_unavailable_on_${item.chain}`),
  };
}

export async function buildGatewayMulticall3Matrix({
  chains = OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  address = MULTICALL3_ADDRESS,
  readCode,
  now = new Date().toISOString(),
} = {}) {
  const uniqueChains = [...new Set(chains)];
  const items = [];
  for (const chain of uniqueChains) {
    items.push(await observeMulticall3Destination({ chain, address, readCode, now }));
  }
  return {
    schemaVersion: 1,
    kind: "gateway_multicall3_matrix",
    observedAt: now,
    address,
    items,
    summary: summarizeGatewayMulticall3Matrix(items),
  };
}
```

- [ ] **Step 4: Implement report CLI**

Create `src/cli/report-multicall3-gateway-matrix.mjs`:

```js
#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import config from "../config/index.mjs";
import { EVM_CHAINS } from "../chains/registry.mjs";
import { rpc } from "../evm/json-rpc.mjs";
import { buildGatewayMulticall3Matrix } from "../evm/multicall3-availability.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  return {
    json: argv.includes("--json"),
    write: argv.includes("--write"),
  };
}

function rpcUrlsForChain(chain) {
  const chainConfig = EVM_CHAINS[chain] || {};
  return [...new Set([...(chainConfig.rpcUrls || []), chainConfig.rpcUrl].filter(Boolean))];
}

async function readCodeFromConfiguredRpc({ chain, address }) {
  const attempts = [];
  for (const rpcUrl of rpcUrlsForChain(chain)) {
    try {
      const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
      return { rpcUrl, code };
    } catch (error) {
      attempts.push(`${rpcUrl}: ${error.message}`);
    }
  }
  throw new Error(attempts.length ? attempts.join(" | ") : `no_rpc_config_for_${chain}`);
}

export async function runReportMulticall3GatewayMatrix(args = parseArgs()) {
  const report = await buildGatewayMulticall3Matrix({
    readCode: readCodeFromConfiguredRpc,
  });
  if (args.write) {
    const outputPath = join(config.dataDir, "multicall3-gateway-matrix.json");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  const report = await runReportMulticall3GatewayMatrix(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`kind=${report.kind}`);
    console.log(`chainCount=${report.summary.chainCount}`);
    console.log(`available=${report.summary.availableCount}`);
    console.log(`missing=${report.summary.missingCount}`);
    console.log(`rpcError=${report.summary.rpcErrorCount}`);
    console.log(`blockers=${report.summary.blockers.join(",") || "none"}`);
  }
}
```

- [ ] **Step 5: Add package script**

In `package.json`, add near the other report scripts:

```json
"report:multicall3-gateway-matrix": "node src/cli/report-multicall3-gateway-matrix.mjs",
```

- [ ] **Step 6: Run tests and syntax checks**

Run:

```bash
node --test test/multicall3-availability.test.mjs
node --check src/cli/report-multicall3-gateway-matrix.mjs
```

Expected:

```text
fail 0
No syntax errors.
```

- [ ] **Step 7: Commit the matrix reporter**

Run:

```bash
git add src/evm/multicall3-availability.mjs src/cli/report-multicall3-gateway-matrix.mjs test/multicall3-availability.test.mjs package.json
git commit -m "feat: report multicall3 gateway availability"
```

Expected:

```text
Commit created without data/multicall3-gateway-matrix.json staged.
```

### Task 3: Multicall3 Read Helper

**Files:**
- Create: `src/lib/multicall3.mjs`
- Create: `test/multicall3.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `test/multicall3.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";

import {
  MULTICALL3_ABI,
  MULTICALL3_ADDRESS,
  multicall3Read,
} from "../src/lib/multicall3.mjs";

const MULTICALL3 = new Interface(MULTICALL3_ABI);

function encodeAggregate3(rows) {
  return MULTICALL3.encodeFunctionResult("aggregate3", [rows]);
}

test("multicall3Read returns an empty result for empty calls", async () => {
  const provider = {
    call: async () => {
      throw new Error("provider should not be called");
    },
  };

  const result = await multicall3Read({ provider, calls: [] });

  assert.deepEqual(result, {
    schemaVersion: 1,
    address: MULTICALL3_ADDRESS,
    batchCount: 0,
    results: [],
  });
});

test("multicall3Read batches aggregate3 calls and preserves input order", async () => {
  const sent = [];
  const provider = {
    call: async (tx, blockTag) => {
      sent.push({ tx, blockTag });
      return encodeAggregate3([
        { success: true, returnData: "0x01" },
        { success: false, returnData: "0x" },
      ]);
    },
  };

  const result = await multicall3Read({
    provider,
    batchSize: 2,
    blockTag: "latest",
    calls: [
      { target: "0x0000000000000000000000000000000000000001", callData: "0x11111111" },
      { target: "0x0000000000000000000000000000000000000002", callData: "0x22222222" },
      { target: "0x0000000000000000000000000000000000000003", callData: "0x33333333" },
      { target: "0x0000000000000000000000000000000000000004", callData: "0x44444444" },
    ],
  });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].tx.to, MULTICALL3_ADDRESS);
  assert.equal(sent[0].blockTag, "latest");
  assert.deepEqual(result.results.map((row) => row.index), [0, 1, 2, 3]);
  assert.equal(result.results[0].success, true);
  assert.equal(result.results[1].success, false);
  assert.equal(result.results[2].success, true);
  assert.equal(result.results[3].success, false);
});

test("multicall3Read rejects malformed calls before touching provider", async () => {
  let touched = false;
  const provider = {
    call: async () => {
      touched = true;
      return "0x";
    },
  };

  await assert.rejects(
    () => multicall3Read({ provider, calls: [{ target: "0x123", callData: "0x" }] }),
    /multicall3_call_target_invalid/u,
  );
  assert.equal(touched, false);
});

test("multicall3Read throws a structured provider error", async () => {
  const provider = {
    call: async () => {
      throw new Error("rpc unavailable");
    },
  };

  await assert.rejects(
    () => multicall3Read({
      provider,
      calls: [{ target: "0x0000000000000000000000000000000000000001", callData: "0x11111111" }],
    }),
    /multicall3_provider_call_failed: rpc unavailable/u,
  );
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test test/multicall3.test.mjs
```

Expected before implementation:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Implement helper**

Create `src/lib/multicall3.mjs`:

```js
import { Interface } from "ethers";

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const MULTICALL3_ABI = Object.freeze([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);

const MULTICALL3 = new Interface(MULTICALL3_ABI);

function assertAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/iu.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function assertHexData(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeCalls(calls, allowFailure) {
  return calls.map((call, index) => ({
    index,
    target: assertAddress(call.target, "multicall3_call_target"),
    allowFailure: call.allowFailure ?? allowFailure,
    callData: assertHexData(call.callData || call.data, "multicall3_call_data"),
  }));
}

export async function multicall3Read({
  provider,
  calls = [],
  batchSize = 100,
  allowFailure = true,
  contractAddress = MULTICALL3_ADDRESS,
  blockTag = "latest",
} = {}) {
  if (!provider || typeof provider.call !== "function") throw new Error("multicall3_provider_required");
  assertAddress(contractAddress, "multicall3_contract_address");
  const normalized = normalizeCalls(calls, allowFailure);
  if (normalized.length === 0) {
    return {
      schemaVersion: 1,
      address: contractAddress,
      batchCount: 0,
      results: [],
    };
  }

  const batches = chunk(normalized, Math.max(1, Number(batchSize) || 1));
  const results = [];
  for (const batch of batches) {
    const data = MULTICALL3.encodeFunctionData("aggregate3", [
      batch.map((call) => ({
        target: call.target,
        allowFailure: call.allowFailure,
        callData: call.callData,
      })),
    ]);
    let raw;
    try {
      raw = await provider.call({ to: contractAddress, data }, blockTag);
    } catch (error) {
      throw new Error(`multicall3_provider_call_failed: ${error.message}`);
    }
    const decoded = MULTICALL3.decodeFunctionResult("aggregate3", raw);
    decoded[0].forEach((row, offset) => {
      const original = batch[offset];
      results.push({
        index: original.index,
        target: original.target,
        success: Boolean(row.success),
        returnData: row.returnData || "0x",
      });
    });
  }

  results.sort((left, right) => left.index - right.index);
  return {
    schemaVersion: 1,
    address: contractAddress,
    batchCount: batches.length,
    results,
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test test/multicall3.test.mjs test/multicall3-availability.test.mjs
```

Expected:

```text
fail 0
```

- [ ] **Step 5: Commit the helper**

Run:

```bash
git add src/lib/multicall3.mjs test/multicall3.test.mjs
git commit -m "feat: add read-only multicall3 helper"
```

Expected:

```text
Commit created without signer, policy, or cap files staged.
```

### Task 4: Batch ERC20 Balance Reader With Explicit Fallback

**Files:**
- Create: `src/treasury/evm-balance-batch-reader.mjs`
- Create: `test/evm-balance-batch-reader.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `test/evm-balance-batch-reader.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";

import { readErc20BalancesBatch } from "../src/treasury/evm-balance-batch-reader.mjs";

const ERC20 = new Interface(["function balanceOf(address owner) view returns (uint256)"]);
const OWNER = "0x00000000000000000000000000000000000000aa";
const TOKEN_A = "0x0000000000000000000000000000000000000001";
const TOKEN_B = "0x0000000000000000000000000000000000000002";

test("reader uses multicall results when multicall is available", async () => {
  const calls = [];
  const rows = await readErc20BalancesBatch({
    owner: OWNER,
    tokens: [TOKEN_A, TOKEN_B],
    multicallAvailable: true,
    multicall3ReadImpl: async ({ calls: callRows }) => {
      calls.push(...callRows);
      return {
        results: [
          { index: 0, target: TOKEN_A, success: true, returnData: ERC20.encodeFunctionResult("balanceOf", [123n]) },
          { index: 1, target: TOKEN_B, success: false, returnData: "0x" },
        ],
      };
    },
    directBalanceOfImpl: async () => {
      throw new Error("direct fallback should not be used");
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].balanceRaw, "123");
  assert.equal(rows[1].status, "error");
  assert.equal(rows[1].error, "multicall_balanceOf_failed");
});

test("reader falls back to direct reads when multicall is unavailable", async () => {
  const direct = [];
  const rows = await readErc20BalancesBatch({
    owner: OWNER,
    tokens: [TOKEN_A, TOKEN_B],
    multicallAvailable: false,
    multicall3ReadImpl: async () => {
      throw new Error("multicall should not be used");
    },
    directBalanceOfImpl: async ({ token }) => {
      direct.push(token);
      return token === TOKEN_A ? 7n : 9n;
    },
  });

  assert.deepEqual(direct, [TOKEN_A, TOKEN_B]);
  assert.deepEqual(rows.map((row) => row.balanceRaw), ["7", "9"]);
  assert.deepEqual(rows.map((row) => row.source), ["direct_balanceOf", "direct_balanceOf"]);
});

test("reader returns explicit errors and never silently drops tokens", async () => {
  const rows = await readErc20BalancesBatch({
    owner: OWNER,
    tokens: [TOKEN_A, TOKEN_B],
    multicallAvailable: false,
    directBalanceOfImpl: async ({ token }) => {
      if (token === TOKEN_B) throw new Error("rpc rejected");
      return 5n;
    },
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[1].status, "error");
  assert.equal(rows[1].error, "rpc rejected");
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test test/evm-balance-batch-reader.test.mjs
```

Expected before implementation:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Implement balance reader**

Create `src/treasury/evm-balance-batch-reader.mjs`:

```js
import { Interface } from "ethers";
import { multicall3Read } from "../lib/multicall3.mjs";

const ERC20 = new Interface(["function balanceOf(address owner) view returns (uint256)"]);

function assertAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/iu.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function normalizeTokenList(tokens = []) {
  return [...new Set(tokens.map((token) => assertAddress(token, "erc20_token")))];
}

function okRow({ token, balance, source }) {
  return {
    token,
    status: "ok",
    balanceRaw: BigInt(balance).toString(),
    source,
    error: null,
  };
}

function errorRow({ token, source, error }) {
  return {
    token,
    status: "error",
    balanceRaw: null,
    source,
    error: error.message || String(error),
  };
}

export async function readErc20BalancesBatch({
  owner,
  tokens = [],
  multicallAvailable = false,
  multicall3ReadImpl = multicall3Read,
  directBalanceOfImpl,
} = {}) {
  const normalizedOwner = assertAddress(owner, "erc20_owner");
  const normalizedTokens = normalizeTokenList(tokens);
  if (normalizedTokens.length === 0) return [];

  if (multicallAvailable) {
    const response = await multicall3ReadImpl({
      calls: normalizedTokens.map((token) => ({
        target: token,
        callData: ERC20.encodeFunctionData("balanceOf", [normalizedOwner]),
      })),
    });
    return normalizedTokens.map((token, index) => {
      const row = response.results.find((item) => item.index === index);
      if (!row?.success) {
        return errorRow({ token, source: "multicall3_balanceOf", error: new Error("multicall_balanceOf_failed") });
      }
      const decoded = ERC20.decodeFunctionResult("balanceOf", row.returnData);
      return okRow({ token, balance: decoded[0], source: "multicall3_balanceOf" });
    });
  }

  if (typeof directBalanceOfImpl !== "function") throw new Error("direct_balanceOf_required");
  const rows = [];
  for (const token of normalizedTokens) {
    try {
      rows.push(okRow({
        token,
        balance: await directBalanceOfImpl({ owner: normalizedOwner, token }),
        source: "direct_balanceOf",
      }));
    } catch (error) {
      rows.push(errorRow({ token, source: "direct_balanceOf", error }));
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test test/evm-balance-batch-reader.test.mjs test/multicall3.test.mjs
```

Expected:

```text
fail 0
```

- [ ] **Step 5: Commit batch reader**

Run:

```bash
git add src/treasury/evm-balance-batch-reader.mjs test/evm-balance-batch-reader.test.mjs
git commit -m "feat: add explicit erc20 balance batch reader"
```

Expected:

```text
Commit created without changing live strategy behavior.
```

### Task 5: Internal Proof Manifest Helper

**Files:**
- Create: `src/proof/manifest.mjs`
- Create: `test/proof-manifest.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `test/proof-manifest.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildProofManifest, canonicalJson } from "../src/proof/manifest.mjs";

test("canonicalJson is stable across object key order", () => {
  assert.equal(
    canonicalJson({ b: 2, a: { d: 4, c: 3 } }),
    canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("proof manifest hash is stable for equivalent inputs", () => {
  const first = buildProofManifest({
    kind: "payback_disbursement",
    observedAt: "2026-05-07T00:00:00.000Z",
    sourcePointers: [{ kind: "gateway_order", id: "order-1" }],
    artifacts: [{ kind: "destination_proof", sha256: "abc", path: "data/private/proof.json" }],
    redactions: ["wallet_inventory_raw"],
    verdict: { status: "delivered", sats: 1000 },
  });
  const second = buildProofManifest({
    verdict: { sats: 1000, status: "delivered" },
    redactions: ["wallet_inventory_raw"],
    artifacts: [{ path: "data/private/proof.json", sha256: "abc", kind: "destination_proof" }],
    sourcePointers: [{ id: "order-1", kind: "gateway_order" }],
    kind: "payback_disbursement",
    observedAt: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.kind, "payback_disbursement");
  assert.equal(first.rawArtifactPublished, false);
});

test("proof manifest rejects secret-like raw fields", () => {
  assert.throws(
    () => buildProofManifest({
      kind: "bad",
      sourcePointers: [],
      artifacts: [{ kind: "raw_tx", signedTx: "0xabc" }],
      verdict: { status: "unsafe" },
    }),
    /proof_manifest_forbidden_field: artifacts.0.signedTx/u,
  );
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test test/proof-manifest.test.mjs
```

Expected before implementation:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Implement proof manifest**

Create `src/proof/manifest.mjs`:

```js
import { createHash } from "node:crypto";

const FORBIDDEN_KEY = /privateKey|mnemonic|signedTx|rawTransaction|secret|apiKey|password/iu;

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedObject(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(sortedObject(value));
}

function assertNoForbiddenKeys(value, path = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}.${index}`.replace(/^\./u, "")));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`.replace(/^\./u, "");
    if (FORBIDDEN_KEY.test(key)) throw new Error(`proof_manifest_forbidden_field: ${childPath}`);
    assertNoForbiddenKeys(child, childPath);
  }
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildProofManifest({
  kind,
  observedAt = new Date().toISOString(),
  sourcePointers = [],
  artifacts = [],
  redactions = [],
  verdict = {},
} = {}) {
  if (!kind) throw new Error("proof_manifest_kind_required");
  const payload = {
    schemaVersion: 1,
    kind,
    observedAt,
    sourcePointers,
    artifacts,
    redactions,
    verdict,
    rawArtifactPublished: false,
  };
  assertNoForbiddenKeys(payload);
  const canonical = canonicalJson(payload);
  return {
    ...payload,
    manifestHash: `sha256:${sha256Hex(canonical)}`,
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test test/proof-manifest.test.mjs
```

Expected:

```text
fail 0
```

- [ ] **Step 5: Commit helper**

Run:

```bash
git add src/proof/manifest.mjs test/proof-manifest.test.mjs
git commit -m "feat: add internal proof manifest helper"
```

Expected:

```text
Commit created with only proof helper and proof tests.
```

### Task 6: Wire Proof Manifests Into Radar And Payback

**Files:**
- Modify: `src/strategy/radar/portable-packet-builder.mjs`
- Modify: `test/radar-portable-packet.test.mjs`
- Modify: `src/executor/payback/scheduler.mjs`
- Modify: `test/payback-scheduler.test.mjs`

- [ ] **Step 1: Add radar packet test**

Add a test in `test/radar-portable-packet.test.mjs` that builds a valid portable packet with `manifestBuilder` injected:

```js
test("portable packet includes internal proof manifest without relaxing blockers", () => {
  const result = buildPortableOpportunityPacket({
    packetId: "packet-1",
    episodes: [{
      episodeId: "episode-1",
      protocolId: "demo",
      chain: "base",
      selfReplayNetPnlUsd: 1,
      pnlClosureStatus: "closed",
    }],
    portabilityWalletSet: ["wallet-a", "wallet-b"],
    portabilityClusterIndependenceProof: "cluster-proof-hash",
    rewardTokenLiquidityDepthUsd: 1000,
    rewardTokenSlippageAtSize: 0.01,
    oracleSource: "fixture",
    oracleStalenessSecondsMax: 60,
    oracleManipulationCostUsd: 10000,
    capacityAtProposedSize: 10,
    slippageSimAtSize: 0.01,
    slippageSimAt2x: 0.02,
    slippageSimAt5x: 0.05,
    manifestBuilder: ({ kind }) => ({ kind, manifestHash: "sha256:portable" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.packet.proofManifestHash, "sha256:portable");
});
```

Add a second test that omits `portabilityClusterIndependenceProof` while injecting the manifest:

```js
test("portable packet manifest does not replace cluster independence proof", () => {
  const result = buildPortableOpportunityPacket({
    packetId: "packet-1",
    episodes: [],
    portabilityWalletSet: ["wallet-a", "wallet-b"],
    manifestBuilder: ({ kind }) => ({ kind, manifestHash: "sha256:portable" }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blockers.includes("radar_portability_cluster_independence_missing"), true);
});
```

- [ ] **Step 2: Modify radar packet builder**

In `src/strategy/radar/portable-packet-builder.mjs`, import `buildProofManifest` and add `manifestBuilder` to the function parameters:

```js
import { buildProofManifest } from "../../proof/manifest.mjs";
```

Inside `buildPortableOpportunityPacket`, add this parameter:

```js
  manifestBuilder = buildProofManifest,
```

After `const validation = validatePortableOpportunityPacket(packet);`, add:

```js
  const manifest = manifestBuilder({
    kind: "radar_portable_opportunity_packet",
    sourcePointers: episodes.map((episode) => ({
      kind: "radar_episode",
      id: episode.episodeId || null,
      chain: episode.chain || null,
      protocolId: episode.protocolId || null,
    })),
    artifacts: [{
      kind: "validated_packet",
      sha256: null,
      path: null,
    }],
    redactions: ["raw_wallet_clusters", "raw_event_payloads"],
    verdict: {
      ok: blockers.length === 0 && validation.blockers.length === 0,
      blockerCount: blockers.length + validation.blockers.length,
    },
  });
```

When returning the valid packet, add the manifest fields without changing the validator contract:

```js
    packet: blockers.length === 0
      ? {
          ...validation.value,
          proofManifestHash: manifest.manifestHash,
          proofManifestKind: manifest.kind,
        }
      : null,
```

- [ ] **Step 3: Add payback disbursement test**

In `test/payback-scheduler.test.mjs`, add or extend a `buildPaybackDisbursementRecord` test:

```js
test("payback disbursement manifest is additive to three-way receipt", () => {
  const record = buildPaybackDisbursementRecord({
    now: "2026-05-07T00:00:00.000Z",
    manifestBuilder: ({ kind, verdict }) => ({
      kind,
      verdict,
      manifestHash: "sha256:payback",
    }),
    compositePlan: {
      plannedPaybackSats: 60000,
      estimatedOfframpCostSats: 3000,
      route: { reserveChain: "base" },
      recipient: "bc1qexample",
      decisionLog: {
        periodId: "period-1",
        inputs: { grossProfitSatsPeriod: 300000 },
        applied: { baseRatio: 0.2, regime: "neutral", regimeMultiplier: 1, volMultiplier: 1 },
      },
    },
    stepResults: [{
      kind: "gateway_btc_offramp",
      execution: {
        settlementStatus: "delivered",
        signerResult: { broadcast: { txHash: "0xsource" } },
        plan: { order: { orderId: "order-1" } },
        destinationProof: {
          txid: "btc-tx-1",
          observedDelta: 55000,
          proofSource: "bitcoin_address_balance_delta",
        },
      },
    }],
  });

  assert.equal(record.receipt.sourceTxHash, "0xsource");
  assert.equal(record.receipt.gatewayOrderId, "order-1");
  assert.equal(record.receipt.bitcoinTxid, "btc-tx-1");
  assert.equal(record.proofManifestHash, "sha256:payback");
  assert.equal(record.proofManifestKind, "payback_disbursement");
});
```

- [ ] **Step 4: Modify payback disbursement record builder**

In `src/executor/payback/scheduler.mjs`, import:

```js
import { buildProofManifest } from "../../proof/manifest.mjs";
```

Change the signature:

```js
export function buildPaybackDisbursementRecord({
  compositePlan,
  stepResults = [],
  now = new Date().toISOString(),
  manifestBuilder = buildProofManifest,
} = {}) {
```

Before the final `return`, build the manifest:

```js
  const proofManifest = manifestBuilder({
    kind: "payback_disbursement",
    observedAt: now,
    sourcePointers: [
      { kind: "source_tx", id: sourceTxHash, chain: compositePlan.route?.reserveChain || null },
      { kind: "gateway_order", id: gatewayOrderId },
      { kind: "bitcoin_tx", id: bitcoinTxid },
    ],
    artifacts: [{
      kind: "destination_proof",
      sha256: null,
      path: null,
    }],
    redactions: ["raw_wallet_inventory", "raw_signed_transactions"],
    verdict: {
      settlementStatus,
      settledBalanceDeltaSats: Number.isFinite(settledBalanceDeltaSats) ? settledBalanceDeltaSats : null,
    },
  });
```

Add these fields to the returned record:

```js
    proofManifestHash: proofManifest.manifestHash,
    proofManifestKind: proofManifest.kind,
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test test/proof-manifest.test.mjs test/radar-portable-packet.test.mjs test/payback-scheduler.test.mjs
```

Expected:

```text
fail 0
```

- [ ] **Step 6: Commit manifest wiring**

Run:

```bash
git add src/strategy/radar/portable-packet-builder.mjs test/radar-portable-packet.test.mjs src/executor/payback/scheduler.mjs test/payback-scheduler.test.mjs
git commit -m "feat: attach internal proof manifests to evidence records"
```

Expected:

```text
Commit created without changing payback policy, strategy caps, or signer authority.
```

### Task 7: Dev-Agent Lifecycle Reporting

**Files:**
- Modify: `src/strategy/dev-agent-automation-bridge.mjs`
- Modify: `test/dev-agent-automation-bridge.test.mjs`
- Create or modify: `docs/ai-agent-operations.md`

- [ ] **Step 1: Add lifecycle tests**

In `test/dev-agent-automation-bridge.test.mjs`, extend `dev-agent bridge converts remediation work orders into safe coding task specs` with:

```js
  assert.deepEqual(task.lifecycle, {
    stage: "proposed",
    allowedStages: ["proposed", "scoped", "submitted", "validated", "accepted", "rejected"],
    runtimeAuthority: "none",
    requiresCommittedDiff: true,
  });
```

Add a new test:

```js
test("dev-agent lifecycle does not create live execution authority", () => {
  const report = buildDevAgentAutomationBridge({
    routeRemediation: { workOrders: [workOrder()] },
    autonomousDiscoveryBoard: { opportunities: [], summary: { opportunityCount: 0 } },
    now: NOW,
  });

  const [task] = report.tasks;
  assert.equal(task.lifecycle.runtimeAuthority, "none");
  assert.equal(task.safety.allowedToExecuteLive, false);
  assert.equal(task.modelPolicy.llmMayCallSigner, false);
  assert.equal(report.summary.liveExecutableTaskCount, 0);
});
```

- [ ] **Step 2: Implement lifecycle helper**

In `src/strategy/dev-agent-automation-bridge.mjs`, add near `baseSafety`:

```js
const DEV_AGENT_ALLOWED_LIFECYCLE_STAGES = Object.freeze([
  "proposed",
  "scoped",
  "submitted",
  "validated",
  "accepted",
  "rejected",
]);

function reportOnlyLifecycle(stage = "proposed") {
  return {
    stage,
    allowedStages: [...DEV_AGENT_ALLOWED_LIFECYCLE_STAGES],
    runtimeAuthority: "none",
    requiresCommittedDiff: true,
  };
}
```

Add to both `task` objects in `workOrderTask` and `opportunityTask`:

```js
      lifecycle: reportOnlyLifecycle(),
```

- [ ] **Step 3: Document the lifecycle**

Create `docs/ai-agent-operations.md` if it does not exist. If it exists, add this section:

```markdown
## Dev-Agent Lifecycle

The dev-agent lifecycle is report-only. It may describe coding and research task progress with these stages:

- `proposed`
- `scoped`
- `submitted`
- `validated`
- `accepted`
- `rejected`

The lifecycle never grants live execution authority. A task with `runtimeAuthority: "none"` may propose source, tests, reports, or committed config diffs. It may not call the signer, sign transactions, bypass policy, raise caps at runtime, decide payback timing or ratio, mutate `autoExecute` through a side channel, or publish raw wallet/route/inventory artifacts.
```

- [ ] **Step 4: Run focused dev-agent tests**

Run:

```bash
node --test test/dev-agent-automation-bridge.test.mjs test/dev-agent-automation-bridge-cli.test.mjs
```

Expected:

```text
fail 0
```

- [ ] **Step 5: Commit lifecycle reporting**

Run:

```bash
git add src/strategy/dev-agent-automation-bridge.mjs test/dev-agent-automation-bridge.test.mjs docs/ai-agent-operations.md
git commit -m "feat: add report-only dev-agent lifecycle"
```

Expected:

```text
Commit created with no runtime executor, signer, or cap mutation.
```

### Task 8: Signer Simulation Evidence Design

**Files:**
- Create: `docs/research/signer-simulation-evidence-design-2026-05.md`
- Modify in a separate source diff after doc acceptance: `src/executor/signer/evm-local-signer.mjs`
- Modify in a separate source diff after doc acceptance: `src/executor/signer/daemon.mjs`
- Modify in a separate source diff after doc acceptance: `test/evm-local-signer.test.mjs`
- Modify in a separate source diff after doc acceptance: `test/executor-signer-daemon.test.mjs`

- [ ] **Step 1: Create the design note**

Create `docs/research/signer-simulation-evidence-design-2026-05.md`:

```markdown
# Signer Simulation Evidence Design

Status: design accepted before source changes
Date: 2026-05-07

## Goal

Attach signer-adjacent `eth_call` simulation evidence to signed or rejected EVM intent audit records without moving RPC calls into `evaluateIntentPolicies()`.

## Non-Goals

- No RPC calls inside `src/executor/policy/index.mjs`.
- No policy approval based solely on a successful simulation.
- No cap raise, autoExecute flip, payback decision, or signer bypass.
- No raw private key, signed transaction bytes, or secret-bearing calldata in public reports.

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

The signer daemon may call `simulateTransactionCall()` after deterministic policy allows an intent and before broadcast. The result is attached to the audit row. A simulation failure records `simulation.status = "error"` and `simulation.class = classifySimulationError(error)`. Broadcast behavior remains governed by policy, signer, and kill-switch rules.

## Verification

Run:

```bash
node --test test/transaction-read.test.mjs test/evm-local-signer.test.mjs test/executor-signer-daemon.test.mjs test/executor-policy-index.test.mjs
```

Expected:

```text
fail 0
```
```

- [ ] **Step 2: Commit the design note**

Run:

```bash
git add docs/research/signer-simulation-evidence-design-2026-05.md
git commit -m "docs: design signer simulation evidence boundary"
```

Expected:

```text
Commit created as docs-only.
```

### Task 9: Keystore V3 Backend Research

**Files:**
- Create: `docs/research/evm-keystore-v3-signer-backend-design.md`

- [ ] **Step 1: Write research design**

Create `docs/research/evm-keystore-v3-signer-backend-design.md`:

```markdown
# EVM Keystore V3 Signer Backend Design

Status: research only
Date: 2026-05-07

## Decision

Do not replace `BURNER_EVM_KEY_PATH` private-key file loading in this diff. Keystore V3 can be evaluated as an optional signer backend only after password source, OS keychain behavior, file permissions, and daemon restart behavior are specified and tested.

## Why This Is Not A BNBAgent Runtime Adoption

BNBAgent SDK's wallet provider keeps app-level encrypted keystore convenience near its agent runtime. BOB Claw keeps private keys inside signer daemon boundaries. A Keystore V3 backend must preserve that boundary.

## Required Properties

- Key material is still read only by `src/executor/signer/*`.
- Keystore JSON path is supplied by env path indirection.
- Password is supplied by OS keychain command or a file path with `0600` permissions.
- No password value appears in CLI args, logs, audit rows, dashboard JSON, data artifacts, or LLM context.
- Unit tests use fixture keystores and fixture passwords only.
- The default live backend remains unchanged until explicit operator approval.

## Proposed Backend Shape

```js
export class EvmKeystoreV3SignerBackend {
  constructor({ keystorePath, passwordReader, walletFactory }) {}
  async privateKey() {}
}
```

## Verification Commands For A Source Diff

```bash
node --test test/evm-keystore-v3-signer-backend.test.mjs test/evm-local-signer.test.mjs
npm run ops:runtime-readiness:json
```

## Rejection Conditions

- Password passed in command-line args.
- Password or decrypted private key included in thrown error messages.
- Keystore backend imported outside signer modules.
- Dashboard/data/report surface includes raw keystore contents.
```

- [ ] **Step 2: Commit research design**

Run:

```bash
git add docs/research/evm-keystore-v3-signer-backend-design.md
git commit -m "docs: define keystore v3 signer backend constraints"
```

Expected:

```text
Commit created as docs-only.
```

### Task 10: Full Verification And Rollout Decision

**Files:**
- Verify: all files touched by Tasks 1-9

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test test/evm-local-signer.test.mjs test/transaction-submit.test.mjs test/multicall3-availability.test.mjs test/multicall3.test.mjs test/evm-balance-batch-reader.test.mjs test/proof-manifest.test.mjs test/radar-portable-packet.test.mjs test/payback-scheduler.test.mjs test/dev-agent-automation-bridge.test.mjs test/dev-agent-automation-bridge-cli.test.mjs test/executor-policy-index.test.mjs
```

Expected:

```text
fail 0
```

- [ ] **Step 2: Run repository checks**

Run:

```bash
npm run check
npm test
npm run graph:focus -- status
```

Expected:

```text
All commands exit 0.
Graph focus may report a root stale marker; it must not report app needs_update yes.
```

- [ ] **Step 3: Confirm no forbidden adoption**

Run:

```bash
rg -n "bnbagent|BNBAgent|BSC Testnet|UMA|paymaster|ERC-4337|IPFS" src test package.json docs/superpowers/plans/2026-05-07-bnbagent-pattern-adoption.md
```

Expected:

```text
Only docs and this plan may mention BNBAgent, BSC Testnet, UMA, paymaster, ERC-4337, or IPFS.
No source file imports BNBAgent SDK.
```

- [ ] **Step 4: Confirm no BNB/BSC privilege**

Run:

```bash
rg -n "OFFICIAL_GATEWAY_DESTINATION_CHAINS|bsc|bnb" src/evm src/lib src/treasury src/strategy/radar src/executor/payback test/multicall3-availability.test.mjs test/multicall3.test.mjs test/evm-balance-batch-reader.test.mjs
```

Expected:

```text
Gateway-wide modules import or consume OFFICIAL_GATEWAY_DESTINATION_CHAINS.
BSC appears only as one chain among official destinations or fixture data.
```

- [ ] **Step 5: Confirm no runtime authority leak**

Run:

```bash
rg -n "autoExecute|perTxUsd|tinyLivePerTxUsd|BURNER_EVM_KEY_PATH|BURNER_PRIVATE_KEY_PATH|signer|policy|payback" src/proof src/lib src/evm/multicall3-availability.mjs src/treasury/evm-balance-batch-reader.mjs src/strategy/dev-agent-automation-bridge.mjs
```

Expected:

```text
`src/proof`, `src/lib/multicall3.mjs`, `src/evm/multicall3-availability.mjs`, and `src/treasury/evm-balance-batch-reader.mjs` do not import signer, strategy caps, payback config, or policy modules.
`src/strategy/dev-agent-automation-bridge.mjs` may contain safety text that denies signer/policy bypass.
```

- [ ] **Step 6: Rollout decision**

If all checks pass, merge the commits as a bounded pattern-adoption branch. If any check fails, stop at the failing task and fix the loophole before running Task 10 again.

## Final Acceptance Criteria

- BOB Claw has no BNBAgent SDK runtime dependency.
- No source file privileges BNB/BSC over the 11 official Gateway destinations.
- Signer recognizes `replacement transaction underpriced` as an already-propagated raw transaction class.
- Multicall3 is read-only, availability-gated, and fallback-safe.
- Proof manifests are internal hashes and do not publish raw artifacts or replace receipt proof.
- Payback still requires source tx, Gateway order id, and Bitcoin L1 destination proof.
- Dev-agent lifecycle is report-only with `runtimeAuthority: "none"`.
- Keystore V3 remains research-only until a separate key-custody diff is approved.
- Focused tests, `npm run check`, `npm test`, and `npm run graph:focus -- status` have all passed.
