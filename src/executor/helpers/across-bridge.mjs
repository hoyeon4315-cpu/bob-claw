// Across bridge signer-intent builder (write side).
//
// Mirrors gateway-btc-consolidation: quote → gas preflight → signer
// intent payload. Does NOT sign — signing is the daemon's job after
// Policy approval.
//
// Destination settlement proof: caller passes a waiter that polls the
// destination SpokePool / ERC20 balance for outputAmount. That proof is
// required before the refill-job runner marks the job "delivered";
// without it only source-chain success is recorded and the job stays
// in a "settlement_pending" state, matching the gateway pattern.

import { Interface } from "ethers";
import { tokenAsset } from "../../assets/tokens.mjs";
import {
  ACROSS_DEFAULT_POLICY,
  acrossSpokePool,
  acrossSupportsPair,
  acrossTokenAddress,
} from "../../config/across.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { AcrossClient } from "../../bridge/across/client.mjs";
import { buildAcrossQuoteRequest, normalizeAcrossQuote } from "../../bridge/across/quote.mjs";
import { SPOKE_POOL_DEPOSIT_ABI, ZERO_ADDRESS } from "../../bridge/across/spoke-pool-abi.mjs";
import { classifyGasEstimateError, estimateGas } from "../../gas/rpc-gas.mjs";
import { getCoinGeckoPricesUsd, priceForAssetUsd } from "../../market/prices.mjs";

export const ACROSS_BRIDGE_STRATEGY_ID = "across-bridge";
export const DEFAULT_ACROSS_GAS_BUFFER_BPS = 12_000;

const SPOKE_INTERFACE = new Interface(SPOKE_POOL_DEPOSIT_ABI);

function applyGasBuffer(gasUnits, bufferBps = DEFAULT_ACROSS_GAS_BUFFER_BPS) {
  const units = BigInt(gasUnits || 0);
  const bps = BigInt(Math.max(10_000, Number(bufferBps) || 10_000));
  return (units * bps) / 10_000n;
}

function serializeAcrossError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return { name: error.name, message: error.message, details: error.details || null };
}

function amountUsdFromAmount(amountRaw, asset, prices) {
  const unit = priceForAssetUsd(asset, prices);
  if (!Number.isFinite(unit)) return null;
  const decimalAmount = Number(BigInt(amountRaw)) / 10 ** asset.decimals;
  return Number((decimalAmount * unit).toFixed(6));
}

function encodeDepositCalldata(quote, depositor) {
  return SPOKE_INTERFACE.encodeFunctionData("depositV3", [
    depositor,
    quote.recipient || depositor,
    quote.inputToken,
    quote.outputToken,
    BigInt(quote.inputAmount),
    BigInt(quote.outputAmount),
    BigInt(quote.destinationChainId),
    quote.exclusiveRelayer || ZERO_ADDRESS,
    quote.quoteTimestamp,
    quote.fillDeadline,
    quote.exclusivityDeadline || 0,
    "0x",
  ]);
}

