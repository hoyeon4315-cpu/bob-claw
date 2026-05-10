import { WBTC_OFT_TOKEN, ZERO_TOKEN, tokenAsset } from "../../assets/tokens.mjs";
import { config } from "../../config/env.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { executionEvFallbackCostUsd, tinyCanarySameChainRoundTripCostUsd } from "../../config/sizing.mjs";
import { GatewayClient, GatewayError, classifyGatewayBlockedReason, isDeterministicGatewayBlock, parseGatewayOrder } from "../../gateway/client.mjs";
import { buildGatewayQuoteParams } from "../../gateway/quote-params.mjs";
import { getCoinGeckoPricesUsd } from "../../market/prices.mjs";
import { appendSignerAuditRecord, buildSignerAuditRecord } from "../signer/audit-log.mjs";
import { sendSignerCommand } from "../signer/client.mjs";

export const GATEWAY_BTC_ONRAMP_STRATEGY_ID = "gateway-btc-onramp";
export const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_OUSDT_TOKEN = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";
export const BITCOIN_ZERO_TOKEN = "0x0000000000000000000000000000000000000000";

const TOKEN_ALIASES = Object.freeze({
  native: ZERO_TOKEN,
  eth: ZERO_TOKEN,
  usdc: BASE_USDC_TOKEN,
  "wbtc.oft": WBTC_OFT_TOKEN,
  wbtc_oft: WBTC_OFT_TOKEN,
  ousdt: BASE_OUSDT_TOKEN,
});

function toPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeTokenAddress(token) {
  if (!token) return BASE_USDC_TOKEN;
  const normalized = String(token).trim();
  const alias = TOKEN_ALIASES[normalized.toLowerCase()];
  if (alias) return alias;
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) return normalized;
  throw new Error(`Unsupported onramp destination token: ${token}`);
}

function normalizeGasRefill(gasRefill) {
  if (gasRefill == null || gasRefill === "") return null;
  if (typeof gasRefill === "object") {
    return normalizeGasRefill(gasRefill.amount);
  }
  return String(toPositiveInteger(gasRefill, "gasRefill"));
}

function normalizeOnrampQuoteBody(body) {
  const quote = body?.onramp || null;
  if (!quote) {
    throw new Error("Gateway quote did not include onramp data");
  }
  if (!quote.inputAmount?.amount || !quote.outputAmount?.amount) {
    throw new Error("Gateway onramp quote is missing input or output amounts");
  }
  if (!quote.signedQuoteData) {
    throw new Error("Gateway onramp quote is missing signedQuoteData");
  }
  return quote;
}

function normalizeOnrampOrderBody(body) {
  const onramp = body?.onramp || null;
  if (!onramp?.order_id || !onramp?.address) {
    throw new Error("Gateway create-order did not return an onramp order");
  }
  return {
    orderId: onramp.order_id,
    address: onramp.address,
    opReturnData: onramp.op_return_data || null,
    psbtHex: onramp.psbt_hex || null,
  };
}

function serializeGatewayError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    ...(error instanceof GatewayError && error.details ? { details: error.details } : {}),
  };
}

