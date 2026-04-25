import { isBtcLikeAsset, tokenAsset } from "../../assets/tokens.mjs";
import { config } from "../../config/env.mjs";
import {
  buildGatewayBtcConsolidationPlan,
  executeGatewayBtcConsolidationPlan,
  GATEWAY_BTC_CONSOLIDATION_STRATEGY_ID,
} from "./gateway-btc-consolidation.mjs";
import {
  buildTokenDexExperimentPlan,
  executeTokenDexExperimentPlan,
  TOKEN_DEX_EXPERIMENT_STRATEGY_ID,
} from "./token-dex-experiment.mjs";

export const PROXY_SPREAD_EXPERIMENT_STRATEGY_ID = "proxy-spread-experiment";

function positiveBigIntString(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[0-9]+$/.test(normalized) || normalized === "0") {
    throw new Error(`${label} must be a positive integer`);
  }
  return normalized;
}

function positiveObservedDelta(result, label) {
  const observed = result?.destinationProof?.observedDelta;
  return positiveBigIntString(observed, label);
}

function blockedPlan(stage, blockedReason, details = {}) {
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    planStatus: "blocked",
    blockedStage: stage,
    blockedReason,
    ...details,
  };
}

export async function buildProxySpreadExperimentPlan({
  strategyId = PROXY_SPREAD_EXPERIMENT_STRATEGY_ID,
  buyChain,
  sellChain,
  amount,
  senderAddress,
  recipient = senderAddress,
  buyInputToken = "usdc",
  buyToken,
  sellToken = buyToken,
  sellOutputToken = "usdc",
  buildTokenDexPlanImpl = buildTokenDexExperimentPlan,
  buildGatewayPlanImpl = buildGatewayBtcConsolidationPlan,
} = {}) {
  if (!buyChain) throw new Error("buyChain is required");
  if (!sellChain) throw new Error("sellChain is required");
  if (buyChain === sellChain) throw new Error("buyChain and sellChain must differ");
  if (!senderAddress) throw new Error("senderAddress is required");
  if (!recipient) throw new Error("recipient is required");
  if (!buyToken) throw new Error("buyToken is required");

  const buyPlan = await buildTokenDexPlanImpl({
    strategyId,
    chain: buyChain,
    amount,
    senderAddress,
    inputToken: buyInputToken,
    outputToken: buyToken,
  });
  if (buyPlan.planStatus !== "ready") {
    return blockedPlan("buy", buyPlan.blockedReason || "buy_plan_blocked", { buyPlan });
  }

  if (!isBtcLikeAsset(tokenAsset(buyChain, buyPlan.outputToken))) {
    throw new Error(`Proxy spread buy leg must output a BTC-family asset, received ${tokenAsset(buyChain, buyPlan.outputToken).ticker}`);
  }

  const estimatedBridgeAmount = positiveBigIntString(
    buyPlan.minimumOutputAmount || buyPlan.quote?.outputAmount,
    "estimatedBridgeAmount",
  );

  const bridgePlan = await buildGatewayPlanImpl({
    strategyId,
    srcChain: buyChain,
    dstChain: sellChain,
    srcToken: buyPlan.outputToken,
    dstToken: sellToken,
    amount: estimatedBridgeAmount,
    senderAddress,
    recipient,
    slippageBps: config.slippageBps,
    skipPreflight: true,
  });
  if (bridgePlan.planStatus !== "ready") {
    return blockedPlan("bridge", bridgePlan.blockedReason || "bridge_plan_blocked", {
      buyPlan,
      estimatedBridgeAmount,
      bridgePlan,
    });
  }

  if (!isBtcLikeAsset(tokenAsset(sellChain, bridgePlan.dstAsset?.token || sellToken))) {
    throw new Error(
      `Proxy spread bridge leg must deliver a BTC-family asset, received ${tokenAsset(sellChain, bridgePlan.dstAsset?.token || sellToken).ticker}`,
    );
  }

  const estimatedSellAmount = positiveBigIntString(
    bridgePlan.quote?.outputAmount?.amount || estimatedBridgeAmount,
    "estimatedSellAmount",
  );

  const sellPlan = await buildTokenDexPlanImpl({
    strategyId,
    chain: sellChain,
    amount: estimatedSellAmount,
    senderAddress,
    inputToken: sellToken,
    outputToken: sellOutputToken,
  });
  if (sellPlan.planStatus !== "ready") {
    return blockedPlan("sell", sellPlan.blockedReason || "sell_plan_blocked", {
      buyPlan,
      estimatedBridgeAmount,
      bridgePlan,
      estimatedSellAmount,
      sellPlan,
    });
  }

  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    planStatus: "ready",
    strategyId,
    buyChain,
    sellChain,
    senderAddress,
    recipient,
    amount: positiveBigIntString(amount, "amount"),
    buyInputToken: buyPlan.inputToken,
    buyToken: buyPlan.outputToken,
    sellToken: sellPlan.inputToken,
    sellOutputToken: sellPlan.outputToken,
    estimatedBridgeAmount,
    estimatedSellAmount,
    buyPlan,
    bridgePlan,
    sellPlan,
    stageStrategyIds: {
      buy: buyPlan.strategyId || TOKEN_DEX_EXPERIMENT_STRATEGY_ID,
      bridge: bridgePlan.strategyId || GATEWAY_BTC_CONSOLIDATION_STRATEGY_ID,
      sell: sellPlan.strategyId || TOKEN_DEX_EXPERIMENT_STRATEGY_ID,
    },
  };
}

