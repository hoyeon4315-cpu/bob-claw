import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGatewayBtcConsolidationPlan,
  DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  executeGatewayBtcConsolidationPlan,
} from "../src/executor/helpers/gateway-btc-consolidation.mjs";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";

function gatewayClientFixture() {
  return {
    getQuote: async () => ({
      latencyMs: 321,
      body: {
        layerZero: {
          inputAmount: {
            amount: "10000",
            address: WBTC_OFT_TOKEN,
            chain: "avalanche",
          },
          outputAmount: {
            amount: "10000",
            address: WBTC_OFT_TOKEN,
            chain: "base",
          },
          fees: {
            amount: "0",
            address: WBTC_OFT_TOKEN,
            chain: "avalanche",
          },
          executionFees: {
            amount: "0",
            address: WBTC_OFT_TOKEN,
            chain: "avalanche",
          },
          estimatedTimeInSecs: 60,
          tx: {
            to: WBTC_OFT_TOKEN,
            data: "0xc7c7f5b3",
            value: "74050734904669428",
            chain: "avalanche",
          },
        },
      },
    }),
  };
}

test("gateway btc consolidation plan normalizes quote data and injects buffered gas limit", async () => {
  const plan = await buildGatewayBtcConsolidationPlan({
    client: gatewayClientFixture(),
    priceReader: async () => ({ btc: 100_000, tokenByKey: { btc: 100_000 } }),
    estimateGasImpl: async () => ({
      observedAt: "2026-04-16T03:00:01.000Z",
      chain: "avalanche",
      rpcUrl: "https://rpc.example",
      latencyMs: 25,
      gasUnits: 240_000,
      gasUnitsHex: "0x3a980",
      rpcFallbacksTried: 0,
    }),
    srcChain: "avalanche",
    dstChain: "base",
    token: "wbtc.oft",
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
    now: "2026-04-16T03:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.strategyId, "gateway-btc-funding-transfer");
  assert.equal(plan.route.srcToken, WBTC_OFT_TOKEN);
  assert.equal(plan.amountUsd, 10);
  assert.equal(plan.quote.latencyMs, 321);
  assert.equal(plan.gasPreflight.gasBufferBps, DEFAULT_GATEWAY_GAS_BUFFER_BPS);
  assert.equal(plan.gasPreflight.gasLimit, 288000);
  assert.equal(plan.intent.tx.gasLimit, "288000");
  assert.equal(plan.intent.metadata.gatewayRouteKey, `${plan.route.srcChain}:${plan.route.srcToken}->${plan.route.dstChain}:${plan.route.dstToken}`);
});

test("gateway btc consolidation plan blocks when gas preflight fails", async () => {
  const plan = await buildGatewayBtcConsolidationPlan({
    client: gatewayClientFixture(),
    priceReader: async () => ({ btc: 100_000, tokenByKey: { btc: 100_000 } }),
    estimateGasImpl: async () => {
      throw new Error("execution reverted: gateway paused");
    },
    srcChain: "sonic",
    dstChain: "base",
    token: "wbtc.oft",
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
  });

  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "execution_reverted");
  assert.equal(plan.intent, null);
  assert.equal(plan.gasPreflight, null);
  assert.match(plan.preflightError.message, /gateway paused/);
});

test("gateway btc consolidation execution sends signer a buffered live intent", async () => {
  const plan = await buildGatewayBtcConsolidationPlan({
    client: gatewayClientFixture(),
    priceReader: async () => ({ btc: 100_000, tokenByKey: { btc: 100_000 } }),
    estimateGasImpl: async () => ({
      observedAt: "2026-04-16T03:00:01.000Z",
      chain: "avalanche",
      rpcUrl: "https://rpc.example",
      latencyMs: 25,
      gasUnits: 200_000,
      gasUnitsHex: "0x30d40",
      rpcFallbacksTried: 0,
    }),
    srcChain: "avalanche",
    dstChain: "base",
    token: "wbtc.oft",
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
  });

  let sentMessage = null;
  const execution = await executeGatewayBtcConsolidationPlan({
    plan,
    awaitConfirmation: true,
    confirmations: 2,
    confirmationTimeoutMs: 45_000,
    sendCommand: async ({ message }) => {
      sentMessage = message;
      return {
        status: "ok",
        signed: {
          txHash: "0xhash",
        },
        broadcast: {
          txHash: "0xhash",
        },
        receipt: {
          hash: "0xhash",
          status: 1,
        },
      };
    },
  });

  assert.equal(sentMessage.command, "sign_and_broadcast");
  assert.equal(sentMessage.awaitConfirmation, true);
  assert.equal(sentMessage.confirmations, 2);
  assert.equal(sentMessage.timeoutMs, 45_000);
  assert.equal(sentMessage.intent.tx.gasLimit, "240000");
  assert.equal(execution.signerResult.broadcast.txHash, "0xhash");
});
