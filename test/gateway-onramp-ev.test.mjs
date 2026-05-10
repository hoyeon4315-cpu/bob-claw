import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_USDC_TOKEN,
  buildGatewayBtcOnrampPlan,
} from "../src/executor/helpers/gateway-btc-onramp.mjs";

function mockClient({ outputAmount, orderId = "order-123", address = "bc1qaddr", psbtHex = "deadbeef" } = {}) {
  return {
    getQuote: async () => ({
      body: {
        onramp: {
          inputAmount: { amount: "1000000", token: "0x0000000000000000000000000000000000000000" },
          outputAmount: { amount: String(outputAmount), token: BASE_USDC_TOKEN },
          signedQuoteData: "signed",
          fees: [],
          executionFees: [],
          feeBreakdown: null,
          estimatedTimeInSecs: 300,
        },
      },
    }),
    createOrder: async () => ({
      body: {
        onramp: {
          order_id: orderId,
          address,
          psbt_hex: psbtHex,
        },
      },
    }),
  };
}

function mockPriceReader() {
  return Promise.resolve({ btc: 60000 });
}

test("gateway btc onramp attaches positive expectedNetUsd when output is large enough", async () => {
  const plan = await buildGatewayBtcOnrampPlan({
    client: mockClient({ outputAmount: 600_000_000 }),
    priceReader: mockPriceReader,
    senderAddress: "bc1qsender",
    recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    amountSats: 1_000_000,
    dstToken: BASE_USDC_TOKEN,
    dstChain: "base",
    now: "2026-05-10T00:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.ok(plan.intent.metadata.expectedNetUsd > 0, `expectedNetUsd=${plan.intent.metadata.expectedNetUsd} should be > 0`);
});

test("gateway btc onramp attaches negative expectedNetUsd when output is too small", async () => {
  const plan = await buildGatewayBtcOnrampPlan({
    client: mockClient({ outputAmount: 600_000 }),
    priceReader: mockPriceReader,
    senderAddress: "bc1qsender",
    recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    amountSats: 1_000,
    dstToken: BASE_USDC_TOKEN,
    dstChain: "base",
    now: "2026-05-10T00:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.ok(plan.intent.metadata.expectedNetUsd <= 0, `expectedNetUsd=${plan.intent.metadata.expectedNetUsd} should be <= 0`);
});
