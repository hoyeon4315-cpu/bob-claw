import { tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { MempoolClient } from "../bitcoin/fees.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import {
  emptyPricesUsd,
  getCoinGeckoPricesUsd,
  latestPriceSnapshot,
  overlayObservedPricesUsd,
  priceForAssetUsd,
  pricesFromSnapshot,
} from "../market/prices.mjs";
import { readTransactionByHash, readTransactionReceipt } from "../evm/transaction-read.mjs";

function bigint(value, fallback = 0n) {
  try {
    if (value === undefined || value === null || value === "") return fallback;
    return BigInt(value);
  } catch {
    return fallback;
  }
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function decimalFromBigInt(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0) return null;
  return unitsToDecimal(value, decimals);
}

function nativeAsset(chain) {
  return tokenAsset(chain, "0x0000000000000000000000000000000000000000");
}

function gasUsdForReceipt(chain, receipt, prices) {
  if (!receipt) return null;
  const priceUsd = priceForAssetUsd(nativeAsset(chain), prices);
  if (!Number.isFinite(priceUsd)) return null;
  return (Number(bigint(receipt.gasUsed) * bigint(receipt.effectiveGasPrice)) / 1e18) * priceUsd;
}

function txValueUsdForTransaction(chain, transaction, prices) {
  if (!transaction) return null;
  const priceUsd = priceForAssetUsd(nativeAsset(chain), prices);
  if (!Number.isFinite(priceUsd)) return null;
  return (Number(bigint(transaction.value)) / 1e18) * priceUsd;
}

function normalizeAddress(value) {
  return value ? String(value).toLowerCase() : null;
}

function uniqueSorted(values = []) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)));
}

const HELPER_TRACE_TIMESTAMP_WINDOW_MS = 120_000;
const HELPER_TRACE_AMOUNT_TOLERANCE_USD = 0.01;
const LEGACY_AUDIT_TRACE_EVIDENCE_TYPE_BY_INTENT = Object.freeze({
  funding_transfer: "gateway_btc_transfer_audit_trace",
  gateway_btc_transfer: "gateway_btc_transfer_audit_trace",
});

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function latestBroadcastSignerRecords(records = []) {
  const latest = new Map();
  for (const record of records) {
    const txHash = record?.broadcast?.txHash;
    if (record?.lifecycle?.stage !== "broadcasted" || !txHash) continue;
    const current = latest.get(txHash);
    if (!current || new Date(record.timestamp || 0) > new Date(current.timestamp || 0)) {
      latest.set(txHash, record);
    }
  }
  return [...latest.values()].sort((left, right) => new Date(left.timestamp || 0) - new Date(right.timestamp || 0));
}

function flattenTreasuryBalances(snapshot = null) {
  if (!snapshot) return [];
  const native = (snapshot.native || []).map((entry) => ({
    key: `native:${entry.chain}:${entry.asset}`,
    chain: entry.chain,
    asset: entry.asset,
    kind: "native",
    startOrEnd: entry.actualDecimal ?? null,
  }));
  const tokens = (snapshot.tokens || []).map((entry) => ({
    key: `token:${entry.chain}:${entry.ticker}`,
    chain: entry.chain,
    asset: entry.ticker,
    kind: "token",
    startOrEnd: entry.actualDecimal ?? null,
  }));
  return [...native, ...tokens];
}

export function buildCapitalAuditScope({
  signerAuditRecords = [],
  treasurySnapshots = [],
  gatewayBtcOfframpExecutions = [],
} = {}) {
  const broadcasts = latestBroadcastSignerRecords(signerAuditRecords);
  const evmAddresses = uniqueSorted([
    ...broadcasts.flatMap((record) => [record?.broadcast?.from, record?.broadcast?.to]),
    ...treasurySnapshots.map((snapshot) => snapshot?.address),
    ...gatewayBtcOfframpExecutions.flatMap((execution) => [execution?.plan?.senderAddress]),
  ]);
  const bitcoinAddresses = uniqueSorted(
    gatewayBtcOfframpExecutions.map((execution) => execution?.plan?.recipient),
  );
  return {
    evmAddresses,
    bitcoinAddresses,
  };
}

function buildConsolidationMap(executions = []) {
  const byTxHash = new Map();
  for (const execution of executions) {
    const txHash = execution?.signerResult?.broadcast?.txHash;
    if (txHash) byTxHash.set(txHash, execution);
  }
  return byTxHash;
}

