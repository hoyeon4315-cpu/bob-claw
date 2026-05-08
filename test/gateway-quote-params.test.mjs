import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGatewayQuoteParams, normalizeGatewayAffiliateId } from "../src/gateway/quote-params.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const WBTC = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

test("buildGatewayQuoteParams omits affiliateId when it is unset", () => {
  const params = buildGatewayQuoteParams({
    route: {
      srcChain: "bitcoin",
      dstChain: "bob",
      srcToken: ZERO,
      dstToken: WBTC,
    },
    amount: "10000",
    recipient: "0xrecipient",
    slippage: "50",
    affiliateId: null,
  });

  assert.equal(params.affiliateId, undefined);
});

test("buildGatewayQuoteParams includes affiliateId and sender only when applicable", () => {
  const affiliateId = "550e8400-e29b-41d4-a716-446655440000";
  const params = buildGatewayQuoteParams({
    route: {
      srcChain: "base",
      dstChain: "bitcoin",
      srcToken: WBTC,
      dstToken: ZERO,
    },
    amount: "250000",
    sender: "0xsender",
    recipient: "bc1qrecipient",
    slippage: "50",
    affiliateId,
  });

  assert.equal(params.sender, "0xsender");
  assert.equal(params.affiliateId, affiliateId);
});

test("normalizeGatewayAffiliateId accepts only UUID values", () => {
  assert.equal(normalizeGatewayAffiliateId(" 550e8400-e29b-41d4-a716-446655440000 "), "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(normalizeGatewayAffiliateId(""), null);
  assert.throws(() => normalizeGatewayAffiliateId("not-a-uuid"), /BOB_GATEWAY_AFFILIATE_ID/);
});
