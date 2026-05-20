import {
  ETHEREUM_WBTC_TOKEN,
  isBtcLikeAsset,
  SOLVBTC_TOKEN,
  tokenAsset,
  UNI_BTC_TOKEN,
  WBTC_OFT_TOKEN,
} from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { config } from "../../config/env.mjs";
import { readErc20Balance, readNativeBalance } from "../../evm/account-state.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { classifyGasEstimateError, estimateGas } from "../../gas/rpc-gas.mjs";
import {
  GatewayClient,
  GatewayError,
  classifyGatewayBlockedReason,
  gatewayQuoteAmountFloor,
  isDeterministicGatewayBlock,
  routeKey,
} from "../../gateway/client.mjs";
import { buildGatewayQuoteParams } from "../../gateway/quote-params.mjs";
import { getCoinGeckoPricesUsd, priceForAssetUsd } from "../../market/prices.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { readLayerZeroMessageStatusByTxHash } from "./layerzero-scan.mjs";

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

function normalizeGasRefill(gasRefill) {
  if (gasRefill == null || gasRefill === "") return null;
  if (typeof gasRefill === "object") {
    return normalizeGasRefill(gasRefill.amount);
  }
  return String(toPositiveInteger(gasRefill, "gasRefill"));
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
  return amountUsdFromAmountRaw(quote.inputAmount.amount, asset, prices);
}

function amountUsdFromAmountRaw(rawAmount, asset, prices) {
  const assetUsd = priceForAssetUsd(asset, prices);
  if (!Number.isFinite(assetUsd)) {
    throw new Error(`Could not price ${asset.ticker} for gateway consolidation plan`);
  }
  if (!Number.isInteger(asset.decimals)) {
    throw new Error(`Missing decimals for ${asset.ticker}`);
  }
  const amountDecimal = Number(BigInt(rawAmount)) / 10 ** asset.decimals;
  return Number((amountDecimal * assetUsd).toFixed(6));
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

function defaultDestinationSettlementTimeoutMs(plan) {
  const estimatedSeconds = Number(plan?.quote?.estimatedTimeInSecs);
  if (Number.isFinite(estimatedSeconds) && estimatedSeconds > 0) {
    return Math.max(180_000, (estimatedSeconds + 60) * 1_000);
  }
  return 180_000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readDestinationAssetBalance({
  asset,
  owner,
  readErc20BalanceImpl = readErc20Balance,
  readNativeBalanceImpl = readNativeBalance,
}) {
  if (asset?.isNative) {
    const result = await readNativeBalanceImpl(asset.chain, owner);
    return {
      proofSource: "native_balance_delta",
      rpcUrl: result.rpcUrl,
      balance: BigInt(result.balanceWei),
    };
  }
  const result = await readErc20BalanceImpl(asset.chain, asset.token, owner);
  return {
    proofSource: "erc20_balance_delta",
    rpcUrl: result.rpcUrl,
    balance: BigInt(result.balance),
  };
}

async function waitForDestinationSettlement({
  plan,
  destinationBalanceBefore,
  readErc20BalanceImpl = readErc20Balance,
  readNativeBalanceImpl = readNativeBalance,
  timeoutMs = defaultDestinationSettlementTimeoutMs(plan),
  pollIntervalMs = 10_000,
  sleepImpl = sleep,
}) {
  const requiredDelta = BigInt(plan?.quote?.outputAmount?.amount || 0);
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(0, Number(timeoutMs) || 0);
  let attempts = 0;

  while (true) {
    attempts += 1;
    const observedAt = new Date().toISOString();
    const current = await readDestinationAssetBalance({
      asset: plan.dstAsset,
      owner: plan.recipient,
      readErc20BalanceImpl,
      readNativeBalanceImpl,
    });
    const observedDelta = current.balance - destinationBalanceBefore.balance;
    if (observedDelta >= requiredDelta) {
      return {
        status: "delivered",
        proofSource: current.proofSource,
        initialBalance: destinationBalanceBefore.balance.toString(),
        settledBalance: current.balance.toString(),
        observedDelta: observedDelta.toString(),
        requiredDelta: requiredDelta.toString(),
        observedAt,
        rpcUrl: current.rpcUrl,
        attempts,
      };
    }
    if (Date.now() >= deadline) {
      return {
        status: "unproven_timeout",
        proofSource: current.proofSource,
        initialBalance: destinationBalanceBefore.balance.toString(),
        settledBalance: current.balance.toString(),
        observedDelta: observedDelta.toString(),
        requiredDelta: requiredDelta.toString(),
        observedAt,
        rpcUrl: current.rpcUrl,
        attempts,
      };
    }
    await sleepImpl(Math.max(0, Number(pollIntervalMs) || 0));
  }
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
  gasRefill = null,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  skipPreflight = false,
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
  if (!isBtcLikeAsset(srcAsset)) {
    throw new Error("Gateway consolidation requires a BTC-family source asset");
  }

  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const normalizedGasRefill = normalizeGasRefill(gasRefill);
  const route = {
    srcChain,
    dstChain,
    srcToken: normalizedSrcToken,
    dstToken: normalizedDstToken,
  };
  let normalizedQuote = null;
  let amountUsd = null;
  let gatewayError = null;
  let blockedReason = null;
  let quoteAmountFloor = null;
  let gatewayQuoteLatencyMs = null;
  try {
    const quoteResult = await client.getQuote(
      buildGatewayQuoteParams({
        route,
        amount: normalizedAmount,
        sender: senderAddress,
        recipient,
        slippage: String(slippageBps),
        gasRefill: normalizedGasRefill,
      }),
    );
    gatewayQuoteLatencyMs = quoteResult.latencyMs;
    const quote = normalizeGatewayTransportQuoteBody(quoteResult.body);
    normalizedQuote = {
      observedAt: now,
      maxAgeMs: strategyCaps.intentTtlMs,
      latencyMs: gatewayQuoteLatencyMs,
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
      gasRefill: normalizedGasRefill,
    };
    const prices = await priceReader();
    amountUsd = amountUsdFromQuote(quote, srcAsset, prices);
  } catch (error) {
    if (isDeterministicGatewayBlock(error)) {
      blockedReason = classifyGatewayBlockedReason(error);
      gatewayError = serializeGatewayError(error);
      quoteAmountFloor = gatewayQuoteAmountFloor(error);
      try {
        amountUsd = amountUsdFromAmountRaw(normalizedAmount, srcAsset, await priceReader());
      } catch {
        amountUsd = null;
      }
    } else {
      throw error;
    }
  }

  let gasPreflight = null;
  let preflightError = null;
  let intent = null;

  try {
    if (!normalizedQuote) {
      throw new Error(`Gateway BTC consolidation plan is not executable: ${blockedReason || "missing_quote"}`);
    }
    if (!skipPreflight) {
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
          expectedTxTo: normalizedQuote.txTo,
          quoteMaxAgeMs: strategyCaps.intentTtlMs,
          gatewayRouteKey: routeKey(route),
          gatewayGasRefill: normalizedGasRefill,
          gatewayQuoteLatencyMs,
          gatewayGasEstimateSource: gasEstimate.rpcUrl,
          gatewayEstimatedTimeInSecs: normalizedQuote.estimatedTimeInSecs,
        },
      };
    }
  } catch (error) {
    if (!gatewayError) {
      blockedReason = classifyGasEstimateError(error);
      preflightError = serializePreflightError(error);
    }
  }

  const executionReady = Boolean(intent && gasPreflight);
  return {
    schemaVersion: 1,
    observedAt: now,
    planStatus: normalizedQuote && (executionReady || skipPreflight) ? "ready" : "blocked",
    blockedReason,
    gatewayError,
    quoteAmountFloor,
    preflightError,
    executionReady,
    skipPreflight,
    strategyId,
    senderAddress,
    recipient,
    route,
    routeKey: routeKey(route),
    srcAsset,
    dstAsset,
    amount: normalizedAmount,
    amountUsd,
    gasRefill: normalizedGasRefill,
    quote: normalizedQuote,
    gasPreflight,
    intent,
  };
}

