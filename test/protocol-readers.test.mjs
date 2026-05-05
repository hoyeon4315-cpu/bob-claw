import { test } from "node:test";
import assert from "node:assert/strict";

import { readErc4626 } from "../src/protocol-readers/readers/erc4626.mjs";
import { readAaveV3 } from "../src/protocol-readers/readers/aave-v3.mjs";
import { readBeefy } from "../src/protocol-readers/readers/beefy.mjs";
import { readPendle } from "../src/protocol-readers/readers/pendle.mjs";

function makeMockProvider(handlers) {
  return ({ chain, address, abi }) => {
    const key = `${chain}:${address.toLowerCase()}`;
    const fns = handlers[key] || handlers[address.toLowerCase()];
    if (!fns) throw new Error(`no mock for ${key}`);
    const wrapped = {};
    for (const [name, value] of Object.entries(fns)) {
      wrapped[name] = typeof value === "function"
        ? (...args) => Promise.resolve(value(...args))
        : () => Promise.resolve(value);
    }
    return wrapped;
  };
}

test("erc4626 reader missing params -> error", async () => {
  const r = await readErc4626({});
  assert.equal(r.ok, false);
  assert.equal(r.code, "missing_params");
});

test("erc4626 reader returns position for non-zero shares", async () => {
  const _providerFactory = makeMockProvider({
    "base:0xvault": {
      balanceOf: () => 100n,
      convertToAssets: (s) => s * 2n,
      asset: () => "0xunderlying",
      decimals: () => 18,
      symbol: () => "mooFoo",
    },
  });
  const r = await readErc4626({
    chain: "base",
    walletAddress: "0xwallet",
    params: { vaultAddress: "0xVault" },
    _providerFactory,
  });
  assert.equal(r.ok, true);
  assert.equal(r.positions.length, 1);
  const p = r.positions[0];
  assert.equal(p.shareBalance, "100");
  assert.equal(p.assetBalance, "200");
  assert.equal(p.adapterId, "erc4626");
  assert.equal(p.family, "vault_share");
  assert.equal(p.chain, "base");
});

test("erc4626 reader returns empty positions on zero shares", async () => {
  const _providerFactory = makeMockProvider({
    "base:0xvault": {
      balanceOf: () => 0n,
      convertToAssets: () => 0n,
      asset: () => "0xunderlying",
      decimals: () => 18,
      symbol: () => "z",
    },
  });
  const r = await readErc4626({
    chain: "base",
    walletAddress: "0xwallet",
    params: { vaultAddress: "0xVault" },
    _providerFactory,
  });
  assert.equal(r.ok, true);
  assert.equal(r.positions.length, 0);
  assert.deepEqual(r.notes, ["zero_shares"]);
});

test("erc4626 reader tries configured rpcUrls in deterministic fallback order", async () => {
  const rpcCalls = [];
  class JsonRpcProvider {
    constructor(rpcUrl) {
      this.rpcUrl = rpcUrl;
    }
  }
  class Contract {
    constructor(address, abi, provider) {
      this.address = address.toLowerCase();
      this.provider = provider;
    }
    async balanceOf() {
      rpcCalls.push(`${this.provider.rpcUrl}:balanceOf:${this.address}`);
      if (this.provider.rpcUrl === "https://primary.example") throw new Error("missing revert data");
      return 100n;
    }
    async convertToAssets(shares) {
      rpcCalls.push(`${this.provider.rpcUrl}:convertToAssets:${this.address}`);
      return shares * 2n;
    }
    async asset() {
      rpcCalls.push(`${this.provider.rpcUrl}:asset:${this.address}`);
      return "0xunderlying";
    }
    async decimals() {
      rpcCalls.push(`${this.provider.rpcUrl}:decimals:${this.address}`);
      return 18;
    }
    async symbol() {
      rpcCalls.push(`${this.provider.rpcUrl}:symbol:${this.address}`);
      return "yoUSDC";
    }
  }

  const r = await readErc4626({
    chain: "base",
    walletAddress: "0xwallet",
    params: { vaultAddress: "0xVault" },
    _chainConfigResolver: () => ({
      rpcUrls: ["https://primary.example", "https://fallback.example"],
    }),
    _ethersLoader: async () => ({ ethers: { JsonRpcProvider, Contract } }),
  });

  assert.equal(r.ok, true);
  assert.equal(r.positions[0].assetBalance, "200");
  assert.deepEqual(rpcCalls.slice(0, 2), [
    "https://primary.example:balanceOf:0xvault",
    "https://fallback.example:balanceOf:0xvault",
  ]);
});

