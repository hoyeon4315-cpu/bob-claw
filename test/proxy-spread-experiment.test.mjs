import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import {
  buildProxySpreadExperimentPlan,
  executeProxySpreadExperimentPlan,
} from "../src/executor/helpers/proxy-spread-experiment.mjs";

test("proxy spread experiment preview composes buy, bridge, and sell plans", async () => {
  const gatewayBuilds = [];
  const buildTokenDexPlanImpl = async ({ chain, amount, inputToken, outputToken, strategyId }) => ({
    strategyId,
    planStatus: "ready",
    chain,
    amount,
    inputToken,
    outputToken: outputToken === "wbtc.oft" ? WBTC_OFT_TOKEN : outputToken,
    outputAsset: { token: outputToken === "wbtc.oft" ? WBTC_OFT_TOKEN : outputToken },
    minimumOutputAmount: chain === "base" ? "9950" : null,
    quote: { outputAmount: chain === "base" ? "10000" : "9925" },
  });
  const buildGatewayPlanImpl = async ({ strategyId, srcChain, dstChain, srcToken, dstToken, amount, skipPreflight }) => {
    gatewayBuilds.push({ strategyId, srcChain, dstChain, srcToken, dstToken, amount, skipPreflight });
    return {
      strategyId,
      planStatus: "ready",
      route: { srcChain, dstChain },
      srcAsset: { token: srcToken },
      dstAsset: { token: dstToken === "wbtc.oft" ? WBTC_OFT_TOKEN : dstToken },
      quote: { outputAmount: { amount: amount } },
    };
  };

  const plan = await buildProxySpreadExperimentPlan({
    buyChain: "base",
    sellChain: "unichain",
    amount: "1000000",
    senderAddress: "0x0000000000000000000000000000000000000001",
    buyToken: "wbtc.oft",
    sellToken: "wbtc.oft",
    buildTokenDexPlanImpl,
    buildGatewayPlanImpl,
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.estimatedBridgeAmount, "9950");
  assert.equal(plan.estimatedSellAmount, "9950");
  assert.equal(plan.buyPlan.inputToken, "usdc");
  assert.equal(plan.sellPlan.outputToken, "usdc");
  assert.equal(gatewayBuilds[0].skipPreflight, true);
});

test("proxy spread experiment execution rebuilds bridge and sell legs from observed deltas", async () => {
  const tokenBuilds = [];
  const gatewayBuilds = [];
  const buildTokenDexPlanImpl = async ({ chain, amount, inputToken, outputToken, strategyId }) => {
    tokenBuilds.push({ chain, amount, inputToken, outputToken, strategyId });
    return {
      strategyId,
      planStatus: "ready",
      chain,
      amount,
      inputToken,
      outputToken: outputToken === "wbtc.oft" ? WBTC_OFT_TOKEN : outputToken,
      outputAsset: { token: outputToken === "wbtc.oft" ? WBTC_OFT_TOKEN : outputToken },
      minimumOutputAmount: chain === "base" ? "9900" : null,
      quote: { outputAmount: chain === "base" ? "10000" : "9800" },
    };
  };
  const buildGatewayPlanImpl = async ({ strategyId, srcChain, dstChain, srcToken, dstToken, amount }) => {
    gatewayBuilds.push({ strategyId, srcChain, dstChain, srcToken, dstToken, amount });
    return {
      strategyId,
      planStatus: "ready",
      route: { srcChain, dstChain },
      srcAsset: { token: srcToken },
      dstAsset: { token: dstToken === "wbtc.oft" ? WBTC_OFT_TOKEN : dstToken },
      quote: { outputAmount: { amount } },
      intent: {},
      gasPreflight: {},
    };
  };
  const executeTokenDexPlanImpl = async ({ plan }) => ({
    settlementStatus: "delivered",
    stepResults: [{ signerResult: { broadcast: { txHash: `0x${plan.chain}-dex` } } }],
    destinationProof: {
      status: "delivered",
      observedDelta: plan.chain === "base" ? "10012" : "7450000",
    },
  });
  const executeGatewayPlanImpl = async () => ({
    settlementStatus: "delivered",
    signerResult: { broadcast: { txHash: "0xbridge" } },
    destinationProof: {
      status: "delivered",
      observedDelta: "9988",
    },
  });

  const previewPlan = await buildProxySpreadExperimentPlan({
    buyChain: "base",
    sellChain: "unichain",
    amount: "1000000",
    senderAddress: "0x0000000000000000000000000000000000000001",
    buyToken: "wbtc.oft",
    sellToken: "wbtc.oft",
    buildTokenDexPlanImpl,
    buildGatewayPlanImpl,
  });

  const execution = await executeProxySpreadExperimentPlan({
    plan: previewPlan,
    buildTokenDexPlanImpl,
    executeTokenDexPlanImpl,
    buildGatewayPlanImpl,
    executeGatewayPlanImpl,
  });

  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(gatewayBuilds.at(-1).amount, "10012");
  assert.equal(tokenBuilds.at(-1).chain, "unichain");
  assert.equal(tokenBuilds.at(-1).amount, "9988");
  assert.equal(execution.sellExecution.destinationProof.observedDelta, "7450000");
});
