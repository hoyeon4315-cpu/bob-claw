import { ZERO_TOKEN, WBTC_OFT_TOKEN, tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { config } from "../../config/env.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { classifyGasEstimateError, estimateGas } from "../../gas/rpc-gas.mjs";
import { GatewayClient, GatewayError } from "../../gateway/client.mjs";
import { getCoinGeckoPricesUsd, priceForAssetUsd } from "../../market/prices.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";
import {
  defaultSettlementTimeoutMs,
  readBitcoinAddressBalance,
  sleep,
  waitForBitcoinBalanceDelta,
} from "./settlement-proof.mjs";

export const GATEWAY_BTC_OFFRAMP_STRATEGY_ID = "gateway-btc-offramp";
export const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_OUSDT_TOKEN = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";

const TOKEN_ALIASES = Object.freeze({
  native: ZERO_TOKEN,
  eth: ZERO_TOKEN,
  usdc: BASE_USDC_TOKEN,
  ousdt: BASE_OUSDT_TOKEN,
  "wbtc.oft": WBTC_OFT_TOKEN,
  wbtc_oft: WBTC_OFT_TOKEN,
});

function toPositiveIntegerString(value, label) {
  if (typeof value === "bigint") {
    if (value <= 0n) throw new Error(`${label} must be a positive integer`);
    return value.toString();
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!/^[0-9]+$/.test(normalized) || normalized === "0") {
      throw new Error(`${label} must be a positive integer`);
    }
    return normalized;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return String(value);
}

function toPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeTokenAddress(token) {
  if (!token) return WBTC_OFT_TOKEN;
  const normalized = String(token).trim();
  const alias = TOKEN_ALIASES[normalized.toLowerCase()];
  if (alias) return alias;
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) return normalized;
  throw new Error(`Unsupported offramp source token: ${token}`);
}

function normalizeOfframpQuoteBody(body) {
  const quote = body?.offramp || null;
  if (!quote) {
    throw new Error("Gateway quote did not include offramp data");
  }
  if (!quote.inputAmount?.amount || !quote.outputAmount?.amount || !quote.txTo) {
    throw new Error("Gateway offramp quote is missing required execution fields");
  }
  return quote;
}

function normalizeOfframpOrderBody(body) {
  const offramp = body?.offramp || null;
  if (!offramp?.order_id || !offramp?.tx?.to || !offramp?.tx?.data) {
    throw new Error("Gateway create-order did not return an executable offramp order");
  }
  return {
    orderId: offramp.order_id,
    tx: {
      to: offramp.tx.to,
      data: offramp.tx.data,
      value: String(offramp.tx.value || 0),
      chain: offramp.tx.chain || null,
    },
  };
}

