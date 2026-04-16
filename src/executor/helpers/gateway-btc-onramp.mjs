import { WBTC_OFT_TOKEN, tokenAsset } from "../../assets/tokens.mjs";
import { config } from "../../config/env.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { GatewayClient, GatewayError } from "../../gateway/client.mjs";
import { getCoinGeckoPricesUsd } from "../../market/prices.mjs";
import { sendSignerCommand } from "../signer/client.mjs";

export const GATEWAY_BTC_ONRAMP_STRATEGY_ID = "gateway-btc-onramp";
export const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_OUSDT_TOKEN = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";
export const BITCOIN_ZERO_TOKEN = "0x0000000000000000000000000000000000000000";

const TOKEN_ALIASES = Object.freeze({
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
  const quoteParams = {
    srcChain: "bitcoin",
    dstChain,
    srcToken: BITCOIN_ZERO_TOKEN,
    dstToken: normalizedDstToken,
    amount: String(normalizedAmountSats),
    sender: senderAddress,
    recipient,
    slippage: String(slippageBps),
    ...(strategyMessage ? { strategyMessage } : {}),
    ...(gasRefill ? { gasRefill } : {}),
  };
  const quoteResult = await client.getQuote(quoteParams);
  const quote = normalizeOnrampQuoteBody(quoteResult.body);
  const prices = await priceReader();
  const btcUsd = Number(prices?.btc);
  if (!Number.isFinite(btcUsd)) {
    throw new Error("Could not price BTC for gateway onramp plan");
  }
  const inputSats = toPositiveInteger(quote.inputAmount.amount, "quote.inputAmount.amount");
  const amountUsd = Number(((inputSats / 1e8) * btcUsd).toFixed(6));
  let order = null;
  let blockedReason = null;
  let gatewayError = null;
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
      gatewayError = error.details.body;
    } else {
      throw error;
    }
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
  const registerResult = await client.registerTx(registerPayload);
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    plan,
    signerResult,
    registerPayload,
    registerResult,
  };
}
