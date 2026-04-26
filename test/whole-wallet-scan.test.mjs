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
    bitcoinAddress: "bc1qtestwallet0000000000000000000000000000",
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
    bitcoinBalance: {
      balanceSats: "25000",
      confirmedBalanceSats: "25000",
      mempoolBalanceSats: "0",
      source: "https://mempool.test/api",
    },
    observedAt: "2026-04-18T01:55:08.967Z",
  });

  assert.equal(inventory.native.length, 4);
  assert.equal(inventory.native.some((item) => item.chain === "bitcoin" && item.actualDecimal === 0.00025), true);
  assert.equal(inventory.tokenBalances.some((item) => item.chain === "base" && item.ticker === "cbBTC"), true);
  assert.equal(inventory.tokenBalances.some((item) => item.chain === "avalanche" && item.ticker === "USDC"), true);
  assert.equal(inventory.summary.tokenCount, 3);
  assert.equal(inventory.totalUsd > 0, true);
});

test("whole-wallet inventory adds external unclassified wallet delta when address scan api sees more assets", () => {
  const inventory = buildWholeWalletInventory({
    address: "0x000000000000000000000000000000000000dEaD",
    prices: {
      btc: 70000,
      tokenByKey: { btc: 70000, wbtc: 70000, ethereum: 2200, usd_stable: 1 },
      nativeByChain: { base: 2200 },
    },
    chains: ["base"],
    nativeBalances: {
      base: { balanceWei: "1000000000000000000", rpcUrl: "https://mainnet.base.org" },
    },
    tokenBalances: [],
    externalPortfolio: {
      provider: "zerion",
      walletUsd: 3000,
      totalPortfolioUsd: 3500,
    },
    observedAt: "2026-04-18T01:55:08.967Z",
  });

  const other = inventory.tokenBalances.find((item) => item.family === "external_unclassified");
  assert.ok(other, "expected unclassified external wallet delta");
  assert.equal(other.estimatedUsd, 800);
  assert.equal(inventory.summary.itemizedWalletUsd, 2200);
  assert.equal(inventory.summary.externalWalletUsd, 3000);
  assert.equal(inventory.summary.externalUnclassifiedUsd, 800);
  assert.equal(inventory.totalUsd, 3000);
  assert.equal(inventory.source, "live_scan_with_external_portfolio");
});
