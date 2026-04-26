import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildTreasuryInventory, scanTreasuryInventory } from "../src/treasury/inventory.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../src/treasury/policy.mjs";
const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

test("treasury inventory separates supported and active states", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const inventory = buildTreasuryInventory({
    policy,
    address: "0x000000000000000000000000000000000000dEaD",
    prices: {
      btc: 70000,
      tokenByKey: { btc: 70000, wbtc: 70000, ethereum: 2200, usd_stable: 1 },
      nativeByChain: {
        ethereum: 2200,
        bob: 2200,
        base: 2200,
        bsc: 600,
        avalanche: 10,
        unichain: 2200,
        bera: 1,
        optimism: 2200,
        soneium: 2200,
        sei: 0.2,
        sonic: 0.05,
      },
    },
    nativeBalances: {
      ethereum: { balanceWei: "3000000000000000", rpcUrl: "https://ethereum-rpc.publicnode.com" },
      bob: { balanceWei: "1000000000000000", rpcUrl: "https://rpc.gobob.xyz" },
      base: { balanceWei: "6000000000000000", rpcUrl: "https://mainnet.base.org" },
      avalanche: { balanceWei: "0", rpcUrl: "https://api.avax.network/ext/bc/C/rpc" },
      unichain: { balanceWei: "0", rpcUrl: "https://mainnet.unichain.org" },
      bera: { balanceWei: "0", rpcUrl: "https://rpc.berachain.com" },
      bsc: { balanceWei: "0", rpcUrl: "https://bsc-dataseed.binance.org" },
      optimism: { balanceWei: "0", rpcUrl: "https://mainnet.optimism.io" },
      soneium: { balanceWei: "0", rpcUrl: "https://rpc.soneium.org" },
      sei: { balanceWei: "0", rpcUrl: "https://evm-rpc.sei-apis.com" },
      sonic: { balanceWei: "0", rpcUrl: "https://rpc.soniclabs.com" },
    },
    tokenBalances: {
      [`bob:${WBTC_OFT_TOKEN.toLowerCase()}`]: { balance: "5000", rpcUrl: "https://rpc.gobob.xyz" },
      [`base:${WBTC_OFT_TOKEN.toLowerCase()}`]: { balance: "30000", rpcUrl: "https://mainnet.base.org" },
      [`base:${BASE_USDC_TOKEN.toLowerCase()}`]: { balance: "100000000", rpcUrl: "https://mainnet.base.org" },
    },
    allowances: {
      [`bob:${WBTC_OFT_TOKEN.toLowerCase()}:${WBTC_OFT_TOKEN.toLowerCase()}`]: { allowance: "40000", rpcUrl: "https://rpc.gobob.xyz" },
    },
    observedAt: "2026-04-11T02:00:00.000Z",
  });

  assert.equal(inventory.supportedChains.length >= inventory.activeChains.length, true);
  assert.equal(inventory.supportedChains.length, 11);
  assert.equal(inventory.activeChains.length, 11);
  assert.equal(inventory.native.find((item) => item.chain === "bob").status, "refill_required");
  assert.equal(inventory.native.find((item) => item.chain === "base").status, "ready");
  assert.equal(inventory.native.find((item) => item.chain === "ethereum").status, "below_target");
  assert.equal(inventory.native.find((item) => item.chain === "optimism").status, "refill_required");
  assert.equal(inventory.native.find((item) => item.chain === "sei").status, "refill_required");
  assert.equal(inventory.tokens.find((item) => item.chain === "bob").status, "refill_required");
  assert.equal(inventory.tokens.find((item) => item.chain === "base").status, "ready");
  assert.equal(inventory.tokens.find((item) => item.chain === "base" && item.ticker === "USDC").status, "ready");
  assert.equal(inventory.allowances[0].status, "over_cap");
  assert.equal(inventory.summary.nativeRefillRequiredCount > 1, true);
  assert.equal(inventory.summary.tokenRefillRequiredCount > 4, true);
  assert.equal(inventory.summary.allowanceOverCapCount, 1);
});