test("aave-v3 reader returns lending position with HF", async () => {
  const _providerFactory = makeMockProvider({
    "ethereum:0xpool": {
      getUserAccountData: () => [0n, 0n, 0n, 8500n, 8000n, 1500000000000000000n], // hf 1.5
    },
    "ethereum:0xatoken": {
      balanceOf: () => 1000n,
      decimals: () => 6,
      symbol: () => "aUSDC",
    },
    "ethereum:0xdebt": {
      balanceOf: () => 500n,
      decimals: () => 6,
      symbol: () => "varUSDC",
    },
  });
  const r = await readAaveV3({
    chain: "ethereum",
    walletAddress: "0xw",
    params: {
      poolAddress: "0xPool",
      aTokenAddress: "0xAToken",
      variableDebtTokenAddress: "0xDebt",
      underlyingTokenAddress: "0xunder",
    },
    _providerFactory,
  });
  assert.equal(r.ok, true);
  const p = r.positions[0];
  assert.equal(p.shareBalance, "1000");
  assert.equal(p.debtBalance, "500");
  assert.ok(Math.abs(p.healthFactor - 1.5) < 1e-9);
  assert.equal(p.family, "lending_loop");
});

test("beefy reader computes underlying from ppfs", async () => {
  const _providerFactory = makeMockProvider({
    "base:0xmoo": {
      balanceOf: () => 1_000_000_000_000_000_000n, // 1 share
      getPricePerFullShare: () => 1_500_000_000_000_000_000n, // 1.5
      want: () => "0xwant",
      decimals: () => 18,
      symbol: () => "mooFoo",
    },
  });
  const r = await readBeefy({
    chain: "base",
    walletAddress: "0xw",
    params: { vaultAddress: "0xMoo" },
    _providerFactory,
  });
  assert.equal(r.ok, true);
  assert.equal(r.positions[0].assetBalance, "1500000000000000000");
  assert.equal(r.positions[0].adapterId, "beefy");
});

test("pendle reader returns PT/YT/LP positions and expiry", async () => {
  const expiry = 1900000000;
  const market = "0xmarket";
  const _providerFactory = makeMockProvider({
    [`base:${market}`]: {
      expiry: () => BigInt(expiry),
      readTokens: () => ["0xsy", "0xpt", "0xyt"],
      // ERC20 view used for LP balance via second loadContract call
      balanceOf: () => 333n,
      decimals: () => 18,
      symbol: () => "PT-LP",
    },
    "base:0xpt": {
      balanceOf: () => 100n,
      decimals: () => 18,
      symbol: () => "PT",
    },
    "base:0xyt": {
      balanceOf: () => 0n,
      decimals: () => 18,
      symbol: () => "YT",
    },
  });
  const r = await readPendle({
    chain: "base",
    walletAddress: "0xw",
    params: { marketAddress: market },
    _providerFactory,
  });
  assert.equal(r.ok, true);
  const pt = r.positions.find((p) => p.symbol === "PT");
  const lp = r.positions.find((p) => p.symbol === "LP");
  assert.ok(pt, "PT position present");
  assert.ok(lp, "LP position present");
  assert.equal(pt.expirySec, expiry);
  assert.equal(lp.family, "cl_lp");
  assert.equal(r.positions.find((p) => p.symbol === "YT"), undefined);
});