export async function buildGatewayBtcOnrampPlan({
  client = new GatewayClient({ baseUrl: config.gatewayApiBase }),
  priceReader = getCoinGeckoPricesUsd,
  strategyId = GATEWAY_BTC_ONRAMP_STRATEGY_ID,
  senderAddress,
  recipient,
  amountSats,
  dstToken = BASE_USDC_TOKEN,
  dstChain = "base",
  slippageBps = config.slippageBps,
  strategyMessage = null,
  gasRefill = null,
  allowUnfundedPreview = false,
  now = new Date().toISOString(),
} = {}) {
  if (!senderAddress) throw new Error("BTC sender address is required");
  if (!recipient) throw new Error("Destination recipient is required");
  const strategyCaps = assertStrategyCaps(strategyId);
  const normalizedAmountSats = toPositiveInteger(amountSats, "amountSats");
  const normalizedDstToken = normalizeTokenAddress(dstToken);
  const normalizedGasRefill = normalizeGasRefill(gasRefill);
  const quoteParams = buildGatewayQuoteParams({
    route: {
      srcChain: "bitcoin",
      dstChain,
      srcToken: BITCOIN_ZERO_TOKEN,
      dstToken: normalizedDstToken,
    },
    amount: String(normalizedAmountSats),
    sender: senderAddress,
    recipient,
    slippage: String(slippageBps),
    strategyMessage,
    gasRefill: normalizedGasRefill,
  });
  const prices = await priceReader();
  const btcUsd = Number(prices?.btc);
  if (!Number.isFinite(btcUsd)) {
    throw new Error("Could not price BTC for gateway onramp plan");
  }
  const amountUsd = Number((((normalizedAmountSats || 0) / 1e8) * btcUsd).toFixed(6));
  let quoteResult = null;
  let quote = null;
  let order = null;
  let blockedReason = null;
  let gatewayError = null;
  try {
    quoteResult = await client.getQuote(quoteParams);
    quote = normalizeOnrampQuoteBody(quoteResult.body);
  } catch (error) {
    if (isDeterministicGatewayBlock(error)) {
      blockedReason = classifyGatewayBlockedReason(error);
      gatewayError = serializeGatewayError(error);
    } else {
      throw error;
    }
  }

  if (quote && !blockedReason) {
    try {
      const orderResult = await client.createOrder(quoteResult.body);
      order = normalizeOnrampOrderBody(orderResult.body);
      if (!order.psbtHex) {
        throw new Error("Gateway create-order did not return psbt_hex for signer-owned onramp execution");
      }
    } catch (error) {
      if (
        allowUnfundedPreview &&
        error instanceof GatewayError &&
        error.details?.body?.code === "INSUFFICIENT_CONFIRMED_FUNDS"
      ) {
        blockedReason = "insufficient_confirmed_bitcoin_balance";
        gatewayError = serializeGatewayError(error);
      } else if (isDeterministicGatewayBlock(error)) {
        blockedReason = classifyGatewayBlockedReason(error);
        gatewayError = serializeGatewayError(error);
      } else {
        throw error;
      }
    }
  }

  let expectedNetUsd = null;
  if (quote) {
    const dstAsset = tokenAsset(dstChain, normalizedDstToken);
    const outputDecimals = dstAsset.decimals ?? 6;
    const outputAmountRaw = Number(quote.outputAmount?.amount || 0);
    const outputAmountUsd = outputAmountRaw / 10 ** outputDecimals;
    const bridgeCostUsd = executionEvFallbackCostUsd({ chain: dstChain });
    const gasCostUsd = tinyCanarySameChainRoundTripCostUsd({ chain: dstChain });
    const slippageReserveUsd = outputAmountUsd * 0.005;
    expectedNetUsd = outputAmountUsd - bridgeCostUsd - gasCostUsd - slippageReserveUsd;
  }

  const plan = {
    schemaVersion: 1,
    observedAt: now,
    planStatus: order ? "ready" : "blocked",
    blockedReason,
    gatewayError,
    strategyId,
    senderAddress,
    recipient,
    dstChain,
    dstToken: normalizedDstToken,
    dstAsset: tokenAsset(dstChain, normalizedDstToken),
    amountSats: normalizedAmountSats,
    amountUsd,
    gasRefill: normalizedGasRefill,
    quote,
    order,
    intent: order
      ? {
      strategyId,
      chain: "bitcoin",
      family: "btc",
      intentType: "gateway_btc_onramp",
      amountUsd,
      mode: "live",
      observedAt: now,
      executionReason: "strategy_execution",
      quote: {
        observedAt: now,
        route: {
          srcChain: "bitcoin",
          dstChain,
          srcToken: BITCOIN_ZERO_TOKEN,
          dstToken: normalizedDstToken,
        },
        quoteType: "onramp",
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        fees: quote.fees,
        executionFees: quote.executionFees,
        feeBreakdown: quote.feeBreakdown || null,
        estimatedTimeInSecs: quote.estimatedTimeInSecs ?? null,
        signedQuoteData: quote.signedQuoteData,
        strategyAddress: quote.strategyAddress || null,
        strategyMessage: quote.strategyMessage || null,
        recipient,
        sender: senderAddress,
        orderId: order.orderId,
        depositAddress: order.address,
      },
      btc: {
        psbtHex: order.psbtHex,
        orderId: order.orderId,
        depositAddress: order.address,
        opReturnData: order.opReturnData,
      },
      strategyConfig: {
        intentTtlMs: strategyCaps.intentTtlMs,
      },
      metadata: {
        skipAutoIngest: true,
        gatewayOrderId: order.orderId,
        gatewayDepositAddress: order.address,
        gatewayDstToken: normalizedDstToken,
        ...(expectedNetUsd !== null ? { expectedNetUsd } : {}),
        ...(normalizedGasRefill ? { gatewayGasRefill: normalizedGasRefill } : {}),
      },
    }
      : null,
  };
  return plan;
}

