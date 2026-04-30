# Radar Live Canary Aggressive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote Onchain Opportunity Radar from a read-only board into an aggressive tiny-live-canary router that validates positive realized PnL and routes a configured share of profit into BTC payback.

**Architecture:** Radar remains a proposer only: it never signs, never mutates caps, and never bypasses the deterministic policy engine. Strategy graduation is based on realized net PnL after measured costs; BTC/sats accounting remains mandatory for reporting, payback sizing, and settlement proof. Cap raises are advisory via `radar:cap-review` and require committed config diffs.

**Tech Stack:** Node.js ESM, `node:test`, pure policy functions, private JSONL under `data/radar`, existing proposer -> policy -> signer pipeline, dashboard public status slice.

---

## Operating Principles

- Trade admission: expected realized net PnL after reward haircut, gas, bridge, claim, swap, slippage, and unwind costs must be positive.
- BTC role: a configured share of realized positive PnL is converted into native BTC as payback. BTC-relative underperformance is reported, not always a hard blocker.
- Cap memory: the operator does not remember cap raise timing. `npm run radar:cap-review` and the dashboard surface candidates.
- Cap control: all cap raises remain committed diffs to `src/config/strategy-caps.mjs`.
- Runtime safety: no LLM signing, no key exposure, kill-switch/watchdog/audit append-only remain unchanged.

---

## File Map

- Modify: `AGENTS.md` — operator override, PnL/payback interpretation, radar sleeve caps, LLM permission row.
- Modify: `docs/research/onchain-opportunity-radar.md` — Phase 6 router, cap review, PnL-vs-BTC accounting.
- Modify: `docs/dashboard-context.md` — public radar/cap-review status fields.
- Modify: `src/config/radar-policy.mjs` — aggressive v1 thresholds when router is ready.
- Modify: `src/config/small-capital-campaign-mode.mjs` — `radarLane` caps and graduation ladder.
- Modify: `src/config/strategy-caps.mjs` — exact failed-gas key, required validator fields, tiny cap declarations.
- Modify: `src/executor/policy/opportunity-policy.mjs` — remove generic `deposit` movement exemption and use dynamic hold days.
- Create: `src/strategy/radar/family-binding-registry.mjs` — candidate family -> existing strategy binding.
- Create: `src/strategy/radar/cost-ledger.mjs` — p50/p90 realized gas/bridge/claim/swap cost lookup.
- Create: `src/strategy/radar/pnl-ev-gate.mjs` — realized-net-PnL EV computation with BTC conversion metadata.
- Create: `src/strategy/radar/radar-candidate-router.mjs` — executable candidate -> tiny live canary intent.
- Create: `src/strategy/radar/cap-graduation-review.mjs` — receipt-backed cap raise recommendations.
- Create: `src/cli/radar-promote.mjs` — `--preview` and `--execute` router CLI.
- Create: `src/cli/report-radar-cap-review.mjs` — advisory cap review CLI.
- Modify: `src/status/radar-slice.mjs` and `src/status/dashboard-status.mjs` — dashboard summary fields only.
- Modify: `dashboard/public/app.jsx` and generated `dashboard/public/app.js` — show radar cap-review status without raw data.
- Test: `test/radar-*.test.mjs`, `test/opportunity-policy.test.mjs`, `test/strategy-caps-typo.test.mjs`, `test/dashboard-*.test.mjs`.

---