export async function executeGatewayBtcConsolidationPlan({
  plan,
  sendCommand = sendSignerCommand,
  receiptIngest = appendExecutionReceiptReconciliation,
  readLayerZeroStatusImpl = readLayerZeroMessageStatusByTxHash,
  readErc20BalanceImpl = readErc20Balance,
  readNativeBalanceImpl = readNativeBalance,
  socketPath,
  timeoutMs,
  awaitConfirmation = true,
  confirmations = 1,
  confirmationTimeoutMs = 120_000,
  awaitDestinationSettlement = true,
  destinationSettlementTimeoutMs = defaultDestinationSettlementTimeoutMs(plan),
  destinationPollIntervalMs = 10_000,
  sleepImpl = sleep,
} = {}) {
  if (!plan?.intent || !plan?.gasPreflight) {
    throw new Error(`Gateway BTC consolidation plan is not executable: ${plan?.blockedReason || "missing_intent"}`);
  }
  const destinationBalanceBefore = awaitDestinationSettlement
    ? await readDestinationAssetBalance({
        asset: plan.dstAsset,
        owner: plan.recipient,
        readErc20BalanceImpl,
        readNativeBalanceImpl,
      })
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
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      settlementStatus: signerResult?.status === "rejected" ? "signer_rejected" : "signer_error",
      plan,
      signerResult,
      destinationProof: null,
    };
  }
  const destinationProof = awaitDestinationSettlement
    ? await waitForDestinationSettlement({
        plan,
        destinationBalanceBefore,
        readErc20BalanceImpl,
        readNativeBalanceImpl,
        timeoutMs: destinationSettlementTimeoutMs,
        pollIntervalMs: destinationPollIntervalMs,
        sleepImpl,
      })
    : null;
  const layerZeroMessageStatus =
    destinationProof?.status === "unproven_timeout" && typeof readLayerZeroStatusImpl === "function"
      ? await readLayerZeroStatusImpl(signerResult.broadcast.txHash).catch(() => null)
      : null;
  const execution = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: destinationProof?.status || "source_confirmed_only",
    plan,
    signerResult,
    destinationProof,
    layerZeroMessageStatus,
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

export { applyGasBuffer, defaultDestinationSettlementTimeoutMs, normalizeGatewayTransportQuoteBody };