export async function executeGatewayBtcOnrampPlan({
  plan,
  client = new GatewayClient({ baseUrl: config.gatewayApiBase }),
  sendCommand = sendSignerCommand,
  appendSignerAuditRecordImpl = appendSignerAuditRecord,
  socketPath,
  timeoutMs,
} = {}) {
  if (!plan?.order || !plan?.intent) {
    throw new Error(`Gateway BTC onramp plan is not executable: ${plan?.blockedReason || "missing_order"}`);
  }
  const signerResult = await sendCommand({
    socketPath,
    timeoutMs,
    message: {
      command: "sign_and_broadcast",
      intent: plan.intent,
      awaitConfirmation: false,
    },
  });
  if (signerResult?.status !== "ok" || !signerResult?.broadcast?.txHash) {
    throw new Error(signerResult?.error?.message || "Signer did not return a broadcasted BTC transaction");
  }
  const registerPayload = {
    onramp: {
      order_id: plan.order.orderId,
      bitcoin_txid: signerResult.broadcast.txHash,
      bitcoin_tx_hex: signerResult.signed?.signedTx || null,
    },
  };
  let registerResult;
  let orderLookup = null;
  let orderLifecycle = null;
  let registerRecovered = false;
  let registerError = null;
  let orderLookupError = null;
  try {
    registerResult = await client.registerTx(registerPayload);
  } catch (error) {
    registerError = serializeGatewayError(error);
    try {
      orderLookup = await client.getOrder(signerResult.broadcast.txHash);
    } catch {
      throw error;
    }
    if (!orderLookup?.body?.id) {
      throw error;
    }
    registerRecovered = true;
  }
  if (!orderLookup) {
    try {
      orderLookup = await client.getOrder(plan.order.orderId);
    } catch (error) {
      orderLookupError = serializeGatewayError(error);
    }
  }
  if (orderLookup?.body) {
    orderLifecycle = parseGatewayOrder(orderLookup.body);
    await appendGatewayOnrampLifecycleAuditRecords({
      plan,
      signerResult,
      orderLifecycle,
      appendSignerAuditRecordImpl,
    });
  }
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    plan,
    signerResult,
    registerPayload,
    registerResult,
    orderLookup,
    orderLifecycle,
    orderLookupError,
    registerRecovered,
    registerError,
  };
}

async function appendGatewayOnrampLifecycleAuditRecords({
  plan,
  signerResult,
  orderLifecycle,
  appendSignerAuditRecordImpl,
}) {
  if (typeof appendSignerAuditRecordImpl !== "function") return [];
  const records = [];
  const txHash = signerResult.broadcast.txHash;
  const buildIntent = () => ({
    ...plan.intent,
    intentId: `${plan.strategyId}:${plan.order.orderId}:lifecycle:${txHash}`,
    amountUsd: plan.amountUsd || 0,
  });
  const appendObservedRecord = async (stage, txField, tx) => {
    if (!tx) return;
    const record = buildSignerAuditRecord({
      intent: buildIntent(),
      policyVerdict: "observed",
      lifecycle: {
        stage,
        txHash,
        gatewayOrderId: plan.order.orderId,
        gatewayOrderStatus: orderLifecycle.status,
        [txField]: tx,
      },
    });
    await appendSignerAuditRecordImpl(record);
    records.push(record);
  };

  await appendObservedRecord("gateway_btc_onramp_bump_fee_observed", "bumpFeeTx", orderLifecycle.bumpFeeTx);
  await appendObservedRecord("gateway_btc_onramp_refund_observed", "refundTx", orderLifecycle.refundTx);
  return records;
}