function buildOfframpMap(executions = []) {
  const byTxHash = new Map();
  for (const execution of executions) {
    const txHash = execution?.signerResult?.broadcast?.txHash;
    if (txHash) byTxHash.set(txHash, execution);
  }
  return byTxHash;
}

function buildNativeDexMap(executions = []) {
  const byTxHash = new Map();
  for (const execution of executions) {
    for (const stepResult of execution?.stepResults || []) {
      const txHash = stepResult?.signerResult?.broadcast?.txHash;
      if (!txHash) continue;
      byTxHash.set(txHash, {
        execution,
        stepId: stepResult.id,
        signerResult: stepResult.signerResult,
      });
    }
  }
  return byTxHash;
}

function helperTraceFallbackBucketKey({ strategyId, chain, from, to }) {
  return [
    String(strategyId || "").trim().toLowerCase(),
    String(chain || "").trim().toLowerCase(),
    normalizeAddress(from),
    normalizeAddress(to),
  ].join(":");
}

function appendIndexEntry(index, key, value) {
  if (!key) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function normalizedText(value) {
  return value === undefined || value === null || value === "" ? null : String(value).trim().toLowerCase();
}

function optionalFieldMatches(left, right, normalizer = normalizedText) {
  const normalizedLeft = normalizer(left);
  const normalizedRight = normalizer(right);
  if (normalizedLeft === null || normalizedRight === null) return true;
  return normalizedLeft === normalizedRight;
}

function helperTraceTimestampMatches(record, candidate) {
  const candidateObservedAt = timestampMs(candidate?.observedAt);
  const recordObservedAt = timestampMs(record?.timestamp);
  if (!Number.isFinite(candidateObservedAt) || !Number.isFinite(recordObservedAt)) return false;
  return Math.abs(candidateObservedAt - recordObservedAt) <= HELPER_TRACE_TIMESTAMP_WINDOW_MS;
}

function helperTraceRecordContextMatches(record, candidate) {
  return (
    optionalFieldMatches(record?.strategyId, candidate?.strategyId) &&
    optionalFieldMatches(record?.chain, candidate?.chain) &&
    optionalFieldMatches(record?.intentHash, candidate?.intentHash) &&
    optionalFieldMatches(record?.broadcast?.from, candidate?.from, normalizeAddress) &&
    optionalFieldMatches(record?.broadcast?.to, candidate?.to, normalizeAddress)
  );
}

function buildAuditHelperTraceIndex(records = []) {
  const groups = new Map();
  for (const record of records) {
    const stage = record?.lifecycle?.stage || null;
    if (!stage) continue;
    const groupKey =
      record.intentHash ||
      record.intentId ||
      `${record.strategyId || "unknown"}:${record.chain || "unknown"}:${record.timestamp || "unknown"}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(record);
  }

  const byTxHash = new Map();
  const byIntentHash = new Map();
  const byFallbackBucket = new Map();
  for (const group of groups.values()) {
    const broadcastRecord =
      group
        .filter((record) => record?.lifecycle?.stage === "broadcasted")
        .sort((left, right) => timestampMs(right?.timestamp) - timestampMs(left?.timestamp))[0] || null;
    const lifecycleTrace = group.some((record) => ["signed", "confirmed"].includes(record?.lifecycle?.stage));
    if (!broadcastRecord || !lifecycleTrace) continue;
    const txHash = broadcastRecord?.broadcast?.txHash || broadcastRecord?.lifecycle?.txHash || null;
    if (!txHash) continue;
    const intentType = broadcastRecord?.intent?.intentType || null;
    const trace = {
      helperKind: intentType || "signer_audit_trace",
      matchSource: "signer_audit",
      matchRule: "tx_hash",
      txHash,
      intentHash: broadcastRecord.intentHash || null,
      intentId: broadcastRecord.intentId || null,
      strategyId: broadcastRecord.strategyId || null,
      chain: broadcastRecord.chain || null,
      from: broadcastRecord?.broadcast?.from || null,
      to: broadcastRecord?.broadcast?.to || null,
      amountUsd: broadcastRecord.amountUsd ?? null,
      observedAt: broadcastRecord.timestamp || null,
      stages: uniqueSorted(group.map((record) => record?.lifecycle?.stage || null)),
      intentType,
      evidenceType: LEGACY_AUDIT_TRACE_EVIDENCE_TYPE_BY_INTENT[intentType] || "signer_audit_trace",
    };
    appendIndexEntry(byTxHash, txHash, trace);
    appendIndexEntry(byIntentHash, trace.intentHash, trace);
    const bucketKey = helperTraceFallbackBucketKey(trace);
    appendIndexEntry(byFallbackBucket, bucketKey, trace);
  }

  for (const traces of byFallbackBucket.values()) {
    traces.sort((left, right) => timestampMs(left?.observedAt) - timestampMs(right?.observedAt));
  }

  return {
    byTxHash,
    byIntentHash,
    byFallbackBucket,
  };
}

function amountCloseEnough(left, right, tolerance = HELPER_TRACE_AMOUNT_TOLERANCE_USD) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return true;
  return Math.abs(left - right) <= tolerance;
}

function matchAuditHelperTrace(record, auditHelperTraceIndex) {
  const txHash = record?.broadcast?.txHash;
  // False-positive guard: do not relax signer-audit helper matching to a single key.
  // Wrapped-BTC loops emit clustered approvals/swaps with near-identical timings and amounts,
  // so every rule below must satisfy an intersection of tx/intent/context keys.
  const txHashMatches = (txHash ? auditHelperTraceIndex.byTxHash.get(txHash) : null) || [];
  const directCandidates = txHashMatches.filter((candidate) => helperTraceRecordContextMatches(record, candidate));
  if (directCandidates.length === 1) {
    return {
      ...directCandidates[0],
      matchRule: "tx_hash+strategy_chain",
    };
  }

  const intentHash = record?.intentHash || null;
  const intentHashMatches = (intentHash ? auditHelperTraceIndex.byIntentHash.get(intentHash) : null) || [];
  const intentCandidates = intentHashMatches.filter(
    (candidate) =>
      helperTraceRecordContextMatches(record, candidate) &&
      optionalFieldMatches(record?.broadcast?.txHash, candidate?.txHash),
  );
  if (intentCandidates.length === 1) {
    return {
      ...intentCandidates[0],
      matchRule: "intent_hash+strategy_chain",
    };
  }

  const bucketKey = helperTraceFallbackBucketKey({
    strategyId: record?.strategyId,
    chain: record?.chain,
    from: record?.broadcast?.from,
    to: record?.broadcast?.to,
  });
  const candidates = (auditHelperTraceIndex.byFallbackBucket.get(bucketKey) || []).filter((candidate) => {
    if (!helperTraceRecordContextMatches(record, candidate)) return false;
    if (!helperTraceTimestampMatches(record, candidate)) return false;
    return amountCloseEnough(candidate.amountUsd, record?.amountUsd ?? null);
  });

  // Timestamp-window fallback stays last-resort and only accepts a single unique candidate.
  // Relaxing this makes clustered retries on the same helper path prone to false positives.
  if (candidates.length === 1) {
    return {
      ...candidates[0],
      matchRule: "strategy_chain_address_window_amount",
    };
  }
  return null;
}

function normalizeBitcoinHistoryTx(address, tx = {}) {
  const receivedSats = (tx.vout || [])
    .filter((output) => normalizeAddress(output?.scriptpubkey_address) === normalizeAddress(address))
    .reduce((sum, output) => sum + Number(output?.value || 0), 0);
  return {
    txid: tx.txid || null,
    confirmed: Boolean(tx.status?.confirmed),
    blockTime: tx.status?.block_time || null,
    receivedSats,
    vinCount: Array.isArray(tx.vin) ? tx.vin.length : 0,
    voutCount: Array.isArray(tx.vout) ? tx.vout.length : 0,
    raw: tx,
  };
}

export function matchBitcoinSettlements({
  gatewayBtcOfframpExecutions = [],
  bitcoinHistoriesByAddress = {},
} = {}) {
  const matchesByTxHash = new Map();
  const addresses = {};

  const executionsByAddress = new Map();
  for (const execution of gatewayBtcOfframpExecutions) {
    const address = execution?.plan?.recipient;
    const txHash = execution?.signerResult?.broadcast?.txHash;
    if (!address || !txHash) continue;
    if (!executionsByAddress.has(address)) executionsByAddress.set(address, []);
    executionsByAddress.get(address).push(execution);
  }

  for (const [address, executions] of executionsByAddress.entries()) {
    const normalizedHistory = (bitcoinHistoriesByAddress[address]?.transactions || [])
      .map((tx) => normalizeBitcoinHistoryTx(address, tx))
      .filter((tx) => tx.txid)
      .sort((left, right) => {
        const timeDiff = Number(left.blockTime || 0) - Number(right.blockTime || 0);
        return timeDiff || String(left.txid).localeCompare(String(right.txid));
      });
    const unused = [...normalizedHistory];
    const sortedExecutions = [...executions].sort(
      (left, right) => new Date(left?.observedAt || 0) - new Date(right?.observedAt || 0),
    );

    for (const execution of sortedExecutions) {
      const txHash = execution?.signerResult?.broadcast?.txHash;
      const observedDelta = Number(execution?.destinationProof?.observedDelta || execution?.plan?.quote?.outputAmount?.amount || 0);
      const candidates = unused.filter((entry) => entry.receivedSats === observedDelta);
      const matched = candidates[0] || null;
      if (matched) {
        const index = unused.findIndex((entry) => entry.txid === matched.txid);
        if (index >= 0) unused.splice(index, 1);
      }
      matchesByTxHash.set(txHash, matched
        ? {
            txid: matched.txid,
            address,
            receivedSats: matched.receivedSats,
            confirmed: matched.confirmed,
            blockTime: matched.blockTime,
            matchType: candidates.length > 1 ? "amount_sequence" : "amount_unique",
          }
        : null);
    }

    addresses[address] = {
      txCount: normalizedHistory.length,
      unmatchedTxs: unused.map((entry) => ({
        txid: entry.txid,
        receivedSats: entry.receivedSats,
        confirmed: entry.confirmed,
        blockTime: entry.blockTime,
      })),
      normalizedHistory,
      balance: bitcoinHistoriesByAddress[address]?.balance || null,
      source: bitcoinHistoriesByAddress[address]?.source || null,
    };
  }

  return {
    matchesByTxHash,
    addresses,
  };
}

function buildInventorySummary(treasurySnapshots = []) {
  if (!treasurySnapshots.length) {
    return {
      snapshotCount: 0,
      start: null,
      end: null,
      deltas: [],
    };
  }
  const sorted = [...treasurySnapshots].sort(
    (left, right) => new Date(left?.observedAt || 0) - new Date(right?.observedAt || 0),
  );
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  const startBalances = new Map(flattenTreasuryBalances(start).map((entry) => [entry.key, entry]));
  const endBalances = new Map(flattenTreasuryBalances(end).map((entry) => [entry.key, entry]));
  const keys = uniqueSorted([...startBalances.keys(), ...endBalances.keys()]);
  const deltas = keys.map((key) => {
    const left = startBalances.get(key);
    const right = endBalances.get(key);
    const startValue = left?.startOrEnd ?? 0;
    const endValue = right?.startOrEnd ?? 0;
    return {
      key,
      chain: right?.chain || left?.chain || null,
      asset: right?.asset || left?.asset || null,
      kind: right?.kind || left?.kind || null,
      start: startValue,
      end: endValue,
      delta: Number.isFinite(startValue) && Number.isFinite(endValue) ? endValue - startValue : null,
    };
  });
  return {
    snapshotCount: sorted.length,
    start: {
      observedAt: start.observedAt,
      address: start.address,
      estimatedWalletUsd: start.summary?.estimatedWalletUsd ?? null,
    },
    end: {
      observedAt: end.observedAt,
      address: end.address,
      estimatedWalletUsd: end.summary?.estimatedWalletUsd ?? null,
    },
    deltas,
  };
}

function routeResidualUnits(inputUnits, outputUnits, feeUnits) {
  if (![inputUnits, outputUnits, feeUnits].every((value) => typeof value === "bigint")) return null;
  return inputUnits - outputUnits - feeUnits;
}

function buildOfframpExecutionSummaries({ executions = [], receiptsByTxHash = {}, transactionsByTxHash = {}, bitcoinMatchesByTxHash, prices }) {
  return executions
    .filter((execution) => execution?.signerResult?.broadcast?.txHash)
    .sort((left, right) => new Date(left?.observedAt || 0) - new Date(right?.observedAt || 0))
    .map((execution) => {
      const txHash = execution.signerResult.broadcast.txHash;
      const plan = execution.plan || {};
      const receipt = receiptsByTxHash[txHash] || null;
      const transaction = transactionsByTxHash[txHash] || null;
      const inputSats = bigint(plan.amount);
      const expectedSats = bigint(plan.quote?.outputAmount?.amount);
      const observedSats = bigint(execution.destinationProof?.observedDelta);
      const quotedFeeSats = bigint(plan.quote?.fees?.amount);
      const residualSats = routeResidualUnits(inputSats, expectedSats, quotedFeeSats);
      const matchedBitcoinTx = bitcoinMatchesByTxHash.get(txHash) || null;
      const btcUsd = prices?.btc ?? null;
      return {
        txHash,
        observedAt: execution.observedAt,
        srcChain: plan.route?.srcChain || null,
        recipient: plan.recipient || null,
        settlementStatus: execution.settlementStatus || null,
        sourceAmountSats: inputSats.toString(),
        expectedBitcoinSats: expectedSats.toString(),
        observedBitcoinSats: observedSats.toString(),
        quotedFeeSats: quotedFeeSats.toString(),
        quotedResidualSats: residualSats.toString(),
        quotedFeeUsd: Number.isFinite(btcUsd) ? Number(quotedFeeSats) / 1e8 * btcUsd : null,
        quotedResidualUsd: Number.isFinite(btcUsd) ? Number(residualSats) / 1e8 * btcUsd : null,
        outputDriftSats: (observedSats - expectedSats).toString(),
        gasUsd: gasUsdForReceipt(plan.route?.srcChain, receipt, prices),
        txValueUsd: txValueUsdForTransaction(plan.route?.srcChain, transaction, prices),
        matchedBitcoinTx,
      };
    });
}

function buildConsolidationExecutionSummaries({ executions = [], receiptsByTxHash = {}, transactionsByTxHash = {}, prices }) {
  return executions
    .filter((execution) => execution?.signerResult?.broadcast?.txHash)
    .sort((left, right) => new Date(left?.observedAt || 0) - new Date(right?.observedAt || 0))
    .map((execution) => {
      const txHash = execution.signerResult.broadcast.txHash;
      const plan = execution.plan || {};
      const receipt = receiptsByTxHash[txHash] || null;
      const transaction = transactionsByTxHash[txHash] || null;
      const inputUnits = bigint(plan.amount);
      const expectedUnits = bigint(plan.quote?.outputAmount?.amount);
      const observedUnits = bigint(execution.destinationProof?.observedDelta);
      const quotedFeeUnits = bigint(plan.quote?.fees?.amount);
      return {
        txHash,
        observedAt: execution.observedAt,
        routeKey: plan.routeKey || null,
        srcChain: plan.route?.srcChain || null,
        dstChain: plan.route?.dstChain || null,
        assetTicker: plan.srcAsset?.ticker || null,
        settlementStatus: execution.settlementStatus || null,
        sourceAmountUnits: inputUnits.toString(),
        expectedOutputUnits: expectedUnits.toString(),
        observedOutputUnits: observedUnits.toString(),
        quotedFeeUnits: quotedFeeUnits.toString(),
        quotedResidualUnits: routeResidualUnits(inputUnits, expectedUnits, quotedFeeUnits).toString(),
        outputDriftUnits: (observedUnits - expectedUnits).toString(),
        gasUsd: gasUsdForReceipt(plan.route?.srcChain, receipt, prices),
        txValueUsd: txValueUsdForTransaction(plan.route?.srcChain, transaction, prices),
      };
    });
}

function buildNativeDexExecutionSummaries({ executions = [], receiptsByTxHash = {}, prices }) {
  return executions
    .filter((execution) => Array.isArray(execution?.stepResults) && execution.stepResults.length > 0)
    .sort((left, right) => new Date(left?.observedAt || 0) - new Date(right?.observedAt || 0))
    .map((execution) => {
      const plan = execution.plan || {};
      const outputAsset = plan.outputAsset || null;
      const quotedOutputUnits = bigint(plan.quote?.outputAmount);
      const observedOutputUnits = bigint(execution.destinationProof?.observedDelta);
      const minimumOutputUnits = bigint(plan.minimumOutputAmount);
      const quotedOutputDecimal = outputAsset?.decimals != null ? decimalFromBigInt(quotedOutputUnits, outputAsset.decimals) : null;
      const observedOutputDecimal = outputAsset?.decimals != null ? decimalFromBigInt(observedOutputUnits, outputAsset.decimals) : null;
      const outputUsd = priceForAssetUsd(outputAsset, prices);
      return {
        observedAt: execution.observedAt,
        chain: plan.chain || null,
        settlementStatus: execution.settlementStatus || null,
        inputNativeAmount: plan.amount || null,
        inputUsd: plan.amountUsd ?? null,
        quotedOutputUnits: quotedOutputUnits.toString(),
        minimumOutputUnits: minimumOutputUnits.toString(),
        observedOutputUnits: observedOutputUnits.toString(),
        quotedOutputDecimal,
        observedOutputDecimal,
        outputDriftUnits: (observedOutputUnits - quotedOutputUnits).toString(),
        outputDriftUsd:
          Number.isFinite(observedOutputDecimal) && Number.isFinite(quotedOutputDecimal) && Number.isFinite(outputUsd)
            ? (observedOutputDecimal - quotedOutputDecimal) * outputUsd
            : null,
        totalGasUsd: execution.stepResults
          .map((step) => gasUsdForReceipt(plan.chain, receiptsByTxHash[step?.signerResult?.broadcast?.txHash], prices))
          .filter(Number.isFinite)
          .reduce((sum, value) => sum + value, 0),
        steps: execution.stepResults.map((step) => ({
          id: step.id,
          txHash: step?.signerResult?.broadcast?.txHash || null,
          gasUsd: gasUsdForReceipt(plan.chain, receiptsByTxHash[step?.signerResult?.broadcast?.txHash], prices),
        })),
      };
    });
}

export function buildCapitalAuditReport({
  generatedAt = new Date().toISOString(),
  signerAuditRecords = [],
  treasurySnapshots = [],
  gatewayBtcOfframpExecutions = [],
  gatewayBtcConsolidationExecutions = [],
  nativeDexExperimentExecutions = [],
  transactionsByTxHash = {},
  receiptsByTxHash = {},
  bitcoinHistoriesByAddress = {},
  prices = emptyPricesUsd(),
  issues = [],
} = {}) {
  const broadcasts = latestBroadcastSignerRecords(signerAuditRecords);
  const scope = buildCapitalAuditScope({
    signerAuditRecords,
    treasurySnapshots,
    gatewayBtcOfframpExecutions,
  });
  const bitcoinMatching = matchBitcoinSettlements({
    gatewayBtcOfframpExecutions,
    bitcoinHistoriesByAddress,
  });
  const offrampsByTxHash = buildOfframpMap(gatewayBtcOfframpExecutions);
  const consolidationsByTxHash = buildConsolidationMap(gatewayBtcConsolidationExecutions);
  const nativeDexByTxHash = buildNativeDexMap(nativeDexExperimentExecutions);
  const auditHelperTraceIndex = buildAuditHelperTraceIndex(signerAuditRecords);

  const transactions = broadcasts.map((record) => {
    const txHash = record.broadcast.txHash;
    const transaction = transactionsByTxHash[txHash] || null;
    const receipt = receiptsByTxHash[txHash] || null;
    const offramp = offrampsByTxHash.get(txHash) || null;
    const consolidation = consolidationsByTxHash.get(txHash) || null;
    const nativeDex = nativeDexByTxHash.get(txHash) || null;
    const auditHelperTrace = matchAuditHelperTrace(record, auditHelperTraceIndex);
    const evidenceType = offramp
      ? "gateway_btc_offramp"
      : consolidation
        ? "gateway_btc_transfer"
        : nativeDex
          ? `native_dex_${nativeDex.stepId}`
          : auditHelperTrace
            ? auditHelperTrace.evidenceType
            : "broadcast_only";
    return {
      txHash,
      observedAt: record.timestamp,
      strategyId: record.strategyId,
      chain: record.chain,
      from: record.broadcast?.from || transaction?.from || null,
      to: record.broadcast?.to || transaction?.to || null,
      amountUsd: record.amountUsd ?? null,
      evidenceType,
      gasUsd: gasUsdForReceipt(record.chain, receipt, prices),
      txValueUsd: txValueUsdForTransaction(record.chain, transaction, prices),
      receiptStatus: receipt?.status ?? null,
      helperMatched: Boolean(offramp || consolidation || nativeDex || auditHelperTrace),
      helperMatchSource: offramp || consolidation || nativeDex ? "execution_jsonl" : auditHelperTrace?.matchSource || null,
      helperMatchRule: offramp || consolidation || nativeDex ? "tx_hash" : auditHelperTrace?.matchRule || null,
    };
  });

  const inventory = buildInventorySummary(treasurySnapshots);
  const offrampSummaries = buildOfframpExecutionSummaries({
    executions: gatewayBtcOfframpExecutions,
    receiptsByTxHash,
    transactionsByTxHash,
    bitcoinMatchesByTxHash: bitcoinMatching.matchesByTxHash,
    prices,
  });
  const consolidationSummaries = buildConsolidationExecutionSummaries({
    executions: gatewayBtcConsolidationExecutions,
    receiptsByTxHash,
    transactionsByTxHash,
    prices,
  });
  const nativeDexSummaries = buildNativeDexExecutionSummaries({
    executions: nativeDexExperimentExecutions,
    receiptsByTxHash,
    prices,
  });

  const unmatchedBroadcasts = transactions.filter((entry) => !entry.helperMatched);
  const unmatchedBitcoinTxs = Object.entries(bitcoinMatching.addresses).flatMap(([address, entry]) =>
    entry.unmatchedTxs.map((tx) => ({ address, ...tx })),
  );
  const totalGasUsd = transactions.map((entry) => entry.gasUsd).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  const totalQuotedGatewayFeeSats = offrampSummaries
    .map((entry) => Number(entry.quotedFeeSats))
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const totalQuotedGatewayResidualSats = offrampSummaries
    .map((entry) => Number(entry.quotedResidualSats))
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const totalObservedBtcSats = offrampSummaries
    .map((entry) => Number(entry.observedBitcoinSats))
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const totalNativeDexOutputDriftUsd = nativeDexSummaries
    .map((entry) => entry.outputDriftUsd)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const currentNativeBtcSats = Object.values(bitcoinMatching.addresses)
    .map((entry) => entry.balance?.balanceSats)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const currentNativeBtcUsd = Number.isFinite(prices?.btc) ? (currentNativeBtcSats / 1e8) * prices.btc : null;
  const currentCombinedUsd =
    Number.isFinite(inventory.end?.estimatedWalletUsd) && Number.isFinite(currentNativeBtcUsd)
      ? inventory.end.estimatedWalletUsd + currentNativeBtcUsd
      : null;
  const startCombinedUsd =
    Number.isFinite(inventory.start?.estimatedWalletUsd) && Number.isFinite(currentNativeBtcUsd)
      ? inventory.start.estimatedWalletUsd + 0
      : null;

  const derivedIssues = [
    ...issues,
    ...unmatchedBroadcasts.map((entry) => ({
      code: "broadcast_missing_helper_trace",
      severity: "medium",
      txHash: entry.txHash,
      strategyId: entry.strategyId,
      chain: entry.chain,
      observedAt: entry.observedAt,
      amountUsd: entry.amountUsd,
      from: entry.from,
      to: entry.to,
    })),
    ...unmatchedBitcoinTxs.map((entry) => ({
      code: "bitcoin_tx_unmatched_to_offramp",
      severity: "high",
      address: entry.address,
      txid: entry.txid,
      receivedSats: entry.receivedSats,
      blockTime: entry.blockTime,
    })),
    ...offrampSummaries
      .filter((entry) => Number(entry.quotedResidualSats) !== 0)
      .map((entry) => ({
        code: "gateway_quote_residual_unexplained",
        severity: "low",
        txHash: entry.txHash,
        srcChain: entry.srcChain,
        recipient: entry.recipient,
        observedAt: entry.observedAt,
        residualSats: Number(entry.quotedResidualSats),
      })),
  ];

  return {
    schemaVersion: 1,
    generatedAt,
    status: unmatchedBroadcasts.length === 0 && unmatchedBitcoinTxs.length === 0 ? "complete_with_residual_checks" : "incomplete_traceability",
    walletScope: scope,
    summary: {
      broadcastCount: transactions.length,
      broadcastWithReceiptCount: transactions.filter((entry) => entry.receiptStatus !== null).length,
      helperMatchedCount: transactions.filter((entry) => entry.helperMatched).length,
      unmatchedBroadcastCount: unmatchedBroadcasts.length,
      bitcoinAddressCount: scope.bitcoinAddresses.length,
      bitcoinMatchedSettlementCount: offrampSummaries.filter((entry) => entry.matchedBitcoinTx?.txid).length,
      bitcoinUnmatchedTxCount: unmatchedBitcoinTxs.length,
      totalGasUsd,
      totalQuotedGatewayFeeSats,
      totalQuotedGatewayResidualSats,
      totalObservedBtcSats,
      totalNativeDexOutputDriftUsd,
      currentNativeBtcSats,
      currentNativeBtcUsd,
      currentCombinedUsd,
      treasurySnapshotCount: inventory.snapshotCount,
      treasuryStartUsd: inventory.start?.estimatedWalletUsd ?? null,
      treasuryEndUsd: inventory.end?.estimatedWalletUsd ?? null,
      treasuryDeltaUsd:
        Number.isFinite(inventory.start?.estimatedWalletUsd) && Number.isFinite(inventory.end?.estimatedWalletUsd)
          ? inventory.end.estimatedWalletUsd - inventory.start.estimatedWalletUsd
          : null,
      combinedDeltaUsd:
        Number.isFinite(startCombinedUsd) && Number.isFinite(currentCombinedUsd)
          ? currentCombinedUsd - startCombinedUsd
          : null,
      issueCount: derivedIssues.length,
    },
    inventory,
    bitcoinAddresses: Object.entries(bitcoinMatching.addresses).map(([address, entry]) => ({
      address,
      txCount: entry.txCount,
      currentBalanceSats: entry.balance?.balanceSats ?? null,
      confirmedBalanceSats: entry.balance?.confirmedBalanceSats ?? null,
      mempoolBalanceSats: entry.balance?.mempoolBalanceSats ?? null,
      source: entry.source,
      unmatchedTxs: entry.unmatchedTxs,
    })),
    executions: {
      gatewayBtcOfframps: offrampSummaries,
      gatewayBtcConsolidations: consolidationSummaries,
      nativeDexExperiments: nativeDexSummaries,
    },
    transactions,
    issues: derivedIssues,
  };
}

export async function collectCapitalAuditInputs({
  dataDir,
  rootDir = process.cwd(),
  priceReader = getCoinGeckoPricesUsd,
  bitcoinClient = new MempoolClient(),
  txReader = readTransactionByHash,
  receiptReader = readTransactionReceipt,
} = {}) {
  const [
    signerAuditRecords,
    treasurySnapshots,
    gatewayBtcOfframpExecutions,
    gatewayBtcConsolidationExecutions,
    nativeDexExperimentExecutions,
    marketPriceSnapshots,
    gasSnapshots,
    bitcoinFeeSnapshots,
  ] = await Promise.all([
    readSignerAuditLog({ rootDir }),
    readJsonl(dataDir, "treasury-inventory"),
    readJsonl(dataDir, "gateway-btc-offramp-executions"),
    readJsonl(dataDir, "gateway-btc-consolidation-executions"),
    readJsonl(dataDir, "native-dex-experiment-executions"),
    readJsonl(dataDir, "market-price-snapshots"),
    readJsonl(dataDir, "gas-snapshots"),
    readJsonl(dataDir, "bitcoin-fee-snapshots"),
  ]);

  const scope = buildCapitalAuditScope({
    signerAuditRecords,
    treasurySnapshots,
    gatewayBtcOfframpExecutions,
  });

  const issues = [];
  let basePrices = null;
  try {
    const latestSnapshot = latestPriceSnapshot(marketPriceSnapshots);
    basePrices = latestSnapshot ? pricesFromSnapshot(latestSnapshot) : await priceReader();
  } catch (error) {
    issues.push({
      code: "price_reader_failed",
      severity: "medium",
      message: error.message,
    });
    basePrices = emptyPricesUsd();
  }

  const prices = overlayObservedPricesUsd(basePrices, {
    gasSnapshots,
    bitcoinFeeSnapshots,
  });

  const transactionsByTxHash = {};
  const receiptsByTxHash = {};
  await Promise.all(
    latestBroadcastSignerRecords(signerAuditRecords).map(async (record) => {
      const txHash = record?.broadcast?.txHash;
      if (!txHash) return;
      try {
        transactionsByTxHash[txHash] = await txReader(record.chain, txHash);
      } catch (error) {
        issues.push({
          code: "transaction_read_failed",
          severity: "medium",
          chain: record.chain,
          txHash,
          message: error.message,
        });
      }
      try {
        receiptsByTxHash[txHash] = await receiptReader(record.chain, txHash);
      } catch (error) {
        issues.push({
          code: "receipt_read_failed",
          severity: "medium",
          chain: record.chain,
          txHash,
          message: error.message,
        });
      }
    }),
  );

  const bitcoinHistoriesByAddress = {};
  await Promise.all(
    scope.bitcoinAddresses.map(async (address) => {
      try {
        const [history, balance] = await Promise.all([
          bitcoinClient.getAddressTransactions(address),
          bitcoinClient.getAddressBalance(address),
        ]);
        bitcoinHistoriesByAddress[address] = {
          transactions: history.transactions || [],
          source: history.source,
          balance,
        };
      } catch (error) {
        issues.push({
          code: "bitcoin_history_read_failed",
          severity: "high",
          address,
          message: error.message,
        });
        bitcoinHistoriesByAddress[address] = {
          transactions: [],
          source: bitcoinClient.baseUrl,
          balance: null,
        };
      }
    }),
  );

  return {
    signerAuditRecords,
    treasurySnapshots,
    gatewayBtcOfframpExecutions,
    gatewayBtcConsolidationExecutions,
    nativeDexExperimentExecutions,
    transactionsByTxHash,
    receiptsByTxHash,
    bitcoinHistoriesByAddress,
    prices,
    issues,
  };
}
