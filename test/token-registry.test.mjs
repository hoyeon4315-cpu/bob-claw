import { test } from "node:test";
import assert from "node:assert/strict";

import { TOKEN_REGISTRY, getTokensForChain, listChains, findToken } from "../src/config/token-registry.mjs";

test("registry contains gateway chains", () => {
  for (const c of ["ethereum", "base", "bsc", "avalanche", "sonic", "bob", "berachain", "optimism", "soneium", "sei", "unichain"]) {
    assert.ok(c in TOKEN_REGISTRY, `missing chain ${c}`);
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

test("listChains is non-empty", () => {
  assert.ok(listChains().length >= 11);
});
