import assert from "node:assert/strict";
import { test } from "node:test";
import { GAS_ZIP_DEFAULT_POLICY, gasZipAcceptsAction, isGasZipSupportedChain } from "../src/config/gas-zip.mjs";
import { buildFundingSourcePlan } from "../src/treasury/funding-source-planner.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../src/treasury/policy.mjs";
import { ZERO_TOKEN } from "../src/assets/tokens.mjs";

function nativeAction(chain, estimatedUsd) {
  return {
    type: "refill_native",
    chain,
    asset: "NATIVE",
    token: ZERO_TOKEN,
    refillAmount: "1",
    refillAmountDecimal: 0.001,
    refillEstimatedUsd: estimatedUsd,
    rationale: "test",
  };
}

test("Gas.Zip rejects token refills outright", () => {
  const verdict = gasZipAcceptsAction(
    { type: "refill_token", chain: "base", refillEstimatedUsd: 5 },
    GAS_ZIP_DEFAULT_POLICY,
  );
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, "gas_zip_non_native_refill_forbidden");
});

test("Gas.Zip rejects destinations outside the Gateway 11 surface", () => {
  const verdict = gasZipAcceptsAction(nativeAction("polygon", 5), GAS_ZIP_DEFAULT_POLICY);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, "gas_zip_unsupported_destination");
});

test("Gas.Zip rejects per-job cap violations", () => {
  const verdict = gasZipAcceptsAction(nativeAction("base", 100), GAS_ZIP_DEFAULT_POLICY);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, "gas_zip_per_job_cap_exceeded");
});

test("Gas.Zip accepts small native gas refuel on supported chain", () => {
  const verdict = gasZipAcceptsAction(nativeAction("bsc", 3), GAS_ZIP_DEFAULT_POLICY);
  assert.equal(verdict.accepted, true);
  assert.equal(isGasZipSupportedChain("bsc"), true);
});

test("funding planner surfaces Gas.Zip as fallback candidate for native refills only", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    schemaVersion: 1,
    observedAt: "2026-04-20T06:00:00.000Z",
    address: "0x000000000000000000000000000000000000dEaD",
    decision: "REVIEW_REFILL_PLAN",
    inventory: { native: [], tokens: [] },
    actions: [nativeAction("bsc", 3)],
  };
  const funding = buildFundingSourcePlan({ plan, policy });
  const candidates = funding.selections[0].candidates;
  const methods = candidates.map((item) => item.method);
  assert.ok(methods.includes("gas_refuel_bridge_gas_zip"));
  const gasZip = candidates.find((item) => item.method === "gas_refuel_bridge_gas_zip");
  assert.equal(gasZip.availability, "conditional");
  assert.deepEqual(gasZip.missingInputs, ["gas_zip_destination_native_delta_proof_required"]);
});

test("funding planner marks Gas.Zip manual_only when destination is off-surface", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    schemaVersion: 1,
    observedAt: "2026-04-20T06:00:00.000Z",
    address: "0x000000000000000000000000000000000000dEaD",
    decision: "REVIEW_REFILL_PLAN",
    inventory: { native: [], tokens: [] },
    actions: [nativeAction("polygon", 3)],
  };
  const funding = buildFundingSourcePlan({ plan, policy });
  const gasZip = funding.selections[0].candidates.find(
    (item) => item.method === "gas_refuel_bridge_gas_zip",
  );
  assert.equal(gasZip.availability, "manual_only");
  assert.deepEqual(gasZip.missingInputs, ["gas_zip_unsupported_destination"]);
});
