import assert from "node:assert/strict";
import { test } from "node:test";
import { planBootstrapHops } from "../src/executor/bootstrap/multi-hop-planner.mjs";

const hopCatalog = [
  { from: { chain: "btc", asset: "BTC" }, to: { chain: "bob", asset: "wBTC.OFT" }, kind: "gateway_onramp", estimatedFeeBps: 10 },
  { from: { chain: "bob", asset: "wBTC.OFT" }, to: { chain: "base", asset: "wBTC.OFT" }, kind: "oft_hop", estimatedFeeBps: 5 },
  { from: { chain: "base", asset: "wBTC.OFT" }, to: { chain: "base", asset: "cbBTC" }, kind: "swap", estimatedFeeBps: 15 },
  // alt path: direct but more expensive
  { from: { chain: "btc", asset: "BTC" }, to: { chain: "base", asset: "cbBTC" }, kind: "gateway_onramp_direct", estimatedFeeBps: 50 },
];

const gasFloats = {
  btc: { actualWei: "10000", targetWei: "5000" },
  bob: { actualWei: "1000000000000000000", targetWei: "500000000000000000" },
  base: { actualWei: "1000000000000000000", targetWei: "500000000000000000" },
};

test("empty input throws", () => {
  assert.throws(() => planBootstrapHops({}));
  assert.throws(() => planBootstrapHops({ sourceAsset: { chain: "base" } }));
  assert.throws(() => planBootstrapHops({
    sourceAsset: { chain: "btc", asset: "BTC", amountWei: 0 },
    targetAsset: { chain: "base", asset: "cbBTC" },
  }));
});

test("same source/target => already_at_target", () => {
  const r = planBootstrapHops({
    sourceAsset: { chain: "base", asset: "cbBTC", amountWei: "1000" },
    targetAsset: { chain: "base", asset: "cbBTC" },
    hopCatalog,
    gasFloats,
  });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "already_at_target");
  assert.equal(r.intents.length, 0);
});

test("no path => ok=false, reason=no_path_found", () => {
  const r = planBootstrapHops({
    sourceAsset: { chain: "btc", asset: "BTC", amountWei: "100000" },
    targetAsset: { chain: "sonic", asset: "S" },
    hopCatalog,
    gasFloats,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_path_found");
});

test("picks lowest-fee path of multiple options", () => {
  const r = planBootstrapHops({
    sourceAsset: { chain: "btc", asset: "BTC", amountWei: "10000000" },
    targetAsset: { chain: "base", asset: "cbBTC" },
    hopCatalog,
    gasFloats,
  });
  assert.equal(r.ok, true);
  // multi-hop chain 10+5+15 = 30 bps beats direct 50
  assert.equal(r.totalFeeBps, 30);
  assert.equal(r.hopCount, 3);
  assert.equal(r.intents[0].kind, "gateway_onramp");
  assert.equal(r.intents[2].kind, "swap");
});

test("running balance math compounds fees", () => {
  const r = planBootstrapHops({
    sourceAsset: { chain: "btc", asset: "BTC", amountWei: "10000000" },
    targetAsset: { chain: "base", asset: "cbBTC" },
    hopCatalog,
    gasFloats,
  });
  const final = BigInt(r.estimatedOutputWei);
  // 10_000_000 * (1-0.001) * (1-0.0005) * (1-0.0015)
  // step 1: 10_000_000 * 9990/10000 = 9_990_000
  // step 2: 9_990_000 * 9995/10000 = 9_985_005
  // step 3: 9_985_005 * 9985/10000 = 9_970_027
  assert.equal(final, 9_970_027n);
  assert.equal(r.intents[0].inputWei, "10000000");
  assert.equal(r.intents[0].estimatedOutputWei, "9990000");
  assert.equal(r.intents[2].estimatedOutputWei, "9970027");
});

test("minAmountWei enforced — meets target", () => {
  const r = planBootstrapHops({
    sourceAsset: { chain: "btc", asset: "BTC", amountWei: "10000000" },
    targetAsset: { chain: "base", asset: "cbBTC", minAmountWei: "9000000" },
    hopCatalog,
    gasFloats,
  });
  assert.equal(r.meetsMinTarget, true);
  assert.equal(r.reason, "ready");
});

test("minAmountWei enforced — below target", () => {
  const r = planBootstrapHops({
    sourceAsset: { chain: "btc", asset: "BTC", amountWei: "10000000" },
    targetAsset: { chain: "base", asset: "cbBTC", minAmountWei: "9999999999" },
    hopCatalog,
    gasFloats,
  });
  assert.equal(r.meetsMinTarget, false);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "below_min_target");
});

test("gas top-up required when chain gas below floor", () => {
  const r = planBootstrapHops({
    sourceAsset: { chain: "btc", asset: "BTC", amountWei: "10000000" },
    targetAsset: { chain: "base", asset: "cbBTC" },
    hopCatalog,
    gasFloats: {
      ...gasFloats,
      base: { actualWei: "100", targetWei: "1000000000000000000" },
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "gas_top_up_required_first");
  assert.ok(r.gasTopUps.some((g) => g.chain === "base"));
});

test("MAX_HOPS bound prevents runaway", () => {
  const longChain = [];
  for (let i = 0; i < 20; i++) {
    longChain.push({
      from: { chain: `c${i}`, asset: "A" },
      to: { chain: `c${i + 1}`, asset: "A" },
      kind: "hop",
      estimatedFeeBps: 1,
    });
  }
  const r = planBootstrapHops({
    sourceAsset: { chain: "c0", asset: "A", amountWei: "1000000" },
    targetAsset: { chain: "c15", asset: "A" },
    hopCatalog: longChain,
    gasFloats: {},
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_path_found");
});

test("frozen output", () => {
  const r = planBootstrapHops({
    sourceAsset: { chain: "btc", asset: "BTC", amountWei: "100000" },
    targetAsset: { chain: "base", asset: "cbBTC" },
    hopCatalog,
    gasFloats,
  });
  assert.throws(() => { r.ok = false; });
  assert.throws(() => { r.intents.push({}); });
  assert.throws(() => { r.intents[0].kind = "x"; });
});

test("deterministic output — same input, same result", () => {
  const args = {
    sourceAsset: { chain: "btc", asset: "BTC", amountWei: "10000000" },
    targetAsset: { chain: "base", asset: "cbBTC" },
    hopCatalog,
    gasFloats,
    observedAt: "2026-04-21T00:00:00Z",
  };
  const a = planBootstrapHops(args);
  const b = planBootstrapHops(args);
  assert.deepEqual(a.intents, b.intents);
  assert.equal(a.estimatedOutputWei, b.estimatedOutputWei);
});
