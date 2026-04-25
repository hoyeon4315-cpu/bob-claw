// Across deposit quote adapter.
//
// Pure transform over the client.suggestedFees() body into the shape the
// signer intent builder + policy engine consume. Rejects any quote that
// violates ACROSS_DEFAULT_POLICY caps or is missing required fields, so
// the caller never has to branch on vendor-specific edge cases.

import { getEvmChainConfig } from "../../config/chains.mjs";
import { tokenAsset } from "../../assets/tokens.mjs";
import {
  ACROSS_DEFAULT_POLICY,
  acrossSpokePool,
  acrossSupportsPair,
  acrossTokenAddress,
} from "../../config/across.mjs";

function requireFinite(value, field) {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) throw new Error(`across quote missing finite ${field}`);
  return asNumber;
}

function chainIdFor(chain) {
  const config = getEvmChainConfig(chain);
  if (!config?.chainId) throw new Error(`across quote: no chainId for chain '${chain}'`);
  return config.chainId;
}

export function buildAcrossQuoteRequest({ srcChain, dstChain, ticker, amount, recipient = null }) {
  if (!acrossSupportsPair({ srcChain, dstChain, ticker })) {
    throw new Error(`across quote: pair unsupported src=${srcChain} dst=${dstChain} ticker=${ticker}`);
  }
  const inputToken = acrossTokenAddress(srcChain, ticker);
  const outputToken = acrossTokenAddress(dstChain, ticker);
  const inputDecimals = tokenAsset(srcChain, inputToken).decimals;
  const outputDecimals = tokenAsset(dstChain, outputToken).decimals;
  return {
    srcChain,
    dstChain,
    ticker,
    inputToken,
    outputToken,
    originChainId: chainIdFor(srcChain),
    destinationChainId: chainIdFor(dstChain),
    amount: String(amount),
    recipient,
    allowUnmatchedDecimals: Number.isInteger(inputDecimals) && Number.isInteger(outputDecimals) && inputDecimals !== outputDecimals,
  };
}

export function normalizeAcrossQuote({
  request,
  responseBody,
  now = Math.floor(Date.now() / 1000),
  policy = ACROSS_DEFAULT_POLICY,
}) {
  if (!responseBody) throw new Error("across quote: empty response body");
  const totalRelayFeePct = requireFinite(responseBody.totalRelayFee?.pct, "totalRelayFee.pct");
  const relayFeePct = totalRelayFeePct / 1e18;
  if (relayFeePct > policy.maxRelayerFeePct) {
    throw new Error(
      `across quote: relayer fee ${(relayFeePct * 100).toFixed(3)}% exceeds cap ${(policy.maxRelayerFeePct * 100).toFixed(3)}%`,
    );
  }
  const outputAmount = String(responseBody.outputAmount ?? "0");
  if (outputAmount === "0") throw new Error("across quote: zero output amount");
  const quoteTimestamp = Number(responseBody.timestamp ?? now);
  const fillDeadline = quoteTimestamp + policy.fillDeadlineBufferSeconds;
  if (fillDeadline - now < policy.minFillDeadlineSeconds) {
    throw new Error(
      `across quote: fillDeadline window ${(fillDeadline - now).toFixed(0)}s below min ${policy.minFillDeadlineSeconds}s`,
    );
  }
  return {
    schemaVersion: 1,
    request,
    quote: {
      inputAmount: request.amount,
      outputAmount,
      inputToken: request.inputToken,
      outputToken: request.outputToken,
      originChainId: request.originChainId,
      destinationChainId: request.destinationChainId,
      recipient: request.recipient,
      relayFeePct,
      lpFeePct: Number(responseBody.lpFee?.pct ?? 0) / 1e18,
      totalRelayFeeTotal: String(responseBody.totalRelayFee?.total ?? "0"),
      exclusiveRelayer: responseBody.exclusiveRelayer || null,
      exclusivityDeadline: Number(responseBody.exclusivityDeadline ?? 0),
      quoteTimestamp,
      fillDeadline,
      spokePoolOrigin: acrossSpokePool(request.srcChain || ""),
      spokePoolDestination: acrossSpokePool(request.dstChain || ""),
      observedAt: new Date(now * 1000).toISOString(),
    },
  };
}
