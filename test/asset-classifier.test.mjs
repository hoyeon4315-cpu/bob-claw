import assert from "node:assert/strict";
import { test } from "node:test";
import { ZERO_TOKEN } from "../src/assets/tokens.mjs";
import { ASSET_CLASSES, classifyInboundAsset } from "../src/treasury/asset-classifier.mjs";

test("classifier recognizes native BTC as BTC-like", () => {
  const result = classifyInboundAsset({ chain: "bitcoin", token: ZERO_TOKEN });

  assert.equal(result.assetClass, ASSET_CLASSES.BTC_LIKE);
  assert.equal(result.routeAllowed, true);
});

test("classifier recognizes known stablecoin inventory", () => {
  const result = classifyInboundAsset({
    chain: "base",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  });

  assert.equal(result.assetClass, ASSET_CLASSES.STABLE);
  assert.equal(result.routeAllowed, true);
});

test("classifier blocks unknown token auto-routing", () => {
  const result = classifyInboundAsset({
    chain: "base",
    token: "0x9999999999999999999999999999999999999999",
  });

  assert.equal(result.assetClass, ASSET_CLASSES.UNKNOWN);
  assert.equal(result.manualReviewRequired, true);
  assert.equal(result.reviewReason, "unknown_token_not_whitelisted");
});

test("classifier recognizes non-ETH/BTC native gas tokens as known bluechip", () => {
  for (const chain of ["avalanche", "sei", "bsc", "bera", "sonic"]) {
    const result = classifyInboundAsset({ chain, token: ZERO_TOKEN });
    assert.equal(result.assetClass, ASSET_CLASSES.OTHER_BLUECHIP, `${chain} native should classify`);
    assert.equal(result.manualReviewRequired, false, `${chain} native should not require manual review`);
    assert.equal(result.routeAllowed, true);
  }
});

test("classifier does not whitelist unknown tokens from metadata alone", () => {
  const result = classifyInboundAsset({
    chain: "base",
    token: "0x9999999999999999999999999999999999999999",
    metadata: { ticker: "USDC", family: "stablecoin", decimals: 6, priceKey: "usd_stable" },
  });

  assert.equal(result.assetClass, ASSET_CLASSES.UNKNOWN);
  assert.equal(result.routeAllowed, false);
  assert.equal(result.reviewReason, "unknown_token_not_whitelisted");
});