### Task 1: Lock Policy Wording And Existing Safety Bugs

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/research/onchain-opportunity-radar.md`
- Modify: `docs/dashboard-context.md`
- Modify: `src/config/strategy-caps.mjs`
- Modify: `src/executor/policy/opportunity-policy.mjs`
- Test: `test/strategy-caps-typo.test.mjs`
- Test: `test/opportunity-policy.test.mjs`

- [x] **Step 1: Write failing tests**

Required behaviors:

```js
// test/strategy-caps-typo.test.mjs
assert.equal(Object.hasOwn(config.caps || {}, "maxFailedGasCost24HUsd"), false);
assert.equal(Number.isFinite(config.caps?.maxFailedGasCost24hUsd), true);
```

```js
// test/opportunity-policy.test.mjs
const result = await evaluateOpportunityPolicy({
  intent: makeIntent({
    chain: "bsc",
    intentType: "deposit",
    amountUsd: 25,
    displayedApr: 100,
    apr: 100,
    rewardTokenType: "stable",
    expectedHoldDays: 1,
    estimatedCostsUsd: 0,
    estimatedBridgeCostUsd: 0,
  }),
  capitalState: { totalDeployableCapital: 1000 },
  killSwitchExistsImpl: async () => false,
});
assert.equal(result.decision, "BLOCK");
assert.ok(result.blockers.includes("non_base_entry_insufficient_expected_net"));
```

- [x] **Step 2: Verify RED**

Run:

```bash
node --test test/strategy-caps-typo.test.mjs test/opportunity-policy.test.mjs test/radar-realization.test.mjs
```

Expected before implementation: failed-gas key typo, generic `deposit` ALLOW, and missing PnL summary fields fail.

- [x] **Step 3: Implement minimal fixes**

Implementation requirements:

```js
// src/executor/policy/opportunity-policy.mjs
const movementTypes = new Set([
  "bridge", "withdraw", "rebalance", "exit", "harvest_yield",
  "scale_up", "capital_rebalance", "capital_drain", "refill", "consolidation",
  "erc4626_redeem", "aave_withdraw", "euler_evault_withdraw",
]);
```

```js
// src/config/strategy-caps.mjs
for (const field of ["perTxUsd", "perDayUsd", "maxDailyLossUsd", "maxFailedGasCost24hUsd"]) {
  if (!isFiniteNumber(config.caps[field])) {
    errors.push(`caps.${field} must be a finite number`);
  }
}
```

- [x] **Step 4: Verify GREEN**

Run:

```bash
node --test test/strategy-caps-typo.test.mjs test/opportunity-policy.test.mjs test/radar-realization.test.mjs
```

Expected: all targeted tests pass.

---

### Task 2: Separate Realized PnL From BTC-Relative Reporting

**Files:**
- Modify: `src/strategy/radar/realization-record-ingest.mjs`
- Modify: `src/strategy/radar/radar-board.mjs`
- Modify: `src/status/radar-slice.mjs`
- Test: `test/radar-realization.test.mjs`
- Test: `test/radar-board.test.mjs`
- Test: `test/radar-dashboard-slice.test.mjs`

- [x] **Step 1: Write failing tests**

Required behavior:

```js
const realized = buildOpportunityRealizationRecord({
  ...baseRecord,
  netRealizedPnlUsd: 2.5,
  netRealizedPnlSats: "-500",
}).record;
const summary = summarizeRealizationRecords([realized]);
assert.equal(summary.positiveRealizedPnlCount, 1);
assert.equal(summary.totalNetRealizedPnlUsd, 2.5);
assert.equal(summary.totalNetRealizedPnlSats, "-500");
```

- [x] **Step 2: Verify RED**

Run:

```bash
node --test test/radar-realization.test.mjs test/radar-board.test.mjs test/radar-dashboard-slice.test.mjs
```

Expected before implementation: missing `positiveRealizedPnlCount` and USD PnL fields.

- [x] **Step 3: Implement summary fields**

Implementation requirements:

```js
return {
  recordCount: records.length,
  strategyRealizedCount,
  positiveRealizedPnlCount,
  paybackDeliveredCount,
  pendingPaybackDeliveryCount: Math.max(0, strategyRealizedCount - paybackDeliveredCount),
  totalNetRealizedPnlUsd: usdSum(strategyRealizedRecords),
  totalNetRealizedPnlSats: satsSum(strategyRealizedRecords),
};
```

- [x] **Step 4: Verify GREEN**

Run:

```bash
node --test test/radar-realization.test.mjs test/radar-board.test.mjs test/radar-dashboard-slice.test.mjs
```

Expected: all targeted tests pass.

---

### Task 3: Add Cap Graduation Memory

**Files:**
- Modify: `src/config/small-capital-campaign-mode.mjs`
- Create: `src/strategy/radar/cap-graduation-review.mjs`
- Create: `src/cli/report-radar-cap-review.mjs`
- Modify: `package.json`
- Test: `test/small-capital-campaign-mode.test.mjs`
- Test: `test/radar-cap-graduation-review.test.mjs`
- Test: `test/radar-cli.test.mjs`

- [x] **Step 1: Write failing tests**

Required behavior:

```js
const review = buildRadarCapGraduationReview({
  realizationRecords: [recordA, recordB],
  strategyCapsById: {
    "wrapped-btc-loop-base-moonwell": { caps: { tinyLivePerTxUsd: 25 } },
  },
});
assert.equal(review.candidates[0].eligible, true);
assert.equal(review.candidates[0].suggestedNextTinyLivePerTxUsd, 50);
assert.equal(review.candidates[0].requiresCommittedDiff, true);
assert.equal(review.candidates[0].autoRaise, false);
```

- [x] **Step 2: Verify RED**

Run:

```bash
node --test test/small-capital-campaign-mode.test.mjs test/radar-cap-graduation-review.test.mjs test/radar-cli.test.mjs
```

Expected before implementation: missing `radarLane`, missing module, missing CLI.

- [x] **Step 3: Implement cap review**

Implementation requirements:

```js
export const SMALL_CAPITAL_CAMPAIGN_MODE = Object.freeze({
  radarLane: Object.freeze({
    enabled: true,
    perCanaryUsd: 30,
    perDayUsd: 90,
    cumulativeOpenUsd: 200,
    maxConcurrentOpen: 6,
    realizedDailyLossLockUsd: 25,
    capGraduationUsd: Object.freeze([10, 25, 50, 80, 100]),
  }),
});
```

`buildRadarCapGraduationReview` must group realized records by strategy/family, require two positive realized PnL records, require two distinct windows/opportunities, check 24h realized loss lock, and return advisory output only.

- [x] **Step 4: Add CLI**

Run format:

```bash
npm run radar:cap-review -- --data-dir=data --write=data/radar-cap-review.json
```

Expected output:

```text
capRaiseCandidates=<n>
radarLossLock=clear|TRIPPED
```

- [x] **Step 5: Verify GREEN**

Run:

```bash
node --test test/small-capital-campaign-mode.test.mjs test/radar-cap-graduation-review.test.mjs test/radar-cli.test.mjs
```

Expected: all targeted tests pass.

---

### Task 4: Dashboard Cap Review Surface

**Files:**
- Modify: `src/status/radar-slice.mjs`
- Modify: `src/status/dashboard-status.mjs`
- Modify: `src/status/current-dashboard-context.mjs`
- Modify: `dashboard/public/app.jsx`
- Generate: `dashboard/public/app.js`
- Test: `test/radar-dashboard-slice.test.mjs`
- Test: `test/dashboard-status.test.mjs`
- Test: `test/dashboard-app.test.mjs`

- [x] **Step 1: Write failing tests**

Required public fields:

```js
assert.equal(status.radar.capReview.eligibleCount, 1);
assert.equal(status.radar.capReview.topSuggestedNextTinyLivePerTxUsd, 50);
assert.equal(status.dataCounts.radarCapRaiseCandidates, 1);
```

- [x] **Step 2: Verify RED**

Run:

```bash
node --test test/radar-dashboard-slice.test.mjs test/dashboard-status.test.mjs test/dashboard-app.test.mjs
```

Expected before implementation: `capReview` is undefined.

- [x] **Step 3: Implement dashboard slice**

Public slice must include only summary fields:

```js
capReview: {
  candidateCount,
  eligibleCount,
  lossLockOn,
  topSuggestedNextTinyLivePerTxUsd,
  requiresCommittedDiff,
  autoRaise: false,
}
```

- [x] **Step 4: Build dashboard bundle**

Run:

```bash
npm run dashboard:build -- --quiet
```

Expected: generated `dashboard/public/app.js` matches `app.jsx`.

---

### Task 5: Router Family Binding

**Files:**
- Create: `src/strategy/radar/family-binding-registry.mjs`
- Test: `test/radar-router.test.mjs`

- [x] **Step 1: Write failing tests**

Required behavior:

```js
assert.deepEqual(resolveFamilyBinding({ familyKey: "wrapped_btc_direct_lending" }), {
  strategyId: "wrapped-btc-loop-base-moonwell",
  intentType: "erc4626_deposit",
  defaultHoldDays: 21,
});
assert.equal(resolveFamilyBinding({ familyKey: "cl_managed_required" }), null);
assert.equal(resolveFamilyBinding({ familyKey: "point_or_pre_tge" }), null);
```

- [x] **Step 2: Verify RED**

Run:

```bash
node --test test/radar-router.test.mjs
```

Expected: module missing.

- [x] **Step 3: Implement bindings**

Create `FAMILY_BINDINGS` with:

```js
wrapped_btc_direct_lending -> wrapped-btc-loop-base-moonwell / erc4626_deposit
btc_collateral_stable_borrow -> wrapped-btc-loop-base-moonwell / leverage_loop_step
same_chain_stable_carry -> stablecoin_spread_loop / erc4626_deposit
pendle_pt_btc -> pendle-pt-lbtc-base / pendle_pt_buy
cl_managed_required -> null
point_or_pre_tge -> null
```

---

### Task 6: PnL EV Gate And Cost Ledger

**Files:**
- Create: `src/strategy/radar/cost-ledger.mjs`
- Create: `src/strategy/radar/pnl-ev-gate.mjs`
- Test: `test/radar-pnl-ev-gate.test.mjs`

- [x] **Step 1: Write failing tests**

Required behavior:

```js
const ev = computeRealizedPnlEv({
  candidate: { displayedAprPct: 120, rewardTokenType: "stable", chain: "base" },
  positionUsd: 30,
  holdDays: 3,
  costLedger: fixtureCostLedger({ p90GasUsd: 0.12, p90ClaimUsd: 0.1, p90SwapUsd: 0.1 }),
});
assert.equal(ev.expectedNetPnlUsd > 0, true);
assert.equal(ev.btcAccountingRequired, true);
```

- [x] **Step 2: Verify RED**

Run:

```bash
node --test test/radar-pnl-ev-gate.test.mjs
```

Expected: module missing.

- [x] **Step 3: Implement cost lookup**

`cost-ledger` reads signer/receipt records and returns p90 values. If sample count `< 20`, multiply fallback cost by `1.5`.

- [x] **Step 4: Implement EV gate**

Use realized net PnL:

```js
grossRewardUsd = positionUsd * displayedAprDecimal * holdYearFraction
haircutRewardUsd = applyRewardHaircut(rewardTokenType, grossRewardUsd)
expectedNetPnlUsd = haircutRewardUsd - p90GasUsd - p90BridgeUsd - p90ClaimUsd - p90SwapUsd
```

Reject when `expectedNetPnlUsd <= costVarianceBufferUsd`.

---

### Task 7: Radar Candidate Router And CLI

**Files:**
- Create: `src/strategy/radar/radar-candidate-router.mjs`
- Create: `src/cli/radar-promote.mjs`
- Modify: `package.json`
- Test: `test/radar-router.test.mjs`
- Test: `test/radar-cli.test.mjs`

- [x] **Step 1: Write failing tests**

Required behavior:

```js
const result = buildRadarCanaryIntent({ packet, candidate, policy, costLedger });
assert.equal(result.status, "ready");
assert.equal(result.intent.intentType, "tiny_live_canary");
assert.equal(result.intent.metadata.radarCandidateId, candidate.candidateId);
assert.equal(result.intent.amountUsd <= caps.tinyLivePerTxUsd, true);
```

- [x] **Step 2: Verify RED**

Run:

```bash
node --test test/radar-router.test.mjs test/radar-cli.test.mjs
```

Expected: router and CLI missing.

- [x] **Step 3: Implement preview mode**

`npm run radar:promote -- --preview` prints ready/blocker counts and never writes queue files.

- [x] **Step 4: Implement execute mode**

`npm run radar:promote -- --execute --write=data/radar-canary-queue.json` writes canary intents only after existing executable gate, binding, tiny cap, EV, kill-switch state, and cap review checks pass.

---

### Task 8: Merkl Autopilot Policy Hook

**Files:**
- Modify: `src/executor/merkl-canary-autopilot.mjs`
- Test: `test/merkl-canary-autopilot.test.mjs`

- [x] **Step 1: Write failing tests**

Required behavior:

```js
const result = await runMerklCanaryAutopilot({
  queue: [genericDepositCandidate],
  evaluateOpportunityPolicyImpl: async () => ({
    decision: "BLOCK",
    blockers: ["non_base_entry_insufficient_expected_net"],
  }),
});
assert.equal(result.results[0].status, "blocked");
```

- [x] **Step 2: Verify RED**

Run:

```bash
node --test test/merkl-canary-autopilot.test.mjs
```

Expected before implementation: autopilot sizes/builds plan without opportunity policy hook.

- [x] **Step 3: Implement hook**

Call `evaluateOpportunityPolicy` after sizing and before plan build. If policy returns `BLOCK`, set sizing to zero and propagate blockers.

---

### Task 9: Radar Lock And Loss Guard

**Files:**
- Create or modify: `src/risk/radar-loss-lock.mjs`
- Modify: relevant all-chain/radar autopilot caller
- Test: `test/radar-loss-lock.test.mjs`

- [x] **Step 1: Write failing tests**

Required behavior:

```js
const result = evaluateRadarLossLock({
  realizationRecords: [lossRecord],
  now,
  thresholdUsd: 25,
});
assert.equal(result.tripped, true);
assert.equal(result.lockPath, process.env.RADAR_LOCK_PATH || "~/.bob-claw/RADAR_LOCK");
```

- [x] **Step 2: Implement file flag**

`$RADAR_LOCK_PATH` blocks radar router only. It must not halt payback or non-radar live strategies; `$KILL_SWITCH_PATH` still halts everything.

---

### Task 10: Final Verification

**Files:**
- All modified source and tests.

- [x] **Step 1: Run targeted tests**

```bash
node --test test/radar-*.test.mjs test/opportunity-policy.test.mjs test/strategy-caps-typo.test.mjs test/small-capital-campaign-mode.test.mjs test/merkl-canary-autopilot.test.mjs test/dashboard-status.test.mjs test/dashboard-app.test.mjs
```

- [x] **Step 2: Run syntax checks**

```bash
node --check src/strategy/radar/cap-graduation-review.mjs
node --check src/cli/report-radar-cap-review.mjs
node --check src/status/radar-slice.mjs
node --check src/status/dashboard-status.mjs
node --check src/status/current-dashboard-context.mjs
node --check dashboard/public/app.js
```

- [x] **Step 3: Build dashboard**

```bash
npm run dashboard:build -- --quiet
```

- [x] **Step 4: Diff hygiene**

```bash
git diff --check
```

Expected: no whitespace errors.
