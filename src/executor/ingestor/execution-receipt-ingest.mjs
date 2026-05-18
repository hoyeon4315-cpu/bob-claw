import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ZERO_TOKEN } from "../../assets/tokens.mjs";
import { config } from "../../config/env.mjs";
import { buildReceiptReconciliation, YIELD_KINDS } from "../../ledger/receipt-reconciliation.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../../market/prices.mjs";
import { readJsonl, readLatestJsonlRecord } from "../../lib/jsonl-read.mjs";
import { JsonlStore } from "../../lib/jsonl-store.mjs";
import { readTransactionByHash, readTransactionReceipt } from "../../evm/transaction-read.mjs";
import { appendSignerAuditRecord, readSignerAuditLog } from "../signer/audit-log.mjs";
import { buildCapitalAuditClosureRecord } from "../capital/capital-audit-pair.mjs";
import {
  getAsyncSettlementHandler,
  hasAsyncSettlementHandler,
  registerAsyncSettlementHandler,
  resolveAsyncSettlementHandler,
} from "../capital/async-settlement-registry.mjs";

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
  return steps.length > 0 ? steps.at(-1) : null;
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
    (sum, item) => sum + BigInt(item.gasUsed ?? 0) * BigInt(item.effectiveGasPrice ?? 0),
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

function signerAuditStage(record = {}) {
  return record?.lifecycle?.stage || null;
}

function signerAuditTxHash(record = {}) {
  return record?.broadcast?.txHash || record?.lifecycle?.txHash || null;
}

const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function topicAddress(topic) {
  if (typeof topic !== "string") return null;
  const hex = topic.toLowerCase().replace(/^0x/, "");
  if (hex.length < 40) return null;
  return `0x${hex.slice(-40)}`;
}

function inferDexSwapOutputUnitsFromReceipt({ receipt = null, outputToken = null, recipient = null } = {}) {
  const normalizedOutputToken = lowercase(outputToken);
  const normalizedRecipient = lowercase(recipient);
  if (!normalizedOutputToken || !normalizedRecipient || !Array.isArray(receipt?.logs)) return null;
  let netAmount = 0n;
  for (const log of receipt.logs) {
    if (lowercase(log?.address) !== normalizedOutputToken) continue;
    const topics = Array.isArray(log?.topics) ? log.topics : [];
    if (lowercase(topics[0]) !== ERC20_TRANSFER_TOPIC) continue;
    const from = topicAddress(topics[1]);
    const to = topicAddress(topics[2]);
    const amount = typeof log?.data === "string" ? BigInt(log.data) : 0n;
    if (to === normalizedRecipient) netAmount += amount;
    if (from === normalizedRecipient) netAmount -= amount;
  }
  return netAmount > 0n ? netAmount.toString() : null;
}

function signerAuditOutput(record = {}, receipt = null, transaction = null) {
  if (record?.intent?.approval) {
    return {
      actualOutputUsd: 0,
    };
  }
  if (record?.intent?.intentType === "dex_swap") {
    const recipient =
      record?.broadcast?.from || record?.lifecycle?.signer?.from || transaction?.from || receipt?.from || null;
    const outputToken = record?.intent?.metadata?.outputToken || null;
    const actualOutputUnits = inferDexSwapOutputUnitsFromReceipt({
      receipt,
      outputToken,
      recipient,
    });
    if (outputToken) {
      return {
        actualOutputUnits,
        chain: record?.chain || null,
        token: outputToken,
        priceUsd: null,
      };
    }
  }
  return {};
}

function receiptRealizedSummary(receipt) {
  if (!receipt || typeof receipt !== "object") return null;
  const gasUsed = receipt.gasUsed != null ? String(receipt.gasUsed) : null;
  const gasPrice = receipt.gasPrice != null ? String(receipt.gasPrice) : null;
  const effectiveGasPrice = receipt.effectiveGasPrice != null ? String(receipt.effectiveGasPrice) : null;
  const fee =
    receipt.fee != null
      ? String(receipt.fee)
      : gasUsed && (effectiveGasPrice || gasPrice)
        ? (BigInt(gasUsed) * BigInt(effectiveGasPrice || gasPrice)).toString()
        : null;
  return {
    hash: receipt.hash || null,
    blockNumber: receipt.blockNumber ?? null,
    status: receipt.status ?? null,
    gasUsed,
    gasPrice,
    effectiveGasPrice,
    fee,
  };
}

