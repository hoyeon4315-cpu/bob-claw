import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildTreasuryInventory } from "../src/treasury/inventory.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../src/treasury/policy.mjs";

test("treasury inventory separates supported and active states", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const inventory = buildTreasuryInventory({
    policy,
    address: "0x000000000000000000000000000000000000dEaD",
    prices: {
      btc: 70000,
      tokenByKey: { btc: 70000, wbtc: 70000, ethereum: 2200, usd_stable: 1 },
      nativeByChain: { bob: 2200, base: 2200, ethereum: 2200, avalanche: null, bera: null, bsc: null, soneium: 2200, sonic: null, unichain: 2200 },
    },
    nativeBalances: {
      bob: { balanceWei: "1000000000000000", rpcUrl: "https://rpc.gobob.xyz" },
      base: { balanceWei: "6000000000000000", rpcUrl: "https://mainnet.base.org" },
      avalanche: { balanceWei: "0", rpcUrl: "https://api.avax.network/ext/bc/C/rpc" },
      bera: { balanceWei: "0", rpcUrl: "https://rpc.berachain.com" },
      bsc: { balanceWei: "0", rpcUrl: "https://bsc-dataseed.binance.org" },
      ethereum: { balanceWei: "100000000000000000", rpcUrl: "https://ethereum-rpc.publicnode.com" },
      soneium: { balanceWei: "0", rpcUrl: "https://rpc.soneium.org" },
      sonic: { balanceWei: "0", rpcUrl: "https://rpc.soniclabs.com" },
      unichain: { balanceWei: "0", rpcUrl: "https://mainnet.unichain.org" },
    },
    tokenBalances: {
      [`bob:${WBTC_OFT_TOKEN.toLowerCase()}`]: { balance: "5000", rpcUrl: "https://rpc.gobob.xyz" },
      [`base:${WBTC_OFT_TOKEN.toLowerCase()}`]: { balance: "30000", rpcUrl: "https://mainnet.base.org" },
    },
    allowances: {
      [`bob:${WBTC_OFT_TOKEN.toLowerCase()}:${WBTC_OFT_TOKEN.toLowerCase()}`]: { allowance: "40000", rpcUrl: "https://rpc.gobob.xyz" },
    },
    observedAt: "2026-04-11T02:00:00.000Z",
  });

  assert.equal(inventory.supportedChains.length >= inventory.activeChains.length, true);
  assert.equal(inventory.native.find((item) => item.chain === "bob").status, "refill_required");
  assert.equal(inventory.native.find((item) => item.chain === "base").status, "ready");
  assert.equal(inventory.native.find((item) => item.chain === "ethereum").status, "observe_only_balance_present");
  assert.equal(inventory.tokens.find((item) => item.chain === "bob").status, "refill_required");
  assert.equal(inventory.tokens.find((item) => item.chain === "base").status, "ready");
  assert.equal(inventory.allowances[0].status, "over_cap");
  assert.equal(inventory.summary.nativeRefillRequiredCount, 1);
  assert.equal(inventory.summary.tokenRefillRequiredCount, 1);
  assert.equal(inventory.summary.allowanceOverCapCount, 1);
});
