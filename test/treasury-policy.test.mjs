import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDefaultTreasuryPolicy,
  decimalToUnits,
  getAllowanceCapPolicy,
  getNativeBalancePolicy,
  getTokenInventoryPolicy,
  nativeThresholdUnits,
  tokenThresholdUnits,
  validateTreasuryPolicy,
} from "../src/treasury/policy.mjs";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";

test("default treasury policy validates and enables bob/base", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());

  assert.deepEqual(policy.activeChains, ["bob", "base"]);
  assert.equal(getNativeBalancePolicy(policy, "bob").enabled, true);
  assert.equal(getNativeBalancePolicy(policy, "base").enabled, true);
  assert.equal(getNativeBalancePolicy(policy, "ethereum").enabled, false);
});

test("threshold helpers convert decimals to raw units", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());

  assert.deepEqual(nativeThresholdUnits(policy, "bob"), {
    minBalance: "2000000000000000",
    targetBalance: "5000000000000000",
    maxBalance: "20000000000000000",
  });
  assert.deepEqual(tokenThresholdUnits(policy, "bob", WBTC_OFT_TOKEN), {
    minBalance: "10000",
    targetBalance: "30000",
    maxBalance: "100000",
  });
});

test("allowance policy lookup is normalized", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const allowance = getAllowanceCapPolicy(
    policy,
    "bob",
    WBTC_OFT_TOKEN.toUpperCase(),
    WBTC_OFT_TOKEN,
  );

  assert.equal(allowance.mode, "self_send_or_exact_only");
  assert.equal(allowance.maxApproval, "0.0003");
});

test("decimal conversion rejects extra precision", () => {
  assert.throws(() => decimalToUnits("0.000000001", 8), /Too many fractional digits/);
});

test("invalid token threshold ordering is rejected", () => {
  const policy = buildDefaultTreasuryPolicy();
  const token = getTokenInventoryPolicy(policy, "bob", WBTC_OFT_TOKEN);
  token.minBalance = "0.001";
  token.targetBalance = "0.0001";

  assert.throws(() => validateTreasuryPolicy(policy), /thresholds must satisfy min <= target <= max/);
});