export async function buildAcrossBridgePlan({
  srcChain,
  dstChain,
  ticker,
  amount,
  senderAddress,
  recipient = null,
  policy = ACROSS_DEFAULT_POLICY,
  clientFactory = null,
  priceReader = getCoinGeckoPricesUsd,
  estimateGasImpl = estimateGas,
  gasBufferBps = DEFAULT_ACROSS_GAS_BUFFER_BPS,
  skipPreflight = false,
  strategyId = ACROSS_BRIDGE_STRATEGY_ID,
  now = Math.floor(Date.now() / 1000),
} = {}) {
  if (!senderAddress) throw new Error("senderAddress required");
  if (!acrossSupportsPair({ srcChain, dstChain, ticker })) {
    throw new Error(`across plan: pair unsupported src=${srcChain} dst=${dstChain} ticker=${ticker}`);
  }
  const srcChainConfig = getEvmChainConfig(srcChain);
  if (!srcChainConfig) throw new Error(`no chain config for '${srcChain}'`);

  const strategyCaps = assertStrategyCaps(strategyId);
  const spokePool = acrossSpokePool(srcChain);
  const srcTokenAddr = acrossTokenAddress(srcChain, ticker);
  const srcAsset = tokenAsset(srcChain, srcTokenAddr);

  const request = buildAcrossQuoteRequest({ srcChain, dstChain, ticker, amount, recipient });
  const client = clientFactory
    ? clientFactory()
    : new AcrossClient({ baseUrl: policy.apiBase, timeoutMs: policy.quoteTimeoutMs });

  let quote = null;
  let quoteLatencyMs = null;
  let blockedReason = null;
  let acrossError = null;
  let amountUsd = null;
  try {
    const response = await client.suggestedFees({
      inputToken: request.inputToken,
      outputToken: request.outputToken,
      originChainId: request.originChainId,
      destinationChainId: request.destinationChainId,
      amount: request.amount,
      recipient: request.recipient,
    });
    quoteLatencyMs = response.latencyMs;
    quote = normalizeAcrossQuote({ request, responseBody: response.body, now, policy }).quote;
    const prices = await priceReader();
    amountUsd = amountUsdFromAmount(request.amount, srcAsset, prices);
  } catch (error) {
    blockedReason = error.name === "AcrossError" ? "across_quote_rejected" : "across_quote_invalid";
    acrossError = serializeAcrossError(error);
    try {
      amountUsd = amountUsdFromAmount(request.amount, srcAsset, await priceReader());
    } catch {
      amountUsd = null;
    }
  }

  if (Number.isFinite(amountUsd) && amountUsd > policy.perTxMaxUsd) {
    blockedReason = "across_per_tx_cap_exceeded";
  }

  let gasPreflight = null;
  let preflightError = null;
  let intent = null;
  if (quote && !blockedReason && !skipPreflight) {
    try {
      const calldata = encodeDepositCalldata(quote, senderAddress);
      const gasEstimate = await estimateGasImpl(
        srcChain,
        { from: senderAddress, to: spokePool, data: calldata, valueWei: "0" },
        srcChainConfig,
      );
      const gasLimit = applyGasBuffer(gasEstimate.gasUnits, gasBufferBps);
      gasPreflight = {
        ...gasEstimate,
        gasBufferBps: Math.max(10_000, Number(gasBufferBps) || 10_000),
        gasLimit: String(gasLimit),
        gasLimitHex: `0x${gasLimit.toString(16)}`,
      };
      intent = {
        strategyId,
        chain: srcChain,
        family: "evm",
        intentType: "across_bridge_deposit",
        method: "cross_chain_bridge_across",
        amountUsd,
        mode: "live",
        observedAt: new Date(now * 1000).toISOString(),
        executionReason: "strategy_execution",
        quote: { ...quote, calldata, spokePool, quoteLatencyMs },
        tx: {
          to: spokePool,
          data: calldata,
          value: "0",
          gasLimit: String(gasLimit),
        },
        strategyConfig: { intentTtlMs: strategyCaps.intentTtlMs },
        metadata: {
          acrossInputToken: quote.inputToken,
          acrossOutputToken: quote.outputToken,
          acrossOutputAmount: quote.outputAmount,
          acrossRelayFeePct: quote.relayFeePct,
          acrossFillDeadline: quote.fillDeadline,
          acrossQuoteTimestamp: quote.quoteTimestamp,
        },
      };
    } catch (error) {
      blockedReason = classifyGasEstimateError(error) || "across_preflight_failed";
      preflightError = serializeAcrossError(error);
    }
  }

  const executionReady = Boolean(intent && gasPreflight);
  return {
    schemaVersion: 1,
    observedAt: new Date(now * 1000).toISOString(),
    planStatus: executionReady ? "ready" : "blocked",
    blockedReason,
    acrossError,
    preflightError,
    executionReady,
    skipPreflight,
    strategyId,
    senderAddress,
    recipient: recipient || senderAddress,
    request,
    quote,
    quoteLatencyMs,
    amountUsd,
    spokePool,
    gasPreflight,
    intent,
    settlementRequirements: [
      "across_destination_output_amount_delta_proof_required",
      "across_deposit_id_recorded",
    ],
  };
}

export { applyGasBuffer, encodeDepositCalldata };
