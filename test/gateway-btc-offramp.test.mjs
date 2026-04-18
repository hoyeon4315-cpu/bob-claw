import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGatewayBtcOfframpPlan, executeGatewayBtcOfframpPlan } from "../src/executor/helpers/gateway-btc-offramp.mjs";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { GatewayError } from "../src/gateway/client.mjs";

function gatewayClientFixture() {
  return {
    getQuote: async () => ({
      latencyMs: 222,
      body: {
        offramp: {
          inputAmount: {
            amount: "5000",
            address: WBTC_OFT_TOKEN,
            chain: "base",
          },
          outputAmount: {
            amount: "4110",
            address: WBTC_OFT_TOKEN,
            chain: "bob",
          },
          fees: {
            amount: "882",
            address: WBTC_OFT_TOKEN,
            chain: "bob",
          },
          feeBreakdown: {
            inclusionFee: {
              amount: "880",
              address: WBTC_OFT_TOKEN,
              chain: "bob",
            },
          },
          txTo: WBTC_OFT_TOKEN,
          estimatedTimeInSecs: 60,
        },
      },
    }),
    createOrder: async () => ({
      body: {
        offramp: {
          order_id: "order-456",
          tx: {
            to: WBTC_OFT_TOKEN,
            data: "0xc7c7f5b3",
            value: "12345",
            chain: "base",
          },
        },
      },
    }),
  };
}

test("gateway btc offramp plan creates a signer-ready live intent", async () => {
  const plan = await buildGatewayBtcOfframpPlan({
    client: gatewayClientFixture(),
    priceReader: async () => ({ btc: 100_000, tokenByKey: { btc: 100_000 } }),
    estimateGasImpl: async () => ({
      observedAt: "2026-04-16T06:00:01.000Z",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      latencyMs: 20,
      gasUnits: 210_000,
      gasUnitsHex: "0x33450",
      rpcFallbacksTried: 0,
    }),
    srcChain: "base",
    srcToken: "wbtc.oft",
    amount: "5000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "bc1qrecipient0000000000000000000000000000000",
    now: "2026-04-16T06:00:00.000Z",
  });

  assert.equal(plan.strategyId, "gateway-btc-offramp");
  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.amountUsd, 5);
  assert.equal(plan.order.orderId, "order-456");
  assert.equal(plan.intent.tx.gasLimit, "252000");
  assert.equal(plan.intent.metadata.gatewayExpectedBitcoinSats, "4110");
});

test("gateway btc offramp plan blocks when gas preflight fails", async () => {
  const plan = await buildGatewayBtcOfframpPlan({
    client: gatewayClientFixture(),
    priceReader: async () => ({ btc: 100_000, tokenByKey: { btc: 100_000 } }),
    estimateGasImpl: async () => {
      throw new Error("execution reverted: paused");
    },
    srcChain: "base",
    amount: "5000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "bc1qrecipient0000000000000000000000000000000",
  });

  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "execution_reverted");
  assert.equal(plan.intent, null);
});

test("gateway btc offramp plan keeps deterministic gateway quote blockers as blocked plans", async () => {
  const plan = await buildGatewayBtcOfframpPlan({
    client: {
      getQuote: async () => {
        throw new GatewayError("Gateway request failed", {
          url: "https://gateway.example/v1/get-quote",
          status: 422,
          latencyMs: 300,
          body: {
            code: "QUOTE_AMOUNT_TOO_LOW",
            error: "Quote amount too low. Minimum required: 5000, but got 1000",
            details: {
              minimum: "5000",
              actual: "1000",
            },
          },
        });
      },
      createOrder: async () => {
        throw new Error("createOrder should not run when quote fails");
      },
    },
    srcChain: "bera",
    amount: "1000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "bc1qrecipient0000000000000000000000000000000",
  });

  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "quote_amount_too_low");
  assert.equal(plan.gatewayError.details.body.code, "QUOTE_AMOUNT_TOO_LOW");
  assert.equal(plan.quote, null);
  assert.equal(plan.intent, null);
});

test("gateway btc offramp execution waits for bitcoin balance proof", async () => {
  const plan = await buildGatewayBtcOfframpPlan({
    client: gatewayClientFixture(),
    priceReader: async () => ({ btc: 100_000, tokenByKey: { btc: 100_000 } }),
    estimateGasImpl: async () => ({
      observedAt: "2026-04-16T06:00:01.000Z",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      latencyMs: 20,
      gasUnits: 200_000,
      gasUnitsHex: "0x30d40",
      rpcFallbacksTried: 0,
    }),
    srcChain: "base",
    amount: "5000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "bc1qrecipient0000000000000000000000000000000",
  });

  let reads = 0;
  const execution = await executeGatewayBtcOfframpPlan({
    plan,
    receiptIngest: async () => ({ appended: false, reason: "test_stub" }),
    bitcoinSettlementTimeoutMs: 1_000,
    bitcoinPollIntervalMs: 0,
    readBitcoinBalanceImpl: async () => {
      reads += 1;
      return {
        proofSource: "bitcoin_address_balance_delta",
        source: "https://mempool.example",
        balance: BigInt(reads > 1 ? 4_110 : 0),
      };
    },
    sendCommand: async () => ({
      status: "ok",
      broadcast: {
        txHash: "0xhash",
      },
      receipt: {
        hash: "0xhash",
        status: 1,
      },
    }),
  });

  assert.equal(execution.signerResult.broadcast.txHash, "0xhash");
  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.destinationProof.observedDelta, "4110");
});
