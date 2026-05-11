import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findPendleMarket,
  buildPendleBindingFromMarket,
  resolvePendleMerklBinding,
} from "../src/strategy/pendle-merkl-binding-join.mjs";

const BASE_MARKET = {
  address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  chainId: 8453,
  expiry: "2099-12-25T00:00:00.000Z",
  underlyingAsset: {
    address: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    symbol: "cbETH",
    decimals: 18,
  },
  pt: { address: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", symbol: "PT-cbETH" },
  yt: { address: "0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", symbol: "YT-cbETH" },
  sy: { address: "0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE", symbol: "SY-cbETH" },
  details: { impliedApy: 0.055, underlyingApy: 0.042, totalTvl: 1_459_557 },
};

const EXPIRED_MARKET = {
  ...BASE_MARKET,
  address: "0x1111111111111111111111111111111111111111",
  expiry: "2020-01-01T00:00:00.000Z",
};

test("findPendleMarket matches Merkl opportunity by chain and pool address", () => {
  const opportunity = {
    protocolId: "pendle",
    executionSurface: "fixedYield",
    chain: "base",
    poolAddress: BASE_MARKET.address,
  };
  const market = findPendleMarket({ markets: [EXPIRED_MARKET, BASE_MARKET], opportunity });
  assert.equal(market?.address, BASE_MARKET.address);
});

test("findPendleMarket rejects when chain mismatches", () => {
  const opportunity = {
    protocolId: "pendle",
    chain: "ethereum",
    poolAddress: BASE_MARKET.address,
  };
  const market = findPendleMarket({ markets: [BASE_MARKET], opportunity });
  assert.equal(market, null);
});

test("buildPendleBindingFromMarket extracts YT instrument with maturity buffer", () => {
  const binding = buildPendleBindingFromMarket(BASE_MARKET, {
    now: new Date("2026-05-11T00:00:00Z").getTime(),
  });
  assert.equal(binding.instrument, "yt");
  assert.equal(binding.marketAddress, BASE_MARKET.address.toLowerCase());
  assert.equal(binding.ytTokenAddress, BASE_MARKET.yt.address.toLowerCase());
  assert.equal(binding.assetAddress, BASE_MARKET.underlyingAsset.address.toLowerCase());
  assert.equal(binding.assetDecimals, 18);
  assert.equal(binding.assetSymbol, "cbETH");
  assert.equal(binding.maturity, "2099-12-25T00:00:00.000Z");
  assert.equal(binding.impliedAprPct, 5.5);
});

test("buildPendleBindingFromMarket rejects when maturity is within buffer", () => {
  const binding = buildPendleBindingFromMarket(EXPIRED_MARKET, {
    now: new Date("2026-05-11T00:00:00Z").getTime(),
  });
  assert.equal(binding, null);
});

test("buildPendleBindingFromMarket rejects when YT address is missing", () => {
  const partial = { ...BASE_MARKET, yt: {} };
  const binding = buildPendleBindingFromMarket(partial, {
    now: new Date("2026-05-11T00:00:00Z").getTime(),
  });
  assert.equal(binding, null);
});

test("resolvePendleMerklBinding returns null for non-Pendle protocol", () => {
  const binding = resolvePendleMerklBinding({
    opportunity: { protocolId: "morpho", chain: "base", poolAddress: BASE_MARKET.address },
    markets: [BASE_MARKET],
  });
  assert.equal(binding, null);
});

test("resolvePendleMerklBinding returns null when executionSurface is not fixedYield", () => {
  const binding = resolvePendleMerklBinding({
    opportunity: {
      protocolId: "pendle",
      executionSurface: "managedVault",
      chain: "base",
      poolAddress: BASE_MARKET.address,
    },
    markets: [BASE_MARKET],
  });
  assert.equal(binding, null);
});

test("resolvePendleMerklBinding produces a binding ready for buildProtocolCanaryBindingPlan", () => {
  const binding = resolvePendleMerklBinding({
    opportunity: {
      protocolId: "pendle",
      executionSurface: "fixedYield",
      chain: "base",
      poolAddress: BASE_MARKET.address,
    },
    markets: [BASE_MARKET],
    now: new Date("2026-05-11T00:00:00Z").getTime(),
  });
  assert.equal(binding.instrument, "yt");
  assert.ok(binding.marketAddress);
  assert.ok(binding.ytTokenAddress);
  assert.ok(binding.assetAddress);
});
