import { tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { ZERO_TOKEN } from "../assets/tokens.mjs";

const BTC_SATS = 100_000_000;
const OFT_SENT_EVENT_TOPIC = "0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a";

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function bigint(value) {
  return BigInt(value || 0);
}

function decimalFromWei(value) {
  const wei = bigint(value);
  const divisor = 1_000_000_000_000_000_000n;
  const whole = wei / divisor;
  const remainder = wei % divisor;
  return Number(whole) + Number(remainder) / 1e18;
}

function integerOrNull(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function priceForAsset(asset, prices) {
  if (!asset) return null;
  if (asset.isNative) return prices?.nativeByChain?.[asset.chain] ?? null;
  if (asset.priceKey === "btc") return prices?.btc ?? prices?.tokenByKey?.btc ?? null;
  if (asset.priceKey === "usd_stable") return 1;
  return prices?.tokenByKey?.[asset.priceKey] ?? prices?.nativeByChain?.[asset.priceKey] ?? null;
}

function btcUsdPrice(prices) {
  return prices?.btc ?? prices?.tokenByKey?.btc ?? null;
}

function usdToSats(valueUsd, btcUsd) {
  if (!Number.isFinite(valueUsd) || !Number.isFinite(btcUsd) || btcUsd <= 0) return null;
  return (valueUsd / btcUsd) * BTC_SATS;
}

function expectedNetPnl(routeContext) {
  if (!routeContext) return null;
  return Number.isFinite(routeContext.executableNetEdgeUsd) ? routeContext.executableNetEdgeUsd : routeContext.netEdgeUsd;
}

function expectedOutputUsd(routeContext) {
  if (!routeContext) return null;
  return Number.isFinite(routeContext.executableOutputUsd) ? routeContext.executableOutputUsd : routeContext.outputUsd;
}

function outputAssetFromContext(routeContext, output) {
  if (output?.chain && output?.token) {
    return tokenAsset(output.chain, output.token);
  }
  if (routeContext?.dstAsset) {
    return tokenAsset(routeContext.dstAsset.chain, routeContext.dstAsset.token, routeContext.dstAsset);
  }
  return null;
}

function normalizeHexAddress(value) {
  return value ? String(value).toLowerCase() : null;
}

function decodeLogWords(data = "0x") {
  return String(data || "")
    .replace(/^0x/i, "")
    .match(/.{64}/g) || [];
}

function inferOutputUnitsFromOftSentLog(routeContext, receipt) {
  const logs = receipt?.raw?.logs;
  if (!Array.isArray(logs) || logs.length === 0) return null;
  const expectedEmitter = normalizeHexAddress(routeContext?.srcAsset?.token || receipt?.to || null);
  const matchingLog = [...logs]
    .reverse()
    .find((entry) => {
      if (!Array.isArray(entry?.topics) || entry.topics[0]?.toLowerCase() !== OFT_SENT_EVENT_TOPIC) return false;
      if (!expectedEmitter) return true;
      return normalizeHexAddress(entry.address) === expectedEmitter;
    });
  if (!matchingLog) return null;
  const words = decodeLogWords(matchingLog.data);
  if (words.length < 3) return null;
  try {
    return BigInt(`0x${words[2]}`).toString();
  } catch {
    return null;
  }
}

function normalizeOutput(routeContext, receipt, output = {}) {
  if (output?.actualOutputUnits !== undefined && output?.actualOutputUnits !== null) {
    return {
      ...output,
      actualOutputUnits: String(output.actualOutputUnits),
      inferredFromLog: false,
    };
  }
  const inferredUnits = inferOutputUnitsFromOftSentLog(routeContext, receipt);
  return {
    ...output,
    actualOutputUnits: inferredUnits,
    inferredFromLog: Boolean(inferredUnits),
  };
}

function inputAssetFromContext(routeContext) {
  if (!routeContext?.srcAsset) return null;
  return tokenAsset(routeContext.srcAsset.chain, routeContext.srcAsset.token, routeContext.srcAsset);
}

function nativeAsset(chain) {
  return tokenAsset(chain, ZERO_TOKEN);
}

function actualOutputUsd({ routeContext, output, prices }) {
  if (Number.isFinite(output?.actualOutputUsd)) return output.actualOutputUsd;
  if (output?.actualOutputUnits === undefined || output?.actualOutputUnits === null) return null;
  const asset = outputAssetFromContext(routeContext, output);
  if (!asset || !Number.isInteger(asset.decimals)) return null;
  const amount = unitsToDecimal(output.actualOutputUnits, asset.decimals);
  const unitPrice = Number.isFinite(output?.priceUsd)
    ? output.priceUsd
    : Number.isFinite(routeContext?.price?.dstRawUsd)
      ? routeContext.price.dstRawUsd
      : priceForAsset(asset, prices);
  if (!Number.isFinite(amount) || !Number.isFinite(unitPrice)) return null;
  return amount * unitPrice;
}

function actualTxValueUsd({ chain, transaction, routeContext, prices }) {
  if (transaction && transaction.value !== undefined && transaction.value !== null) {
    const priceUsd = priceForAsset(nativeAsset(chain), prices);
    if (!Number.isFinite(priceUsd)) return null;
    return decimalFromWei(transaction.value) * priceUsd;
  }
  return Number.isFinite(routeContext?.nativeCostUsd) ? routeContext.nativeCostUsd : null;
}

function receiptGasUsd({ chain, receipt, prices }) {
  if (!receipt) return null;
  const gasCostWei =
    receipt.gasCostWei !== undefined && receipt.gasCostWei !== null
      ? bigint(receipt.gasCostWei)
      : bigint(receipt.gasUsed) * bigint(receipt.effectiveGasPrice);
  const priceUsd = priceForAsset(nativeAsset(chain), prices);
  if (!Number.isFinite(priceUsd)) return null;
  return (Number(gasCostWei) / 1e18) * priceUsd;
}

function outputDriftBps(actualUsd, expectedUsd) {
  if (!Number.isFinite(actualUsd) || !Number.isFinite(expectedUsd) || expectedUsd === 0) return null;
  return ((actualUsd - expectedUsd) / expectedUsd) * 10_000;
}

function gasDriftPct(actualGasUsd, expectedGasUsd) {
  if (!Number.isFinite(actualGasUsd) || !Number.isFinite(expectedGasUsd) || expectedGasUsd === 0) return null;
  return (actualGasUsd - expectedGasUsd) / expectedGasUsd;
}

function driftUsd(actualValue, expectedValue) {
  if (!Number.isFinite(actualValue) || !Number.isFinite(expectedValue)) return null;
  return actualValue - expectedValue;
}

function reconciliationStatus({ receipt, actualOutputValueUsd, expectedOutputValueUsd }) {
  if (Number(receipt?.status) === 0) return "failed";
  if (
    Number.isFinite(actualOutputValueUsd) &&
    Number.isFinite(expectedOutputValueUsd) &&
    expectedOutputValueUsd > 0 &&
    actualOutputValueUsd <= 0
  ) {
    return "failed";
  }
  if (Number.isFinite(actualOutputValueUsd)) return "reconciled";
  return "pending_output";
}

export function buildReceiptReconciliation({
  kind = "route_execution",
  chain,
  txHash,
  routeContext = null,
  receipt,
  transaction = null,
  output = {},
  prices = null,
  observedAt,
}) {
  const normalizedOutput = normalizeOutput(routeContext, receipt, output);
  const actualGasCostUsd = receiptGasUsd({ chain, receipt, prices });
  const actualTxValueCostUsd = actualTxValueUsd({ chain, transaction, routeContext, prices });
  const actualOutputValueUsd = actualOutputUsd({ routeContext, output: normalizedOutput, prices });
  const expectedOutputValueUsd = expectedOutputUsd(routeContext);
  const actualKnownCostUsd =
    (Number.isFinite(actualGasCostUsd) ? actualGasCostUsd : 0) + (Number.isFinite(actualTxValueCostUsd) ? actualTxValueCostUsd : 0);
  const btcUsd = btcUsdPrice(prices);
  const expectedInputUsd = routeContext?.inputUsd ?? null;
  const realizedNetPnlUsd =
    Number(receipt?.status) === 0
      ? finiteOrNull(-actualKnownCostUsd)
      : Number.isFinite(expectedInputUsd) && Number.isFinite(actualOutputValueUsd)
        ? finiteOrNull(actualOutputValueUsd - expectedInputUsd - actualKnownCostUsd)
        : null;
  const realizedNetPnlSats = integerOrNull(usdToSats(realizedNetPnlUsd, btcUsd));

  return {
    schemaVersion: 1,
    observedAt: observedAt || new Date().toISOString(),
    kind,
    chain,
    txHash,
    reconciliationStatus: reconciliationStatus({ receipt, actualOutputValueUsd, expectedOutputValueUsd }),
    routeContext: routeContext
      ? {
          routeKey: routeContext.routeKey,
          amount: routeContext.amount,
          srcChain: routeContext.srcChain,
          dstChain: routeContext.dstChain,
          tradeReadiness: routeContext.tradeReadiness ?? null,
          estimatedInputUsd: routeContext.inputUsd ?? null,
          estimatedOutputUsd: expectedOutputUsd(routeContext),
          estimatedNetPnlUsd: expectedNetPnl(routeContext),
          estimatedExecutionGasUsd: routeContext.executionGasUsd ?? null,
          estimatedNativeCostUsd: routeContext.nativeCostUsd ?? null,
        }
      : null,
    transaction: transaction
      ? {
          from: transaction.from,
          to: transaction.to,
          nonce: transaction.nonce,
          value: transaction.value != null ? transaction.value.toString() : null,
          valueDecimal: transaction.value != null ? decimalFromWei(transaction.value) : null,
        }
      : null,
    receipt: receipt
      ? {
          status: Number(receipt.status),
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
          gasCostWei: receipt.gasCostWei != null ? receipt.gasCostWei.toString() : null,
          from: receipt.from,
          to: receipt.to,
        }
      : null,
    pricing: {
      btcUsd: finiteOrNull(btcUsd),
    },
    output: {
      asset: outputAssetFromContext(routeContext, normalizedOutput),
      actualOutputUnits: normalizedOutput.actualOutputUnits != null ? String(normalizedOutput.actualOutputUnits) : null,
      actualOutputUsd: finiteOrNull(actualOutputValueUsd),
      explicitOutputPriceUsd: finiteOrNull(normalizedOutput.priceUsd),
      outputInference: normalizedOutput.inferredFromLog ? "oft_sent_log" : null,
    },
    realized: {
      actualTxValueUsd: finiteOrNull(actualTxValueCostUsd),
      receiptGasUsd: finiteOrNull(actualGasCostUsd),
      actualKnownCostUsd: finiteOrNull(actualKnownCostUsd),
      realizedNetPnlUsd,
      realizedNetPnlSats,
      realizedNetProfitSats: realizedNetPnlSats,
      realizedFillVsEstimateBps: outputDriftBps(actualOutputValueUsd, expectedOutputUsd(routeContext)),
      gasDriftUsd:
        Number.isFinite(actualGasCostUsd) && Number.isFinite(routeContext?.executionGasUsd)
          ? actualGasCostUsd - routeContext.executionGasUsd
          : null,
      gasDriftPct: gasDriftPct(actualGasCostUsd, routeContext?.executionGasUsd),
    },
    flags: {
      failed: Number(receipt?.status) === 0,
      missingActualOutput: Number(receipt?.status) !== 0 && !Number.isFinite(actualOutputValueUsd),
      estimatedPositiveButRealizedNegative:
        Number.isFinite(expectedNetPnl(routeContext)) &&
        expectedNetPnl(routeContext) > 0 &&
        Number.isFinite(realizedNetPnlUsd) &&
        realizedNetPnlUsd < 0,
    },
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildReceiptLedgerSummary(records = []) {
  const reconciled = records.filter((item) => item.reconciliationStatus === "reconciled");
  const failed = records.filter((item) => item.reconciliationStatus === "failed");
  const pendingOutput = records.filter((item) => item.reconciliationStatus === "pending_output");
  const settled = [...reconciled, ...failed];
  const realizedValues = reconciled.map((item) => item.realized?.realizedNetPnlUsd).filter(Number.isFinite);
  const gasValues = records.map((item) => item.realized?.receiptGasUsd).filter(Number.isFinite);
  const driftValues = reconciled.map((item) => item.realized?.realizedFillVsEstimateBps).filter(Number.isFinite);
  const estimatedNetValues = settled.map((item) => item.routeContext?.estimatedNetPnlUsd).filter(Number.isFinite);
  const netDriftValues = settled
    .map((item) => driftUsd(item.realized?.realizedNetPnlUsd, item.routeContext?.estimatedNetPnlUsd))
    .filter(Number.isFinite);
  const outputDriftValues = reconciled
    .map((item) => driftUsd(item.output?.actualOutputUsd, item.routeContext?.estimatedOutputUsd))
    .filter(Number.isFinite);
  const gasDriftValues = settled.map((item) => item.realized?.gasDriftUsd).filter(Number.isFinite);
  const routeGroups = new Map();

  for (const item of records) {
    const key = item.routeContext?.routeKey || "__unknown__";
    if (!routeGroups.has(key)) routeGroups.set(key, []);
    routeGroups.get(key).push(item);
  }

  return {
    schemaVersion: 1,
    summary: {
      recordCount: records.length,
      reconciledCount: reconciled.length,
      failedCount: failed.length,
      pendingOutputCount: pendingOutput.length,
      realizedNetPnlUsd: realizedValues.reduce((sum, value) => sum + value, 0),
      medianRealizedNetPnlUsd: median(realizedValues),
      failedGasCostUsd: failed.map((item) => item.realized?.actualKnownCostUsd).filter(Number.isFinite).reduce((sum, value) => sum + value, 0),
      totalReceiptGasUsd: gasValues.reduce((sum, value) => sum + value, 0),
      medianFillDriftBps: median(driftValues),
      totalEstimatedNetPnlUsd: estimatedNetValues.length ? sum(estimatedNetValues) : null,
      medianEstimatedNetPnlUsd: median(estimatedNetValues),
      totalNetDriftUsd: netDriftValues.length ? sum(netDriftValues) : null,
      medianNetDriftUsd: median(netDriftValues),
      medianOutputDriftUsd: median(outputDriftValues),
      totalExecutionGasDriftUsd: gasDriftValues.length ? sum(gasDriftValues) : null,
      medianExecutionGasDriftUsd: median(gasDriftValues),
      estimatedPositiveRealizedNegativeCount: settled.filter((item) => item.flags?.estimatedPositiveButRealizedNegative).length,
    },
    routes: [...routeGroups.entries()].map(([routeKey, items]) => {
      const routeRealized = items.map((item) => item.realized?.realizedNetPnlUsd).filter(Number.isFinite);
      const routeSettled = items.filter((item) => item.reconciliationStatus === "reconciled" || item.reconciliationStatus === "failed");
      const routeEstimatedNet = routeSettled.map((item) => item.routeContext?.estimatedNetPnlUsd).filter(Number.isFinite);
      const routeNetDrift = routeSettled
        .map((item) => driftUsd(item.realized?.realizedNetPnlUsd, item.routeContext?.estimatedNetPnlUsd))
        .filter(Number.isFinite);
      const routeOutputDrift = items
        .filter((item) => item.reconciliationStatus === "reconciled")
        .map((item) => driftUsd(item.output?.actualOutputUsd, item.routeContext?.estimatedOutputUsd))
        .filter(Number.isFinite);
      const routeGasDrift = routeSettled.map((item) => item.realized?.gasDriftUsd).filter(Number.isFinite);
      return {
        routeKey: routeKey === "__unknown__" ? null : routeKey,
        count: items.length,
        reconciledCount: items.filter((item) => item.reconciliationStatus === "reconciled").length,
        failedCount: items.filter((item) => item.reconciliationStatus === "failed").length,
        realizedNetPnlUsd: routeRealized.reduce((sum, value) => sum + value, 0),
        medianRealizedNetPnlUsd: median(routeRealized),
        totalEstimatedNetPnlUsd: routeEstimatedNet.length ? sum(routeEstimatedNet) : null,
        medianEstimatedNetPnlUsd: median(routeEstimatedNet),
        totalNetDriftUsd: routeNetDrift.length ? sum(routeNetDrift) : null,
        medianNetDriftUsd: median(routeNetDrift),
        medianOutputDriftUsd: median(routeOutputDrift),
        totalExecutionGasDriftUsd: routeGasDrift.length ? sum(routeGasDrift) : null,
        medianExecutionGasDriftUsd: median(routeGasDrift),
        estimatedPositiveRealizedNegativeCount: routeSettled.filter((item) => item.flags?.estimatedPositiveButRealizedNegative).length,
      };
    }),
  };
}
