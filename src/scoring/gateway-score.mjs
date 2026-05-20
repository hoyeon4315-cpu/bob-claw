import { tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { ETHEREUM_L1_PHASE_DISABLED_REASON, isEthereumL1Route } from "../risk/ethereum-l1-policy.mjs";

export const BTC_DECIMALS = 8;

export function unitsToBtc(units) {
  return unitsToDecimal(units, BTC_DECIMALS);
}

export function txValueUsd(quote, nativeByChain) {
  const txValueWei = BigInt(quote.txValueWei || 0);
  if (txValueWei === 0n) return 0;
  const nativePrice = nativeByChain?.[quote.route.srcChain];
  if (!Number.isFinite(nativePrice)) return null;
  return (Number(txValueWei) / 1e18) * nativePrice;
}

function amountUsd(amount, price) {
  if (!Number.isFinite(amount) || !Number.isFinite(price?.usd)) return null;
  return amount * price.usd;
}

function priceFromKey(priceKey, prices) {
  if (!priceKey) return null;
  if (priceKey === "btc") return prices.btc ?? prices.tokenByKey?.btc ?? null;
  if (priceKey === "usd_stable") return prices.tokenByKey?.usd_stable ?? 1;
  return prices.tokenByKey?.[priceKey] ?? prices.nativeByChain?.[priceKey] ?? null;
}

function priceConfidence(asset) {
  if (asset.family === "stablecoin") return "stablecoin_peg_assumption";
  if (asset.family === "wrapped_btc") return "btc_peg_assumption";
  if (asset.ticker === "BTC") return "market";
  if (asset.priceKey === "paxg" || asset.priceKey === "xaut") return "market";
  if (asset.priceKey) return "market_or_native_proxy";
  return "unknown";
}

function pricedAsset(asset, prices, side, options) {
  const rawUsd = priceFromKey(asset.priceKey, prices);
  if (!Number.isFinite(rawUsd)) {
    return { usd: null, rawUsd: null, confidence: "missing", haircutBps: 0 };
  }
  const haircutBps = options.priceHaircutBps ?? 25;
  const multiplier = side === "input" ? 1 + haircutBps / 10_000 : 1 - haircutBps / 10_000;
  return {
    usd: rawUsd * multiplier,
    rawUsd,
    confidence: priceConfidence(asset),
    haircutBps,
  };
}

function minutesBetween(older, newer) {
  if (!older || !newer) return null;
  return (new Date(newer).getTime() - new Date(older).getTime()) / 60_000;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function isNativeBtcDestination(quote, dstAsset) {
  return quote?.route?.dstChain === "bitcoin" && (dstAsset?.ticker === "BTC" || dstAsset?.family === "btc");
}

function executableOutputUsdForDestination({ quote, dstAsset, outputUsd, dexOutputQuote }) {
  if (Number.isFinite(dexOutputQuote?.netOutputValueUsd)) return dexOutputQuote.netOutputValueUsd;
  if (Number.isFinite(dexOutputQuote?.outputValueUsd)) {
    return dexOutputQuote.outputValueUsd - (dexOutputQuote.gasEstimateValueUsd || 0);
  }
  if (isNativeBtcDestination(quote, dstAsset) && Number.isFinite(outputUsd)) return outputUsd;
  return null;
}

function exactGasGapForFailure(reason) {
  if (reason === "erc20_allowance_insufficient") return "exact_src_execution_gas_allowance_insufficient";
  if (reason === "erc20_balance_insufficient") return "exact_src_execution_gas_token_insufficient";
  if (reason === "execution_reverted") return "exact_src_execution_gas_reverted";
  return "exact_src_execution_gas_not_estimated";
}

function classifyQuote({
  quote,
  dataGaps,
  netEdgeUsd,
  netEdgePct,
  executableNetEdgeUsd,
  executableNetEdgePct,
  effectiveSystemNetPnlUsd,
  effectiveSystemNetPnlPct,
  options,
}) {
  if (!options.allowEthereumL1Routes && isEthereumL1Route(quote?.route)) {
    return ETHEREUM_L1_PHASE_DISABLED_REASON;
  }
  if (dataGaps.length > 0) return "insufficient_data";
  if ((options.routeStats?.failureRate ?? 0) > (options.maxRouteFailureRate ?? 0.1)) return "reject_high_failure_rate";
  if (quote.quoteType === "offramp") return "observe_only_expensive_exit";
  if (quote.quoteType === "onramp") return "observe_only_slow_settlement";
  if (quote.quoteType !== "layerZero") return "unknown_quote_type";
  const candidateNetEdgeUsd =
    finiteOrNull(effectiveSystemNetPnlUsd) ?? finiteOrNull(executableNetEdgeUsd) ?? finiteOrNull(netEdgeUsd);
  const candidateNetEdgePct =
    finiteOrNull(effectiveSystemNetPnlPct) ?? finiteOrNull(executableNetEdgePct) ?? finiteOrNull(netEdgePct);
  if (!Number.isFinite(candidateNetEdgeUsd) || !Number.isFinite(candidateNetEdgePct)) return "insufficient_data";
  if (candidateNetEdgeUsd <= 0) return "reject_no_net_edge";
  if (candidateNetEdgeUsd < (options.minProfitUsd ?? 1)) return "reject_below_min_profit";
  if (candidateNetEdgePct < (options.minEdgeBps ?? 20) / 10_000) return "reject_below_min_edge";
  return "shadow_candidate_review_only";
}

export function scoreGatewayQuote(quote, prices, options = {}) {
  const srcAsset = options.srcAsset || tokenAsset(quote.route.srcChain, quote.route.srcToken);
  const dstAsset = options.dstAsset || tokenAsset(quote.route.dstChain, quote.route.dstToken);
  const dataGaps = [];
  const assumptions = [];
  const routeStats = options.routeStats || { quoteCount: 0, failureCount: 0, failureRate: 0 };
  const dexOutputQuote = options.dexOutputQuote || null;
  const bitcoinFee = options.bitcoinFee || null;
  const hasNativeBitcoinLeg = quote.route.srcChain === "bitcoin" || quote.route.dstChain === "bitcoin";
  const executionGasSource = options.executionGasSource || null;
  const exactExecutionGasFailureReason = options.exactExecutionGasFailureReason || null;

  if (!Number.isInteger(srcAsset.decimals)) dataGaps.push("missing_src_token_decimals");
  if (!Number.isInteger(dstAsset.decimals)) dataGaps.push("missing_dst_token_decimals");

  const inputAmount = unitsToDecimal(quote.inputAmount, srcAsset.decimals);
  const outputAmount = unitsToDecimal(quote.outputAmount, dstAsset.decimals);
  const srcPrice = pricedAsset(srcAsset, prices, "input", options);
  const dstPrice = pricedAsset(dstAsset, prices, "output", options);
  if (!Number.isFinite(srcPrice.usd)) dataGaps.push("missing_src_token_price");
  if (!Number.isFinite(dstPrice.usd)) dataGaps.push("missing_dst_token_price");
  if (srcPrice.confidence.endsWith("_assumption")) assumptions.push(srcPrice.confidence);
  if (dstPrice.confidence.endsWith("_assumption")) assumptions.push(dstPrice.confidence);

  const inputUsd = amountUsd(inputAmount, srcPrice);
  const outputUsd = amountUsd(outputAmount, dstPrice);
  const tokenDeltaUsd = Number.isFinite(inputUsd) && Number.isFinite(outputUsd) ? outputUsd - inputUsd : null;
  const nativeCostUsd = txValueUsd(quote, prices.nativeByChain);
  if (nativeCostUsd === null && BigInt(quote.txValueWei || 0) > 0n) dataGaps.push("missing_tx_value_native_price");

  const gasSnapshotAgeMinutes = minutesBetween(options.gasObservedAt, options.now || new Date().toISOString());
  if (
    options.gasObservedAt &&
    gasSnapshotAgeMinutes !== null &&
    gasSnapshotAgeMinutes > (options.maxGasSnapshotAgeMinutes ?? 30)
  ) {
    dataGaps.push("stale_src_gas_snapshot");
  }

  const executionGasUsd = options.executionGasUsd ?? null;
  if (quote.route.srcChain !== "bitcoin" && !Number.isFinite(executionGasUsd)) {
    dataGaps.push("missing_src_execution_gas");
  }
  if (
    quote.route.srcChain !== "bitcoin" &&
    options.requireExactExecutionGas &&
    executionGasSource !== "eth_estimateGas"
  ) {
    dataGaps.push(exactGasGapForFailure(exactExecutionGasFailureReason));
  }
  if (hasNativeBitcoinLeg && !Number.isFinite(bitcoinFee?.estimatedFeeUsd)) {
    dataGaps.push("bitcoin_network_fee_not_modelled");
  }

  const gasBufferMultiplier = options.gasBufferMultiplier ?? 2;
  const gasShockBufferUsd = Number.isFinite(executionGasUsd)
    ? executionGasUsd * Math.max(0, gasBufferMultiplier - 1)
    : null;
  const nativeBitcoinFeeUsd =
    hasNativeBitcoinLeg && Number.isFinite(bitcoinFee?.estimatedFeeUsd) ? bitcoinFee.estimatedFeeUsd : null;
  const knownCostUsd =
    (nativeCostUsd || 0) +
    (Number.isFinite(executionGasUsd) ? executionGasUsd : 0) +
    (Number.isFinite(gasShockBufferUsd) ? gasShockBufferUsd : 0) +
    (Number.isFinite(nativeBitcoinFeeUsd) ? nativeBitcoinFeeUsd : 0);
  const treasuryExecutionRefillCostUsd = finiteOrNull(options.executionRefillExpectedCostUsd);
  const treasuryReserveReplenishmentCostUsd = finiteOrNull(options.reserveReplenishmentExpectedCostUsd);
  const expectedFailureCostUsd = finiteOrNull(options.expectedFailureCostUsd);
  const capitalFragmentationDragUsd = finiteOrNull(options.capitalFragmentationDragUsd);
  const treasuryAdjustedKnownCostUsd =
    knownCostUsd + (Number.isFinite(treasuryExecutionRefillCostUsd) ? treasuryExecutionRefillCostUsd : 0);
  const effectiveSystemKnownCostUsd =
    Number.isFinite(treasuryExecutionRefillCostUsd) &&
    Number.isFinite(treasuryReserveReplenishmentCostUsd) &&
    Number.isFinite(expectedFailureCostUsd) &&
    Number.isFinite(capitalFragmentationDragUsd)
      ? treasuryAdjustedKnownCostUsd +
        treasuryReserveReplenishmentCostUsd +
        expectedFailureCostUsd +
        capitalFragmentationDragUsd
      : null;
  const netEdgeUsd = Number.isFinite(tokenDeltaUsd) ? tokenDeltaUsd - knownCostUsd : null;
  const netEdgePct =
    Number.isFinite(netEdgeUsd) && Number.isFinite(inputUsd) && inputUsd > 0 ? netEdgeUsd / inputUsd : null;
  const treasuryAdjustedNetEdgeUsd = Number.isFinite(tokenDeltaUsd)
    ? tokenDeltaUsd - treasuryAdjustedKnownCostUsd
    : null;
  const treasuryAdjustedNetEdgePct =
    Number.isFinite(treasuryAdjustedNetEdgeUsd) && Number.isFinite(inputUsd) && inputUsd > 0
      ? treasuryAdjustedNetEdgeUsd / inputUsd
      : null;
  const dexOutputQuoteAgeMinutes = minutesBetween(dexOutputQuote?.observedAt, options.now || new Date().toISOString());
  if (
    dexOutputQuote &&
    dexOutputQuoteAgeMinutes !== null &&
    dexOutputQuoteAgeMinutes > (options.maxDexQuoteAgeMinutes ?? 30)
  ) {
    dataGaps.push("stale_dex_output_quote");
  }
  const executableOutputUsd = executableOutputUsdForDestination({
    quote,
    dstAsset,
    outputUsd,
    dexOutputQuote,
  });
  const executableTokenDeltaUsd =
    Number.isFinite(inputUsd) && Number.isFinite(executableOutputUsd) ? executableOutputUsd - inputUsd : null;
  const executableNetEdgeUsd = Number.isFinite(executableTokenDeltaUsd) ? executableTokenDeltaUsd - knownCostUsd : null;
  const executableNetEdgePct =
    Number.isFinite(executableNetEdgeUsd) && Number.isFinite(inputUsd) && inputUsd > 0
      ? executableNetEdgeUsd / inputUsd
      : null;
  const treasuryAdjustedExecutableNetEdgeUsd = Number.isFinite(executableTokenDeltaUsd)
    ? executableTokenDeltaUsd - treasuryAdjustedKnownCostUsd
    : null;
  const treasuryAdjustedExecutableNetEdgePct =
    Number.isFinite(treasuryAdjustedExecutableNetEdgeUsd) && Number.isFinite(inputUsd) && inputUsd > 0
      ? treasuryAdjustedExecutableNetEdgeUsd / inputUsd
      : null;
  const outputInputValueRatio =
    Number.isFinite(inputUsd) && inputUsd > 0 && Number.isFinite(outputUsd) ? outputUsd / inputUsd : null;
  if (
    Number.isFinite(outputInputValueRatio) &&
    inputUsd >= (options.minValueSanityInputUsd ?? 1) &&
    (outputInputValueRatio > (options.maxPlausibleValueRatio ?? 1.5) ||
      outputInputValueRatio < (options.minPlausibleValueRatio ?? 0.5))
  ) {
    dataGaps.push("implausible_quote_value_ratio");
  }
  const breakEvenPct = Number.isFinite(inputUsd) && inputUsd > 0 ? knownCostUsd / inputUsd : null;
  const treasuryAdjustedBreakEvenPct =
    Number.isFinite(inputUsd) && inputUsd > 0 ? treasuryAdjustedKnownCostUsd / inputUsd : null;
  const effectiveSystemNetPnlUsd =
    finiteOrNull(options.effectiveSystemNetPnlUsd) ??
    (Number.isFinite(tokenDeltaUsd) && Number.isFinite(effectiveSystemKnownCostUsd)
      ? tokenDeltaUsd - effectiveSystemKnownCostUsd
      : null);
  const effectiveSystemNetPnlPct =
    Number.isFinite(effectiveSystemNetPnlUsd) && Number.isFinite(inputUsd) && inputUsd > 0
      ? effectiveSystemNetPnlUsd / inputUsd
      : null;
  const effectiveSystemBreakEvenPct =
    Number.isFinite(inputUsd) &&
    inputUsd > 0 &&
    Number.isFinite(treasuryExecutionRefillCostUsd) &&
    Number.isFinite(treasuryReserveReplenishmentCostUsd) &&
    Number.isFinite(expectedFailureCostUsd) &&
    Number.isFinite(capitalFragmentationDragUsd)
      ? effectiveSystemKnownCostUsd / inputUsd
      : null;

  return {
    observedAt: quote.observedAt,
    routeKey: quote.routeKey,
    srcChain: quote.route.srcChain,
    dstChain: quote.route.dstChain,
    quoteType: quote.quoteType,
    amount: quote.amount,
    srcAsset,
    dstAsset,
    inputAmount,
    outputAmount,
    inputUsd: finiteOrNull(inputUsd),
    outputUsd: finiteOrNull(outputUsd),
    tokenDeltaUsd: finiteOrNull(tokenDeltaUsd),
    nativeCostUsd: finiteOrNull(nativeCostUsd),
    executionGasUsd: finiteOrNull(executionGasUsd),
    executionGasSource,
    exactExecutionGasFailureReason,
    gasShockBufferUsd: finiteOrNull(gasShockBufferUsd),
    bitcoinFeeUsd: finiteOrNull(nativeBitcoinFeeUsd),
    knownCostUsd,
    netEdgeUsd: finiteOrNull(netEdgeUsd),
    netEdgePct: finiteOrNull(netEdgePct),
    treasuryExecutionRefillCostUsd,
    treasuryReserveReplenishmentCostUsd,
    expectedFailureCostUsd,
    capitalFragmentationDragUsd,
    treasuryAdjustedKnownCostUsd: finiteOrNull(treasuryAdjustedKnownCostUsd),
    treasuryAdjustedNetEdgeUsd: finiteOrNull(treasuryAdjustedNetEdgeUsd),
    treasuryAdjustedNetEdgePct: finiteOrNull(treasuryAdjustedNetEdgePct),
    executableOutputUsd: finiteOrNull(executableOutputUsd),
    executableTokenDeltaUsd: finiteOrNull(executableTokenDeltaUsd),
    executableNetEdgeUsd: finiteOrNull(executableNetEdgeUsd),
    executableNetEdgePct: finiteOrNull(executableNetEdgePct),
    treasuryAdjustedExecutableNetEdgeUsd: finiteOrNull(treasuryAdjustedExecutableNetEdgeUsd),
    treasuryAdjustedExecutableNetEdgePct: finiteOrNull(treasuryAdjustedExecutableNetEdgePct),
    effectiveSystemKnownCostUsd: finiteOrNull(effectiveSystemKnownCostUsd),
    effectiveSystemNetPnlUsd,
    effectiveSystemNetPnlPct: finiteOrNull(effectiveSystemNetPnlPct),
    outputInputValueRatio: finiteOrNull(outputInputValueRatio),
    breakEvenPct: finiteOrNull(breakEvenPct),
    treasuryAdjustedBreakEvenPct: finiteOrNull(treasuryAdjustedBreakEvenPct),
    effectiveSystemBreakEvenPct: finiteOrNull(effectiveSystemBreakEvenPct),
    gasSnapshotAgeMinutes: finiteOrNull(gasSnapshotAgeMinutes),
    estimatedTimeInSecs: quote.estimatedTimeInSecs,
    latencyMs: quote.latencyMs,
    price: {
      srcUsd: finiteOrNull(srcPrice.usd),
      dstUsd: finiteOrNull(dstPrice.usd),
      srcRawUsd: finiteOrNull(srcPrice.rawUsd),
      dstRawUsd: finiteOrNull(dstPrice.rawUsd),
      srcConfidence: srcPrice.confidence,
      dstConfidence: dstPrice.confidence,
      haircutBps: srcPrice.haircutBps || dstPrice.haircutBps || 0,
    },
    dataGaps: [...new Set(dataGaps)],
    assumptions: [...new Set(assumptions)],
    routeStats,
    bitcoinFee:
      hasNativeBitcoinLeg && bitcoinFee
        ? {
            observedAt: bitcoinFee.observedAt,
            feeRateSatVb: bitcoinFee.selectedFeeRateSatVb,
            vbytes: bitcoinFee.vbytes,
            estimatedFeeSats: bitcoinFee.estimatedFeeSats,
            estimatedFeeUsd: finiteOrNull(bitcoinFee.estimatedFeeUsd),
            model: bitcoinFee.model,
          }
        : null,
    dex: dexOutputQuote
      ? {
          provider: dexOutputQuote.provider,
          observedAt: dexOutputQuote.observedAt,
          chain: dexOutputQuote.chain,
          outputTicker: dexOutputQuote.outputTicker,
          outputAmount: dexOutputQuote.outputAmount,
          outputValueUsd: finiteOrNull(dexOutputQuote.outputValueUsd),
          netOutputValueUsd: finiteOrNull(dexOutputQuote.netOutputValueUsd),
          gasEstimateValueUsd: finiteOrNull(dexOutputQuote.gasEstimateValueUsd),
          priceImpactPct: finiteOrNull(dexOutputQuote.priceImpactPct),
          ageMinutes: finiteOrNull(dexOutputQuoteAgeMinutes),
        }
      : null,
    tradeReadiness: classifyQuote({
      quote,
      dataGaps,
      netEdgeUsd,
      netEdgePct,
      executableNetEdgeUsd,
      executableNetEdgePct,
      effectiveSystemNetPnlUsd,
      effectiveSystemNetPnlPct,
      options,
    }),
  };
}
