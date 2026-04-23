import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consecutiveBridgeFailureCount,
  refillBridgeCandidates,
  resolveRefillBridgeFallback,
} from "../src/executor/helpers/refill-fallback.mjs";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";

function jobFixture(overrides = {}) {
  return {
    jobId: "job-fallback",
    chain: "base",
    resourceKey: `base:${WBTC_OFT_TOKEN.toLowerCase()}`,
    type: "refill_token",
    asset: "wBTC.OFT",
    token: WBTC_OFT_TOKEN,
    targetAmount: "10000",
    targetAmountDecimal: 0.0001,
    executionMethod: "cross_chain_bridge_or_swap",
    fundingSource: {
      selectionStatus: "ready",
      method: "cross_chain_bridge_or_swap",
      source: {
        chain: "bob",
        token: WBTC_OFT_TOKEN,
        actual: "30000",
        actualDecimal: 0.0003,
        estimatedUsd: 21,
      },
      missingInputs: [],
      settlementRequirements: ["gateway_destination_delta_proof_required"],
    },
    candidateMethods: [
      {
        method: "cross_chain_bridge_or_swap",
        availability: "ready",
        source: {
          chain: "bob",
          token: WBTC_OFT_TOKEN,
          actual: "30000",
          actualDecimal: 0.0003,
          estimatedUsd: 21,
        },
        missingInputs: [],
        settlementRequirements: ["gateway_destination_delta_proof_required"],
      },
      {
        method: "cross_chain_bridge_across",
        availability: "ready",
        source: {
          chain: "optimism",
          token: "0x68f180fcCe683668e9084f035309E29Bf0A2095",
          actual: "30000",
          actualDecimal: 0.0003,
          estimatedUsd: 21,
        },
        missingInputs: [],
        settlementRequirements: ["across_destination_output_amount_delta_proof_required"],
      },
      {
        method: "cross_chain_bridge_lifi",
        availability: "conditional",
        source: {
          chain: "optimism",
          token: "0x68f180fcCe683668e9084f035309E29Bf0A2095",
        },
        missingInputs: ["bridge_provider_executor_missing:lifi"],
      },
    ],
    ...overrides,
  };
}

function failureEvent(observedAt, method = "cross_chain_bridge_or_swap") {
  return {
    schemaVersion: 1,
    observedAt,
    eventType: "execution_funding_outcome",
    status: "failed",
    jobId: "job-fallback",
    resourceKey: `base:${WBTC_OFT_TOKEN.toLowerCase()}`,
    executionMethod: method,
    error: { message: "provider reverted" },
  };
}

test("refill bridge fallback candidates keep executable methods in rank order", () => {
  const candidates = refillBridgeCandidates(jobFixture());

  assert.deepEqual(candidates.map((item) => item.method), [
    "cross_chain_bridge_or_swap",
    "cross_chain_bridge_across",
  ]);
  assert.equal(candidates[1].source.chain, "optimism");
});

test("refill bridge fallback advances after three consecutive failures", () => {
  const job = jobFixture();
  const events = [
    failureEvent("2026-04-22T00:00:00.000Z"),
    failureEvent("2026-04-22T00:01:00.000Z"),
    failureEvent("2026-04-22T00:02:00.000Z"),
  ];

  const resolved = resolveRefillBridgeFallback({
    job,
    events,
    observedAt: "2026-04-22T00:03:00.000Z",
  });

  assert.equal(consecutiveBridgeFailureCount({ events, job, method: "cross_chain_bridge_or_swap" }), 3);
  assert.equal(resolved.job.executionMethod, "cross_chain_bridge_across");
  assert.equal(resolved.job.fundingSource.method, "cross_chain_bridge_across");
  assert.equal(resolved.job.fundingSource.source.chain, "optimism");
  assert.equal(resolved.fallbackEvent.eventType, "bridge_fallback_triggered");
  assert.equal(resolved.fallbackEvent.fromExecutionMethod, "cross_chain_bridge_or_swap");
  assert.equal(resolved.fallbackEvent.toExecutionMethod, "cross_chain_bridge_across");
  assert.equal(resolved.fallbackEvent.failureCount, 3);
});

test("refill bridge fallback does not advance when next provider is not executable", () => {
  const job = jobFixture({
    candidateMethods: [
      {
        method: "cross_chain_bridge_or_swap",
        availability: "ready",
        source: { chain: "bob", token: WBTC_OFT_TOKEN },
        missingInputs: [],
      },
      {
        method: "cross_chain_bridge_across",
        availability: "conditional",
        source: { chain: "optimism", token: "0x68f180fcCe683668e9084f035309E29Bf0A2095" },
        missingInputs: ["source_inventory_below_target_amount"],
      },
    ],
  });

  const resolved = resolveRefillBridgeFallback({
    job,
    events: [
      failureEvent("2026-04-22T00:00:00.000Z"),
      failureEvent("2026-04-22T00:01:00.000Z"),
      failureEvent("2026-04-22T00:02:00.000Z"),
    ],
  });

  assert.equal(resolved.job.executionMethod, "cross_chain_bridge_or_swap");
  assert.equal(resolved.fallbackEvent, null);
});
