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
import { ETHEREUM_WBTC_TOKEN, WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { DESTINATION_REPRESENTATIVE_BINDINGS } from "../src/config/destination-representative-bindings.mjs";
const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_APXUSD_TOKEN = "0xd993935e13851dd7517af10687ec7e5022127228";
const BSC_USDC_TOKEN = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_USDT_TOKEN = "0x55d398326f99059fF775485246999027B3197955";
const ETHEREUM_USDC_TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ETHEREUM_USDT_TOKEN = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const ETHEREUM_RLUSD_TOKEN = "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD";

test("default treasury policy validates and enables live Merkl deployment chains", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());

  assert.deepEqual(policy.activeChains, [
    "ethereum",
    "bob",
    "base",
    "bsc",
    "avalanche",
    "unichain",
    "bera",
    "optimism",
    "soneium",
    "sei",
    "sonic",
  ]);
  assert.equal(getNativeBalancePolicy(policy, "bob").enabled, true);
  assert.equal(getNativeBalancePolicy(policy, "base").enabled, true);
  assert.equal(getNativeBalancePolicy(policy, "ethereum").enabled, true);
  assert.equal(getNativeBalancePolicy(policy, "optimism").enabled, true);
  assert.equal(getNativeBalancePolicy(policy, "sei").enabled, true);
  assert.equal(policy.capital.activeBudgetUsd, 1_000_000);
  assert.equal(referenceBudgetUsd(policy), 1_000_000);
});

test("default treasury policy models representative stable inventory for every official destination", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());

  for (const binding of Object.values(DESTINATION_REPRESENTATIVE_BINDINGS)) {
    const inventoryPolicy = getTokenInventoryPolicy(policy, binding.chain, binding.assetAddress);
    assert.ok(inventoryPolicy, `${binding.chain} representative stable inventory is modeled`);
    assert.ok(Number(inventoryPolicy.targetBalance) >= binding.maxCanaryUsd);
  }
  assert.equal(policy.capital.maxRefillCost24hUsd, 12);
  assert.equal(policy.refillPolicy.maxPendingJobs, 24);
});

test("default treasury policy includes measured idle inventory consolidation thresholds", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());

  assert.deepEqual(policy.idleInventoryConsolidation, {
    enabled: true,
    dstChain: "base",
    minIdleAgeMs: 259_200_000,
    minIdleUsd: 5,
    maxAggregateIdleUsd: 50,
    evidenceSource: "data/treasury/inbound-events.jsonl trailing_30d",
  });
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
    minBalance: "25000000",
    targetBalance: "68000000",
    maxBalance: "150000000",
  });
  assert.deepEqual(tokenThresholdUnits(policy, "base", BASE_APXUSD_TOKEN), {
    minBalance: "0",
    targetBalance: "0",
    maxBalance: "0",
  });
  assert.equal(getTokenInventoryPolicy(policy, "base", BASE_APXUSD_TOKEN).enabled, false);
  assert.deepEqual(tokenThresholdUnits(policy, "ethereum", ETHEREUM_USDC_TOKEN), {
    minBalance: "25000000",
    targetBalance: "90000000",
    maxBalance: "150000000",
  });
  assert.deepEqual(tokenThresholdUnits(policy, "ethereum", ETHEREUM_WBTC_TOKEN), {
    minBalance: "3000",
    targetBalance: "10000",
    maxBalance: "50000",
  });
  assert.deepEqual(tokenThresholdUnits(policy, "ethereum", ETHEREUM_USDT_TOKEN), {
    minBalance: "25000000",
    targetBalance: "60000000",
    maxBalance: "100000000",
  });
  assert.deepEqual(tokenThresholdUnits(policy, "ethereum", ETHEREUM_RLUSD_TOKEN), {
    minBalance: "10000000000000000000",
    targetBalance: "35000000000000000000",
    maxBalance: "75000000000000000000",
  });
  assert.deepEqual(tokenThresholdUnits(policy, "bsc", BSC_USDC_TOKEN), {
    minBalance: "1000000000000000000",
    targetBalance: "3000000000000000000",
    maxBalance: "50000000000000000000",
  });
  assert.deepEqual(tokenThresholdUnits(policy, "bsc", BSC_USDT_TOKEN), {
    minBalance: "1000000000000000000",
    targetBalance: "3000000000000000000",
    maxBalance: "50000000000000000000",
  });
  assert.deepEqual(tokenThresholdUnits(policy, "optimism", WBTC_OFT_TOKEN), {
    minBalance: "3000",
    targetBalance: "10000",
    maxBalance: "50000",
  });
});

test("ethereum treasury policy tracks canonical WBTC instead of OFT mirror", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  assert.ok(getTokenInventoryPolicy(policy, "ethereum", ETHEREUM_WBTC_TOKEN));
  assert.equal(getTokenInventoryPolicy(policy, "ethereum", WBTC_OFT_TOKEN), null);
});

test("allowance policy lookup is normalized", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const allowance = getAllowanceCapPolicy(policy, "bob", WBTC_OFT_TOKEN.toUpperCase(), WBTC_OFT_TOKEN);

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
