import { tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { MempoolClient } from "../bitcoin/fees.mjs";
import { listApprovedOperatorBtcAddresses } from "../config/operator-btc-addresses.mjs";
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

function bigintOrNull(value) {
  try {
    if (value === undefined || value === null || value === "") return null;
    return BigInt(value);
  } catch {
    return null;
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

function normalizeTxHash(value) {
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

function appendMapEntry(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function terminalStageReceiptStatus(stage, realized = {}) {
  if (stage === "confirmed") return realized.status ?? 1;
  if (stage === "reverted") return realized.status ?? 0;
  return null;
}

function terminalSignerReceiptIdentity(record = {}) {
  const stage = record?.lifecycle?.stage || null;
  if (stage !== "confirmed" && stage !== "reverted") return null;
  const txHash = record?.broadcast?.txHash || record?.lifecycle?.txHash || null;
  const normalizedTxHash = normalizeTxHash(txHash);
  if (!normalizedTxHash) return null;
  const receiptHash = record?.realized?.hash || txHash;
  if (normalizeTxHash(receiptHash) !== normalizedTxHash) return null;
  return { stage, txHash };
}

function terminalSignerReceiptCosts(realized = {}) {
  if (!realized || typeof realized !== "object") return null;
  const gasUsed = bigintOrNull(realized.gasUsed);
  const effectiveGasPrice = bigintOrNull(realized.effectiveGasPrice ?? realized.gasPrice);
  if (gasUsed === null || effectiveGasPrice === null) return null;
  return { gasUsed, effectiveGasPrice };
}

function terminalSignerReceiptForRecord(record = {}) {
  const identity = terminalSignerReceiptIdentity(record);
  if (!identity) return null;
  const costs = terminalSignerReceiptCosts(record.realized);
  if (!costs) return null;
  const { stage, txHash } = identity;
  const status = terminalStageReceiptStatus(stage, record.realized);
  if (status === null || status === undefined) return null;
  return {
    hash: txHash,
    status,
    blockNumber: record.realized.blockNumber ?? null,
    gasUsed: costs.gasUsed.toString(),
    effectiveGasPrice: costs.effectiveGasPrice.toString(),
    from: record?.broadcast?.from || null,
    to: record?.broadcast?.to || null,
  };
}

function buildTerminalSignerReceiptIndex(records = []) {
  const byTxHash = new Map();
  for (const record of records) {
    const receipt = terminalSignerReceiptForRecord(record);
    if (!receipt) continue;
    appendMapEntry(byTxHash, normalizeTxHash(receipt.hash), { record, receipt });
  }
  return byTxHash;
}

function closedCapitalAuditPairMatchesBroadcast(record = {}, pair = {}) {
  const reconciliationStatus = String(pair.reconciliationStatus || "").toLowerCase();
  return (
    String(pair.status || "").toLowerCase() === "closed" &&
    String(pair.stage || "").toLowerCase() === "post_reconciliation" &&
    (reconciliationStatus === "reconciled" || reconciliationStatus === "failed") &&
    pair.validation?.ok === true &&
    normalizeTxHash(record?.broadcast?.txHash) === normalizeTxHash(pair.txHash) &&
    helperTraceRecordContextMatches(record, {
      strategyId: pair.strategyId,
      chain: pair.chain,
      intentHash: pair.intentHash,
    })
  );
}

function resultFromCapitalAuditPair(pair = null) {
  const status = String(pair?.reconciliationStatus || "").toLowerCase();
  if (status === "reconciled") return "reconciled";
  if (status === "failed") return "reverted";
  return null;
}

function buildCapitalAuditPairIndex(pairs = []) {
  const byTxHash = new Map();
  for (const pair of pairs) {
    appendMapEntry(byTxHash, normalizeTxHash(pair?.txHash), pair);
  }
  return byTxHash;
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
  const positions = (snapshot.positions || []).map((entry) => ({
    key: `position:${entry.chain}:${entry.positionId}`,
    chain: entry.chain,
    asset: entry.assetSymbol || entry.protocolId || "protocol_position",
    kind: "protocol_position",
    startOrEnd: entry.valueUsd ?? null,
  }));
  return [...native, ...tokens, ...positions];
}

export function buildCapitalAuditScope({
  signerAuditRecords = [],
  treasurySnapshots = [],
  gatewayBtcOfframpExecutions = [],
  gatewayBtcOnrampExecutions = [],
  approvedOperatorBtcAddresses = [],
} = {}) {
  const broadcasts = latestBroadcastSignerRecords(signerAuditRecords);
  const evmAddresses = uniqueSorted([
    ...broadcasts.flatMap((record) => [record?.broadcast?.from, record?.broadcast?.to]),
    ...treasurySnapshots.map((snapshot) => snapshot?.address),
    ...gatewayBtcOfframpExecutions.flatMap((execution) => [execution?.plan?.senderAddress]),
    ...gatewayBtcOnrampExecutions.flatMap((execution) => [execution?.plan?.recipient]),
  ]);
  const bitcoinAddresses = uniqueSorted([
    ...gatewayBtcOfframpExecutions.map((execution) => execution?.plan?.recipient),
    ...gatewayBtcOnrampExecutions.map((execution) => execution?.plan?.senderAddress),
    ...approvedOperatorBtcAddresses,
  ]);
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

function buildOnrampMap(executions = []) {
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
    String(strategyId || "")
      .trim()
      .toLowerCase(),
    String(chain || "")
      .trim()
      .toLowerCase(),
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

function groupSignerAuditRecordsByKey(records = []) {
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
  return groups;
}

function selectLatestBroadcastRecordFromGroup(group = []) {
  return (
    group
      .filter((record) => record?.lifecycle?.stage === "broadcasted")
      .sort((left, right) => timestampMs(right?.timestamp) - timestampMs(left?.timestamp))[0] || null
  );
}

function buildTraceIdentifiers(broadcastRecord) {
  const txHash = broadcastRecord?.broadcast?.txHash || broadcastRecord?.lifecycle?.txHash || null;
  const intentType = broadcastRecord?.intent?.intentType || null;
  return {
    txHash,
    intentHash: broadcastRecord.intentHash || null,
    intentId: broadcastRecord.intentId || null,
    strategyId: broadcastRecord.strategyId || null,
    chain: broadcastRecord.chain || null,
    intentType,
  };
}

function buildTraceAddresses(broadcastRecord) {
  return {
    from: broadcastRecord?.broadcast?.from || null,
    to: broadcastRecord?.broadcast?.to || null,
  };
}

function buildTraceAmountsAndTime(broadcastRecord) {
  return {
    amountUsd: broadcastRecord.amountUsd ?? null,
    observedAt: broadcastRecord.timestamp || null,
  };
}

function buildAuditTraceFromBroadcastGroup(group, broadcastRecord) {
  const ids = buildTraceIdentifiers(broadcastRecord);
  if (!ids.txHash) return null;
  const addrs = buildTraceAddresses(broadcastRecord);
  const meta = buildTraceAmountsAndTime(broadcastRecord);
  const intentType = ids.intentType;
  const trace = {
    helperKind: intentType || "signer_audit_trace",
    matchSource: "signer_audit",
    matchRule: "tx_hash",
    txHash: ids.txHash,
    intentHash: ids.intentHash,
    intentId: ids.intentId,
    strategyId: ids.strategyId,
    chain: ids.chain,
    from: addrs.from,
    to: addrs.to,
    amountUsd: meta.amountUsd,
    observedAt: meta.observedAt,
    stages: uniqueSorted(group.map((record) => record?.lifecycle?.stage || null)),
    intentType,
    evidenceType: LEGACY_AUDIT_TRACE_EVIDENCE_TYPE_BY_INTENT[intentType] || "signer_audit_trace",
  };
  return trace;
}

function buildAuditHelperTraceIndex(records = []) {
  const groups = groupSignerAuditRecordsByKey(records);

  const byTxHash = new Map();
  const byIntentHash = new Map();
  const byFallbackBucket = new Map();
  for (const group of groups.values()) {
    const broadcastRecord = selectLatestBroadcastRecordFromGroup(group);
    const lifecycleTrace = group.some((record) => ["signed", "confirmed"].includes(record?.lifecycle?.stage));
    if (!broadcastRecord || !lifecycleTrace) continue;
    const trace = buildAuditTraceFromBroadcastGroup(group, broadcastRecord);
    if (!trace) continue;
    const txHash = trace.txHash;
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
  const sentSats = (tx.vin || [])
    .filter((input) => normalizeAddress(input?.prevout?.scriptpubkey_address) === normalizeAddress(address))
    .reduce((sum, input) => sum + Number(input?.prevout?.value || 0), 0);
  return {
    txid: tx.txid || null,
    confirmed: Boolean(tx.status?.confirmed),
    blockTime: tx.status?.block_time || null,
    receivedSats,
    sentSats,
    vinCount: Array.isArray(tx.vin) ? tx.vin.length : 0,
    voutCount: Array.isArray(tx.vout) ? tx.vout.length : 0,
    raw: tx,
  };
}

function buildExecutionsByAddress(gatewayBtcOfframpExecutions = []) {
  const executionsByAddress = new Map();
  for (const execution of gatewayBtcOfframpExecutions) {
    const address = execution?.plan?.recipient;
    const txHash = execution?.signerResult?.broadcast?.txHash;
    if (!address || !txHash) continue;
    if (!executionsByAddress.has(address)) executionsByAddress.set(address, []);
    executionsByAddress.get(address).push(execution);
  }
  return executionsByAddress;
}

function normalizeAndSortBitcoinHistory(address, historyTxs = []) {
  return (historyTxs || [])
    .map((tx) => normalizeBitcoinHistoryTx(address, tx))
    .filter((tx) => tx.txid)
    .sort((left, right) => {
      const timeDiff = Number(left.blockTime || 0) - Number(right.blockTime || 0);
      return timeDiff || String(left.txid).localeCompare(String(right.txid));
    });
}

function findBtcMatchForExecution(execution, unused) {
  const observedDelta = Number(
    execution?.destinationProof?.observedDelta || execution?.plan?.quote?.outputAmount?.amount || 0,
  );
  const candidates = unused.filter((entry) => entry.receivedSats === observedDelta);
  const matched = candidates[0] || null;
  return { matched, candidates, observedDelta };
}

function classifyRemainingBitcoinTxs(unused = [], operatorFundingAddressSet, address) {
  const isOperatorFundingAddress = operatorFundingAddressSet.has(normalizeAddress(address));
  const operatorFundingTxs = isOperatorFundingAddress
    ? unused.filter((entry) => entry.receivedSats > 0 && Number(entry.sentSats || 0) === 0)
    : [];
  const operatorFundingTxIds = new Set(operatorFundingTxs.map((entry) => entry.txid));
  const nonSettlementTxs = unused.filter(
    (entry) => Number(entry.receivedSats || 0) <= 0 || Number(entry.sentSats || 0) > 0,
  );
  const nonSettlementTxIds = new Set(nonSettlementTxs.map((entry) => entry.txid));
  const unmatchedTxs = unused
    .filter((entry) => !operatorFundingTxIds.has(entry.txid) && !nonSettlementTxIds.has(entry.txid))
    .map((entry) => ({
      txid: entry.txid,
      receivedSats: entry.receivedSats,
      sentSats: entry.sentSats,
      confirmed: entry.confirmed,
      blockTime: entry.blockTime,
    }));
  return { operatorFundingTxs, operatorFundingTxIds, nonSettlementTxs, nonSettlementTxIds, unmatchedTxs };
}

function buildAddressBitcoinMatchEntry(
  address,
  normalizedHistory,
  unusedAfter,
  classification,
  bitcoinHistoriesByAddress = {},
) {
  const { operatorFundingTxs, nonSettlementTxs, unmatchedTxs } = classification;
  return {
    txCount: normalizedHistory.length,
    matchedOfframpTxCount: normalizedHistory.length - unusedAfter.length,
    operatorFundingTxs: operatorFundingTxs.map((entry) => ({
      txid: entry.txid,
      receivedSats: entry.receivedSats,
      sentSats: entry.sentSats,
      confirmed: entry.confirmed,
      blockTime: entry.blockTime,
    })),
    nonSettlementTxs: nonSettlementTxs.map((entry) => ({
      txid: entry.txid,
      receivedSats: entry.receivedSats,
      sentSats: entry.sentSats,
      confirmed: entry.confirmed,
      blockTime: entry.blockTime,
    })),
    unmatchedTxs,
    normalizedHistory,
    balance: bitcoinHistoriesByAddress[address]?.balance || null,
    source: bitcoinHistoriesByAddress[address]?.source || null,
  };
}

export function matchBitcoinSettlements({
  gatewayBtcOfframpExecutions = [],
  bitcoinHistoriesByAddress = {},
  operatorFundingBtcAddresses = [],
} = {}) {
  const matchesByTxHash = new Map();
  const addresses = {};
  const operatorFundingAddressSet = new Set(
    operatorFundingBtcAddresses.map((address) => normalizeAddress(address)).filter(Boolean),
  );

  const executionsByAddress = buildExecutionsByAddress(gatewayBtcOfframpExecutions);

  const auditAddresses = uniqueSorted([...executionsByAddress.keys(), ...operatorFundingBtcAddresses]);
  for (const address of auditAddresses) {
    const executions = executionsByAddress.get(address) || [];
    const normalizedHistory = normalizeAndSortBitcoinHistory(
      address,
      bitcoinHistoriesByAddress[address]?.transactions || [],
    );
    const unused = [...normalizedHistory];
    const sortedExecutions = [...executions].sort(
      (left, right) => new Date(left?.observedAt || 0) - new Date(right?.observedAt || 0),
    );

    for (const execution of sortedExecutions) {
      const txHash = execution?.signerResult?.broadcast?.txHash;
      const { matched, candidates } = findBtcMatchForExecution(execution, unused);
      if (matched) {
        const index = unused.findIndex((entry) => entry.txid === matched.txid);
        if (index >= 0) unused.splice(index, 1);
      }
      matchesByTxHash.set(
        txHash,
        matched
          ? {
              txid: matched.txid,
              address,
              receivedSats: matched.receivedSats,
              confirmed: matched.confirmed,
              blockTime: matched.blockTime,
              matchType: candidates.length > 1 ? "amount_sequence" : "amount_unique",
            }
          : null,
      );
    }

    const classification = classifyRemainingBitcoinTxs(unused, operatorFundingAddressSet, address);
    addresses[address] = buildAddressBitcoinMatchEntry(
      address,
      normalizedHistory,
      unused,
      classification,
      bitcoinHistoriesByAddress,
    );
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

function buildOfframpExecutionSummaries({
  executions = [],
  receiptsByTxHash = {},
  transactionsByTxHash = {},
  bitcoinMatchesByTxHash,
  prices,
}) {
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
        quotedFeeUsd: Number.isFinite(btcUsd) ? (Number(quotedFeeSats) / 1e8) * btcUsd : null,
        quotedResidualUsd: Number.isFinite(btcUsd) ? (Number(residualSats) / 1e8) * btcUsd : null,
        outputDriftSats: (observedSats - expectedSats).toString(),
        gasUsd: gasUsdForReceipt(plan.route?.srcChain, receipt, prices),
        txValueUsd: txValueUsdForTransaction(plan.route?.srcChain, transaction, prices),
        matchedBitcoinTx,
      };
    });
}

function buildConsolidationExecutionSummaries({
  executions = [],
  receiptsByTxHash = {},
  transactionsByTxHash = {},
  prices,
}) {
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

function buildOnrampExecutionSummaries({ executions = [], receiptsByTxHash = {}, transactionsByTxHash = {}, prices }) {
  return executions
    .filter((execution) => execution?.signerResult?.broadcast?.txHash)
    .sort((left, right) => new Date(left?.observedAt || 0) - new Date(right?.observedAt || 0))
    .map((execution) => {
      const txHash = execution.signerResult.broadcast.txHash;
      const plan = execution.plan || {};
      const receipt = receiptsByTxHash[txHash] || null;
      const transaction = transactionsByTxHash[txHash] || null;
      const inputSats = bigint(plan.amountSats);
      const expectedUnits = bigint(plan.quote?.outputAmount?.amount);
      const observedUnits = bigint(execution.destinationProof?.observedDelta);
      const quotedFeeUnits = bigint(plan.quote?.fees?.amount);
      return {
        txHash,
        observedAt: execution.observedAt,
        routeKey: plan.routeKey || null,
        srcChain: "bitcoin",
        dstChain: plan.dstChain || null,
        assetTicker: plan.dstAsset?.ticker || null,
        settlementStatus: execution.settlementStatus || null,
        sourceAmountSats: inputSats.toString(),
        expectedOutputUnits: expectedUnits.toString(),
        observedOutputUnits: observedUnits.toString(),
        quotedFeeUnits: quotedFeeUnits.toString(),
        quotedResidualSats: null,
        outputDriftUnits: (observedUnits - expectedUnits).toString(),
        gasUsd: gasUsdForReceipt(plan.dstChain, receipt, prices),
        txValueUsd: txValueUsdForTransaction(plan.dstChain, transaction, prices),
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
      const quotedOutputDecimal =
        outputAsset?.decimals != null ? decimalFromBigInt(quotedOutputUnits, outputAsset.decimals) : null;
      const observedOutputDecimal =
        outputAsset?.decimals != null ? decimalFromBigInt(observedOutputUnits, outputAsset.decimals) : null;
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

function broadcastLifecycleStage(record = {}) {
  return record.lifecycleStage || record.intent?.lifecycleStage || record.lifecycle?.stage || "unknown";
}

function broadcastCategory(record = {}, evidenceType = null) {
  return record.category || record.intent?.category || record.intent?.intentType || evidenceType || "unknown";
}

function broadcastResultFromReceipt(receipt) {
  if (!receipt) return "no_receipt";
  if (receipt.status === 0 || receipt.status === "0" || receipt.status === false) return "reverted";
  return "ok";
}

function buildBroadcastBreakdown(transactions = []) {
  const cells = new Map();
  for (const tx of transactions) {
    const key = [tx.lifecycleStage, tx.category, tx.chain || "unknown", tx.result].join("|");
    const current = cells.get(key) || {
      lifecycleStage: tx.lifecycleStage,
      category: tx.category,
      chain: tx.chain || "unknown",
      result: tx.result,
      broadcastCount: 0,
      gasUsd: 0,
    };
    current.broadcastCount += 1;
    if (Number.isFinite(tx.gasUsd)) current.gasUsd += tx.gasUsd;
    cells.set(key, current);
  }
  const rows = [...cells.values()].map((cell) => ({
    ...cell,
    gasUsd: Number(cell.gasUsd.toFixed(6)),
    gasPerBroadcastUsd: cell.broadcastCount > 0 ? Number((cell.gasUsd / cell.broadcastCount).toFixed(6)) : null,
    totalShareOfGasPct: null,
  }));
  const totalGasUsd = rows.reduce((sum, cell) => sum + cell.gasUsd, 0);
  for (const row of rows) {
    row.totalShareOfGasPct = totalGasUsd > 0 ? Number(((row.gasUsd / totalGasUsd) * 100).toFixed(6)) : 0;
  }
  rows.sort(
    (left, right) =>
      right.gasUsd - left.gasUsd ||
      right.broadcastCount - left.broadcastCount ||
      String(left.category).localeCompare(String(right.category)),
  );
  return rows;
}

function injectProtocolPositionsIntoLatestSnapshot(treasurySnapshots = [], protocolPositionMarks = []) {
  if (!treasurySnapshots.length || !protocolPositionMarks.length) return treasurySnapshots;
  const latestByPosition = new Map();
  for (const mark of protocolPositionMarks) {
    if (mark.event !== "position_marked") continue;
    const existing = latestByPosition.get(mark.positionId);
    if (!existing || new Date(mark.observedAt) > new Date(existing.observedAt)) {
      latestByPosition.set(mark.positionId, mark);
    }
  }
  const positions = [...latestByPosition.values()].map((mark) => ({
    chain: mark.chain,
    positionId: mark.positionId,
    protocolId: mark.protocolId,
    assetSymbol: mark.assetSymbol || mark.protocolId || "protocol_position",
    assetAmount: mark.assetAmount ?? null,
    valueUsd: mark.valueUsd ?? null,
    shareBalance: mark.shareBalance ?? null,
    assetAddress: mark.assetAddress ?? null,
    observedAt: mark.observedAt,
  }));
  const last = treasurySnapshots[treasurySnapshots.length - 1];
  const positionsValueUsd = positions
    .map((p) => p.valueUsd)
    .filter(Number.isFinite)
    .reduce((sum, v) => sum + v, 0);
  const enrichedSummary = last.summary
    ? {
        ...last.summary,
        estimatedWalletUsd: (last.summary.estimatedWalletUsd ?? 0) + positionsValueUsd,
      }
    : { estimatedWalletUsd: positionsValueUsd };
  return [...treasurySnapshots.slice(0, -1), { ...last, positions, summary: enrichedSummary }];
}

function determineBroadcastEvidenceType(offramp, onramp, consolidation, nativeDex, auditHelperTrace) {
  if (offramp) return "gateway_btc_offramp";
  if (onramp) return "gateway_btc_onramp";
  if (consolidation) return "gateway_btc_transfer";
  if (nativeDex) return `native_dex_${nativeDex.stepId}`;
  if (auditHelperTrace) return auditHelperTrace.evidenceType;
  return "broadcast_only";
}

function buildUnmatchedBitcoinTxs(bitcoinMatching) {
  return Object.entries(bitcoinMatching.addresses).flatMap(([address, entry]) =>
    entry.unmatchedTxs.map((tx) => ({ address, ...tx })),
  );
}

function buildOperatorFundingBitcoinTxs(bitcoinMatching) {
  return Object.entries(bitcoinMatching.addresses).flatMap(([address, entry]) =>
    (entry.operatorFundingTxs || []).map((tx) => ({ address, ...tx })),
  );
}

function buildNonSettlementBitcoinTxs(bitcoinMatching) {
  return Object.entries(bitcoinMatching.addresses).flatMap(([address, entry]) =>
    (entry.nonSettlementTxs || []).map((tx) => ({ address, ...tx })),
  );
}

function aggregateGasByCategoryAndChain(broadcastBreakdown) {
  const byCategoryGas = new Map();
  const byChainGas = new Map();
  for (const cell of broadcastBreakdown) {
    byCategoryGas.set(cell.category, (byCategoryGas.get(cell.category) || 0) + cell.gasUsd);
    byChainGas.set(cell.chain, (byChainGas.get(cell.chain) || 0) + cell.gasUsd);
  }
  return { byCategoryGas, byChainGas };
}

function computeBroadcastHelperMatchDetails(offramp, onramp, consolidation, nativeDex, auditHelperTrace) {
  const helperMatched = Boolean(offramp || onramp || consolidation || nativeDex || auditHelperTrace);
  const fromExecutionJsonl = offramp || onramp || consolidation || nativeDex;
  const helperMatchSource = fromExecutionJsonl ? "execution_jsonl" : auditHelperTrace?.matchSource || null;
  const helperMatchRule = fromExecutionJsonl ? "tx_hash" : auditHelperTrace?.matchRule || null;
  return { helperMatched, helperMatchSource, helperMatchRule };
}

function terminalSignerReceiptMatchesBroadcast(record = {}, candidateRecord = {}) {
  return (
    normalizeTxHash(record?.broadcast?.txHash) ===
      normalizeTxHash(candidateRecord?.broadcast?.txHash || candidateRecord?.lifecycle?.txHash) &&
    helperTraceRecordContextMatches(record, {
      strategyId: candidateRecord?.strategyId,
      chain: candidateRecord?.chain,
      intentHash: candidateRecord?.intentHash,
      from: candidateRecord?.broadcast?.from,
      to: candidateRecord?.broadcast?.to,
    })
  );
}

function fallbackTerminalSignerReceipt(record = {}, terminalSignerReceiptsByTxHash = new Map()) {
  const txHash = normalizeTxHash(record?.broadcast?.txHash);
  const candidates = terminalSignerReceiptsByTxHash.get(txHash) || [];
  const matches = candidates.filter((candidate) => terminalSignerReceiptMatchesBroadcast(record, candidate.record));
  if (matches.length !== 1) return null;
  return matches[0].receipt;
}

function fallbackCapitalAuditPair(record = {}, capitalAuditPairsByTxHash = new Map()) {
  const txHash = normalizeTxHash(record?.broadcast?.txHash);
  const candidates = capitalAuditPairsByTxHash.get(txHash) || [];
  const matches = candidates.filter((pair) => closedCapitalAuditPairMatchesBroadcast(record, pair));
  if (matches.length !== 1) return null;
  return matches[0];
}

function resolveBroadcastTxAndReceipt(
  record,
  transactionsByTxHash = {},
  receiptsByTxHash = {},
  terminalSignerReceiptsByTxHash = new Map(),
  capitalAuditPairsByTxHash = new Map(),
) {
  const txHash = record?.broadcast?.txHash;
  return {
    transaction: transactionsByTxHash[txHash] || null,
    receipt: receiptsByTxHash[txHash] || fallbackTerminalSignerReceipt(record, terminalSignerReceiptsByTxHash),
    reconciliationPair: fallbackCapitalAuditPair(record, capitalAuditPairsByTxHash),
  };
}

function resolveEvidenceMaps(txHash, offrampsByTxHash, onrampsByTxHash, consolidationsByTxHash, nativeDexByTxHash) {
  return {
    offramp: offrampsByTxHash.get(txHash) || null,
    onramp: onrampsByTxHash.get(txHash) || null,
    consolidation: consolidationsByTxHash.get(txHash) || null,
    nativeDex: nativeDexByTxHash.get(txHash) || null,
  };
}

function enrichBroadcastRecord(record, helpers = {}) {
  const {
    offrampsByTxHash = new Map(),
    onrampsByTxHash = new Map(),
    consolidationsByTxHash = new Map(),
    nativeDexByTxHash = new Map(),
    auditHelperTraceIndex = { byTxHash: new Map(), byIntentHash: new Map(), byFallbackBucket: new Map() },
    transactionsByTxHash = {},
    receiptsByTxHash = {},
    terminalSignerReceiptsByTxHash = new Map(),
    capitalAuditPairsByTxHash = new Map(),
    prices = emptyPricesUsd(),
  } = helpers;
  const txHash = record.broadcast.txHash;
  const { transaction, receipt, reconciliationPair } = resolveBroadcastTxAndReceipt(
    record,
    transactionsByTxHash,
    receiptsByTxHash,
    terminalSignerReceiptsByTxHash,
    capitalAuditPairsByTxHash,
  );
  const evidenceMaps = resolveEvidenceMaps(
    txHash,
    offrampsByTxHash,
    onrampsByTxHash,
    consolidationsByTxHash,
    nativeDexByTxHash,
  );
  const { offramp, onramp, consolidation, nativeDex } = evidenceMaps;
  const auditHelperTrace = matchAuditHelperTrace(record, auditHelperTraceIndex);
  const evidenceType = determineBroadcastEvidenceType(offramp, onramp, consolidation, nativeDex, auditHelperTrace);
  function buildEnrichedBroadcastRecordFields(
    record,
    transaction,
    receipt,
    reconciliationPair,
    evidenceType,
    matchDetails,
    prices,
  ) {
    return {
      txHash: record.broadcast.txHash,
      observedAt: record.timestamp,
      strategyId: record.strategyId,
      chain: record.chain,
      lifecycleStage: broadcastLifecycleStage(record),
      category: broadcastCategory(record, evidenceType),
      result: receipt
        ? broadcastResultFromReceipt(receipt)
        : resultFromCapitalAuditPair(reconciliationPair) || "no_receipt",
      from: record.broadcast?.from || transaction?.from || null,
      to: record.broadcast?.to || transaction?.to || null,
      amountUsd: record.amountUsd ?? null,
      evidenceType,
      gasUsd: gasUsdForReceipt(record.chain, receipt, prices),
      txValueUsd: txValueUsdForTransaction(record.chain, transaction, prices),
      receiptStatus: receipt?.status ?? null,
      reconciliationStatus: reconciliationPair?.reconciliationStatus ?? null,
      reconciliationSource: reconciliationPair?.source ?? null,
      helperMatched: matchDetails.helperMatched,
      helperMatchSource: matchDetails.helperMatchSource,
      helperMatchRule: matchDetails.helperMatchRule,
    };
  }

  const matchDetails = computeBroadcastHelperMatchDetails(offramp, onramp, consolidation, nativeDex, auditHelperTrace);
  return buildEnrichedBroadcastRecordFields(
    record,
    transaction,
    receipt,
    reconciliationPair,
    evidenceType,
    matchDetails,
    prices,
  );
}

export function buildCapitalAuditReport({
  generatedAt = new Date().toISOString(),
  signerAuditRecords = [],
  treasurySnapshots = [],
  gatewayBtcOfframpExecutions = [],
  gatewayBtcOnrampExecutions = [],
  gatewayBtcConsolidationExecutions = [],
  nativeDexExperimentExecutions = [],
  capitalAuditPairs = [],
  transactionsByTxHash = {},
  receiptsByTxHash = {},
  bitcoinHistoriesByAddress = {},
  prices = emptyPricesUsd(),
  issues = [],
  approvedOperatorBtcAddresses = [],
  operatorFundingBtcAddresses = listApprovedOperatorBtcAddresses({
    purpose: "operating_capital_ingress",
    includeObservationOnly: false,
  }),
  protocolPositionMarks = [],
} = {}) {
  const broadcasts = latestBroadcastSignerRecords(signerAuditRecords);
  const scope = buildCapitalAuditScope({
    signerAuditRecords,
    treasurySnapshots,
    gatewayBtcOfframpExecutions,
    gatewayBtcOnrampExecutions,
    approvedOperatorBtcAddresses,
  });
  const bitcoinMatching = matchBitcoinSettlements({
    gatewayBtcOfframpExecutions,
    bitcoinHistoriesByAddress,
    operatorFundingBtcAddresses,
  });
  const offrampsByTxHash = buildOfframpMap(gatewayBtcOfframpExecutions);
  const onrampsByTxHash = buildOnrampMap(gatewayBtcOnrampExecutions);
  const consolidationsByTxHash = buildConsolidationMap(gatewayBtcConsolidationExecutions);
  const nativeDexByTxHash = buildNativeDexMap(nativeDexExperimentExecutions);
  const auditHelperTraceIndex = buildAuditHelperTraceIndex(signerAuditRecords);
  const terminalSignerReceiptsByTxHash = buildTerminalSignerReceiptIndex(signerAuditRecords);
  const capitalAuditPairsByTxHash = buildCapitalAuditPairIndex(capitalAuditPairs);

  const transactions = broadcasts.map((record) =>
    enrichBroadcastRecord(record, {
      offrampsByTxHash,
      onrampsByTxHash,
      consolidationsByTxHash,
      nativeDexByTxHash,
      auditHelperTraceIndex,
      transactionsByTxHash,
      receiptsByTxHash,
      terminalSignerReceiptsByTxHash,
      capitalAuditPairsByTxHash,
      prices,
    }),
  );

  const enrichedTreasurySnapshots = injectProtocolPositionsIntoLatestSnapshot(treasurySnapshots, protocolPositionMarks);
  const inventory = buildInventorySummary(enrichedTreasurySnapshots);
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
  const onrampSummaries = buildOnrampExecutionSummaries({
    executions: gatewayBtcOnrampExecutions,
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
  const unmatchedBitcoinTxs = buildUnmatchedBitcoinTxs(bitcoinMatching);
  const operatorFundingBitcoinTxs = buildOperatorFundingBitcoinTxs(bitcoinMatching);
  const nonSettlementBitcoinTxs = buildNonSettlementBitcoinTxs(bitcoinMatching);
  const broadcastBreakdown = buildBroadcastBreakdown(transactions);
  const gasMetrics = buildGasMetrics(transactions, broadcastBreakdown);
  const {
    totalGasUsd,
    breakdownGasUsd,
    byCategoryGas,
    byChainGas,
    topGasCategory,
    topGasChain,
    gasFromRevertedTxsUsd,
    gasFromNoReceiptTxsUsd,
  } = gasMetrics;
  function buildGasMetrics(transactions = [], broadcastBreakdown = []) {
    const totalGasUsd = transactions
      .map((entry) => entry.gasUsd)
      .filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    const breakdownGasUsd = broadcastBreakdown.map((entry) => entry.gasUsd).reduce((sum, value) => sum + value, 0);
    const { byCategoryGas, byChainGas } = aggregateGasByCategoryAndChain(broadcastBreakdown);
    const topGasCategory = [...byCategoryGas.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
    const topGasChain = [...byChainGas.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
    const gasFromRevertedTxsUsd = transactions
      .filter((entry) => entry.result === "reverted")
      .map((entry) => entry.gasUsd)
      .filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    const gasFromNoReceiptTxsUsd = transactions
      .filter((entry) => entry.result === "no_receipt")
      .map((entry) => entry.gasUsd)
      .filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    return {
      totalGasUsd,
      breakdownGasUsd,
      byCategoryGas,
      byChainGas,
      topGasCategory,
      topGasChain,
      gasFromRevertedTxsUsd,
      gasFromNoReceiptTxsUsd,
    };
  }
  const {
    totalQuotedGatewayFeeSats,
    totalQuotedGatewayResidualSats,
    totalObservedBtcSats,
    totalNativeDexOutputDriftUsd,
    operatorFundingBtcSats,
    currentNativeBtcSats,
    currentNativeBtcUsd,
    currentCombinedUsd,
    startCombinedUsd,
  } = buildGatewayBtcAndInventoryTotals({
    offrampSummaries,
    nativeDexSummaries,
    operatorFundingBitcoinTxs,
    bitcoinMatching,
    inventory,
    prices,
  });

  function buildGatewayBtcAndInventoryTotals({
    offrampSummaries = [],
    nativeDexSummaries = [],
    operatorFundingBitcoinTxs = [],
    bitcoinMatching = { addresses: {} },
    inventory = {},
    prices = {},
  } = {}) {
    const totalQuotedGatewayResidualSats = offrampSummaries
      .map((entry) => Number(entry.quotedResidualSats))
      .filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    const totalQuotedGatewayFeeSats = offrampSummaries
      .map((entry) => Number(entry.quotedFeeSats))
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
    const operatorFundingBtcSats = operatorFundingBitcoinTxs
      .map((entry) => Number(entry.receivedSats || 0))
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
    return {
      totalQuotedGatewayFeeSats,
      totalQuotedGatewayResidualSats,
      totalObservedBtcSats,
      totalNativeDexOutputDriftUsd,
      operatorFundingBtcSats,
      currentNativeBtcSats,
      currentNativeBtcUsd,
      currentCombinedUsd,
      startCombinedUsd,
    };
  }

  function buildDerivedIssues(issues = [], unmatchedBroadcasts = [], unmatchedBitcoinTxs = [], offrampSummaries = []) {
    return [
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
  }

  const derivedIssues = buildDerivedIssues(issues, unmatchedBroadcasts, unmatchedBitcoinTxs, offrampSummaries);

  const summary = buildCapitalAuditSummary({
    transactions,
    unmatchedBroadcasts,
    unmatchedBitcoinTxs,
    scope,
    offrampSummaries,
    operatorFundingBitcoinTxs,
    nonSettlementBitcoinTxs,
    gasMetrics: {
      totalGasUsd,
      breakdownGasUsd,
      topGasCategory,
      topGasChain,
      gasFromRevertedTxsUsd,
      gasFromNoReceiptTxsUsd,
    },
    gatewayBtcTotals: {
      totalQuotedGatewayFeeSats,
      totalQuotedGatewayResidualSats,
      totalObservedBtcSats,
      totalNativeDexOutputDriftUsd,
      currentNativeBtcSats,
      currentNativeBtcUsd,
      currentCombinedUsd,
    },
    inventory,
    startCombinedUsd,
    currentCombinedUsd,
    derivedIssues,
    operatorFundingBtcSats,
  });

  return {
    schemaVersion: 1,
    generatedAt,
    status:
      unmatchedBroadcasts.length === 0 && unmatchedBitcoinTxs.length === 0
        ? "complete_with_residual_checks"
        : "incomplete_traceability",
    walletScope: scope,
    summary,
    inventory,
    bitcoinAddresses: Object.entries(bitcoinMatching.addresses).map(([address, entry]) => ({
      address,
      txCount: entry.txCount,
      currentBalanceSats: entry.balance?.balanceSats ?? null,
      confirmedBalanceSats: entry.balance?.confirmedBalanceSats ?? null,
      mempoolBalanceSats: entry.balance?.mempoolBalanceSats ?? null,
      source: entry.source,
      matchedOfframpTxCount: entry.matchedOfframpTxCount,
      operatorFundingTxs: entry.operatorFundingTxs,
      nonSettlementTxs: entry.nonSettlementTxs,
      unmatchedTxs: entry.unmatchedTxs,
    })),
    executions: {
      gatewayBtcOfframps: offrampSummaries,
      gatewayBtcOnramps: onrampSummaries,
      gatewayBtcConsolidations: consolidationSummaries,
      nativeDexExperiments: nativeDexSummaries,
    },
    broadcastBreakdown,
    transactions,
    issues: derivedIssues,
  };
}

function buildCapitalAuditSummary(params = {}) {
  const broadcast = buildBroadcastCounts(params.transactions, params.unmatchedBroadcasts, params.scope);
  const bitcoin = buildBitcoinCounts(
    params.offrampSummaries,
    params.unmatchedBitcoinTxs,
    params.operatorFundingBitcoinTxs,
    params.nonSettlementBitcoinTxs,
    params.operatorFundingBtcSats,
  );
  const gas = buildGasSummaryFields(params.gasMetrics);
  const treasury = buildTreasuryAndCombinedFields(
    params.inventory,
    params.startCombinedUsd,
    params.currentCombinedUsd,
    params.gatewayBtcTotals,
  );
  return {
    ...broadcast,
    ...bitcoin,
    ...gas,
    ...treasury,
    issueCount: params.derivedIssues ? params.derivedIssues.length : 0,
  };
}

function buildBroadcastCounts(transactions = [], unmatchedBroadcasts = [], scope = { bitcoinAddresses: [] }) {
  return {
    broadcastCount: transactions.length,
    broadcastWithReceiptCount: transactions.filter((entry) => entry.receiptStatus !== null).length,
    helperMatchedCount: transactions.filter((entry) => entry.helperMatched).length,
    unmatchedBroadcastCount: unmatchedBroadcasts.length,
    bitcoinAddressCount: scope.bitcoinAddresses.length,
  };
}

function buildBitcoinCounts(
  offrampSummaries = [],
  unmatchedBitcoinTxs = [],
  operatorFundingBitcoinTxs = [],
  nonSettlementBitcoinTxs = [],
  operatorFundingBtcSats = 0,
) {
  return {
    bitcoinMatchedSettlementCount: offrampSummaries.filter((entry) => entry.matchedBitcoinTx?.txid).length,
    bitcoinUnmatchedTxCount: unmatchedBitcoinTxs.length,
    bitcoinOperatorFundingTxCount: operatorFundingBitcoinTxs.length,
    bitcoinOperatorFundingSats: operatorFundingBtcSats,
    bitcoinNonSettlementTxCount: nonSettlementBitcoinTxs.length,
  };
}

function buildGasSummaryFields(gasMetrics = {}) {
  const {
    totalGasUsd = 0,
    breakdownGasUsd = 0,
    topGasCategory = null,
    topGasChain = null,
    gasFromRevertedTxsUsd = 0,
    gasFromNoReceiptTxsUsd = 0,
  } = gasMetrics;
  return {
    totalGasUsd,
    topGasCategory,
    topGasChain,
    gasFromRevertedTxsUsd: Number(gasFromRevertedTxsUsd.toFixed(6)),
    gasFromNoReceiptTxsUsd: Number(gasFromNoReceiptTxsUsd.toFixed(6)),
    broadcastBreakdownGasDriftUsd: Number(Math.abs(totalGasUsd - breakdownGasUsd).toFixed(6)),
  };
}

function buildTreasuryAndCombinedFields(
  inventory = {},
  startCombinedUsd = null,
  currentCombinedUsd = null,
  gatewayBtcTotals = {},
) {
  const {
    totalQuotedGatewayFeeSats = 0,
    totalQuotedGatewayResidualSats = 0,
    totalObservedBtcSats = 0,
    totalNativeDexOutputDriftUsd = 0,
    currentNativeBtcSats = 0,
    currentNativeBtcUsd = null,
  } = gatewayBtcTotals;
  const deltas = buildDeltaFields(inventory, startCombinedUsd, currentCombinedUsd);
  return {
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
    ...deltas,
  };
}

function buildDeltaFields(inventory = {}, startCombinedUsd = null, currentCombinedUsd = null) {
  return {
    treasuryDeltaUsd:
      Number.isFinite(inventory.start?.estimatedWalletUsd) && Number.isFinite(inventory.end?.estimatedWalletUsd)
        ? inventory.end.estimatedWalletUsd - inventory.start.estimatedWalletUsd
        : null,
    combinedDeltaUsd:
      Number.isFinite(startCombinedUsd) && Number.isFinite(currentCombinedUsd)
        ? currentCombinedUsd - startCombinedUsd
        : null,
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
    gatewayBtcOnrampExecutions,
    gatewayBtcConsolidationExecutions,
    nativeDexExperimentExecutions,
    capitalAuditPairs,
    marketPriceSnapshots,
    gasSnapshots,
    bitcoinFeeSnapshots,
    protocolPositionMarks,
  ] = await Promise.all([
    readSignerAuditLog({ rootDir }),
    readJsonl(dataDir, "treasury-inventory"),
    readJsonl(dataDir, "gateway-btc-offramp-executions"),
    readJsonl(dataDir, "gateway-btc-onramp-executions"),
    readJsonl(dataDir, "gateway-btc-consolidation-executions"),
    readJsonl(dataDir, "native-dex-experiment-executions"),
    readJsonl(dataDir, "capital-audit-pairs"),
    readJsonl(dataDir, "market-price-snapshots"),
    readJsonl(dataDir, "gas-snapshots"),
    readJsonl(dataDir, "bitcoin-fee-snapshots"),
    readJsonl(dataDir, "protocol-position-marks"),
  ]);

  const scope = buildCapitalAuditScope({
    signerAuditRecords,
    treasurySnapshots,
    gatewayBtcOfframpExecutions,
    gatewayBtcOnrampExecutions,
    approvedOperatorBtcAddresses: listApprovedOperatorBtcAddresses({ purpose: "deposit_watch" }),
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

  async function readTransactionAndReceiptSafely(record, issues) {
    const txHash = record?.broadcast?.txHash;
    if (!txHash) return;

    try {
      transactionsByTxHash[txHash] = await txReader(record.chain, txHash);
    } catch (error) {
      issues.push({
        code: "transaction_read_failed",
        severity: "low",
        chain: record.chain,
        message: `Transaction read failed for ${txHash}: ${error.message}`,
      });
    }

    try {
      receiptsByTxHash[txHash] = await receiptReader(record.chain, txHash);
    } catch (error) {
      issues.push({
        code: "receipt_read_failed",
        severity: "low",
        chain: record.chain,
        message: `Receipt read failed for ${txHash}: ${error.message}`,
      });
    }
  }

  await Promise.all(
    latestBroadcastSignerRecords(signerAuditRecords).map((record) => readTransactionAndReceiptSafely(record, issues)),
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
    gatewayBtcOnrampExecutions,
    gatewayBtcConsolidationExecutions,
    nativeDexExperimentExecutions,
    capitalAuditPairs,
    transactionsByTxHash,
    receiptsByTxHash,
    bitcoinHistoriesByAddress,
    prices,
    approvedOperatorBtcAddresses: listApprovedOperatorBtcAddresses({ purpose: "deposit_watch" }),
    issues,
    protocolPositionMarks,
  };
}
