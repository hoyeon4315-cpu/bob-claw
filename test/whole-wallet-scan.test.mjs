import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildWholeWalletInventory, knownWholeWalletTokenTargets } from "../src/treasury/whole-wallet-scan.mjs";

test("whole-wallet scan exposes known wrapped-btc token targets", () => {
  const targets = knownWholeWalletTokenTargets({ families: ["wrapped_btc"] });
  assert.equal(targets.some((item) => item.token.toLowerCase() === WBTC_OFT_TOKEN.toLowerCase()), true);
  assert.equal(targets.every((item) => item.family === "wrapped_btc"), true);
});

test("whole-wallet inventory keeps non-zero native and token balances outside treasury policy scope", () => {
  const inventory = buildWholeWalletInventory({
    address: "0x000000000000000000000000000000000000dEaD",
    prices: {
      btc: 70000,
      tokenByKey: { btc: 70000, wbtc: 70000, ethereum: 2200, usd_stable: 1 },
      nativeByChain: { bob: 2200, base: 2200, avalanche: 10, bera: null, bsc: null, ethereum: 2200, soneium: 2200, sonic: 0.05, unichain: 2200 },
    },
    chains: ["base", "avalanche", "sonic"],
    nativeBalances: {
      base: { balanceWei: "1000000000000000000", rpcUrl: "https://mainnet.base.org" },
      avalanche: { balanceWei: "500000000000000000", rpcUrl: "https://api.avax.network/ext/bc/C/rpc" },
      sonic: { balanceWei: "1000000000000000000", rpcUrl: "https://rpc.soniclabs.com" },
    },
    tokenBalances: [
      { chain: "base", token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", balance: "10000", rpcUrl: "https://mainnet.base.org" },
      { chain: "avalanche", token: WBTC_OFT_TOKEN, balance: "10000", rpcUrl: "https://api.avax.network/ext/bc/C/rpc" },
      { chain: "avalanche", token: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", balance: "250000", rpcUrl: "https://api.avax.network/ext/bc/C/rpc" },
    ],
    observedAt: "2026-04-18T01:55:08.967Z",
  });

  assert.equal(inventory.native.length, 3);
  assert.equal(inventory.tokenBalances.some((item) => item.chain === "base" && item.ticker === "cbBTC"), true);
  assert.equal(inventory.tokenBalances.some((item) => item.chain === "avalanche" && item.ticker === "USDC"), true);
  assert.equal(inventory.summary.tokenCount, 3);
  assert.equal(inventory.totalUsd > 0, true);
});
