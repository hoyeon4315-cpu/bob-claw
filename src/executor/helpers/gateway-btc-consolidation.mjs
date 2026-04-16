import { ETHEREUM_WBTC_TOKEN, isBtcLikeAsset, SOLVBTC_TOKEN, tokenAsset, UNI_BTC_TOKEN, WBTC_OFT_TOKEN } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { config } from "../../config/env.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { classifyGasEstimateError, estimateGas } from "../../gas/rpc-gas.mjs";
import { GatewayClient, routeKey } from "../../gateway/client.mjs";
import { getCoinGeckoPricesUsd, priceForAssetUsd } from "../../market/prices.mjs";
import { sendSignerCommand } from "../signer/client.mjs";

export const GATEWAY_BTC_CONSOLIDATION_STRATEGY_ID = "gateway-btc-funding-transfer";
export const DEFAULT_GATEWAY_GAS_BUFFER_BPS = 12_000;

const TOKEN_ALIASES = Object.freeze({
  "wbtc.oft": WBTC_OFT_TOKEN,
  wbtc_oft: WBTC_OFT_TOKEN,
  wbtc: ETHEREUM_WBTC_TOKEN,
  unibtc: UNI_BTC_TOKEN,
  "uni-btc": UNI_BTC_TOKEN,
  solvbtc: SOLVBTC_TOKEN,
  cbbtc: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
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

function normalizeTokenAddress(token, label) {
  if (!token) throw new Error(`${label} is required`);
  const normalized = String(token).trim();
  const alias = TOKEN_ALIASES[normalized.toLowerCase()];
  if (alias) return alias;
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) return normalized;
  throw new Error(`Unsupported BTC-family token for ${label}: ${token}`);
}

function txDataBytes(data) {
  if (typeof data !== "string" || !data.startsWith("0x")) return null;
  return Math.max(0, (data.length - 2) / 2);
}

function normalizeGatewayTransportQuoteBody(body) {
  const quote = body?.layerZero || null;
  if (!quote) {
    throw new Error("Gateway quote did not include layerZero transport data");
  }
  if (!quote.inputAmount?.amount || !quote.outputAmount?.amount) {
    throw new Error("Gateway transport quote is missing input or output amounts");
  }
  if (!quote.tx?.to || !quote.tx?.data) {
    throw new Error("Gateway transport quote is missing executable tx data");
  }
  return quote;
}

function applyGasBuffer(gasUnits, gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS) {
  const normalizedGasUnits = toPositiveInteger(gasUnits, "gasUnits");
  const normalizedBufferBps = Math.max(10_000, toPositiveInteger(gasBufferBps, "gasBufferBps"));
  return Math.max(normalizedGasUnits, Math.ceil((normalizedGasUnits * normalizedBufferBps) / 10_000));
}

function amountUsdFromQuote(quote, asset, prices) {
  const assetUsd = priceForAssetUsd(asset, prices);
  if (!Number.isFinite(assetUsd)) {
    throw new Error(`Could not price ${asset.ticker} for gateway consolidation plan`);
  }
  if (!Number.isInteger(asset.decimals)) {
    throw new Error(`Missing decimals for ${asset.ticker}`);
  }
  const amountDecimal = Number(BigInt(quote.inputAmount.amount)) / 10 ** asset.decimals;
  return Number((amountDecimal * assetUsd).toFixed(6));
}

function serializePreflightError(error) {
  return {
    name: error.name,
    message: error.message,
    attempts: error.attempts || null,
  };
}

export async function buildGatewayBtcConsolidationPlan({
  client = new GatewayClient({ baseUrl: config.gatewayApiBase }),
  priceReader = getCoinGeckoPricesUsd,
  estimateGasImpl = estimateGas,
  strategyId = GATEWAY_BTC_CONSOLIDATION_STRATEGY_ID,
  srcChain,
  dstChain,
  token = WBTC_OFT_TOKEN,
  srcToken = token,
  dstToken = token,
  amount,
  senderAddress,
  recipient,
  slippageBps = config.slippageBps,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  now = new Date().toISOString(),
} = {}) {
  if (!senderAddress) throw new Error("Source sender address is required");
  if (!recipient) throw new Error("Destination recipient is required");
  if (!getEvmChainConfig(srcChain)) throw new Error(`Unsupported EVM source chain: ${srcChain}`);
  if (!getEvmChainConfig(dstChain)) throw new Error(`Unsupported EVM destination chain: ${dstChain}`);
  if (srcChain === dstChain) throw new Error("Source and destination chains must differ");

  const strategyCaps = assertStrategyCaps(strategyId);
  const normalizedSrcToken = normalizeTokenAddress(srcToken, "srcToken");
  const normalizedDstToken = normalizeTokenAddress(dstToken, "dstToken");
  const srcAsset = tokenAsset(srcChain, normalizedSrcToken);
  const dstAsset = tokenAsset(dstChain, normalizedDstToken);
  if (!isBtcLikeAsset(srcAsset) || !isBtcLikeAsset(dstAsset)) {
    throw new Error("Gateway consolidation only supports BTC-family assets");
  }

  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const route = {
    srcChain,
    dstChain,
    srcToken: normalizedSrcToken,
    dstToken: normalizedDstToken,
  };
  const quoteResult = await client.getQuote({
    ...route,
    amount: normalizedAmount,
    sender: senderAddress,
    recipient,
    slippage: String(slippageBps),
  });
  const quote = normalizeGatewayTransportQuoteBody(quoteResult.body);
  const normalizedQuote = {
    observedAt: now,
    latencyMs: quoteResult.latencyMs,
    quoteType: "layerZero",
    route,
    inputAmount: quote.inputAmount,
    outputAmount: quote.outputAmount,
    fees: quote.fees || null,
    executionFees: quote.executionFees || null,
    feeBreakdown: quote.feeBreakdown || null,
    estimatedTimeInSecs: quote.estimatedTimeInSecs ?? null,
    sender: senderAddress,
    recipient,
    txValueWei: String(quote.tx?.value || 0),
    txTo: quote.tx.to,
    txData: quote.tx.data,
    txChain: quote.tx.chain || srcChain,
    txDataBytes: txDataBytes(quote.tx.data),
  };
  const prices = await priceReader();
  const amountUsd = amountUsdFromQuote(quote, srcAsset, prices);

  let gasPreflight = null;
  let blockedReason = null;
  let preflightError = null;
  let intent = null;

  try {
    const gasEstimate = await estimateGasImpl(
      srcChain,
      {
        from: senderAddress,
        to: normalizedQuote.txTo,
        data: normalizedQuote.txData,
        valueWei: normalizedQuote.txValueWei,
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
      intentType: "gateway_btc_transfer",
      amountUsd,
      mode: "live",
      observedAt: now,
      executionReason: "strategy_execution",
      quote: {
        ...normalizedQuote,
        gasEstimate: gasPreflight,
        routeKey: routeKey(route),
      },
      tx: {
        to: normalizedQuote.txTo,
        data: normalizedQuote.txData,
        value: normalizedQuote.txValueWei,
        gasLimit: String(gasLimit),
      },
      strategyConfig: {
        intentTtlMs: strategyCaps.intentTtlMs,
      },
      metadata: {
        skipAutoIngest: true,
        gatewayRouteKey: routeKey(route),
        gatewayQuoteLatencyMs: quoteResult.latencyMs,
        gatewayGasEstimateSource: gasEstimate.rpcUrl,
        gatewayEstimatedTimeInSecs: normalizedQuote.estimatedTimeInSecs,
      },
    };
  } catch (error) {
    blockedReason = classifyGasEstimateError(error);
    preflightError = serializePreflightError(error);
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    planStatus: intent ? "ready" : "blocked",
    blockedReason,
    preflightError,
    strategyId,
    senderAddress,
    recipient,
    route,
    routeKey: routeKey(route),
    srcAsset,
    dstAsset,
    amount: normalizedAmount,
    amountUsd,
    quote: normalizedQuote,
    gasPreflight,
    intent,
  };
}

export async function executeGatewayBtcConsolidationPlan({
  plan,
  sendCommand = sendSignerCommand,
  socketPath,
  timeoutMs,
  awaitConfirmation = true,
  confirmations = 1,
  confirmationTimeoutMs = 120_000,
} = {}) {
  if (!plan?.intent || !plan?.gasPreflight) {
    throw new Error(`Gateway BTC consolidation plan is not executable: ${plan?.blockedReason || "missing_intent"}`);
  }
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
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    plan,
    signerResult,
  };
}

export { applyGasBuffer, normalizeGatewayTransportQuoteBody };