export async function executeProxySpreadExperimentPlan({
  plan,
  strategyId = PROXY_SPREAD_EXPERIMENT_STRATEGY_ID,
  buildTokenDexPlanImpl = buildTokenDexExperimentPlan,
  executeTokenDexPlanImpl = executeTokenDexExperimentPlan,
  buildGatewayPlanImpl = buildGatewayBtcConsolidationPlan,
  executeGatewayPlanImpl = executeGatewayBtcConsolidationPlan,
  socketPath,
  timeoutMs,
  awaitConfirmation = true,
  confirmations = 1,
  confirmationTimeoutMs = 120_000,
  awaitDestinationSettlement = true,
  destinationSettlementTimeoutMs = undefined,
  destinationPollIntervalMs = 5_000,
} = {}) {
  if (plan?.planStatus !== "ready") {
    throw new Error(`Proxy spread experiment plan is not executable: ${plan?.blockedReason || "missing_plan"}`);
  }

  const executionOptions = {
    socketPath,
    timeoutMs,
    awaitConfirmation,
    confirmations,
    confirmationTimeoutMs,
    awaitDestinationSettlement,
    destinationSettlementTimeoutMs,
    destinationPollIntervalMs,
  };

  const buyExecution = await executeTokenDexPlanImpl({
    plan: plan.buyPlan,
    ...executionOptions,
  });
  if (buyExecution?.settlementStatus !== "delivered") {
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      settlementStatus: "buy_leg_not_delivered",
      strategyId,
      plan,
      buyExecution,
      bridgePlan: null,
      bridgeExecution: null,
      sellPlan: null,
      sellExecution: null,
    };
  }

  const actualBridgeAmount = positiveObservedDelta(buyExecution, "actualBridgeAmount");
  const actualBridgePlan = await buildGatewayPlanImpl({
    strategyId,
    srcChain: plan.buyChain,
    dstChain: plan.sellChain,
    srcToken: plan.buyToken,
    dstToken: plan.sellToken,
    amount: actualBridgeAmount,
    senderAddress: plan.senderAddress,
    recipient: plan.recipient,
    slippageBps: config.slippageBps,
  });
  if (actualBridgePlan.planStatus !== "ready") {
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      settlementStatus: "bridge_plan_blocked",
      strategyId,
      plan,
      buyExecution,
      bridgePlan: actualBridgePlan,
      bridgeExecution: null,
      sellPlan: null,
      sellExecution: null,
    };
  }

  const bridgeExecution = await executeGatewayPlanImpl({
    plan: actualBridgePlan,
    ...executionOptions,
  });
  if (bridgeExecution?.settlementStatus !== "delivered") {
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      settlementStatus: bridgeExecution?.settlementStatus || "bridge_leg_not_delivered",
      strategyId,
      plan,
      buyExecution,
      bridgePlan: actualBridgePlan,
      bridgeExecution,
      sellPlan: null,
      sellExecution: null,
    };
  }

  const actualSellAmount = positiveObservedDelta(bridgeExecution, "actualSellAmount");
  const actualSellPlan = await buildTokenDexPlanImpl({
    strategyId,
    chain: plan.sellChain,
    amount: actualSellAmount,
    senderAddress: plan.senderAddress,
    inputToken: plan.sellToken,
    outputToken: plan.sellOutputToken,
  });
  if (actualSellPlan.planStatus !== "ready") {
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      settlementStatus: "sell_plan_blocked",
      strategyId,
      plan,
      buyExecution,
      bridgePlan: actualBridgePlan,
      bridgeExecution,
      sellPlan: actualSellPlan,
      sellExecution: null,
    };
  }

  const sellExecution = await executeTokenDexPlanImpl({
    plan: actualSellPlan,
    ...executionOptions,
  });

  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: sellExecution?.settlementStatus || "source_confirmed_only",
    strategyId,
    plan,
    buyExecution,
    bridgePlan: actualBridgePlan,
    bridgeExecution,
    sellPlan: actualSellPlan,
    sellExecution,
  };
}