function serializePreflightError(error) {
  return {
    name: error.name,
    message: error.message,
    attempts: error.attempts || null,
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

function normalizeGatewayBlockedReason(code) {
  const normalized = String(code || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
}

function classifyGatewayBlockedReason(error) {
  if (!(error instanceof GatewayError)) return null;
  const code = error.details?.body?.code || null;
  if (code) return normalizeGatewayBlockedReason(code);
  const status = Number(error.details?.status);
  if (status === 404) return "no_route";
  if (Number.isFinite(status) && status >= 400 && status < 500) return "gateway_request_rejected";
  return null;
}

function isDeterministicGatewayBlock(error) {
  if (!(error instanceof GatewayError)) return false;
  const status = Number(error.details?.status);
  return Number.isFinite(status) && status >= 400 && status < 500;
}

function amountUsdFromQuote(quote, asset, prices) {
  const assetUsd = priceForAssetUsd(asset, prices);
  if (!Number.isFinite(assetUsd)) {
    throw new Error(`Could not price ${asset.ticker} for gateway offramp plan`);
  }
  if (!Number.isInteger(asset.decimals)) {
    throw new Error(`Missing decimals for ${asset.ticker}`);
  }
  const amountDecimal = Number(BigInt(quote.inputAmount.amount)) / 10 ** asset.decimals;
  return Number((amountDecimal * assetUsd).toFixed(6));
}

export async function buildGatewayBtcOfframpPlan({
  client = new GatewayClient({ baseUrl: config.gatewayApiBase }),
  priceReader = getCoinGeckoPricesUsd,
  estimateGasImpl = estimateGas,
  strategyId = GATEWAY_BTC_OFFRAMP_STRATEGY_ID,
  srcChain,
  srcToken = WBTC_OFT_TOKEN,
  amount,
  senderAddress,
  recipient,
  slippageBps = config.slippageBps,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  now = new Date().toISOString(),
} = {}) {
  if (!senderAddress) throw new Error("EVM sender address is required");
  if (!recipient) throw new Error("Bitcoin recipient is required");
  if (!getEvmChainConfig(srcChain)) throw new Error(`Unsupported EVM source chain: ${srcChain}`);

  const strategyCaps = assertStrategyCaps(strategyId);
  const normalizedSrcToken = normalizeTokenAddress(srcToken);
  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const srcAsset = tokenAsset(srcChain, normalizedSrcToken);
  let quoteResult = null;
  let quote = null;
  let order = null;
  let amountUsd = null;
  let gatewayError = null;
  let blockedReason = null;

  try {
    quoteResult = await client.getQuote({
      srcChain,
      dstChain: "bitcoin",
      srcToken: normalizedSrcToken,
      dstToken: ZERO_TOKEN,
      amount: normalizedAmount,
      sender: senderAddress,
      recipient,
      slippage: String(slippageBps),
    });
    quote = normalizeOfframpQuoteBody(quoteResult.body);
    const orderResult = await client.createOrder(quoteResult.body);
    order = normalizeOfframpOrderBody(orderResult.body);
    const prices = await priceReader();
    amountUsd = amountUsdFromQuote(quote, srcAsset, prices);
  } catch (error) {
    if (isDeterministicGatewayBlock(error)) {
      blockedReason = classifyGatewayBlockedReason(error);
      gatewayError = serializeGatewayError(error);
    } else {
      throw error;
    }
  }

  let gasPreflight = null;
  let preflightError = null;
  let intent = null;

  try {
    if (!order || !quote) {
      throw new Error(`Gateway BTC offramp plan is not executable: ${blockedReason || "missing_order"}`);
    }
    const gasEstimate = await estimateGasImpl(
      srcChain,
      {
        from: senderAddress,
        to: order.tx.to,
        data: order.tx.data,
        valueWei: order.tx.value,
      },
      getEvmChainConfig(srcChain),
    );
    const gasLimit = applyGasBuffer(gasEstimate.gasUnits, gasBufferBps);
    gasPreflight = {
      ...gasEstimate,
      gasBufferBps: Math.max(10_000, toPositiveInteger(gasBufferBps, "gasBufferBps")),
      gasLimit,
      gasLimitHex: `0x${BigInt(gasLimit).toString(16)}`,
    };
    intent = {
      strategyId,
      chain: srcChain,
      family: "evm",
      intentType: "gateway_btc_offramp",
      amountUsd,
      mode: "live",
      observedAt: now,
      executionReason: "strategy_execution",
      quote: {
        observedAt: now,
        quoteType: "offramp",
        route: {
          srcChain,
          dstChain: "bitcoin",
          srcToken: normalizedSrcToken,
          dstToken: ZERO_TOKEN,
        },
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        fees: quote.fees || null,
        feeBreakdown: quote.feeBreakdown || null,
        estimatedTimeInSecs: quote.estimatedTimeInSecs ?? null,
        sender: senderAddress,
        recipient,
        txTo: quote.txTo,
        orderId: order.orderId,
      },
      tx: {
        to: order.tx.to,
        data: order.tx.data,
        value: order.tx.value,
        gasLimit: String(gasLimit),
      },
      strategyConfig: {
        intentTtlMs: strategyCaps.intentTtlMs,
      },
      metadata: {
        skipAutoIngest: true,
        gatewayOrderId: order.orderId,
        gatewayRecipientBitcoin: recipient,
        gatewayExpectedBitcoinSats: quote.outputAmount.amount,
      },
    };
  } catch (error) {
    if (!gatewayError) {
      blockedReason = classifyGasEstimateError(error);
      preflightError = serializePreflightError(error);
    }
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    planStatus: intent ? "ready" : "blocked",
    blockedReason,
    gatewayError,
    preflightError,
    strategyId,
    senderAddress,
    recipient,
    route: {
      srcChain,
      dstChain: "bitcoin",
      srcToken: normalizedSrcToken,
      dstToken: ZERO_TOKEN,
    },
    srcAsset,
    amount: normalizedAmount,
    amountUsd,
    quote: quote
      ? {
          observedAt: now,
          latencyMs: quoteResult?.latencyMs ?? null,
          inputAmount: quote.inputAmount,
          outputAmount: quote.outputAmount,
          fees: quote.fees || null,
          feeBreakdown: quote.feeBreakdown || null,
          estimatedTimeInSecs: quote.estimatedTimeInSecs ?? null,
          txTo: quote.txTo,
          sender: senderAddress,
          recipient,
        }
      : null,
    order,
    gasPreflight,
    intent,
  };
}

export async function executeGatewayBtcOfframpPlan({
  plan,
  sendCommand = sendSignerCommand,
  receiptIngest = appendExecutionReceiptReconciliation,
  readBitcoinBalanceImpl = readBitcoinAddressBalance,
  socketPath,
  timeoutMs,
  awaitConfirmation = true,
  confirmations = 1,
  confirmationTimeoutMs = 120_000,
  awaitBitcoinSettlement = true,
  bitcoinSettlementTimeoutMs = defaultSettlementTimeoutMs(plan?.quote?.estimatedTimeInSecs),
  bitcoinPollIntervalMs = 10_000,
  sleepImpl = sleep,
} = {}) {
  if (!plan?.intent || !plan?.gasPreflight) {
    throw new Error(`Gateway BTC offramp plan is not executable: ${plan?.blockedReason || "missing_intent"}`);
  }
  const bitcoinBalanceBefore = awaitBitcoinSettlement
    ? await readBitcoinBalanceImpl({ address: plan.recipient })
    : null;
  const signerResult = await sendCommand({
    socketPath,
    timeoutMs,
    message: {
      command: "sign_and_broadcast",
      intent: plan.intent,
      awaitConfirmation,
      confirmations,
      timeoutMs: confirmationTimeoutMs,
    },
  });
  if (signerResult?.status !== "ok" || !signerResult?.broadcast?.txHash) {
    throw new Error(signerResult?.error?.message || "Signer did not return a broadcasted EVM transaction");
  }
  const destinationProof = awaitBitcoinSettlement
    ? await waitForBitcoinBalanceDelta({
        address: plan.recipient,
        initialBalance: bitcoinBalanceBefore,
        requiredDelta: plan.quote.outputAmount.amount,
        readBitcoinBalanceImpl,
        timeoutMs: bitcoinSettlementTimeoutMs,
        pollIntervalMs: bitcoinPollIntervalMs,
        sleepImpl,
      })
    : null;
  const execution = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: destinationProof?.status || "source_confirmed_only",
    plan,
    signerResult,
    destinationProof,
  };
  if (typeof receiptIngest !== "function") return execution;
  try {
    return {
      ...execution,
      receiptIngest: await receiptIngest({ execution }),
    };
  } catch (error) {
    return {
      ...execution,
      receiptIngest: {
        appended: false,
        reason: "ingest_failed",
        error: error.message,
      },
    };
  }
}
