import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consecutiveBridgeFailureCount,
  forceRefillExecutionMethod,
  refillCandidateExecutable,
  refillBridgeCandidates,
  refillExecutionCandidates,
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

test("refill execution candidates can force a non-bridge gas refuel fallback", () => {
  const job = jobFixture({
    type: "refill_native",
    asset: "ETH",
    executionMethod: "cross_chain_bridge_or_swap",
    candidateMethods: [
      ...jobFixture().candidateMethods,
      {
        method: "gas_refuel_bridge_gas_zip",
        availability: "conditional",
        source: {
          chain: "base",
          token: "0x0000000000000000000000000000000000000000",
          actual: "10000000000000000",
          actualDecimal: 0.01,
          estimatedUsd: 20,
        },
        missingInputs: [],
        settlementRequirements: ["gas_zip_destination_native_delta_proof_required"],
      },
    ],
  });

  const candidates = refillExecutionCandidates(job);
  const gasZip = candidates.find((item) => item.method === "gas_refuel_bridge_gas_zip");
  assert.equal(refillCandidateExecutable(gasZip), true);

  const forced = forceRefillExecutionMethod({ job, method: "gas_refuel_bridge_gas_zip" });
  assert.equal(forced.error, null);
  assert.equal(forced.job.executionMethod, "gas_refuel_bridge_gas_zip");
  assert.equal(forced.job.fundingSource.method, "gas_refuel_bridge_gas_zip");
  assert.equal(forced.job.fundingSource.source.chain, "base");
});

test("forcing an executable conditional method promotes it to ready funding", () => {
  const job = jobFixture({
    type: "refill_native",
    asset: "ETH",
    requiresManualReview: true,
    reviewReasons: ["funding_source_conditional"],
    executionMethod: "same_chain_token_to_native_swap",
    candidateMethods: [
      {
        method: "cross_chain_swap_via_btc_intermediate",
        availability: "conditional",
        source: {
          chain: "ethereum",
          token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          actual: "100000000",
          actualDecimal: 100,
          estimatedUsd: 100,
        },
        missingInputs: [],
        settlementRequirements: [],
      },
    ],
  });

  const forced = forceRefillExecutionMethod({ job, method: "cross_chain_swap_via_btc_intermediate" });

  assert.equal(forced.error, null);
  assert.equal(forced.job.executionMethod, "cross_chain_swap_via_btc_intermediate");
  assert.equal(forced.job.fundingSource.selectionStatus, "ready");
  assert.equal(forced.job.requiresManualReview, false);
  assert.deepEqual(forced.job.reviewReasons, []);
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
