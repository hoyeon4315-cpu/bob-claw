import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildFundingSourcePlan } from "../src/treasury/funding-source-planner.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../src/treasury/policy.mjs";

function crossChainPlanFixture() {
  return {
    schemaVersion: 1,
    observedAt: "2026-04-24T00:00:00.000Z",
    address: "0x000000000000000000000000000000000000dEaD",
    decision: "REVIEW_REFILL_PLAN",
    inventory: {
      native: [
        { chain: "base", actual: "5000000000000000", actualDecimal: 0.005, estimatedUsd: 16 },
      ],
      tokens: [
        {
          chain: "base",
          actual: "5000000",
          actualDecimal: 5,
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ticker: "USDC",
          estimatedUsd: 5,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "unichain",
        ticker: "wBTC.OFT",
        token: WBTC_OFT_TOKEN,
        refillAmount: "25000",
        refillAmountDecimal: 0.00025,
        refillEstimatedUsd: 17.5,
        rationale: "Unichain route buffer",
      },
    ],
  };
}

test("planner blocks Gateway methods when Gateway availability marked paused", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({
    plan: crossChainPlanFixture(),
    policy,
    gatewayAvailability: {
      available: false,
      reason: "gateway_runtime_disabled_state_file_present",
      observedAt: "2026-04-24T00:00:00.000Z",
    },
  });
  assert.equal(funding.selections.length, 1);
  const selection = funding.selections[0];
  const gatewayCandidates = selection.candidates.filter((candidate) =>
    candidate.method.startsWith("cross_chain_bridge_or_swap") ||
    candidate.method === "cross_chain_swap_via_btc_intermediate",
  );
  assert.ok(gatewayCandidates.length > 0, "Gateway candidate present");
  for (const candidate of gatewayCandidates) {
    assert.equal(candidate.availability, "manual_only", `${candidate.method} must be manual_only`);
    assert.equal(candidate.preferred, false);
    assert.ok(
      candidate.missingInputs.includes("gateway_runtime_disabled_state_file_present"),
      "missingInputs records pause reason",
    );
  }
  assert.ok(
    funding.reasons.includes("gateway_runtime_disabled_state_file_present"),
    "plan-level reasons include pause",
  );
  assert.equal(funding.gatewayAvailability.available, false);
});

test("planner emits alternate bridge candidates when Gateway paused and fallback supports pair", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({
    plan: crossChainPlanFixture(),
    policy,
    gatewayAvailability: {
      available: false,
      reason: "gateway_runtime_disabled_state_file_present",
      observedAt: "2026-04-24T00:00:00.000Z",
    },
  });
  const methods = new Set(funding.selections[0].candidates.map((c) => c.method));
  // Base <-> Unichain is supported by across + lifi + relay + stargate in
  // the registry scaffold. All arrive as conditional (design_scaffold).
  assert.ok(methods.has("cross_chain_bridge_across"), "Across candidate emitted");
  assert.ok(methods.has("cross_chain_bridge_lifi"), "LiFi candidate emitted");
  for (const method of ["cross_chain_bridge_across", "cross_chain_bridge_lifi"]) {
    const candidate = funding.selections[0].candidates.find((c) => c.method === method);
    assert.equal(candidate.availability, "conditional");
    assert.ok(
      candidate.missingInputs.some((input) => input.startsWith("bridge_provider_executor_missing:")),
      `${method} missingInputs flags missing executor`,
    );
  }
});

test("planner leaves Gateway candidates selectable when Gateway available", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({
    plan: crossChainPlanFixture(),
    policy,
    gatewayAvailability: { available: true, reason: null, observedAt: "2026-04-24T00:00:00.000Z" },
  });
  const methods = new Set(funding.selections[0].candidates.map((c) => c.method));
  assert.ok(
    methods.has("cross_chain_bridge_or_swap") || methods.has("cross_chain_swap_via_btc_intermediate"),
    "Gateway candidate still emitted when available",
  );
  assert.ok(!methods.has("cross_chain_bridge_across"), "alt bridges suppressed when Gateway live");
  assert.equal(funding.gatewayAvailability.available, true);
});
