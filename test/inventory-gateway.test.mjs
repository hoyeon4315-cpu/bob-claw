import assert from "node:assert/strict";
import { test } from "node:test";
import { ZERO_TOKEN, WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildGatewayInventorySummary } from "../src/cli/inventory-gateway.mjs";

test("gateway inventory summary keeps token counts chain-aware and preserves unknown tokens", () => {
  const summary = buildGatewayInventorySummary([
    {
      srcChain: "base",
      dstChain: "bob",
      srcToken: ZERO_TOKEN,
      dstToken: WBTC_OFT_TOKEN,
    },
    {
      srcChain: "bob",
      dstChain: "bitcoin",
      srcToken: WBTC_OFT_TOKEN,
      dstToken: ZERO_TOKEN,
    },
    {
      srcChain: "bob",
      dstChain: "base",
      srcToken: "0x9999999999999999999999999999999999999999",
      dstToken: WBTC_OFT_TOKEN,
    },
  ]);

  assert.equal(summary.tokenCounts.find((item) => item.chain === "base" && item.token === ZERO_TOKEN)?.ticker, "native");
  assert.equal(
    summary.tokenCounts.find((item) => item.chain === "bob" && item.token === "0x9999999999999999999999999999999999999999")?.ticker,
    "0x9999999999999999999999999999999999999999",
  );
  assert.deepEqual(summary.bobTouchingBtcRoutes[0], {
    routeKey: "bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->bitcoin:0x0000000000000000000000000000000000000000",
    srcChain: "bob",
    srcTicker: "wBTC.OFT",
    dstChain: "bitcoin",
    dstTicker: "native",
  });
});
