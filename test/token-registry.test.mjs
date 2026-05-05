import { test } from "node:test";
import assert from "node:assert/strict";

import { TOKEN_REGISTRY, getTokensForChain, listChains, findToken } from "../src/config/token-registry.mjs";
import { EVM_CHAIN_CONFIGS } from "../src/config/chains.mjs";

test("registry contains gateway chains", () => {
  for (const c of ["ethereum", "base", "bsc", "avalanche", "sonic", "bob", "berachain", "bera", "optimism", "soneium", "sei", "unichain"]) {
    assert.ok(c in TOKEN_REGISTRY, `missing chain ${c}`);
  }
});

test("registry covers every configured EVM chain used by realtime portfolio", () => {
  for (const chain of Object.keys(EVM_CHAIN_CONFIGS)) {
    assert.ok(chain in TOKEN_REGISTRY, `missing realtime chain ${chain}`);
  }
});

test("getTokensForChain returns array (possibly empty)", () => {
  assert.ok(Array.isArray(getTokensForChain("ethereum")));
  assert.ok(getTokensForChain("ethereum").length > 0);
  assert.deepEqual(getTokensForChain("nonexistent"), []);
});

test("findToken locates by symbol or address case-insensitive", () => {
  const t1 = findToken("base", "USDC");
  assert.ok(t1);
  assert.equal(t1.decimals, 6);
  const t2 = findToken("base", t1.address.toLowerCase());
  assert.equal(t2?.symbol, "USDC");
  assert.equal(findToken("base", "doesnotexist"), null);
});

test("registry covers currently held Gateway BTC and stable assets on official destinations", () => {
  for (const chain of ["base", "bob", "bsc", "avalanche", "sonic", "sei", "bera", "soneium", "unichain", "optimism"]) {
    assert.ok(findToken(chain, "wBTC.OFT"), `missing wBTC.OFT on ${chain}`);
  }
  for (const [chain, symbol] of [
    ["ethereum", "RLUSD"],
    ["bob", "oUSDT"],
    ["optimism", "USDC"],
    ["unichain", "USDC"],
    ["sonic", "USDC"],
  ]) {
    assert.ok(findToken(chain, symbol), `missing ${symbol} on ${chain}`);
  }
});

test("listChains is non-empty", () => {
  assert.ok(listChains().length >= 11);
});
