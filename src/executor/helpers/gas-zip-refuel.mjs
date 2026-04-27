import { ZERO_TOKEN, tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import {
  GAS_ZIP_DEFAULT_POLICY,
  gasZipAcceptsAction,
  gasZipInboundChain,
  gasZipOutboundChain,
  gasZipQuoteUrl,
} from "../../config/gas-zip.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { classifyGasEstimateError, estimateGas } from "../../gas/rpc-gas.mjs";
import { getCoinGeckoPricesUsd, priceForAssetUsd } from "../../market/prices.mjs";
import { evaluateGasZipQuoteLossGuard } from "../../treasury/discretionary-budget-guard.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";
import { buildGasZipRateState, evaluateGasZipRateLimit, classifySettlementTimeout } from "./gas-zip-rate-limit.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./settlement-proof.mjs";

export const GAS_ZIP_NATIVE_REFUEL_STRATEGY_ID = "gas-zip-native-refuel";

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

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function serializeError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    details: error.details || null,
  };
}

function amountUsdFromWei(amountWei, asset, prices) {
  const unitUsd = priceForAssetUsd(asset, prices);
  if (!Number.isFinite(unitUsd)) {
    throw new Error(`Could not price ${asset.ticker} for Gas.Zip refuel plan`);
  }
  const amountDecimal = Number(BigInt(amountWei)) / 10 ** asset.decimals;
  return Number((amountDecimal * unitUsd).toFixed(6));
}

function decimalFromRawUnits(rawAmount, decimals) {
  if (rawAmount == null || rawAmount === "") return null;
  if (!Number.isInteger(decimals)) return null;
  return Number(BigInt(rawAmount)) / 10 ** decimals;
}

function minimumOutputWithTolerance(outputWei, toleranceBps = 9950) {
  const output = BigInt(outputWei || 0);
  const bps = BigInt(Math.max(0, Math.min(10_000, Number(toleranceBps) || 0)));
  return ((output * bps) / 10_000n).toString();
}

function normalizeQuoteBody(body, dstChainId) {
  if (!body?.calldata || !Array.isArray(body?.quotes)) {
    throw new Error("Gas.Zip quote response is missing calldata or quotes");
  }
  const quote = body.quotes.find((item) => Number(item?.chain) === Number(dstChainId)) || null;
  if (!quote?.expected) {
    throw new Error(`Gas.Zip quote response did not include destination quote for chain ${dstChainId}`);
  }
  return {
    calldata: body.calldata,
    quote,
  };
}

async function fetchGasZipQuote(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const error = new Error(`Gas.Zip quote request failed: ${response.status}`);
    error.name = "GasZipQuoteError";
    throw error;
  }
  return response.json();
}

