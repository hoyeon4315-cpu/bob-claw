import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  buildEvCostModel,
  evGate,
} from "../src/executor/policy/ev-gate.mjs";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";
import { executionEvFallbackCostUsd, tinyCanarySameChainRoundTripCostUsd } from "../src/config/sizing.mjs";
import { stableSerialize } from "../src/execution/journal.mjs";

function sha256(value) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function makeAuditRecord({
  txHash,
  strategyId = "across-bridge",
  chain = "base",
  intentType = "swap",
  timestamp = "2026-05-01T00:00:00.000Z",
} = {}) {
  return {
    timestamp,
    strategyId,
    chain,
    intent: { intentType },
    lifecycle: { stage: "confirmed", txHash },
    broadcast: { txHash },
  };
}

function makeReceiptRecord({
  txHash,
  chain = "base",
  costUsd = 0.1,
  observedAt = "2026-05-01T00:00:00.000Z",
} = {}) {
  return {
    observedAt,
    chain,
    txHash,
    kind: "route_execution",
    routeContext: { estimatedNetPnlUsd: 0.5 },
    realized: {
      actualKnownCostUsd: costUsd,
      realizedNetPnlUsd: 0.2,
    },
  };
}

function makeHistory(costsUsd, overrides = {}) {
  const receiptRecords = [];
  const auditRecords = [];
  for (const [index, costUsd] of costsUsd.entries()) {
    const txHash = `0x${(index + 1).toString(16).padStart(64, "0")}`;
    const observedAt = new Date(Date.UTC(2026, 4, index + 1)).toISOString();
    receiptRecords.push(makeReceiptRecord({ txHash, costUsd, observedAt, chain: overrides.chain || "base" }));
    auditRecords.push(
      makeAuditRecord({
        txHash,
        strategyId: overrides.strategyId || "across-bridge",
        chain: overrides.chain || "base",
        intentType: overrides.intentType || "swap",
        timestamp: observedAt,
      }),
    );
  }
  return { receiptRecords, auditRecords };
}

