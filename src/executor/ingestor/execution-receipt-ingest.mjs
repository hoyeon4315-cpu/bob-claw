import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ZERO_TOKEN } from "../../assets/tokens.mjs";
import { config } from "../../config/env.mjs";
import { buildReceiptReconciliation } from "../../ledger/receipt-reconciliation.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../../market/prices.mjs";
import { readJsonl } from "../../lib/jsonl-read.mjs";
import { JsonlStore } from "../../lib/jsonl-store.mjs";

function lowercase(value) {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function finiteNumber(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeObservedAt(value) {
  return value || new Date().toISOString();
}

function executionStepResults(execution) {
  return Array.isArray(execution?.stepResults)
    ? execution.stepResults.filter((item) => item && typeof item === "object")
    : [];
}

function lastStepResult(execution) {
  const steps = executionStepResults(execution);
  return steps.length > 0
    ? steps.at(-1)
    : null;
}

function signerResultsFromExecution(execution) {
  if (execution?.signerResult && typeof execution.signerResult === "object") {
    return [execution.signerResult];
  }
  return executionStepResults(execution)
    .map((item) => item?.signerResult)
    .filter((item) => item && typeof item === "object");
}

function signerResultFromExecution(execution) {
  const signerResults = signerResultsFromExecution(execution);
  return signerResults.length > 0 ? signerResults.at(-1) : null;
}

function normalizeReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") return null;
  return {
    ...receipt,
    gasUsed: receipt.gasUsed ?? "0",
    effectiveGasPrice: receipt.effectiveGasPrice ?? receipt.gasPrice ?? "0",
  };
}

function normalizedReceiptFromExecution(execution) {
  const receipts = signerResultsFromExecution(execution)
    .map((item) => normalizeReceipt(item?.receipt))
    .filter(Boolean);
  if (receipts.length === 0) return null;
  const receipt = receipts.at(-1);
  const totalGasUsed = receipts.reduce((sum, item) => sum + BigInt(item.gasUsed ?? 0), 0n);
  const totalGasCostWei = receipts.reduce(
    (sum, item) => sum + (BigInt(item.gasUsed ?? 0) * BigInt(item.effectiveGasPrice ?? 0)),
    0n,
  );
  return {
    ...receipt,
    status: receipts.every((item) => Number(item.status) !== 0) ? 1 : Number(receipt.status ?? 0),
    gasUsed: totalGasUsed.toString(),
    effectiveGasPrice:
      totalGasUsed > 0n
        ? (totalGasCostWei / totalGasUsed).toString()
        : String(receipt.effectiveGasPrice ?? receipt.gasPrice ?? "0"),
    gasCostWei: totalGasCostWei.toString(),
  };
}

function transactionForExecution(execution) {
  const signerResult = signerResultFromExecution(execution);
  const signedMetadata = signerResult?.signed?.metadata || {};
  const tx =
    execution?.plan?.intent?.tx ||
    lastStepResult(execution)?.planStep?.intent?.tx ||
    execution?.plan?.steps?.at?.(-1)?.intent?.tx ||
    execution?.plan?.steps?.[execution?.plan?.steps?.length - 1]?.intent?.tx ||
    null;
  if (!signerResult && !tx) return null;
  return {
    from: signedMetadata.from || execution?.plan?.senderAddress || null,
    to: signedMetadata.to || tx?.to || null,
    nonce: signedMetadata.nonce ?? null,
    value: tx?.value ?? tx?.valueWei ?? null,
  };
}

function routeContextForDexExecution(execution) {
  const plan = execution?.plan;
  if (!plan?.chain || !plan?.inputToken || !plan?.outputToken) return null;
  const inputUsd = finiteNumber(plan?.quote?.inputValueUsd) ?? finiteNumber(plan?.amountUsd);
  const outputUsd = finiteNumber(plan?.quote?.outputValueUsd);
  const estimatedNetPnlUsd =
    finiteNumber(plan?.quote?.netOutputValueUsd) != null && inputUsd != null
      ? finiteNumber(plan.quote.netOutputValueUsd) - inputUsd
      : null;
  return {
    routeKey: `${plan.chain}:${plan.inputToken}->${plan.chain}:${plan.outputToken}`,
    amount: plan.amount,
    srcChain: plan.chain,
    dstChain: plan.chain,
    srcAsset: {
      chain: plan.chain,
      token: plan.inputToken,
    },
    dstAsset: {
      chain: plan.chain,
      token: plan.outputToken,
    },
    inputUsd,
    outputUsd,
    netEdgeUsd: estimatedNetPnlUsd,
    executionGasUsd: finiteNumber(plan?.quote?.gasEstimateValueUsd),
    nativeCostUsd: null,
  };
}

function routeContextForGatewayExecution(execution) {
  const plan = execution?.plan;
  if (!plan?.route?.srcChain || !plan?.route?.srcToken || !plan?.route?.dstChain || !plan?.route?.dstToken) {
    return null;
  }
  return {
    routeKey:
      plan.routeKey ||
      `${plan.route.srcChain}:${plan.route.srcToken}->${plan.route.dstChain}:${plan.route.dstToken}`,
    amount: plan.amount,
    srcChain: plan.route.srcChain,
    dstChain: plan.route.dstChain,
    srcAsset: {
      chain: plan.route.srcChain,
      token: plan.route.srcToken,
    },
    dstAsset: {
      chain: plan.route.dstChain,
      token: plan.route.dstToken,
    },
    inputUsd: finiteNumber(plan.amountUsd),
    outputUsd: null,
    netEdgeUsd: null,
    executionGasUsd: null,
    nativeCostUsd: null,
  };
}

function outputForDexExecution(execution) {
  const plan = execution?.plan;
  const observedDelta = execution?.destinationProof?.observedDelta || null;
  return {
    actualOutputUnits: observedDelta,
    chain: plan?.chain || null,
    token: plan?.outputToken || null,
    priceUsd: null,
  };
}

function outputForGatewayConsolidation(execution) {
  const plan = execution?.plan;
  return {
    actualOutputUnits: execution?.destinationProof?.observedDelta || null,
    chain: plan?.route?.dstChain || null,
    token: plan?.route?.dstToken || null,
    priceUsd: null,
  };
}

function outputForGatewayOfframp(execution) {
  return {
    actualOutputUnits: execution?.destinationProof?.observedDelta || null,
    chain: "bitcoin",
    token: ZERO_TOKEN,
    priceUsd: null,
  };
}

function ingestionDescriptorForExecution(execution) {
  const strategyId = execution?.plan?.strategyId || null;
  if (strategyId === "native-dex-experiment") {
    return {
      kind: "native_dex_experiment",
      routeContext: routeContextForDexExecution(execution),
      output: outputForDexExecution(execution),
    };
  }
  if (strategyId === "token-dex-experiment") {
    return {
      kind: "token_dex_experiment",
      routeContext: routeContextForDexExecution(execution),
      output: outputForDexExecution(execution),
    };
  }
  if (strategyId === "gateway-btc-funding-transfer") {
    return {
      kind: "gateway_btc_consolidation",
      routeContext: routeContextForGatewayExecution(execution),
      output: outputForGatewayConsolidation(execution),
    };
  }
  if (strategyId === "gateway-btc-offramp") {
    return {
      kind: "gateway_btc_offramp",
      routeContext: routeContextForGatewayExecution(execution),
      output: outputForGatewayOfframp(execution),
    };
  }
  return null;
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function appendExecutionReceiptReconciliation({
  execution,
  dataDir = config.dataDir,
  store = new JsonlStore(dataDir),
  priceReader = getCoinGeckoPricesUsd,
} = {}) {
  const descriptor = ingestionDescriptorForExecution(execution);
  if (!descriptor) {
    return {
      appended: false,
      reason: "unsupported_execution_type",
      receiptRecord: null,
    };
  }

  const signerResult = signerResultFromExecution(execution);
  const txHash = signerResult?.broadcast?.txHash || null;
  const receipt = normalizedReceiptFromExecution(execution);
  if (!txHash || !receipt) {
    return {
      appended: false,
      reason: "missing_source_receipt",
      receiptRecord: null,
    };
  }

  const existing = await readJsonl(dataDir, "receipt-reconciliations");
  const normalizedTxHash = lowercase(txHash);
  const duplicate = existing.find((item) => lowercase(item?.txHash) === normalizedTxHash);
  if (duplicate) {
    return {
      appended: false,
      reason: "already_ingested",
      receiptRecord: duplicate,
    };
  }

  const prices = await priceReader().catch(() => emptyPricesUsd());
  const receiptRecord = buildReceiptReconciliation({
    kind: descriptor.kind,
    chain: execution?.plan?.chain || execution?.plan?.route?.srcChain || null,
    txHash,
    routeContext: descriptor.routeContext,
    receipt,
    transaction: transactionForExecution(execution),
    prices,
    output: descriptor.output,
    observedAt: normalizeObservedAt(execution?.observedAt),
  });
  await store.append("receipt-reconciliations", receiptRecord);
  return {
    appended: true,
    reason: "ingested",
    receiptRecord,
  };
}

export async function backfillExecutionReceiptReconciliations({
  dataDir = config.dataDir,
  priceReader = getCoinGeckoPricesUsd,
} = {}) {
  const sources = [
    "native-dex-experiment-executions",
    "token-dex-experiment-executions",
    "gateway-btc-consolidation-executions",
    "gateway-btc-offramp-executions",
  ];
  const store = new JsonlStore(dataDir);
  const results = [];
  for (const name of sources) {
    const records = await readJsonl(dataDir, name);
    for (const execution of records) {
      results.push(await appendExecutionReceiptReconciliation({
        execution,
        dataDir,
        store,
        priceReader,
      }));
    }
  }
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    sourceCount: sources.length,
    executionCount: results.length,
    appendedCount: results.filter((item) => item.appended).length,
    skippedCount: results.filter((item) => !item.appended).length,
    reasons: Object.entries(
      results.reduce((acc, item) => {
        const reason = item.reason || "unknown";
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {}),
    )
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
}

export async function loadPaybackAuditLog({ logsDir = join(process.cwd(), "logs"), fileName = "signer-audit.jsonl" } = {}) {
  try {
    const text = await readFile(join(logsDir, fileName), "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadLivePaybackReceiptStore({ dataDir = config.dataDir } = {}) {
  const [
    receiptReconciliations,
    treasuryInventory,
    marketPriceSnapshots,
    wrappedBtcLoopReceipts,
    wrappedBtcLoopLiveProof,
  ] = await Promise.all([
    readJsonl(dataDir, "receipt-reconciliations"),
    readJsonl(dataDir, "treasury-inventory"),
    readJsonl(dataDir, "market-price-snapshots"),
    readJsonl(dataDir, "wrapped-btc-loop-dry-runs"),
    readJsonIfExists(join(dataDir, "wrapped-btc-loop-live-success-latest.json")),
  ]);

  const signerBackedLoopReceipts = wrappedBtcLoopReceipts.filter((item) => item?.executionMode && item.executionMode !== "simulated_dry_run");
  return {
    receiptReconciliations,
    treasuryInventory,
    marketPriceSnapshots,
    wrappedBtcLoopReceipts: signerBackedLoopReceipts,
    wrappedBtcLoopLiveProofs: wrappedBtcLoopLiveProof ? [wrappedBtcLoopLiveProof] : [],
  };
}
