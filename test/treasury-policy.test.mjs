import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDefaultTreasuryPolicy,
  decimalToUnits,
  referenceBudgetUsd,
  getAllowanceCapPolicy,
  getNativeBalancePolicy,
  getTokenInventoryPolicy,
  nativeThresholdUnits,
  tokenThresholdUnits,
  validateTreasuryPolicy,
} from "../src/treasury/policy.mjs";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BSC_USDC_TOKEN = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

test("default treasury policy validates and enables bob/base", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());

  assert.deepEqual(policy.activeChains, ["bob", "base"]);
  assert.equal(getNativeBalancePolicy(policy, "bob").enabled, true);
  assert.equal(getNativeBalancePolicy(policy, "base").enabled, true);
  assert.equal(getNativeBalancePolicy(policy, "ethereum").enabled, true);
  assert.equal(policy.capital.activeBudgetUsd, 300);
  assert.equal(referenceBudgetUsd(policy), 300);
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
  assert.deepEqual(tokenThresholdUnits(policy, "base", BASE_USDC_TOKEN), {
    minBalance: "250000000",
    targetBalance: "300000000",
    maxBalance: "1000000000",
  });
  assert.deepEqual(tokenThresholdUnits(policy, "bsc", BSC_USDC_TOKEN), {
    minBalance: "250000000000000000000",
    targetBalance: "300000000000000000000",
    maxBalance: "1000000000000000000000",
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
