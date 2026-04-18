import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGatewayBtcOnrampPlan, executeGatewayBtcOnrampPlan } from "../src/executor/helpers/gateway-btc-onramp.mjs";
import { ZERO_TOKEN } from "../src/assets/tokens.mjs";
import { GatewayError } from "../src/gateway/client.mjs";

function gatewayClientFixture() {
  return {
    getQuote: async () => ({
      body: {
        onramp: {
          inputAmount: {
            amount: "100000",
            address: "0x0000000000000000000000000000000000000000",
            chain: "bitcoin",
          },
          outputAmount: {
            amount: "74240811",
            address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            chain: "base",
          },
          fees: {
            amount: "1239",
            address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
            chain: "bob",
          },
          executionFees: {
            amount: "81",
            address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
            chain: "bob",
          },
          feeBreakdown: {
            protocolFee: { amount: "50", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", chain: "bob" },
          },
          recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
          sender: "bc1qpkdqyrycv900kh97jctjn83e2ypc0xfmhv8546",
          signedQuoteData: "0xfeedbeef",
          slippage: "50",
          strategyAddress: "0x4572ce66cB33255B60a15e3c6cb2ef9c65A30ebC",
          strategyMessage: "0x1234",
          token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
          estimatedTimeInSecs: 394,
        },
      },
    }),
    createOrder: async () => ({
      body: {
        onramp: {
          order_id: "order-123",
          address: "bc1qdepositaddress0000000000000000000000000000",
          op_return_data: "",
          psbt_hex: "cHNidP8BAAoCAAAAAA==",
        },
      },
    }),
    registerTx: async (payload) => ({
      body: {
        onramp: {
          txid: payload.onramp.bitcoin_txid,
        },
      },
    }),
    getOrder: async () => ({
      body: {
        id: "order-123",
        status: "success",
      },
    }),
  };
}

test("gateway btc onramp plan creates a signer-ready PSBT intent", async () => {
  const plan = await buildGatewayBtcOnrampPlan({
    client: gatewayClientFixture(),
    priceReader: async () => ({ btc: 100_000 }),
    senderAddress: "bc1qpkdqyrycv900kh97jctjn83e2ypc0xfmhv8546",
    recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    amountSats: 100_000,
    dstToken: "USDC",
    now: "2026-04-16T03:00:00.000Z",
  });

  assert.equal(plan.strategyId, "gateway-btc-onramp");
  assert.equal(plan.amountUsd, 100);
  assert.equal(plan.order.orderId, "order-123");
  assert.equal(plan.intent.btc.psbtHex, "cHNidP8BAAoCAAAAAA==");
  assert.equal(plan.intent.quote.depositAddress, "bc1qdepositaddress0000000000000000000000000000");
});

test("gateway btc onramp execution registers the broadcast tx back to Gateway", async () => {
  const client = gatewayClientFixture();
  const plan = await buildGatewayBtcOnrampPlan({
    client,
    priceReader: async () => ({ btc: 100_000 }),
    senderAddress: "bc1qpkdqyrycv900kh97jctjn83e2ypc0xfmhv8546",
    recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    amountSats: 100_000,
  });
  const execution = await executeGatewayBtcOnrampPlan({
    plan,
    client,
    sendCommand: async () => ({
      status: "ok",
      signed: { signedTx: "02000000" },
      broadcast: { txHash: "aa".repeat(32) },
    }),
  });

  assert.equal(execution.signerResult.broadcast.txHash, "aa".repeat(32));
  assert.equal(execution.registerPayload.onramp.order_id, "order-123");
  assert.equal(execution.registerResult.body.onramp.txid, "aa".repeat(32));
});

test("gateway btc onramp preview can surface insufficient confirmed funds without fabricating a PSBT", async () => {
  const plan = await buildGatewayBtcOnrampPlan({
    client: {
      ...gatewayClientFixture(),
      createOrder: async () => {
        throw new GatewayError("Gateway request failed", {
          body: {
            code: "INSUFFICIENT_CONFIRMED_FUNDS",
            error: "Insufficient confirmed bitcoin balance",
          },
        });
      },
    },
    priceReader: async () => ({ btc: 100_000 }),
    senderAddress: "bc1qpkdqyrycv900kh97jctjn83e2ypc0xfmhv8546",
    recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    amountSats: 100_000,
    allowUnfundedPreview: true,
  });

  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "insufficient_confirmed_bitcoin_balance");
  assert.equal(plan.intent, null);
  assert.equal(plan.order, null);
});

test("gateway btc onramp plan accepts native ETH destination aliases", async () => {
  const plan = await buildGatewayBtcOnrampPlan({
    client: {
      ...gatewayClientFixture(),
      getQuote: async () => ({
        body: {
          onramp: {
            ...(await gatewayClientFixture().getQuote()).body.onramp,
            outputAmount: {
              amount: "2815964105455293",
              address: ZERO_TOKEN,
              chain: "base",
            },
          },
        },
      }),
    },
    priceReader: async () => ({ btc: 100_000 }),
    senderAddress: "bc1qpkdqyrycv900kh97jctjn83e2ypc0xfmhv8546",
    recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    amountSats: 10_000,
    dstChain: "base",
    dstToken: "ETH",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.dstAsset.ticker, "ETH");
  assert.equal(plan.dstAsset.token, ZERO_TOKEN);
  assert.equal(plan.intent.quote.route.dstToken, ZERO_TOKEN);
});

test("gateway btc onramp execution recovers order state by txid after register failure", async () => {
  const client = {
    ...gatewayClientFixture(),
    registerTx: async () => {
      throw new GatewayError("Gateway request failed", {
        status: 502,
        body: {
          code: "BAD_GATEWAY",
          error: "upstream timeout",
        },
      });
    },
  };
  const plan = await buildGatewayBtcOnrampPlan({
    client,
    priceReader: async () => ({ btc: 100_000 }),
    senderAddress: "bc1qpkdqyrycv900kh97jctjn83e2ypc0xfmhv8546",
    recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    amountSats: 100_000,
  });
  const execution = await executeGatewayBtcOnrampPlan({
    plan,
    client,
    sendCommand: async () => ({
      status: "ok",
      signed: { signedTx: "02000000" },
      broadcast: { txHash: "bb".repeat(32) },
    }),
  });

  assert.equal(execution.signerResult.broadcast.txHash, "bb".repeat(32));
  assert.equal(execution.registerResult, undefined);
  assert.equal(execution.registerRecovered, true);
  assert.equal(execution.orderLookup.body.id, "order-123");
  assert.equal(execution.registerError.name, "GatewayError");
  assert.equal(execution.registerError.details.body.code, "BAD_GATEWAY");
});
