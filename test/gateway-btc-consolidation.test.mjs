import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGatewayBtcConsolidationPlan,
  DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  executeGatewayBtcConsolidationPlan,
} from "../src/executor/helpers/gateway-btc-consolidation.mjs";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { GatewayError } from "../src/gateway/client.mjs";

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

test("gateway btc consolidation plan preserves deterministic gateway quote blockers", async () => {
  const plan = await buildGatewayBtcConsolidationPlan({
    client: {
      getQuote: async () => {
        throw new GatewayError("Gateway request failed", {
          status: 404,
          body: {
            code: "NO_ROUTE",
            message: "No route available",
          },
        });
      },
    },
    priceReader: async () => ({ btc: 100_000, tokenByKey: { btc: 100_000 } }),
    srcChain: "base",
    dstChain: "ethereum",
    token: "wbtc.oft",
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
  });

  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "no_route");
  assert.equal(plan.intent, null);
  assert.equal(plan.gasPreflight, null);
  assert.equal(plan.gatewayError.details.body.code, "NO_ROUTE");
  assert.equal(plan.preflightError, null);
  assert.equal(plan.amountUsd, 10);
});

test("gateway btc consolidation plan classifies zero-limit gateway pauses explicitly", async () => {
  const plan = await buildGatewayBtcConsolidationPlan({
    client: {
      getQuote: async () => {
        throw new GatewayError("Gateway request failed", {
          status: 429,
          body: {
            code: "EXCEEDED_LIMIT",
            error: "Requested amount exceeds current limit of 0 BTC",
            details: {
              limit: "0 BTC",
            },
          },
        });
      },
    },
    priceReader: async () => ({ btc: 100_000, tokenByKey: { btc: 100_000 } }),
    srcChain: "base",
    dstChain: "bera",
    token: "wbtc.oft",
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
  });

  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "gateway_zero_btc_limit");
  assert.equal(plan.gatewayError.details.body.code, "EXCEEDED_LIMIT");
  assert.equal(plan.intent, null);
});

test("gateway btc consolidation preview can skip preflight and still preserve quote data", async () => {
  let estimateCalls = 0;
  const plan = await buildGatewayBtcConsolidationPlan({
    client: gatewayClientFixture(),
    priceReader: async () => ({ btc: 100_000, tokenByKey: { btc: 100_000 } }),
    estimateGasImpl: async () => {
      estimateCalls += 1;
      throw new Error("should not be called");
    },
    srcChain: "base",
    dstChain: "bera",
    token: "wbtc.oft",
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
    skipPreflight: true,
  });

  assert.equal(estimateCalls, 0);
  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.executionReady, false);
  assert.equal(plan.skipPreflight, true);
  assert.equal(plan.intent, null);
  assert.equal(plan.gasPreflight, null);
  assert.equal(plan.quote.route.dstChain, "bera");
});

test("gateway btc consolidation plan forwards gas refill for destination native bootstrap", async () => {
  let capturedParams = null;
  const plan = await buildGatewayBtcConsolidationPlan({
    client: {
      ...gatewayClientFixture(),
      getQuote: async (params) => {
        capturedParams = params;
        return gatewayClientFixture().getQuote();
      },
    },
    priceReader: async () => ({ btc: 100_000, tokenByKey: { btc: 100_000 } }),
    estimateGasImpl: async () => ({
      observedAt: "2026-04-16T03:00:01.000Z",
      chain: "base",
      rpcUrl: "https://rpc.example",
      latencyMs: 25,
      gasUnits: 240_000,
      gasUnitsHex: "0x3a980",
      rpcFallbacksTried: 0,
    }),
    srcChain: "base",
    dstChain: "bsc",
    token: "wbtc.oft",
    amount: "10000",
    gasRefill: { amount: "1000000000000000" },
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.gasRefill, "1000000000000000");
  assert.equal(plan.quote.gasRefill, "1000000000000000");
  assert.equal(capturedParams.gasRefill, "1000000000000000");
  assert.equal(plan.intent.metadata.gatewayGasRefill, "1000000000000000");
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
    receiptIngest: async () => ({ appended: false, reason: "test_stub" }),
    awaitConfirmation: true,
    awaitDestinationSettlement: true,
    confirmations: 2,
    confirmationTimeoutMs: 45_000,
    destinationSettlementTimeoutMs: 1_000,
    destinationPollIntervalMs: 0,
    readErc20BalanceImpl: async () => ({
      rpcUrl: "https://base-rpc.example",
      balance: sentMessage ? 11_000n : 1_000n,
    }),
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
  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.destinationProof.observedDelta, "10000");
  assert.equal(execution.destinationProof.requiredDelta, "10000");
});

test("gateway btc consolidation execution distinguishes source confirmation from destination proof timeout", async () => {
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

  const execution = await executeGatewayBtcConsolidationPlan({
    plan,
    receiptIngest: async () => ({ appended: false, reason: "test_stub" }),
    awaitDestinationSettlement: true,
    destinationSettlementTimeoutMs: 0,
    destinationPollIntervalMs: 0,
    readErc20BalanceImpl: async () => ({
      rpcUrl: "https://base-rpc.example",
      balance: 1_000n,
    }),
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
  assert.equal(execution.settlementStatus, "unproven_timeout");
  assert.equal(execution.destinationProof.observedDelta, "0");
  assert.equal(execution.destinationProof.requiredDelta, "10000");
});

test("gateway btc consolidation execution preserves signer rejection details", async () => {
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

  const execution = await executeGatewayBtcConsolidationPlan({
    plan,
    receiptIngest: async () => ({ appended: false, reason: "test_stub" }),
    awaitDestinationSettlement: false,
    sendCommand: async () => ({
      status: "rejected",
      policy: {
        blockers: ["strategy_per_day_cap_exceeded"],
      },
    }),
  });

  assert.equal(execution.settlementStatus, "signer_rejected");
  assert.equal(execution.signerResult.status, "rejected");
  assert.equal(execution.signerResult.policy.blockers[0], "strategy_per_day_cap_exceeded");
  assert.equal(execution.destinationProof, null);
});