test("treasury inventory can continue past one chain RPC failure with stale fallback markers", async () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const fallbackInventory = buildTreasuryInventory({
    policy,
    address: "0x000000000000000000000000000000000000dEaD",
    nativeBalances: {
      bob: { balanceWei: "1230000000000000", rpcUrl: "https://fallback.example" },
    },
    observedAt: "2026-04-11T02:00:00.000Z",
  });
  const fetchImpl = async (url) => {
    if (String(url).includes("gobob")) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: { code: -32000, message: "rpc unavailable" } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: "0x0" }),
    };
  };

  const inventory = await scanTreasuryInventory({
    policy,
    address: "0x000000000000000000000000000000000000dEaD",
    fetchImpl,
    continueOnError: true,
    fallbackInventory,
  });

  const bob = inventory.native.find((item) => item.chain === "bob");
  const base = inventory.native.find((item) => item.chain === "base");
  assert.equal(bob.actual, "1230000000000000");
  assert.equal(bob.staleFallback, true);
  assert.match(bob.scanError.message, /All RPC endpoints failed/);
  assert.equal(base.staleFallback, false);
  assert.equal(inventory.summary.scanErrorCount > 0, true);
});

test("treasury inventory preserves last known price when balance is current but price feed is missing", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const fallbackInventory = buildTreasuryInventory({
    policy,
    address: "0x000000000000000000000000000000000000dEaD",
    prices: {
      btc: 70000,
      tokenByKey: { btc: 70000, wbtc: 70000, ethereum: 2200, usd_stable: 1 },
      nativeByChain: {
        ethereum: 2200,
        bob: 2200,
        base: 2200,
        bsc: 600,
        avalanche: 10,
        unichain: 2200,
        bera: 1,
        optimism: 2200,
        soneium: 2200,
        sei: 0.2,
        sonic: 0.05,
      },
    },
    nativeBalances: {
      ethereum: { balanceWei: "0" },
      bob: { balanceWei: "0" },
      base: { balanceWei: "0" },
      avalanche: { balanceWei: "0" },
      unichain: { balanceWei: "0" },
      bera: { balanceWei: "0" },
      bsc: { balanceWei: "0" },
      optimism: { balanceWei: "0" },
      soneium: { balanceWei: "0" },
      sei: { balanceWei: "100000000000000000000" },
      sonic: { balanceWei: "200000000000000000000" },
    },
  });

  const inventory = buildTreasuryInventory({
    policy,
    address: "0x000000000000000000000000000000000000dEaD",
    prices: {
      btc: 70000,
      tokenByKey: { btc: 70000, wbtc: 70000, ethereum: 2200, usd_stable: 1 },
      nativeByChain: {
        ethereum: 2200,
        bob: 2200,
        base: 2200,
        bsc: 600,
        avalanche: 10,
        unichain: 2200,
        bera: 1,
        optimism: 2200,
        soneium: 2200,
        sei: null,
        sonic: null,
      },
    },
    nativeBalances: {
      ethereum: { balanceWei: "0" },
      bob: { balanceWei: "0" },
      base: { balanceWei: "0" },
      avalanche: { balanceWei: "0" },
      unichain: { balanceWei: "0" },
      bera: { balanceWei: "0" },
      bsc: { balanceWei: "0" },
      optimism: { balanceWei: "0" },
      soneium: { balanceWei: "0" },
      sei: { balanceWei: "100000000000000000000" },
      sonic: { balanceWei: "200000000000000000000" },
    },
    fallbackInventory,
  });

  const sei = inventory.native.find((item) => item.chain === "sei");
  const sonic = inventory.native.find((item) => item.chain === "sonic");
  assert.equal(sei.priceUsd, 0.2);
  assert.equal(sonic.priceUsd, 0.05);
  assert.equal(sei.estimatedUsd, 20);
  assert.equal(sonic.estimatedUsd, 10);
  assert.equal(inventory.summary.estimatedWalletUsd, 30);
});