function finalSignerAuditIntentHashes(records = []) {
  return new Set(
    (records || [])
      .filter((record) => ["confirmed", "reverted", "rejected", "error"].includes(signerAuditStage(record)))
      .map((record) => record?.intentHash)
      .filter(Boolean),
  );
}

function pendingSignerConfirmationCandidates(records = []) {
  const finalIntentHashes = finalSignerAuditIntentHashes(records);
  const latestByIntent = new Map();
  for (const record of records || []) {
    const stage = signerAuditStage(record);
    if (!["broadcasted", "confirmation_pending"].includes(stage)) continue;
    if (record?.intent?.mode !== "live") continue;
    if (record?.chain == null || record.chain === "bitcoin") continue;
    if (!record?.intentHash || finalIntentHashes.has(record.intentHash)) continue;
    const txHash = signerAuditTxHash(record);
    if (!txHash) continue;
    const previous = latestByIntent.get(record.intentHash);
    if (!previous || String(record.timestamp || "") >= String(previous.timestamp || "")) {
      latestByIntent.set(record.intentHash, record);
    }
  }
  return [...latestByIntent.values()];
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
      plan.routeKey || `${plan.route.srcChain}:${plan.route.srcToken}->${plan.route.dstChain}:${plan.route.dstToken}`,
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

function routeContextForAcrossExecution(execution) {
  const plan = execution?.plan;
  if (!plan?.srcChain || !plan?.srcToken || !plan?.dstChain || !plan?.dstToken) {
    return null;
  }
  return {
    routeKey: `${plan.srcChain}:${plan.srcToken}->${plan.dstChain}:${plan.dstToken}`,
    amount: plan.quote?.inputAmount || plan.request?.amount || null,
    srcChain: plan.srcChain,
    dstChain: plan.dstChain,
    srcAsset: {
      chain: plan.srcChain,
      token: plan.srcToken,
    },
    dstAsset: {
      chain: plan.dstChain,
      token: plan.dstToken,
    },
    inputUsd: finiteNumber(plan.amountUsd),
    outputUsd: null,
    netEdgeUsd: null,
    executionGasUsd: null,
    nativeCostUsd: null,
  };
}

function routeContextForLifiExecution(execution) {
  const plan = execution?.plan;
  if (!plan?.srcChain || !plan?.srcToken || !plan?.dstChain || !plan?.dstToken) {
    return null;
  }
  return {
    routeKey: `${plan.srcChain}:${plan.srcToken}->${plan.dstChain}:${plan.dstToken}`,
    amount: plan.amount || null,
    srcChain: plan.srcChain,
    dstChain: plan.dstChain,
    srcAsset: {
      chain: plan.srcChain,
      token: plan.srcToken,
    },
    dstAsset: {
      chain: plan.dstChain,
      token: plan.dstToken,
    },
    inputUsd: finiteNumber(plan.amountUsd),
    outputUsd: null,
    netEdgeUsd: null,
    executionGasUsd: null,
    nativeCostUsd: null,
  };
}

function routeContextForGasZipExecution(execution) {
  const plan = execution?.plan;
  if (!plan?.srcChain || !plan?.dstChain) return null;
  return {
    routeKey: `${plan.srcChain}:native->${plan.dstChain}:native`,
    amount: plan.amountWei || null,
    srcChain: plan.srcChain,
    dstChain: plan.dstChain,
    srcAsset: {
      chain: plan.srcChain,
      token: ZERO_TOKEN,
    },
    dstAsset: {
      chain: plan.dstChain,
      token: ZERO_TOKEN,
    },
    inputUsd: finiteNumber(plan?.amountUsd),
    outputUsd: finiteNumber(plan?.quote?.outputValueUsd),
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

function routeContextForErc4626Canary(execution) {
  const plan = execution?.plan;
  if (!plan?.chain || !plan?.assetAddress || !plan?.shareTokenAddress) return null;
  return {
    routeKey: `${plan.chain}:${plan.assetAddress}->${plan.chain}:${plan.shareTokenAddress}->${plan.chain}:${plan.assetAddress}`,
    amount: plan.amount,
    srcChain: plan.chain,
    dstChain: plan.chain,
    srcAsset: {
      chain: plan.chain,
      token: plan.assetAddress,
    },
    dstAsset: {
      chain: plan.chain,
      token: plan.assetAddress,
    },
    inputUsd: finiteNumber(plan.amountUsd),
    outputUsd: finiteNumber(plan.amountUsd),
    netEdgeUsd: null,
    executionGasUsd: null,
    nativeCostUsd: null,
  };
}

function outputForErc4626Canary(execution) {
  return {
    actualOutputUnits: execution?.redeemProof?.observedDelta || null,
    chain: execution?.plan?.chain || null,
    token: execution?.plan?.assetAddress || null,
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

function outputForAcrossExecution(execution) {
  const plan = execution?.plan;
  return {
    actualOutputUnits: execution?.destinationProof?.observedDelta || null,
    chain: plan?.dstChain || null,
    token: plan?.dstToken || null,
    priceUsd: null,
  };
}

function outputForLifiExecution(execution) {
  const plan = execution?.plan;
  return {
    actualOutputUnits: execution?.destinationProof?.observedDelta || null,
    chain: plan?.dstChain || null,
    token: plan?.dstToken || null,
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
  if (strategyId === "token-dex-experiment" || strategyId === "native-gas-refill") {
    return {
      kind: "token_dex_experiment",
      routeContext: routeContextForDexExecution(execution),
      output: outputForDexExecution(execution),
    };
  }
  if (strategyId === "gateway_native_asset_conversion_sleeve") {
    return {
      kind: "erc4626_protocol_canary",
      routeContext: routeContextForErc4626Canary(execution),
      output: outputForErc4626Canary(execution),
    };
  }
  if (strategyId === "gateway-btc-funding-transfer") {
    return {
      kind: "gateway_btc_consolidation",
      routeContext: routeContextForGatewayExecution(execution),
      output: outputForGatewayConsolidation(execution),
    };
  }
  if (strategyId === "across-bridge") {
    return {
      kind: "across_bridge",
      routeContext: routeContextForAcrossExecution(execution),
      output: outputForAcrossExecution(execution),
    };
  }
  if (strategyId === "lifi-bridge") {
    return {
      kind: "lifi_bridge",
      routeContext: routeContextForLifiExecution(execution),
      output: outputForLifiExecution(execution),
    };
  }
  if (strategyId === "gateway-btc-offramp") {
    return {
      kind: "gateway_btc_offramp",
      routeContext: routeContextForGatewayExecution(execution),
      output: outputForGatewayOfframp(execution),
    };
  }
  if (strategyId === "gas-zip-native-refuel") {
    return {
      kind: "gas_zip_native_refuel",
      routeContext: routeContextForGasZipExecution(execution),
      output: {
        actualOutputUnits: execution?.destinationProof?.observedDelta || null,
        chain: execution?.plan?.dstChain || null,
        token: ZERO_TOKEN,
        priceUsd: null,
      },
    };
  }
  // YCE-002: DefiLlama yield portfolio support (deposit/withdraw/reward). Reuses dex helpers for route/output MVP;
  // yieldContext carries pool metadata for pairDefiLlamaYieldEntryExit + adapter.
  if (strategyId === "defillama-yield-portfolio") {
    const plan = execution?.plan || {};
    const action = String(plan.action || plan.type || plan.intent || "deposit").toLowerCase();
    const kind =
      action.includes("withdraw") || action.includes("redeem") || action.includes("exit")
        ? "defillama_yield_withdraw"
        : action.includes("claim") || action.includes("reward")
          ? "defillama_yield_reward_claim"
          : "defillama_yield_deposit";
    const poolId = plan.poolId || plan.target?.poolId || plan.metadata?.poolId || "defillama-unknown";
    const protocol = plan.protocol || plan.target?.protocol || plan.family || "defillama";
    return {
      kind,
      routeContext: (typeof routeContextForDexExecution === "function"
        ? routeContextForDexExecution(execution)
        : null) || {
        routeKey: `${plan.srcChain || plan.chain}:${plan.srcAsset || "unknown"}->${plan.dstChain || plan.chain}:${plan.dstAsset || "share"}`,
        amount: plan.amount || "0",
        srcChain: plan.srcChain || plan.chain || null,
        dstChain: plan.dstChain || plan.chain || null,
        inputUsd: plan.inputUsd || null,
        outputUsd: plan.outputUsd || null,
        poolId,
        protocol,
      },
      output: (typeof outputForDexExecution === "function" ? outputForDexExecution(execution) : null) || {
        actualOutputUnits: execution?.destinationProof?.observedDelta || plan.actualOutputUnits || null,
        chain: plan.dstChain || plan.chain || null,
        token: plan.dstAsset?.token || ZERO_TOKEN,
        priceUsd: plan.priceUsd || null,
      },
      yieldContext: {
        poolId,
        protocol,
        chain: plan.dstChain || plan.chain || null,
        entrySharePrice: plan.entrySharePrice || null,
        // Capture decision-time values from plan (populated by adapter/catalog tick using snapshot at allocation)
        // Snapshot fallback enrichment happens later in append for cases where plan omits them.
        apy: Number.isFinite(plan.apy) ? plan.apy : Number.isFinite(plan.apyBps) ? plan.apyBps / 10000 : null,
        tvlUsd: Number.isFinite(plan.tvlUsd) ? plan.tvlUsd : null,
        newPool: typeof plan.newPool === "boolean" ? plan.newPool : null,
      },
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

  // Schema enhancement: if this is a DefiLlama yield execution, enrich yieldContext from snapshot (if available)
  // so that entry/exit apy, tvlUsd, newPool flag are captured at (near) execution time for richer yieldProof.
  // Plan-provided values (from tick decision snapshot) take precedence; snapshot fills gaps.
  let finalYieldContext = descriptor.yieldContext ?? null;
  if (finalYieldContext?.poolId && descriptor.kind && YIELD_KINDS.has(descriptor.kind)) {
    try {
      const snapPath = join(dataDir || "data", "snapshots", "defillama-yield-latest.json");
      const snap = await readJsonIfExists(snapPath);
      const pools = snap?.snapshot?.pools || [];
      const pool = pools.find((p) => p && p.pool === finalYieldContext.poolId);
      if (pool) {
        const snapApy = finiteNumber(pool.apy);
        const snapTvl = finiteNumber(pool.tvlUsd);
        const snapCount = finiteNumber(pool.count);
        const snapOutlier = pool.outlier === true;
        const snapNew =
          (snapTvl != null && snapTvl < 5_000_000) || (snapCount != null && snapCount < 100) || snapOutlier;
        finalYieldContext = {
          ...finalYieldContext,
          apy: finalYieldContext.apy != null ? finalYieldContext.apy : snapApy,
          tvlUsd: finalYieldContext.tvlUsd != null ? finalYieldContext.tvlUsd : snapTvl,
          newPool: finalYieldContext.newPool != null ? finalYieldContext.newPool : snapNew,
          apyMean30d:
            finalYieldContext.apyMean30d != null ? finalYieldContext.apyMean30d : finiteNumber(pool.apyMean30d),
        };
      }
    } catch {
      // snapshot enrichment is best-effort and optional; never fail ingestion on it
    }
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
    chain: execution?.plan?.chain || execution?.plan?.route?.srcChain || execution?.plan?.srcChain || null,
    txHash,
    routeContext: descriptor.routeContext,
    receipt,
    transaction: transactionForExecution(execution),
    prices,
    output: descriptor.output,
    observedAt: normalizeObservedAt(execution?.observedAt),
    yieldContext: finalYieldContext,
  });
  await store.append("receipt-reconciliations", receiptRecord);
  return {
    appended: true,
    reason: "ingested",
    receiptRecord,
  };
}

export async function backfillPendingSignerConfirmations({
  auditRecords = null,
  existingReceiptRecords = null,
  rootDir = process.cwd(),
  dataDir = config.dataDir,
  store = new JsonlStore(dataDir),
  priceReader = getCoinGeckoPricesUsd,
  readTransactionReceiptImpl = readTransactionReceipt,
  readTransactionByHashImpl = readTransactionByHash,
  appendSignerAuditRecordImpl = appendSignerAuditRecord,
  readSignerAuditLogImpl = readSignerAuditLog,
  now = new Date().toISOString(),
} = {}) {
  const records = Array.isArray(auditRecords) ? auditRecords : await readSignerAuditLogImpl({ rootDir });
  const receipts = Array.isArray(existingReceiptRecords)
    ? existingReceiptRecords
    : await readJsonl(dataDir, "receipt-reconciliations").catch(() => []);
  const existingReceiptTxHashes = new Set(receipts.map((record) => lowercase(record?.txHash)).filter(Boolean));
  const candidates = pendingSignerConfirmationCandidates(records);
  const prices = await priceReader().catch(() => emptyPricesUsd());
  const processed = [];
  for (const record of candidates) {
    const txHash = signerAuditTxHash(record);
    if (!txHash) continue;
    let receipt;
    try {
      receipt = await readTransactionReceiptImpl(record.chain, txHash);
    } catch {
      continue;
    }
    if (!receipt) continue;
    const receiptTxHash = receipt.hash || txHash;
    const normalizedTxHash = lowercase(receiptTxHash);
    let receiptRecord = receipts.find((entry) => lowercase(entry?.txHash) === normalizedTxHash) || null;
    let transaction = null;
    const loadTransaction = async () => {
      if (transaction !== null) return transaction;
      transaction = await readTransactionByHashImpl(record.chain, receiptTxHash).catch(() => null);
      return transaction;
    };
    if (!receiptRecord) {
      transaction = await loadTransaction();
      receiptRecord = buildReceiptReconciliation({
        kind: record?.intent?.intentType || "signer_broadcast",
        chain: record.chain,
        txHash: receiptTxHash,
        routeContext: null,
        receipt,
        transaction,
        prices,
        output: signerAuditOutput(record, receipt, transaction),
        observedAt: now,
      });
      if (!existingReceiptTxHashes.has(normalizedTxHash) && store?.append) {
        await store.append("receipt-reconciliations", receiptRecord);
      }
      existingReceiptTxHashes.add(normalizedTxHash);
      receipts.push(receiptRecord);
    } else if (receiptRecord?.reconciliationStatus === "pending_output") {
      transaction = await loadTransaction();
      const inferredOutput = signerAuditOutput(record, receipt, transaction);
      if (inferredOutput?.actualOutputUnits !== undefined && inferredOutput?.actualOutputUnits !== null) {
        receiptRecord = buildReceiptReconciliation({
          kind: receiptRecord?.kind || record?.intent?.intentType || "signer_broadcast",
          chain: record.chain,
          txHash: receiptTxHash,
          routeContext: receiptRecord?.routeContext || null,
          receipt,
          transaction,
          prices,
          output: inferredOutput,
          observedAt: now,
        });
      }
    }
    if (store?.append) {
      await store.append(
        "capital-audit-pairs",
        buildCapitalAuditClosureRecord({
          auditRecord: record,
          receiptRecord,
          observedAt: now,
        }),
      );
    }
    const status = Number(receipt.status ?? 0);
    const finalStage = status === 0 ? "reverted" : "confirmed";
    if (auditRecords === null) {
      const currentAuditRecords = await readSignerAuditLogImpl({ rootDir }).catch(() => []);
      const alreadyFinalized = currentAuditRecords.some((entry) => {
        const entryTxHash = lowercase(signerAuditTxHash(entry));
        return (
          entry?.intentHash === record.intentHash &&
          entryTxHash === normalizedTxHash &&
          signerAuditStage(entry) === finalStage
        );
      });
      if (alreadyFinalized) {
        continue;
      }
    }
    const finalRecord = {
      ...record,
      timestamp: now,
      policyVerdict: status === 0 ? "errored" : "approved",
      lifecycle: {
        stage: finalStage,
        txHash: receiptTxHash,
      },
      broadcast: record.broadcast || { txHash: receiptTxHash },
      realized: {
        ...receiptRealizedSummary(receipt),
        actualKnownCostUsd: receiptRecord?.realized?.actualKnownCostUsd ?? null,
      },
      error:
        status === 0
          ? {
              name: "EvmReceiptReverted",
              message: "Transaction reverted after broadcast",
            }
          : null,
    };
    if (appendSignerAuditRecordImpl) {
      await appendSignerAuditRecordImpl(finalRecord, { rootDir });
    }
    processed.push({
      strategyId: record.strategyId,
      chain: record.chain,
      intentHash: record.intentHash,
      txHash: receiptTxHash,
      stage: finalRecord.lifecycle.stage,
      receiptReconciled: receiptRecord?.reconciliationStatus || null,
      auditAppended: Boolean(appendSignerAuditRecordImpl),
      receiptAppended: Boolean(store?.append),
    });
  }
  return {
    schemaVersion: 1,
    observedAt: now,
    candidateCount: candidates.length,
    processedCount: processed.length,
    processed,
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
    "gateway-btc-onramp-executions",
  ];
  const store = new JsonlStore(dataDir);
  const results = [];
  for (const name of sources) {
    const records = await readJsonl(dataDir, name);
    for (const execution of records) {
      results.push(
        await appendExecutionReceiptReconciliation({
          execution,
          dataDir,
          store,
          priceReader,
        }),
      );
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

async function findProtocolPositionProof(txHash, dataDir) {
  if (!txHash) return null;
  const normalizedTxHash = String(txHash).toLowerCase();
  const records = await readJsonl(dataDir, "merkl-portfolio-positions").catch(() => []);
  const matched = [...records]
    .reverse()
    .find(
      (r) =>
        (r.txHash && String(r.txHash).toLowerCase() === normalizedTxHash) ||
        (r.entryTxHash && String(r.entryTxHash).toLowerCase() === normalizedTxHash),
    );
  if (!matched) return null;
  const proof = matched.redeemProof || matched.shareProof || matched.positionProof || null;
  if (proof && proof.status === "delivered") return proof;
  if (matched.shareDelta || matched.event === "position_opened")
    return { status: "delivered", observedDelta: matched.shareDelta || "1", proofSource: "position_opened_record" };
  return null;
}

async function findWrappedBtcLoopProof(txHash, dataDir) {
  if (!txHash) return null;
  const normalizedTxHash = String(txHash).toLowerCase();
  const proofFile = join(dataDir, "wrapped-btc-loop-live-success-latest.json");
  const liveProof = await readJsonIfExists(proofFile);
  if (!liveProof || !liveProof.success) return null;
  const entryHashes = Array.isArray(liveProof.entryTxHashes) ? liveProof.entryTxHashes : [];
  const unwindHashes = Array.isArray(liveProof.unwindTxHashes) ? liveProof.unwindTxHashes : [];
  const allHashes = [...entryHashes, ...unwindHashes].map((h) => String(h).toLowerCase());
  if (!allHashes.includes(normalizedTxHash)) return null;
  return {
    status: "delivered",
    observedDelta: "1",
    proofSource: "wrapped_btc_loop_live_proof",
  };
}

function initAsyncSettlementHandlers() {
  if (hasAsyncSettlementHandler("merkl_portfolio")) return;
  registerAsyncSettlementHandler("merkl_portfolio", {
    gracePeriodMs: 300_000,
    destinationProofReader: findProtocolPositionProof,
  });
  registerAsyncSettlementHandler("wrapped_btc_loop", {
    gracePeriodMs: 600_000,
    destinationProofReader: findWrappedBtcLoopProof,
  });
}

async function findSettlementProof(pair, dataDir) {
  initAsyncSettlementHandlers();
  const handler = resolveAsyncSettlementHandler(pair.strategyId || "");
  if (handler) {
    const proof = await handler.destinationProofReader(pair.txHash, dataDir);
    if (proof) return proof;
  }
  const fallback = await findProtocolPositionProof(pair.txHash, dataDir);
  return fallback || null;
}

export async function runAsyncSettlementWatcher({
  dataDir = config.dataDir,
  store = new JsonlStore(dataDir),
  priceReader = getCoinGeckoPricesUsd,
  enabled = config.asyncSettlementEnabled,
} = {}) {
  if (!enabled) {
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      pendingCount: 0,
      processedCount: 0,
      processed: [],
      skippedReason: "async_settlement_disabled",
    };
  }
  const effectiveStore = store || null;
  const pendingPairs = (await readJsonl(dataDir, "capital-audit-pairs").catch(() => []))
    .filter((r) => r.status === "pending" || r.status === "pending_with_grace")
    .filter((r) => r.txHash && r.intentHash);
  const processed = [];
  for (const pair of pendingPairs) {
    const proof = await findSettlementProof(pair, dataDir);
    if (!proof) continue;
    const receiptRecord = buildReceiptReconciliation({
      kind: "erc4626_protocol_canary",
      chain: pair.chain || "unknown",
      txHash: pair.txHash,
      routeContext: null,
      receipt: { status: 1, gasUsed: "0", effectiveGasPrice: "0" },
      transaction: null,
      output: { actualOutputUnits: proof.observedDelta, chain: pair.chain, token: null, priceUsd: null },
      prices: await priceReader().catch(() => emptyPricesUsd()),
      observedAt: new Date().toISOString(),
    });
    if (effectiveStore?.append) {
      await effectiveStore.append("receipt-reconciliations", receiptRecord);
    }
    const closureRecord = {
      schemaVersion: 1,
      status: "closed",
      stage: "post_reconciliation",
      source: "async_settlement_watcher",
      observedAt: new Date().toISOString(),
      strategyId: pair.strategyId,
      chain: pair.chain,
      intentHash: pair.intentHash,
      txHash: pair.txHash,
      reconciliationStatus: "reconciled",
      validation: { ok: true, method: "async_settlement_watcher" },
    };
    if (effectiveStore?.append) {
      await effectiveStore.append("capital-audit-pairs", closureRecord);
    }
    processed.push({ txHash: pair.txHash, strategyId: pair.strategyId, proofSource: proof.proofSource });
  }
  const signerConfirmationBackfill = await backfillPendingSignerConfirmations({
    dataDir,
    store: effectiveStore,
    priceReader,
    appendSignerAuditRecordImpl: effectiveStore?.append ? appendSignerAuditRecord : null,
  });
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    pendingCount: pendingPairs.length,
    processedCount: processed.length,
    processed,
    signerConfirmationCandidateCount: signerConfirmationBackfill.candidateCount,
    signerConfirmationProcessedCount: signerConfirmationBackfill.processedCount,
    signerConfirmations: signerConfirmationBackfill.processed,
  };
}

export async function loadPaybackAuditLog({
  logsDir = join(process.cwd(), "logs"),
  fileName = "signer-audit.jsonl",
} = {}) {
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
    latestTreasuryInventory,
    marketPriceSnapshots,
    wrappedBtcLoopReceipts,
    wrappedBtcLoopLiveProof,
  ] = await Promise.all([
    readJsonl(dataDir, "receipt-reconciliations"),
    readLatestJsonlRecord(dataDir, "treasury-inventory"),
    readJsonl(dataDir, "market-price-snapshots"),
    readJsonl(dataDir, "wrapped-btc-loop-dry-runs"),
    readJsonIfExists(join(dataDir, "wrapped-btc-loop-live-success-latest.json")),
  ]);

  const signerBackedLoopReceipts = wrappedBtcLoopReceipts.filter(
    (item) => item?.executionMode && item.executionMode !== "simulated_dry_run",
  );
  return {
    receiptReconciliations,
    treasuryInventory: latestTreasuryInventory ? [latestTreasuryInventory] : [],
    marketPriceSnapshots,
    wrappedBtcLoopReceipts: signerBackedLoopReceipts,
    wrappedBtcLoopLiveProofs: wrappedBtcLoopLiveProof ? [wrappedBtcLoopLiveProof] : [],
  };
}