export async function buildGasZipNativeRefuelPlan({
  srcChain,
  dstChain,
  amountWei,
  minimumDestinationWei = null,
  requiredDestinationBalanceWei = null,
  senderAddress,
  recipient,
  strategyId = GAS_ZIP_NATIVE_REFUEL_STRATEGY_ID,
  priceReader = getCoinGeckoPricesUsd,
  estimateGasImpl = estimateGas,
  quoteFetcher = fetchGasZipQuote,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  gasZipPolicy = GAS_ZIP_DEFAULT_POLICY,
  auditRecords = [],
  destinationBalanceStatus = null,
  destinationNativeDecimal = null,
  destinationMinBalanceDecimal = null,
  skipRateLimit = false,
  discretionaryBudgetBypass = false,
  aggregateRefuelAmountUsd = null,
  now = new Date().toISOString(),
} = {}) {
  if (!senderAddress) throw new Error("EVM sender address is required");
  if (!recipient) throw new Error("Destination recipient is required");
  if (!getEvmChainConfig(srcChain)) throw new Error(`Unsupported EVM source chain: ${srcChain}`);
  if (!getEvmChainConfig(dstChain)) throw new Error(`Unsupported EVM destination chain: ${dstChain}`);
  const srcConfig = gasZipInboundChain(srcChain, gasZipPolicy);
  const dstConfig = gasZipOutboundChain(dstChain, gasZipPolicy);
  if (!srcConfig) throw new Error(`Gas.Zip inbound config missing for ${srcChain}`);
  if (!dstConfig) throw new Error(`Gas.Zip outbound config missing for ${dstChain}`);

  const normalizedAmountWei = toPositiveIntegerString(amountWei, "amountWei");
  const normalizedMinimumDestinationWei =
    minimumDestinationWei == null ? null : toPositiveIntegerString(minimumDestinationWei, "minimumDestinationWei");
  const normalizedRequiredDestinationBalanceWei =
    requiredDestinationBalanceWei == null
      ? null
      : toPositiveIntegerString(requiredDestinationBalanceWei, "requiredDestinationBalanceWei");
  const dstNativeAsset = tokenAsset(dstChain, ZERO_TOKEN);
  const requiredDestinationBalanceDecimal = decimalFromRawUnits(
    normalizedRequiredDestinationBalanceWei,
    dstNativeAsset.decimals,
  );
  const effectiveDestinationMinBalanceDecimal = Number.isFinite(requiredDestinationBalanceDecimal)
    ? Math.max(
        requiredDestinationBalanceDecimal,
        Number.isFinite(destinationMinBalanceDecimal) ? destinationMinBalanceDecimal : 0,
      )
    : destinationMinBalanceDecimal;
  const effectiveDestinationBalanceStatus =
    Number.isFinite(requiredDestinationBalanceDecimal) &&
    Number.isFinite(destinationNativeDecimal) &&
    destinationNativeDecimal < effectiveDestinationMinBalanceDecimal
      ? "refill_required_for_operation"
      : destinationBalanceStatus;
  const amountUsd = amountUsdFromWei(normalizedAmountWei, tokenAsset(srcChain, ZERO_TOKEN), await priceReader());
  const strategyCaps = assertStrategyCaps(strategyId);
  const policyVerdict = gasZipAcceptsAction({
    type: "refill_native",
    chain: dstChain,
    token: ZERO_TOKEN,
    refillEstimatedUsd: amountUsd,
  }, gasZipPolicy);
  if (!policyVerdict.accepted) {
    return {
      schemaVersion: 1,
      observedAt: now,
      planStatus: "blocked",
      blockedReason: policyVerdict.reason,
      strategyId,
      srcChain,
      dstChain,
      amountWei: normalizedAmountWei,
    };
  }

  // Rate-limit enforcement: per-chain daily max, open jobs, cooldown, destination-already-met
  if (!skipRateLimit) {
    const rateState = buildGasZipRateState({ auditRecords, now, gasZipPolicy });
      const rateVerdict = evaluateGasZipRateLimit({
      dstChain,
      amountUsd,
      rateState,
      destinationBalanceStatus: effectiveDestinationBalanceStatus,
      destinationNativeDecimal,
      destinationMinBalanceDecimal: effectiveDestinationMinBalanceDecimal,
      now,
    });
    if (rateVerdict.decision === "BLOCK") {
      return {
        schemaVersion: 1,
        observedAt: now,
        planStatus: "blocked",
        blockedReason: rateVerdict.blockers[0],
        rateLimitBlockers: rateVerdict.blockers,
        rateLimitMetrics: rateVerdict.metrics,
        strategyId,
        srcChain,
        dstChain,
        amountWei: normalizedAmountWei,
        amountUsd,
      };
    }
  }

  const quoteUrl = gasZipQuoteUrl({
    srcChain,
    dstChain,
    amountWei: normalizedAmountWei,
    recipient,
    senderAddress,
    policy: gasZipPolicy,
  });

  let quote = null;
  let gasZipError = null;
  let gasPreflight = null;
  let preflightError = null;
  let intent = null;
  let effectiveMinimumDestinationWei = normalizedMinimumDestinationWei;
  let quoteLossGuard = null;

  try {
    const quoteBody = await quoteFetcher(quoteUrl);
    quote = normalizeQuoteBody(quoteBody, dstConfig.chainId);
    quoteLossGuard = evaluateGasZipQuoteLossGuard({
      amountWei: normalizedAmountWei,
      expectedOutputWei: quote.quote.expected,
      amountUsd,
      aggregateAmountUsd: aggregateRefuelAmountUsd,
      discretionaryBudgetBypass,
    });
    if (!quoteLossGuard.accepted) {
      return {
        schemaVersion: 1,
        observedAt: now,
        planStatus: "blocked",
        blockedReason: quoteLossGuard.reason,
        strategyId,
        srcChain,
        dstChain,
        senderAddress,
        recipient,
        amountWei: normalizedAmountWei,
        requiredDestinationBalanceWei: normalizedRequiredDestinationBalanceWei,
        minimumDestinationWei: effectiveMinimumDestinationWei,
        amountUsd,
        srcAsset: tokenAsset(srcChain, ZERO_TOKEN),
        dstAsset: dstNativeAsset,
        quoteLossGuard,
        quote: {
          observedAt: now,
          calldata: quote.calldata,
          expectedOutputWei: String(quote.quote.expected),
          outputValueUsd: finiteNumber(quote.quote.usd),
          speed: finiteNumber(quote.quote.speed),
          gasWei: quote.quote.gas != null ? String(quote.quote.gas) : null,
        },
      };
    }
  } catch (error) {
    gasZipError = serializeError(error);
  }

  try {
    if (!quote) {
      throw new Error("Gas.Zip refuel plan is not executable: missing_quote");
    }
    effectiveMinimumDestinationWei =
      normalizedMinimumDestinationWei || minimumOutputWithTolerance(quote.quote.expected);
    const gasEstimate = await estimateGasImpl(
      srcChain,
      {
        from: senderAddress,
        to: srcConfig.directAddress,
        data: quote.calldata,
        valueWei: normalizedAmountWei,
      },
      getEvmChainConfig(srcChain),
    );
    const gasLimit = applyGasBuffer(gasEstimate.gasUnits, gasBufferBps);
    gasPreflight = {
      ...gasEstimate,
      gasBufferBps: Math.max(10_000, Number(gasBufferBps) || DEFAULT_GATEWAY_GAS_BUFFER_BPS),
      gasLimit,
      gasLimitHex: `0x${BigInt(gasLimit).toString(16)}`,
    };
    intent = {
      strategyId,
      chain: srcChain,
      family: "evm",
      intentType: "gas_zip_native_refuel",
      amountUsd,
      mode: "live",
      observedAt: now,
      executionReason: "capital_rebalance",
      quote: {
        observedAt: now,
        quoteType: "gas_zip_direct_refuel",
        route: {
          srcChain,
          dstChain,
          srcToken: ZERO_TOKEN,
          dstToken: ZERO_TOKEN,
        },
        inputAmount: { amount: normalizedAmountWei },
        outputAmount: { amount: String(quote.quote.expected) },
        outputValueUsd: finiteNumber(quote.quote.usd),
        gasRefill: String(quote.quote.expected),
        sender: senderAddress,
        recipient,
        txTo: srcConfig.directAddress,
        gasZipChainId: dstConfig.chainId,
        gasZipShortId: dstConfig.shortId,
      },
      tx: {
        to: srcConfig.directAddress,
        data: quote.calldata,
        value: normalizedAmountWei,
        gasLimit: String(gasLimit),
      },
      strategyConfig: {
        intentTtlMs: strategyCaps.intentTtlMs,
      },
      metadata: {
        skipAutoIngest: true,
        gasZipSourceChainId: srcConfig.chainId,
        gasZipDestinationChainId: dstConfig.chainId,
        gasZipDestinationShortId: dstConfig.shortId,
        gasZipDirectAddress: srcConfig.directAddress,
        gasZipContractAddress: srcConfig.contractAddress,
        gasZipSettlementProof: "destination_native_balance_delta",
        gasZipExpectedDestinationWei: String(quote.quote.expected),
        gasZipMinimumDestinationWei: effectiveMinimumDestinationWei,
      },
    };
  } catch (error) {
    preflightError = serializeError(error);
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    planStatus: intent ? "ready" : "blocked",
    blockedReason: intent ? null : (preflightError ? classifyGasEstimateError(new Error(preflightError.message || "gas_zip_preflight_failed")) : "gas_zip_quote_failed"),
    gasZipError,
    preflightError,
    strategyId,
    srcChain,
    dstChain,
    senderAddress,
    recipient,
    amountWei: normalizedAmountWei,
    requiredDestinationBalanceWei: normalizedRequiredDestinationBalanceWei,
    minimumDestinationWei: effectiveMinimumDestinationWei,
    amountUsd,
    srcAsset: tokenAsset(srcChain, ZERO_TOKEN),
    dstAsset: dstNativeAsset,
    gasZip: {
      apiBase: gasZipPolicy.apiBase,
      quoteUrl,
      sourceChainId: srcConfig.chainId,
      destinationChainId: dstConfig.chainId,
      destinationShortId: dstConfig.shortId,
      directAddress: srcConfig.directAddress,
      contractAddress: srcConfig.contractAddress,
    },
    quote: quote
      ? {
          observedAt: now,
          calldata: quote.calldata,
          expectedOutputWei: String(quote.quote.expected),
          outputValueUsd: finiteNumber(quote.quote.usd),
          speed: finiteNumber(quote.quote.speed),
          gasWei: quote.quote.gas != null ? String(quote.quote.gas) : null,
        }
      : null,
    gasPreflight,
    intent,
    quoteLossGuard,
  };
}

