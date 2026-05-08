import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateColdStartClamp } from "../src/executor/policy/cold-start-clamp.mjs";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";

const NOW = "2026-05-09T00:00:00.000Z";

function baseIntent(overrides = {}) {
  return {
    strategyId: "wrapper-btc-arbitrage",
    chain: "base",
    family: "evm",
    intentType: "swap",
    mode: "live",
    amountUsd: 600,
    expectedNetUsd: 10,
    observedAt: NOW,
    metadata: {},
    ...overrides,
  };
}

test("evaluateColdStartClamp returns 0.25 clamp during first 24h", () => {
  const result = evaluateColdStartClamp({
    strategy: { firstAutoExecuteAt: "2026-05-08T12:00:00.000Z" },
    signerAuditRecords: [],
    now: NOW,
  });

  assert.equal(result.clamp, 0.25);
  assert.equal(result.reason, "cold_start_first_24h");
});

test("evaluateColdStartClamp returns 1.0 when strategy has no firstAutoExecuteAt", () => {
  const result = evaluateColdStartClamp({
    strategy: {},
    signerAuditRecords: [],
    now: NOW,
  });

  assert.equal(result.clamp, 1.0);
  assert.equal(result.reason, null);
});

test("policy applies cold-start clamp to amountUsd without blocking emit", async () => {
  const policy = await evaluateIntentPolicies({
    intent: baseIntent(),
    auditRecords: [],
    killSwitchPath: null,
    now: NOW,
    riskContext: {
      strategy: {
        strategyId: "wrapper-btc-arbitrage",
        firstAutoExecuteAt: "2026-05-08T23:00:00.000Z",
      },
    },
  });

  assert.equal(policy.decision, "ALLOW");
  assert.equal(policy.amountClamp.clamp, 0.25);
  assert.equal(policy.amountClamp.reason, "cold_start_first_24h");
  assert.equal(policy.effectiveIntent.amountUsd, 150);
  assert.equal(policy.results.find((item) => item.policy === "cap_check").metrics.amountUsd, 150);
});

test("policy does not clamp after first 24h", async () => {
  const policy = await evaluateIntentPolicies({
    intent: baseIntent(),
    auditRecords: [],
    killSwitchPath: null,
    now: NOW,
    riskContext: {
      strategy: {
        strategyId: "wrapper-btc-arbitrage",
        firstAutoExecuteAt: "2026-05-07T00:00:00.000Z",
      },
    },
  });

  assert.equal(policy.decision, "BLOCK");
  assert.equal(policy.amountClamp.clamp, 1.0);
  assert.ok(policy.blockers.includes("strategy_per_tx_cap_exceeded"));
});
