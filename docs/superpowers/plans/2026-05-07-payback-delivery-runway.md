# Payback Delivery Runway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, BTC-first runway from live Merkl/canary profit creation to native-BTC payback delivery without changing caps, signer rules, kill-switch rules, or payback policy.

**Architecture:** Keep execution ownership unchanged: Merkl/canary creates receipt-backed realized PnL, the payback accumulator books sats, the payback scheduler plans the configured share, and Gateway/offramp helpers deliver native BTC only through policy and signer approval. Add a read-only runway report that joins the current payback gap with allocator/canary EV blockers so the next automation action is explicit.

**Tech Stack:** Node `.mjs`, pure-function report helpers, existing `node:test`, existing payback scheduler/accumulator/dashboard modules, existing Merkl allocator and canary reports.

---

### Task 1: Current State Gate

**Files:**
- Read: `src/executor/payback/scheduler.mjs`
- Read: `src/executor/payback/dashboard.mjs`
- Read: `src/executor/merkl-portfolio-allocator.mjs`
- Read: `src/executor/merkl-canary-autopilot.mjs`

- [x] **Step 1: Confirm current payback blocker**

Run:

```bash
npm run report:payback-status -- --json
```

Expected current state:

```text
payback.scheduler.status = carry
payback.scheduler.reason = planned_payback_below_minimum
grossProfitSatsPeriod = 601
minimum.requiredGrossProfitSats = 250000
minimum.grossTargetBeforeCostsSats = 120
minimum.satsToMinimumPayback = 49880
```

- [x] **Step 2: Confirm current profit-creation blockers**

Read latest Merkl/canary reports:

```bash
data/merkl-portfolio-allocator-latest.json
data/merkl-canary-autopilot-latest.json
data/all-chain-autopilot-latest.json
```

Expected current blockers:

```text
same_chain_unprofitable:need_$10_on_optimism
same_chain_unprofitable:need_$9_on_sei
```

### Task 2: Add BTC-First Payback Runway Helper

**Files:**
- Create: `src/executor/payback/delivery-runway.mjs`
- Test: `test/payback-delivery-runway.test.mjs`

- [x] **Step 1: Write tests**

Test cases:

```js
test("runway prioritizes profit creation when payback is below minimum", () => {
  const report = buildPaybackDeliveryRunway({
    paybackStatus: {
      payback: {
        grossProfitSatsPeriod: 601,
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
          minimumPaybackProgress: {
            grossTargetBeforeCostsSats: 120,
            minPaybackSats: 50000,
            requiredGrossProfitSats: 250000,
            satsToMinimumPayback: 49880,
            progressToMinimumRatio: 0.0024,
          },
        },
      },
    },
    merklCanaryReport: {
      summary: {
        topBlocker: "same_chain_unprofitable:need_$10_on_optimism",
        topEvGate: {
          blocker: "same_chain_unprofitable:need_$10_on_optimism",
          currentAmountUsd: 2.86,
          neededUsd: 9.96,
          limitingFactor: "inventory",
        },
      },
    },
  });
  assert.equal(report.status, "profit_creation_required");
  assert.equal(report.blockers[0].code, "planned_payback_below_minimum");
  assert.equal(report.nextActions[0].code, "create_payback_eligible_realized_pnl");
});
```

```js
test("runway marks payback delivery ready when composite preview is ready", () => {
  const report = buildPaybackDeliveryRunway({
    paybackStatus: {
      payback: {
        grossProfitSatsPeriod: 300000,
        scheduler: { status: "plan", reason: "planning_required" },
      },
      compositePreview: {
        status: "ready",
        stepCount: 2,
        plannedPaybackSats: 55000,
        estimatedOfframpCostSats: 4000,
      },
    },
  });
  assert.equal(report.status, "payback_delivery_ready");
  assert.equal(report.nextActions[0].code, "run_payback_scheduler_execute");
});
```

- [x] **Step 2: Implement pure helper**

Implementation requirements:

```js
export function buildPaybackDeliveryRunway({
  paybackStatus = null,
  merklAllocatorReport = null,
  merklCanaryReport = null,
  allChainReport = null,
  now = new Date().toISOString(),
} = {}) {
  return {
    schemaVersion: 1,
    observedAt: now,
    finalGoal: "native_btc_payback_delivery",
    status,
    current,
    profitCreation,
    deliveryPath,
    blockers,
    nextActions,
  };
}
```

No execution, no signer calls, no cap/policy changes.

### Task 3: Wire Runway Into Payback Status CLI

**Files:**
- Modify: `src/cli/report-payback-status.mjs`
- Modify: `test/payback-status-cli.test.mjs`

- [x] **Step 1: Load optional latest reports**

Read these optional JSON files from `config.dataDir`:

```text
merkl-portfolio-allocator-latest.json
merkl-canary-autopilot-latest.json
all-chain-autopilot-latest.json
```

Missing files must not fail the CLI.

- [x] **Step 2: Add `runway` to JSON output**

Expected shape:

```json
{
  "runway": {
    "finalGoal": "native_btc_payback_delivery",
    "status": "profit_creation_required",
    "current": {
      "grossProfitSatsPeriod": 601,
      "grossTargetBeforeCostsSats": 120,
      "minPaybackSats": 50000,
      "requiredGrossProfitSats": 250000,
      "satsToMinimumPayback": 49880
    }
  }
}
```

- [x] **Step 3: Add text output lines**

Add concise lines:

```text
runwayStatus=profit_creation_required
runwayGoal=native_btc_payback_delivery
runwayNext=create_payback_eligible_realized_pnl
```

### Task 4: Verify

**Files:**
- Test: `test/payback-delivery-runway.test.mjs`
- Test: `test/payback-status-cli.test.mjs`
- Test: `test/payback-scheduler.test.mjs`
- Test: `test/payback-dashboard.test.mjs`

- [x] **Step 1: Focused tests**

Run:

```bash
node --test test/payback-delivery-runway.test.mjs test/payback-status-cli.test.mjs test/payback-scheduler.test.mjs test/payback-dashboard.test.mjs
```

Expected:

```text
fail 0
```

- [x] **Step 2: Repo checks**

Run:

```bash
npm run check
npm test
```

Expected:

```text
check exits 0
test fail 0
```

### Task 5: Operational Handoff

**Files:**
- Read: `data/payback-scheduler-tick-latest.json`
- Read: `data/merkl-portfolio-allocator-latest.json`
- Read: `data/merkl-canary-autopilot-latest.json`

- [x] **Step 1: Report current live blocker**

Expected current blocker summary:

```text
payback is below minimum because realized payback-eligible PnL is too low.
next action is not payback execution; next action is payback-eligible realized PnL creation.
```

- [x] **Step 2: Preserve safety invariants**

Must remain true:

```text
No cap raise.
No payback policy change.
No signer bypass.
No kill-switch/dev-lock mutation.
No audit log rewrite.
No runtime LLM decision.
```