export async function executeGasZipNativeRefuelPlan({
  plan,
  sendCommand = sendSignerCommand,
  receiptIngest = appendExecutionReceiptReconciliation,
  readErc20BalanceImpl,
  readNativeBalanceImpl,
  socketPath,
  timeoutMs,
  awaitConfirmation = true,
  confirmations = 1,
  confirmationTimeoutMs = 120_000,
  awaitDestinationSettlement = true,
  destinationSettlementTimeoutMs = defaultSettlementTimeoutMs(60),
  destinationPollIntervalMs = 10_000,
  sleepImpl = sleep,
} = {}) {
  if (!plan?.intent || !plan?.gasPreflight) {
    throw new Error(`Gas.Zip refuel plan is not executable: ${plan?.blockedReason || "missing_intent"}`);
  }

  const destinationBalanceBefore = awaitDestinationSettlement
    ? await readEvmAssetBalance({
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
    ? classifySettlementTimeout(await waitForEvmAssetDelta({
        asset: plan.dstAsset,
        owner: plan.recipient,
        initialBalance: destinationBalanceBefore,
        requiredDelta: plan.minimumDestinationWei || plan.quote?.expectedOutputWei || "0",
        readErc20BalanceImpl,
        readNativeBalanceImpl,
        timeoutMs: destinationSettlementTimeoutMs,
        pollIntervalMs: destinationPollIntervalMs,
        sleepImpl,
      }))
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
