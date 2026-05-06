import assert from "node:assert/strict";
import { test } from "node:test";
import { ETHEREUM_WBTC_TOKEN, WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildWholeWalletInventory, knownWholeWalletTokenTargets, scanWholeWalletInventory } from "../src/treasury/whole-wallet-scan.mjs";

test("whole-wallet scan exposes known wrapped-btc token targets", () => {
  const targets = knownWholeWalletTokenTargets({ families: ["wrapped_btc"] });
  assert.equal(targets.some((item) => item.token.toLowerCase() === WBTC_OFT_TOKEN.toLowerCase()), true);
  assert.equal(targets.every((item) => item.family === "wrapped_btc"), true);
});

test("whole-wallet scan filters token targets by chain before RPC calls", () => {
  const ethereumTargets = knownWholeWalletTokenTargets({ chain: "ethereum", families: ["wrapped_btc"] });
  assert.equal(ethereumTargets.some((item) => item.token.toLowerCase() === ETHEREUM_WBTC_TOKEN.toLowerCase()), true);
  assert.equal(ethereumTargets.some((item) => item.token.toLowerCase() === WBTC_OFT_TOKEN.toLowerCase()), false);

  const avalancheTargets = knownWholeWalletTokenTargets({ chain: "avalanche", families: ["wrapped_btc"] });
  assert.equal(avalancheTargets.some((item) => item.token.toLowerCase() === WBTC_OFT_TOKEN.toLowerCase()), true);
  assert.equal(avalancheTargets.some((item) => item.token.toLowerCase() === ETHEREUM_WBTC_TOKEN.toLowerCase()), false);
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

test("whole-wallet inventory keeps external portfolio as reference metadata only", () => {
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
  assert.equal(other, undefined);
  assert.equal(inventory.summary.itemizedWalletUsd, 2200);
  assert.equal(inventory.summary.externalWalletUsd, 3000);
  assert.equal(inventory.summary.externalUnclassifiedUsd, 800);
  assert.equal(inventory.totalUsd, 2200);
  assert.equal(inventory.source, "live_scan_with_external_reference");
});

test("whole-wallet inventory deduplicates repeated chain token balances before totals", () => {
  const inventory = buildWholeWalletInventory({
    address: "0x000000000000000000000000000000000000dEaD",
    prices: {
      tokenByKey: { ethereum: 2200 },
      nativeByChain: { base: 2200 },
    },
    chains: ["base"],
    nativeBalances: {},
    tokenBalances: [
      { chain: "base", token: "0x4200000000000000000000000000000000000006", balance: "1000000000000000000", rpcUrl: "https://mainnet.base.org" },
      { chain: "base", token: "0x4200000000000000000000000000000000000006", balance: "1000000000000000000", rpcUrl: "https://base.llamarpc.com" },
    ],
    observedAt: "2026-04-26T10:40:00.900Z",
  });

  assert.equal(inventory.tokenBalances.length, 1);
  assert.equal(inventory.summary.tokenCount, 1);
  assert.equal(inventory.summary.itemizedWalletUsd, 2200);
  assert.equal(inventory.totalUsd, 2200);
});

test("whole-wallet inventory reports full_rpc only when asset universe is closed and authoritative scans pass", () => {
  const inventory = buildWholeWalletInventory({
    address: "0x000000000000000000000000000000000000dEaD",
    chains: ["base"],
    nativeBalances: {},
    tokenBalances: [],
    assetUniverse: {
      status: "closed",
      targetCount: 2,
      registeredTargetCount: 2,
      protocolReaderCoveredTargetCount: 0,
      unknownTargetCount: 0,
      unknownTargets: [],
    },
  });

  assert.equal(inventory.summary.walletCoverage, "full_rpc");
  assert.equal(inventory.summary.assetUniverseStatus, "closed");
});

test("whole-wallet inventory can be full_rpc with zero-balance unknown universe targets", () => {
  const inventory = buildWholeWalletInventory({
    address: "0x000000000000000000000000000000000000dEaD",
    chains: ["base"],
    nativeBalances: {},
    tokenBalances: [],
    assetUniverse: {
      status: "needs_review",
      targetCount: 1,
      registeredTargetCount: 0,
      protocolReaderCoveredTargetCount: 0,
      unknownTargetCount: 1,
      unknownTargets: [{ chain: "base", token: "0x1234567890123456789012345678901234567890" }],
    },
  });

  assert.equal(inventory.summary.walletCoverage, "full_rpc");
  assert.equal(inventory.summary.assetUniverseUnknownTargetCount, 1);
  assert.equal(inventory.summary.unknownAssetBalanceCount, 0);
});

test("whole-wallet inventory downgrades coverage when nonzero balances lack USD valuation", () => {
  const inventory = buildWholeWalletInventory({
    address: "0x000000000000000000000000000000000000dEaD",
    prices: {
      tokenByKey: { usd_stable: 1 },
      nativeByChain: {},
    },
    chains: ["base"],
    nativeBalances: {
      base: { balanceWei: "1000000000000000000", rpcUrl: "https://mainnet.base.org" },
    },
    tokenBalances: [{
      chain: "base",
      token: WBTC_OFT_TOKEN,
      balance: "10000",
      rpcUrl: "https://mainnet.base.org",
    }],
    assetUniverse: {
      status: "closed",
      targetCount: 2,
      registeredTargetCount: 2,
      protocolReaderCoveredTargetCount: 0,
      unknownTargetCount: 0,
      unknownTargets: [],
    },
  });

  assert.equal(inventory.summary.walletCoverage, "partial_supported");
  assert.equal(inventory.summary.missingValuationCount, 2);
  assert.deepEqual(
    inventory.summary.missingValuationAssets.map((item) => `${item.chain}:${item.ticker}`).sort(),
    ["base:ETH", "base:wBTC.OFT"],
  );
});

test("whole-wallet inventory blocks exact coverage when tx-derived universe has unknown token balances", () => {
  const inventory = buildWholeWalletInventory({
    address: "0x000000000000000000000000000000000000dEaD",
    prices: {},
    chains: ["base"],
    nativeBalances: {},
    tokenBalances: [{
      chain: "base",
      token: "0x1234567890123456789012345678901234567890",
      balance: "1000000000000000000",
    }],
    assetUniverse: {
      status: "needs_review",
      targetCount: 1,
      registeredTargetCount: 0,
      protocolReaderCoveredTargetCount: 0,
      unknownTargetCount: 1,
      unknownTargets: [{
        chain: "base",
        token: "0x1234567890123456789012345678901234567890",
        trackingStatus: "pending_whitelist_review",
      }],
    },
    tokenMetadata: {
      "base:0x1234567890123456789012345678901234567890": {
        ticker: "NEW",
        decimals: 18,
        trackingStatus: "pending_whitelist_review",
        registered: false,
      },
    },
  });

  assert.equal(inventory.summary.walletCoverage, "partial_supported");
  assert.equal(inventory.summary.unknownAssetBalanceCount, 1);
  assert.equal(inventory.unknownAssetBalances[0].ticker, "NEW");
});

test("whole-wallet inventory does not double count protocol-reader-covered share tokens", () => {
  const inventory = buildWholeWalletInventory({
    address: "0x000000000000000000000000000000000000dEaD",
    prices: { tokenByKey: { usd_stable: 1 } },
    chains: ["base"],
    nativeBalances: {},
    tokenBalances: [{
      chain: "base",
      token: "0x0000000f2eb9f69274678c76222b35eec7588a65",
      balance: "50000000",
    }],
    protocolPositions: [{
      source: "protocol_reader",
      freshness: "fresh",
      chain: "base",
      symbol: "yoUSD",
      estimatedUsd: 50,
      usdValue: 50,
    }],
    tokenMetadata: {
      "base:0x0000000f2eb9f69274678c76222b35eec7588a65": {
        ticker: "yoUSD",
        decimals: 6,
        trackingStatus: "protocol_reader_covered",
        registered: false,
        estimatedUsdOverride: 50,
      },
    },
  });

  assert.equal(inventory.tokenBalances[0].estimatedUsd, 50);
  assert.equal(inventory.tokenBalances[0].countedInWalletTotal, false);
  assert.equal(inventory.totals.tokenUsd, 0);
  assert.equal(inventory.totals.protocolUsd, 50);
  assert.equal(inventory.totalUsd, 50);
});

test("scanWholeWalletInventory queries tx-derived token targets beyond static registry", async () => {
  const calls = [];
  const encodedNew = "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "0000000000000000000000000000000000000000000000000000000000000003" +
    "4e45570000000000000000000000000000000000000000000000000000000000";
  const inventory = await scanWholeWalletInventory({
    address: "0x000000000000000000000000000000000000dEaD",
    chains: ["base"],
    prices: {},
    bitcoinBalanceReader: null,
    assetUniverse: {
      status: "needs_review",
      targetCount: 1,
      registeredTargetCount: 0,
      protocolReaderCoveredTargetCount: 0,
      unknownTargetCount: 1,
      targets: [{
        chain: "base",
        token: "0x1234567890123456789012345678901234567890",
        family: "other",
        trackingStatus: "pending_whitelist_review",
        registered: false,
      }],
      unknownTargets: [],
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      if (body.method === "eth_getBalance") return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: "0x0" }) };
      if (body.method === "eth_call" && body.params[0].data === "0x313ce567") {
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: "0x12" }) };
      }
      if (body.method === "eth_call" && ["0x95d89b41", "0x06fdde03"].includes(body.params[0].data)) {
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: encodedNew }) };
      }
      if (body.method === "eth_call" && body.params[0].to.toLowerCase() === "0x1234567890123456789012345678901234567890") {
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000" }) };
      }
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: "0x0" }) };
    },
  });

  assert.equal(calls.some((call) => call.method === "eth_call" && call.params[0].to.toLowerCase() === "0x1234567890123456789012345678901234567890"), true);
  const token = inventory.tokenBalances.find((item) => item.token === "0x1234567890123456789012345678901234567890");
  assert.ok(token);
  assert.equal(token.ticker, "NEW");
  assert.equal(token.actualDecimal, 1);
  assert.equal(inventory.summary.unknownAssetBalanceCount, 1);
});

