import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyExecutableQuoteHydrationError,
  hydrateStoredOfframpQuoteExecution,
  isOfframpExecutionHydrationRequired,
} from "../src/gateway/executable-quote.mjs";
import { GatewayError } from "../src/gateway/client.mjs";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function offrampQuote(overrides = {}) {
  return {
    observedAt: "2026-04-18T00:00:00.000Z",
    route: {
      srcChain: "base",
      dstChain: "bitcoin",
      srcToken: BASE_USDC,
      dstToken: "0x0000000000000000000000000000000000000000",
    },
    routeKey: `base:${BASE_USDC}->bitcoin:0x0000000000000000000000000000000000000000`,
    quoteType: "offramp",
    amount: "250000000",
    inputAmount: "250000000",
    outputAmount: "249000",
    txTo: null,
    txData: null,
    txValueWei: "0",
    txDataBytes: null,
    ...overrides,
  };
}

test("offramp execution hydration is required only when executable tx is missing", () => {
  assert.equal(isOfframpExecutionHydrationRequired(offrampQuote()), true);
  assert.equal(isOfframpExecutionHydrationRequired(offrampQuote({ txTo: "0x1111", txData: "0x1234" })), false);
});

test("hydrateStoredOfframpQuoteExecution attaches executable order tx for offramps", async () => {
  const quote = offrampQuote();
  let getQuoteCalls = 0;
  let createOrderCalls = 0;
  const hydrated = await hydrateStoredOfframpQuoteExecution(quote, {
    senderAddress: "0x1111111111111111111111111111111111111111",
    client: {
      getQuote: async (params) => {
        getQuoteCalls += 1;
        assert.equal(params.srcChain, "base");
        assert.equal(params.dstChain, "bitcoin");
        assert.equal(params.amount, "250000000");
        return {
          body: {
            offramp: {
              inputAmount: { amount: "250000000" },
              outputAmount: { amount: "249000" },
              txTo: "0x2222222222222222222222222222222222222222",
            },
          },
        };
      },
      createOrder: async () => {
        createOrderCalls += 1;
        return {
          body: {
            offramp: {
              order_id: "order-123",
              tx: {
                to: "0x3333333333333333333333333333333333333333",
                data: "0xabcdef",
                value: "42",
                chain: "base",
              },
            },
          },
        };
      },
    },
  });

  assert.equal(getQuoteCalls, 1);
  assert.equal(createOrderCalls, 1);
  assert.equal(hydrated.txTo, "0x3333333333333333333333333333333333333333");
  assert.equal(hydrated.txData, "0xabcdef");
  assert.equal(hydrated.txValueWei, "42");
  assert.equal(hydrated.txChain, "base");
  assert.equal(hydrated.txDataBytes, 3);
  assert.equal(hydrated.executionHydratedFromOrder, true);
  assert.equal(hydrated.executionOrderId, "order-123");
});

test("hydrateStoredOfframpQuoteExecution leaves already executable quotes untouched", async () => {
  const quote = offrampQuote({
    txTo: "0x4444444444444444444444444444444444444444",
    txData: "0x12345678",
    txValueWei: "7",
  });
  let called = false;
  const hydrated = await hydrateStoredOfframpQuoteExecution(quote, {
    client: {
      getQuote: async () => {
        called = true;
        throw new Error("should not fetch");
      },
      createOrder: async () => {
        called = true;
        throw new Error("should not create order");
      },
    },
  });

  assert.equal(called, false);
  assert.equal(hydrated.txTo, quote.txTo);
  assert.equal(hydrated.txData, quote.txData);
  assert.equal(hydrated.executionHydratedFromOrder, false);
});

test("classifyExecutableQuoteHydrationError normalizes gateway errors", () => {
  const error = new GatewayError("Gateway request failed", {
    status: 422,
    body: {
      code: "QUOTE_AMOUNT_TOO_LOW",
    },
  });
  assert.equal(classifyExecutableQuoteHydrationError(error), "quote_amount_too_low");
});