function makeIntent(overrides = {}) {
  return {
    strategyId: "across-bridge",
    chain: "base",
    family: "evm",
    intentType: "swap",
    amountUsd: 100,
    expectedNetUsd: 1,
    observedAt: "2026-05-15T00:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

test("evGate allows high-EV intent when expected net clears history-backed p90", () => {
  const history = makeHistory([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);
  const verdict = evGate(
    makeIntent({ expectedNetUsd: 1.01 }),
    history,
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, true);
  assert.equal(verdict.evidence.costSource, "history_p90");
  assert.equal(verdict.evidence.p90CostUsd, 0.9);
});

test("evGate rejects marginal EV when expected net is at the receipt-backed threshold", () => {
  const history = makeHistory([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);
  const verdict = evGate(
    makeIntent({ expectedNetUsd: 0.9 }),
    history,
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, false);
  assert.deepEqual(verdict.blockers, ["expected_net_below_receipt_cost_p90_floor"]);
  assert.equal(verdict.evidence.requiredNetUsd, 0.9);
});

test("evGate rejects non-safety live intents when expected net is unmeasured", () => {
  const verdict = evGate(
    makeIntent({ expectedNetUsd: undefined }),
    makeHistory([]),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, false);
  assert.deepEqual(verdict.blockers, ["expected_net_unmeasured"]);
  assert.equal(verdict.evidence.blockReason, "expected_net_required_for_live_intent");
});

test("evGate allows transport plumbing without expectedNetUsd as zero-PnL surface", () => {
  const verdict = evGate(
    makeIntent({
      intentType: "gateway_btc_transfer",
      expectedNetUsd: undefined,
      metadata: {},
    }),
    makeHistory([]),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, true);
  assert.deepEqual(verdict.blockers, []);
  assert.equal(verdict.evidence.bypassReason, "transport_plumbing_zero_pnl_surface");
});

test("evGate keeps normal EV pass/fail when transport plumbing carries expectedNetUsd", () => {
  const verdict = evGate(
    makeIntent({
      intentType: "gateway_btc_transfer",
      expectedNetUsd: 0,
    }),
    makeHistory([], { intentType: "gateway_btc_transfer" }),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, false);
  assert.deepEqual(verdict.blockers, ["expected_net_below_receipt_cost_p90_floor"]);
  assert.notEqual(verdict.evidence.bypassReason, "transport_plumbing_zero_pnl_surface");
});

test("evGate accepts expectedNetProfitUsd aliases from campaign proposers", () => {
  const verdict = evGate(
    makeIntent({
      expectedNetUsd: undefined,
      expectedNetProfitUsd: 1.01,
    }),
    makeHistory([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, true);
  assert.equal(verdict.evidence.expectedNetUsd, 1.01);
});

test("evGate accepts metadata expectedNetProfitUsd aliases from campaign proposers", () => {
  const verdict = evGate(
    makeIntent({
      expectedNetUsd: undefined,
      metadata: { expectedNetProfitUsd: 1.01 },
    }),
    makeHistory([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, true);
  assert.equal(verdict.evidence.expectedNetUsd, 1.01);
});

test("evGate falls back to committed chain p99 cost when sample history is sparse", () => {
  const history = makeHistory([0.01, 0.02], { chain: "bsc" });
  const fallbackP99CostUsd = executionEvFallbackCostUsd({ chain: "bsc" });
  const verdict = evGate(
    makeIntent({
      chain: "bsc",
      expectedNetUsd: fallbackP99CostUsd,
    }),
    history,
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, false);
  assert.equal(verdict.evidence.costSource, "fallback_chain_p99");
  assert.equal(verdict.evidence.fallbackP99CostUsd, fallbackP99CostUsd);
});

test("evGate allows safety-critical unmeasured emergency unwinds", () => {
  const verdict = evGate(
    makeIntent({
      intentType: "emergency_unwind",
      executionReason: "risk_unwind",
      expectedNetUsd: undefined,
    }),
    makeHistory([]),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, true);
  assert.deepEqual(verdict.blockers, []);
  assert.equal(verdict.evidence.bypassReason, "safety_critical_intent");
});

test("evGate allows exact approval children only with matching parent EV evidence and hash", () => {
  const parentIntent = {
    strategyId: "across-bridge",
    chain: "base",
    intentType: "swap",
    expectedNetUsd: 1.2,
    approval: {
      token: "0x0000000000000000000000000000000000000001",
      spender: "0x0000000000000000000000000000000000000002",
      amount: "1000000",
      mode: "per_tx",
    },
  };
  const parentEvEvidence = {
    allow: true,
    strategyId: "across-bridge",
    chain: "base",
    expectedNetUsd: 1.2,
    requiredNetUsd: 0.9,
  };
  const verdict = evGate(
    makeIntent({
      intentType: "approve_exact",
      expectedNetUsd: undefined,
      approval: {
        mode: "per_tx",
        token: "0x0000000000000000000000000000000000000001",
        spender: "0x0000000000000000000000000000000000000002",
        amount: "1000000",
      },
      metadata: {
        parentIntentHash: sha256(parentIntent),
        parentEvEvidenceHash: sha256(parentEvEvidence),
        parentIntent,
        parentEvEvidence,
      },
    }),
    makeHistory([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, true);
  assert.deepEqual(verdict.blockers, []);
  assert.equal(verdict.evidence.bypassReason, "parent_ev_approved_exact_approval");
});

test("evGate rejects spoofed parent approval hashes", () => {
  const verdict = evGate(
    makeIntent({
      intentType: "approve_exact",
      expectedNetUsd: undefined,
      approval: {
        mode: "per_tx",
        token: "0x0000000000000000000000000000000000000001",
        spender: "0x0000000000000000000000000000000000000002",
        amount: "1000000",
      },
      metadata: {
        parentIntentHash: "spoofed-parent-hash",
        parentEvEvidenceHash: "spoofed-evidence-hash",
        parentIntent: {
          strategyId: "across-bridge",
          chain: "base",
          approval: {
            token: "0x0000000000000000000000000000000000000001",
            spender: "0x0000000000000000000000000000000000000002",
            amount: "1000000",
            mode: "per_tx",
          },
        },
        parentEvEvidence: {
          allow: true,
          strategyId: "across-bridge",
          chain: "base",
          expectedNetUsd: 1.2,
          requiredNetUsd: 0.4,
        },
      },
    }),
    makeHistory([]),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, false);
  assert.deepEqual(verdict.blockers, ["expected_net_unmeasured"]);
});

test("evGate rejects parent approval evidence when recomputed parent EV fails", () => {
  const parentIntent = {
    strategyId: "across-bridge",
    chain: "base",
    intentType: "swap",
    expectedNetUsd: 0.01,
    approval: {
      token: "0x0000000000000000000000000000000000000001",
      spender: "0x0000000000000000000000000000000000000002",
      amount: "1000000",
      mode: "per_tx",
    },
  };
  const parentEvEvidence = {
    allow: true,
    strategyId: "across-bridge",
    chain: "base",
    expectedNetUsd: 1.2,
    requiredNetUsd: 0.4,
  };
  const verdict = evGate(
    makeIntent({
      intentType: "approve_exact",
      expectedNetUsd: undefined,
      approval: {
        mode: "per_tx",
        token: "0x0000000000000000000000000000000000000001",
        spender: "0x0000000000000000000000000000000000000002",
        amount: "1000000",
      },
      metadata: {
        parentIntentHash: sha256(parentIntent),
        parentEvEvidenceHash: sha256(parentEvEvidence),
        parentIntent,
        parentEvEvidence,
      },
    }),
    makeHistory([]),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, false);
  assert.deepEqual(verdict.blockers, ["expected_net_unmeasured"]);
});

test("evGate rejects parentIntentId-only approval children", () => {
  const verdict = evGate(
    makeIntent({
      intentType: "approve_exact",
      expectedNetUsd: undefined,
      approval: {
        mode: "per_tx",
        token: "0x0000000000000000000000000000000000000001",
        spender: "0x0000000000000000000000000000000000000002",
        amount: "1000000",
      },
      metadata: {
        parentIntentId: "parent-only-is-not-proof",
      },
    }),
    makeHistory([]),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, false);
  assert.deepEqual(verdict.blockers, ["expected_net_unmeasured"]);
});

test("evGate does not bypass approve_max children", () => {
  const verdict = evGate(
    makeIntent({
      intentType: "approve_max",
      expectedNetUsd: undefined,
      approval: {
        mode: "unlimited",
        token: "0x0000000000000000000000000000000000000001",
        spender: "0x0000000000000000000000000000000000000002",
        amount: "max",
        isUnlimited: true,
      },
      metadata: {
        parentIntentHash: "0xparent",
        parentEvEvidenceHash: "0xevidence",
        parentIntent: {
          strategyId: "across-bridge",
          chain: "base",
          intentHash: "0xparent",
          approval: {
            token: "0x0000000000000000000000000000000000000001",
            spender: "0x0000000000000000000000000000000000000002",
            amount: "max",
            mode: "unlimited",
          },
        },
        parentEvEvidence: {
          allow: true,
          strategyId: "across-bridge",
          chain: "base",
          expectedNetUsd: 1.2,
          requiredNetUsd: 0.4,
        },
      },
    }),
    makeHistory([]),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, false);
  assert.deepEqual(verdict.blockers, ["expected_net_unmeasured"]);
});

test("evGate uses shared tiny-canary cost floor for sparse tiny_live_canary history", () => {
  const required = tinyCanarySameChainRoundTripCostUsd({ chain: "base" });
  const verdict = evGate(
    makeIntent({
      intentType: "tiny_live_canary",
      expectedNetUsd: required,
    }),
    makeHistory([], { intentType: "tiny_live_canary" }),
    { now: "2026-05-15T00:00:00.000Z" },
  );

  assert.equal(verdict.allow, false);
  assert.equal(verdict.evidence.costSource, "tiny_canary_shared_p90");
  assert.equal(verdict.evidence.requiredNetUsd, required);
  assert.equal(verdict.evidence.fallbackP99CostUsd, executionEvFallbackCostUsd({ chain: "base" }));
});

test("buildEvCostModel computes deterministic p90 entries regardless of input order", () => {
  const history = makeHistory([0.9, 0.1, 0.5, 0.2, 1.0, 0.4, 0.7, 0.3, 0.8, 0.6], {
    strategyId: "deterministic-strategy",
    chain: "optimism",
    intentType: "deposit",
  });

  const forwardModel = buildEvCostModel({
    receiptRecords: history.receiptRecords,
    auditRecords: history.auditRecords,
    now: "2026-05-15T00:00:00.000Z",
  });
  const reverseModel = buildEvCostModel({
    receiptRecords: [...history.receiptRecords].reverse(),
    auditRecords: [...history.auditRecords].reverse(),
    now: "2026-05-15T00:00:00.000Z",
  });

  assert.deepEqual(forwardModel, reverseModel);
  assert.equal(forwardModel.entries[0].key, "deterministic-strategy:optimism:deposit");
  assert.equal(forwardModel.entries[0].p90CostUsd, 0.9);
});

test("policy index evaluates ev gate before consecutive failures", async () => {
  const history = makeHistory([0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65]);
  const policy = await evaluateIntentPolicies({
    intent: makeIntent({ expectedNetUsd: 0.1 }),
    auditRecords: history.auditRecords,
    receiptRecords: history.receiptRecords,
    now: "2026-05-15T00:00:00.000Z",
  });

  const orderedPolicies = policy.results.map((item) => item.policy);
  assert.ok(orderedPolicies.indexOf("ev_gate") < orderedPolicies.indexOf("consecutive_failures"));
  assert.ok(policy.blockers.includes("expected_net_below_receipt_cost_p90_floor"));
});