test("scanWholeWalletInventory values unknown ERC4626 share balances through convertToAssets while keeping review blocker", async () => {
  const encodedShareSymbol = "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "0000000000000000000000000000000000000000000000000000000000000005" +
    "5348415245000000000000000000000000000000000000000000000000000000";
  const encodedUsdcSymbol = "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "0000000000000000000000000000000000000000000000000000000000000004" +
    "5553444300000000000000000000000000000000000000000000000000000000";
  const shareToken = "0x1234567890123456789012345678901234567890";
  const usdcToken = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const inventory = await scanWholeWalletInventory({
    address: "0x000000000000000000000000000000000000dEaD",
    chains: ["base"],
    prices: { tokenByKey: { usd_stable: 1 }, nativeByChain: { base: 2200 } },
    assetUniverse: {
      status: "needs_review",
      targets: [{
        chain: "base",
        token: shareToken,
        trackingStatus: "pending_whitelist_review",
        registered: false,
      }],
      unknownTargets: [{ chain: "base", token: shareToken }],
      targetCount: 1,
      unknownTargetCount: 1,
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === "eth_getBalance") return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: "0x0" }) };
      const call = body.params[0];
      if (call.data === "0x313ce567") return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: call.to.toLowerCase() === shareToken.toLowerCase() ? "0x12" : "0x06" }) };
      if (call.data === "0x95d89b41" || call.data === "0x06fdde03") {
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: call.to.toLowerCase() === shareToken.toLowerCase() ? encodedShareSymbol : encodedUsdcSymbol }) };
      }
      if (call.data === "0x38d52e0f") {
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: `0x000000000000000000000000${usdcToken.slice(2).toLowerCase()}` }) };
      }
      if (call.data.startsWith("0x07a2d13a")) {
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: "0x0000000000000000000000000000000000000000000000000000000001312d00" }) };
      }
      if (call.to.toLowerCase() === shareToken.toLowerCase()) {
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000" }) };
      }
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: "0x0" }) };
    },
  });

  const token = inventory.unknownAssetBalances.find((item) => item.token === shareToken.toLowerCase());
  assert.ok(token);
  assert.equal(token.estimatedUsd, 20);
  assert.equal(token.valuation.kind, "erc4626_preview");
  assert.equal(inventory.summary.unknownAssetBalanceCount, 1);
});
