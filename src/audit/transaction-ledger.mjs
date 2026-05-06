import { tokenAsset, ZERO_TOKEN } from "../assets/tokens.mjs";
import { priceForAssetUsd } from "../market/prices.mjs";

const BASE_CBBTC_TOKEN = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SIGNER_SNAPSHOT_SKEW_MS = 5 * 60 * 1000;
const WRAPPED_BTC_LOOP_STRATEGY_ID = "wrapped-btc-loop-base-moonwell";

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function observedAt(record = {}) {
  return record.observedAt || record.timestamp || null;
}

function observedAtMs(record = {}) {
  const parsed = new Date(observedAt(record) || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function currentNavConfidence(currentNav = null) {
  if (!currentNav) return "missing";
  return currentNav.walletCoverage === "full_rpc" &&
    Number(currentNav.scanErrorCount || 0) === 0 &&
    Number(currentNav.unknownAssetBalanceCount || 0) === 0
    ? "verified_current"
    : "verified_known_assets";
}

function receiptCategory(record = {}) {
  if (record.reconciliationStatus === "failed") return "failed_tx_cost";
  const kind = String(record.kind || "");
  if (kind === "gas_zip_native_refuel") return "gas_refuel_cost";
  if (kind.includes("bridge") || kind.includes("gateway_btc")) return "bridge_or_gateway_cost";
  if (kind.includes("dex")) return "swap_execution_cost";
  if (kind.includes("protocol") || kind.includes("erc4626")) return "protocol_position_cost";
  return "strategy_execution_cost";
}

function costUsdFromRealizedNet(value) {
  const realized = finiteNumber(value);
  if (!Number.isFinite(realized) || realized >= 0) return 0;
  return Math.abs(realized);
}

function receiptRow(record = {}) {
  const realizedNetPnlUsd = finiteNumber(record.realized?.realizedNetPnlUsd);
  const receiptGasUsd = finiteNumber(record.realized?.receiptGasUsd);
  const txHash = record.txHash || null;
  return {
    schemaVersion: 1,
    ledgerRowId: `receipt:${txHash || record.observedAt || "unknown"}`,
    sourceFile: "data/receipt-reconciliations.jsonl",
    rowType: "receipt_reconciliation",
    observedAt: observedAt(record),
    chain: record.chain || record.routeContext?.srcChain || record.routeContext?.dstChain || null,
    txHash,
    strategyId: record.strategyId || null,
    kind: record.kind || null,
    category: receiptCategory(record),
    reconciliationStatus: record.reconciliationStatus || null,
    confidence: record.reconciliationStatus === "reconciled" ? "receipt_reconciled" : record.reconciliationStatus || "receipt_record",
    routeKey: record.routeContext?.routeKey || null,
    inputUsd: finiteNumber(record.routeContext?.estimatedInputUsd),
    expectedOutputUsd: finiteNumber(record.routeContext?.estimatedOutputUsd),
    actualOutputUsd: finiteNumber(record.output?.actualOutputUsd),
    receiptGasUsd,
    knownCostUsd: finiteNumber(record.realized?.actualKnownCostUsd),
    realizedNetPnlUsd,
    costUsd: costUsdFromRealizedNet(realizedNetPnlUsd),
    note: "costUsd_uses_negative_realized_net_pnl_do_not_add_receipt_gas_again",
  };
}

function signerTxHash(record = {}) {
  return record.broadcast?.txHash || record.lifecycle?.txHash || null;
}

function isSignerRevert(record = {}) {
  return record.lifecycle?.stage === "reverted" || record.policyVerdict === "errored" && signerTxHash(record);
}

function bigintFromValue(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function signerRevertFeeWei(record = {}) {
  const directFee = bigintFromValue(record.realized?.fee ?? record.receipt?.fee ?? record.receipt?.gasCostWei);
  if (directFee !== null) return directFee;
  const gasUsed = bigintFromValue(record.realized?.gasUsed ?? record.receipt?.gasUsed);
  const gasPrice = bigintFromValue(
    record.realized?.effectiveGasPrice ??
      record.realized?.gasPrice ??
      record.receipt?.effectiveGasPrice ??
      record.receipt?.gasPrice,
  );
  if (gasUsed === null || gasPrice === null) return null;
  return gasUsed * gasPrice;
}

function signerRevertCostRecordKey(record = {}) {
  const chain = normalized(record.chain);
  const txHash = normalized(record.txHash);
  return chain && txHash ? `${chain}:${txHash}` : null;
}

function signerRevertFeeUsd(record = {}, prices = null, costRecord = null) {
  const attributedCost = finiteNumber(costRecord?.estimatedUsd ?? costRecord?.costUsd);
  if (Number.isFinite(attributedCost)) return attributedCost;
  const explicit = finiteNumber(record.realized?.actualKnownCostUsd);
  if (Number.isFinite(explicit)) return explicit;
  const feeWei = bigintFromValue(costRecord?.feeWei) ?? signerRevertFeeWei(record);
  if (feeWei === null) return null;
  const chain = normalized(record.chain || costRecord?.chain);
  const priceUsd = finiteNumber(prices?.nativeByChain?.[chain]) ?? priceForAssetUsd(tokenAsset(chain, ZERO_TOKEN), prices);
  if (!Number.isFinite(priceUsd)) return null;
  return (Number(feeWei) / 1e18) * priceUsd;
}

function hasSignerRevertFeeEvidence(record = {}) {
  return Number.isFinite(finiteNumber(record.realized?.actualKnownCostUsd)) || signerRevertFeeWei(record) !== null;
}

function dedupeSignerRevertRecords(records = []) {
  const byKey = new Map();
  for (const record of records) {
    const key = signerRevertCostRecordKey({
      chain: record.chain,
      txHash: signerTxHash(record),
    });
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || !hasSignerRevertFeeEvidence(existing) && hasSignerRevertFeeEvidence(record)) {
      byKey.set(key, record);
    }
  }
  return [...byKey.values()];
}

function signerRevertRow(record = {}, { prices = null, costRecord = null } = {}) {
  const txHash = signerTxHash(record);
  const knownCostUsd = signerRevertFeeUsd(record, prices, costRecord);
  const feeWei = bigintFromValue(costRecord?.feeWei) ?? signerRevertFeeWei(record);
  const confidence = Number.isFinite(knownCostUsd)
    ? (
        costRecord
          ? "revert_receipt_fee_priced_from_rpc_receipt"
          : Number.isFinite(finiteNumber(record.realized?.actualKnownCostUsd))
            ? "signer_realized_cost"
            : "revert_receipt_fee_priced_from_audit"
      )
    : "needs_receipt_price";
  return {
    schemaVersion: 1,
    ledgerRowId: `signer_revert:${txHash || record.intentHash || record.timestamp || "unknown"}`,
    sourceFile: "logs/signer-audit.jsonl",
    rowType: "signer_revert",
    observedAt: observedAt(record),
    chain: record.chain || null,
    txHash,
    strategyId: record.strategyId || record.intent?.metadata?.capStrategyId || null,
    kind: record.intent?.intentType || null,
    category: Number.isFinite(knownCostUsd) ? "failed_tx_cost" : "unquantified_revert_cost",
    confidence,
    routeKey: record.intent?.metadata?.routeKey || null,
    inputUsd: finiteNumber(record.amountUsd ?? record.intent?.amountUsd),
    expectedOutputUsd: null,
    actualOutputUsd: null,
    receiptGasUsd: knownCostUsd,
    knownCostUsd,
    realizedNetPnlUsd: null,
    costUsd: knownCostUsd,
    feeWei: feeWei !== null ? feeWei.toString() : null,
    costAttribution: costRecord ? {
      sourceFile: costRecord.sourceFile || "data/signer-revert-receipt-costs.jsonl",
      observedAt: costRecord.observedAt || null,
      blockNumber: costRecord.blockNumber ?? null,
      status: costRecord.status ?? null,
      rpcUrl: costRecord.rpcUrl || null,
    } : null,
    errorMessage: record.error?.message || record.error || null,
  };
}

function outputToken(record = {}) {
  return normalized(record.output?.asset?.token || record.output?.token || record.routeContext?.dstAsset?.token);
}

function outputTicker(record = {}) {
  return normalized(record.output?.asset?.ticker || record.output?.asset?.symbol || record.routeContext?.dstAsset?.ticker);
}

function outputChain(record = {}) {
  return normalized(record.output?.asset?.chain || record.routeContext?.dstChain || record.chain);
}

function receiptOutputAttributionCandidates(receiptRecords = []) {
  return receiptRecords
    .filter((record) => record.reconciliationStatus === "reconciled")
    .filter((record) => record.txHash && Number.isFinite(finiteNumber(record.output?.actualOutputUsd)))
    .map((record) => ({
      sourceFile: "data/receipt-reconciliations.jsonl",
      observedAt: observedAt(record),
      observedAtMs: observedAtMs(record),
      txHash: record.txHash,
      chain: outputChain(record),
      token: outputToken(record),
      ticker: outputTicker(record),
      outputUsd: finiteNumber(record.output?.actualOutputUsd),
      kind: record.kind || null,
      strategyId: record.strategyId || null,
      routeKey: record.routeContext?.routeKey || null,
      category: "internal_route_output",
      confidence: "tx_attributed_internal_route_output",
      matchReason: "receipt_output_matches_inbound_chain_token_and_snapshot_window",
      timeToleranceMs: 0,
    }))
    .filter((candidate) => candidate.chain && (candidate.token || candidate.ticker));
}

function transferAttributionCandidates(transferAttributionRecords = []) {
  return transferAttributionRecords
    .filter((record) => record.eventId && record.txHash)
    .map((record) => {
      const confidence = record.confidence || "tx_attributed_erc20_transfer_log";
      return {
        sourceFile: record.sourceFile || "data/treasury/inbound-transfer-attributions.jsonl",
        observedAt: observedAt(record),
        observedAtMs: observedAtMs(record),
        txHash: record.txHash,
        chain: normalized(record.chain),
        token: normalized(record.token),
        ticker: normalized(record.ticker),
        outputUsd: finiteNumber(record.estimatedUsd ?? record.actualOutputUsd),
        amount: record.amount === null || record.amount === undefined ? null : String(record.amount),
        amountDecimal: finiteNumber(record.amountDecimal),
        eventId: record.eventId,
        kind: record.kind || (confidence === "tx_attributed_native_transfer_history" ? "native_transfer" : "erc20_transfer"),
        strategyId: record.strategyId || null,
        routeKey: record.routeKey || null,
        category: "external_or_internal_inbound_tx",
        confidence,
        matchReason: confidence === "tx_attributed_native_transfer_history"
          ? "native_transfer_history_matches_inbound_event_id_chain_token_and_amount"
          : "erc20_transfer_log_matches_inbound_event_id_chain_token_and_amount",
        timeToleranceMs: SIGNER_SNAPSHOT_SKEW_MS,
        blockNumber: record.blockNumber ?? null,
        logIndex: record.logIndex ?? null,
        transactionIndex: record.transactionIndex ?? null,
        from: record.from || null,
        to: record.to || null,
      };
    })
    .filter((candidate) => candidate.chain && candidate.token);
}

function signerConfirmedOutputAsset(record = {}) {
  const chain = normalized(record.chain);
  const strategyId = record.strategyId || record.intent?.strategyId || record.intent?.metadata?.capStrategyId || null;
  const intentType = record.intent?.intentType || null;
  const metadata = record.intent?.metadata || {};
  const explicitOutputToken = intentType === "dex_swap" || intentType === "unwrap_native"
    ? metadata.outputToken
    : null;
  const explicitAssetAddress = intentType === "erc4626_redeem" ? metadata.assetAddress : null;
  const token = explicitOutputToken ||
    explicitAssetAddress ||
    (
      strategyId === WRAPPED_BTC_LOOP_STRATEGY_ID &&
        chain === "base" &&
        intentType === "risk_unwind" &&
        metadata.kind === "withdraw_initial_collateral"
        ? BASE_CBBTC_TOKEN
        : strategyId === WRAPPED_BTC_LOOP_STRATEGY_ID &&
          chain === "base" &&
          intentType === "risk_unwind" &&
          metadata.kind === "swap_collateral_to_repay_asset"
          ? BASE_USDC_TOKEN
        : null
    );
  if (!token) return null;
  const asset = tokenAsset(chain, token);
  return {
    chain,
    token: normalized(token),
    ticker: normalized(asset.ticker),
  };
}

function signerOutputAttributionCandidates(signerAuditRecords = []) {
  return signerAuditRecords
    .filter((record) => record.lifecycle?.stage === "confirmed")
    .filter((record) => signerTxHash(record))
    .map((record) => {
      const asset = signerConfirmedOutputAsset(record);
      if (!asset) return null;
      return {
        sourceFile: "logs/signer-audit.jsonl",
        observedAt: observedAt(record),
        observedAtMs: observedAtMs(record),
        txHash: signerTxHash(record),
        chain: asset.chain,
        token: asset.token,
        ticker: asset.ticker,
        outputUsd: finiteNumber(record.amountUsd ?? record.intent?.amountUsd ?? record.intent?.metadata?.capCheckAmountUsd),
        kind: record.intent?.intentType || null,
        strategyId: record.strategyId || record.intent?.strategyId || record.intent?.metadata?.capStrategyId || null,
        routeKey: record.intent?.metadata?.routeKey || null,
        category: "internal_strategy_output",
        confidence: "tx_attributed_signer_strategy_output",
        matchReason: "signer_output_matches_inbound_chain_token_and_snapshot_window",
        timeToleranceMs: SIGNER_SNAPSHOT_SKEW_MS,
      };
    })
    .filter(Boolean);
}

function candidateMatchesInbound(event = {}, candidate = {}) {
  if (candidate.eventId && event.eventId !== candidate.eventId) return false;
  if (normalized(event.chain) !== candidate.chain) return false;
  const eventToken = normalized(event.token);
  const eventTicker = normalized(event.ticker);
  if (eventToken && candidate.token && eventToken !== candidate.token) return false;
  if (eventToken && !candidate.token) return false;
  if (!eventToken && eventTicker && candidate.ticker && eventTicker !== candidate.ticker) return false;
  if (candidate.amount !== null && candidate.amount !== undefined && event.amount !== null && event.amount !== undefined && String(event.amount) !== candidate.amount) return false;
  const previousMs = timestampMs(event.previousObservedAt);
  const observedMs = timestampMs(event.observedAt);
  const toleranceMs = Number.isFinite(candidate.timeToleranceMs) ? candidate.timeToleranceMs : 0;
  if (previousMs && candidate.observedAtMs && candidate.observedAtMs < previousMs - toleranceMs) return false;
  if (observedMs && candidate.observedAtMs && candidate.observedAtMs > observedMs + toleranceMs) return false;
  return true;
}

function matchInboundAttribution(event = {}, candidates = []) {
  if (event.txHash) return null;
  const eventUsd = finiteNumber(event.estimatedUsd);
  const matches = candidates.filter((candidate) => candidateMatchesInbound(event, candidate));
  if (matches.length === 0) return null;
  return [...matches].sort((left, right) => {
    const leftUsdDistance = Number.isFinite(eventUsd) ? Math.abs((left.outputUsd ?? 0) - eventUsd) : 0;
    const rightUsdDistance = Number.isFinite(eventUsd) ? Math.abs((right.outputUsd ?? 0) - eventUsd) : 0;
    return leftUsdDistance - rightUsdDistance || right.observedAtMs - left.observedAtMs || String(left.txHash).localeCompare(String(right.txHash));
  })[0];
}

function inboundRow(event = {}, attribution = null) {
  const txHash = event.txHash || attribution?.txHash || null;
  const category = attribution?.category || (event.txHash ? "external_or_internal_inbound_tx" : "inbound_inventory_diff");
  const confidence = attribution?.confidence || (event.txHash ? "tx_attributed" : "balance_diff_not_tx_attributed");
  return {
    schemaVersion: 1,
    ledgerRowId: `inbound:${event.eventId || event.txHash || event.observedAt || "unknown"}`,
    sourceFile: "data/treasury/inbound-events.jsonl",
    rowType: "inbound_event",
    observedAt: observedAt(event),
    chain: event.chain || null,
    txHash,
    eventId: event.eventId || null,
    strategyId: attribution?.strategyId || null,
    kind: event.kind || "inbound",
    category,
    confidence,
    token: event.token || null,
    ticker: event.ticker || null,
    amountDecimal: finiteNumber(event.amountDecimal),
    inputUsd: null,
    actualOutputUsd: finiteNumber(event.estimatedUsd),
    receiptGasUsd: null,
    knownCostUsd: null,
    realizedNetPnlUsd: null,
    costUsd: 0,
    detectionSource: event.detectionSource || null,
    attribution: attribution ? {
      sourceFile: attribution.sourceFile,
      txHash: attribution.txHash,
      observedAt: attribution.observedAt,
      kind: attribution.kind,
      strategyId: attribution.strategyId || null,
      routeKey: attribution.routeKey,
      outputUsd: attribution.outputUsd,
      matchReason: attribution.matchReason,
      blockNumber: attribution.blockNumber ?? null,
      logIndex: attribution.logIndex ?? null,
      transactionIndex: attribution.transactionIndex ?? null,
      from: attribution.from || null,
      to: attribution.to || null,
    } : null,
  };
}

function gatewayOfframpRow(record = {}) {
  const sourceUsd = finiteNumber(record.plan?.amountUsd);
  const outputSats = finiteNumber(record.destinationProof?.outputSats ?? record.destinationProof?.amountSats);
  const txHash = record.execution?.signerResult?.broadcast?.txHash || record.txHash || null;
  return {
    schemaVersion: 1,
    ledgerRowId: `gateway_offramp:${txHash || record.plan?.order?.orderId || record.observedAt || "unknown"}`,
    sourceFile: "data/gateway-btc-offramp-executions.jsonl",
    rowType: "gateway_btc_offramp",
    observedAt: observedAt(record),
    chain: record.plan?.route?.srcChain || null,
    txHash,
    strategyId: record.plan?.strategyId || "gateway-btc-offramp",
    kind: "gateway_btc_offramp",
    category: "btc_offramp_delivery",
    confidence: record.settlementStatus === "delivered" ? "delivered" : record.settlementStatus || "offramp_record",
    inputUsd: sourceUsd,
    actualOutputUsd: null,
    outputSats,
    receiptGasUsd: null,
    knownCostUsd: null,
    realizedNetPnlUsd: null,
    costUsd: 0,
    recipient: record.plan?.recipient || null,
  };
}

function groupByCategory(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.category || "unknown";
    if (!groups.has(key)) {
      groups.set(key, {
        category: key,
        rowCount: 0,
        costUsd: 0,
        realizedNetPnlUsd: 0,
        receiptGasUsd: 0,
        inboundDiffUsd: 0,
      });
    }
    const group = groups.get(key);
    group.rowCount += 1;
    group.costUsd += finiteNumber(row.costUsd) ?? 0;
    group.realizedNetPnlUsd += finiteNumber(row.realizedNetPnlUsd) ?? 0;
    group.receiptGasUsd += finiteNumber(row.receiptGasUsd) ?? 0;
    if (row.category === "inbound_inventory_diff") group.inboundDiffUsd += finiteNumber(row.actualOutputUsd) ?? 0;
  }
  return [...groups.values()].sort((left, right) => right.costUsd - left.costUsd || left.category.localeCompare(right.category));
}

export function buildTransactionLedger({
  receiptRecords = [],
  signerAuditRecords = [],
  gatewayOfframpRecords = [],
  inboundEvents = [],
  transferAttributionRecords = [],
  signerRevertCostRecords = [],
  prices = null,
  currentNav = null,
  baselineUsd = null,
  now = new Date().toISOString(),
} = {}) {
  const receiptTxHashes = new Set(receiptRecords.map((record) => String(record.txHash || "").toLowerCase()).filter(Boolean));
  const signerRevertCostsByKey = new Map(
    signerRevertCostRecords
      .map((record) => [signerRevertCostRecordKey(record), record])
      .filter(([key]) => key),
  );
  const receiptRows = receiptRecords.map(receiptRow);
  const revertRecords = signerAuditRecords
    .filter(isSignerRevert)
    .filter((record) => {
      const txHash = signerTxHash(record);
      return txHash && !receiptTxHashes.has(String(txHash).toLowerCase());
    });
  const revertRows = dedupeSignerRevertRecords(revertRecords)
    .map((record) => signerRevertRow(record, {
      prices,
      costRecord: signerRevertCostsByKey.get(signerRevertCostRecordKey({
        chain: record.chain,
        txHash: signerTxHash(record),
      })),
    }));
  const inboundAttributionCandidates = [
    ...transferAttributionCandidates(transferAttributionRecords),
    ...receiptOutputAttributionCandidates(receiptRecords),
    ...signerOutputAttributionCandidates(signerAuditRecords),
  ];
  const inboundRows = inboundEvents.map((event) => inboundRow(event, matchInboundAttribution(event, inboundAttributionCandidates)));
  const offrampRows = gatewayOfframpRecords.map(gatewayOfframpRow);
  const rows = [...receiptRows, ...revertRows, ...inboundRows, ...offrampRows]
    .sort((left, right) => observedAtMs(left) - observedAtMs(right) || String(left.txHash || left.eventId || "").localeCompare(String(right.txHash || right.eventId || "")));
  const reconciledRealizedNetPnlUsd = receiptRows
    .filter((row) => row.reconciliationStatus === "reconciled")
    .reduce((sum, row) => sum + (finiteNumber(row.realizedNetPnlUsd) ?? 0), 0);
  const recordedNetPnlUsd = receiptRows.reduce((sum, row) => sum + (finiteNumber(row.realizedNetPnlUsd) ?? 0), 0);
  const totalCostUsd = rows.reduce((sum, row) => sum + (finiteNumber(row.costUsd) ?? 0), 0);
  const receiptGasUsd = rows.reduce((sum, row) => sum + (finiteNumber(row.receiptGasUsd) ?? 0), 0);
  const inboundDiffUsd = inboundRows.reduce((sum, row) => sum + (finiteNumber(row.actualOutputUsd) ?? 0), 0);
  const attributedInboundRows = inboundRows.filter((row) => row.confidence === "tx_attributed_internal_route_output" || row.confidence === "tx_attributed_signer_strategy_output" || row.confidence === "tx_attributed_erc20_transfer_log" || row.confidence === "tx_attributed_native_transfer_history" || row.confidence === "tx_attributed");
  const unattributedInboundRows = inboundRows.filter((row) => row.confidence === "balance_diff_not_tx_attributed");
  const unquantifiedRevertCount = revertRows.filter((row) => row.confidence === "needs_receipt_price").length;
  const quantifiedRevertCount = revertRows.filter((row) => row.confidence !== "needs_receipt_price").length;
  const caveats = [
    "totalCostUsd_uses_negative_realized_net_pnl_and_does_not_add_receipt_gas_again",
    "inbound_inventory_diff_rows_are_not_external_deposit_proof_until_txhash_attributed",
    ...(unquantifiedRevertCount > 0 ? ["unquantified_revert_cost_rows_need_receipt_price_lookup_before_usd_cost_is_exact"] : []),
  ];

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: typeof now === "string" ? now : now.toISOString(),
    currentNav: currentNav ? {
      ...currentNav,
      confidence: currentNavConfidence(currentNav),
    } : null,
    baseline: {
      baselineUsd: Number.isFinite(baselineUsd) ? baselineUsd : null,
      deltaFromCurrentUsd: Number.isFinite(baselineUsd) && Number.isFinite(currentNav?.totalUsd)
        ? baselineUsd - currentNav.totalUsd
        : null,
    },
    summary: {
      rowCount: rows.length,
      receiptRowCount: receiptRows.length,
      inboundRowCount: inboundRows.length,
      gatewayOfframpRowCount: offrampRows.length,
      unquantifiedRevertCount,
      quantifiedRevertCount,
      attributedInboundCount: attributedInboundRows.length,
      unattributedInboundCount: unattributedInboundRows.length,
      attributedInboundUsd: attributedInboundRows.reduce((sum, row) => sum + (finiteNumber(row.actualOutputUsd) ?? 0), 0),
      unattributedInboundUsd: unattributedInboundRows.reduce((sum, row) => sum + (finiteNumber(row.actualOutputUsd) ?? 0), 0),
      realizedNetPnlUsd: reconciledRealizedNetPnlUsd,
      reconciledRealizedNetPnlUsd,
      recordedNetPnlUsd,
      totalCostUsd,
      receiptGasUsd,
      inboundDiffUsd,
      categoryCount: groupByCategory(rows).length,
    },
    categories: groupByCategory(rows),
    rows,
    caveats,
  });
}
