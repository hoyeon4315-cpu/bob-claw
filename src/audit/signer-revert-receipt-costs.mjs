import { tokenAsset, ZERO_TOKEN } from "../assets/tokens.mjs";
import { priceForAssetUsd } from "../market/prices.mjs";
import { buildTransactionLedger } from "./transaction-ledger.mjs";

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function costKey(record = {}) {
  const chain = normalized(record.chain);
  const txHash = normalized(record.txHash);
  return chain && txHash ? `${chain}:${txHash}` : null;
}

function receiptFeeWei(receipt = {}) {
  const gasUsed = BigInt(receipt.gasUsed ?? 0);
  const gasPrice = BigInt(receipt.effectiveGasPrice ?? receipt.gasPrice ?? 0);
  return gasUsed * gasPrice;
}

function nativePriceUsd(chain, prices = null) {
  return finiteNumber(prices?.nativeByChain?.[chain]) ?? priceForAssetUsd(tokenAsset(chain, ZERO_TOKEN), prices);
}

function existingCostRecordIsUsable(record = {}, prices = null) {
  if (Number.isFinite(finiteNumber(record.estimatedUsd ?? record.costUsd))) return true;
  const feeWei = finiteNumber(record.feeWei);
  if (!Number.isFinite(feeWei)) return false;
  return Number.isFinite(nativePriceUsd(normalized(record.chain), prices));
}

export function normalizeSignerRevertReceiptCost({
  row,
  receipt,
  prices,
  observedAt = new Date().toISOString(),
  sourceFile = "rpc:eth_getTransactionReceipt",
} = {}) {
  const chain = normalized(row?.chain);
  const txHash = normalized(row?.txHash || receipt?.transactionHash);
  const feeWei = receiptFeeWei(receipt);
  const priceUsd = nativePriceUsd(chain, prices);
  const estimatedUsd = Number.isFinite(priceUsd) ? (Number(feeWei) / 1e18) * priceUsd : null;
  return {
    schemaVersion: 1,
    observedAt,
    chain,
    txHash,
    strategyId: row?.strategyId || null,
    kind: row?.kind || null,
    blockNumber: receipt?.blockNumber ?? null,
    status: receipt?.status ?? null,
    gasUsed: receipt?.gasUsed?.toString?.() ?? String(receipt?.gasUsed ?? "0"),
    effectiveGasPrice: receipt?.effectiveGasPrice?.toString?.() ?? String(receipt?.effectiveGasPrice ?? receipt?.gasPrice ?? "0"),
    feeWei: feeWei.toString(),
    estimatedUsd,
    rpcUrl: receipt?.rpcUrl || null,
    sourceFile,
    confidence: Number.isFinite(estimatedUsd)
      ? "revert_receipt_fee_priced_from_rpc_receipt"
      : "revert_receipt_fee_missing_price",
  };
}

export async function buildSignerRevertReceiptCostReport({
  receiptRecords = [],
  signerAuditRecords = [],
  existingCostRecords = [],
  prices = null,
  receiptReader,
  limit = Infinity,
  now = new Date().toISOString(),
} = {}) {
  if (typeof receiptReader !== "function") throw new Error("receiptReader is required");
  const existingKeys = new Set(
    existingCostRecords
      .filter((record) => existingCostRecordIsUsable(record, prices))
      .map(costKey)
      .filter(Boolean),
  );
  const ledger = buildTransactionLedger({
    receiptRecords,
    signerAuditRecords,
    signerRevertCostRecords: existingCostRecords,
    prices,
    now,
  });
  const candidates = ledger.rows
    .filter((row) => row.category === "unquantified_revert_cost")
    .filter((row) => row.chain && row.txHash)
    .filter((row) => !existingKeys.has(costKey(row)))
    .slice(0, Number.isFinite(limit) ? limit : Infinity);

  const records = [];
  const failures = [];
  for (const row of candidates) {
    try {
      const receipt = await receiptReader(row.chain, row.txHash);
      records.push(normalizeSignerRevertReceiptCost({
        row,
        receipt,
        prices,
        observedAt: now,
        sourceFile: `rpc:${row.chain}:eth_getTransactionReceipt`,
      }));
    } catch (error) {
      failures.push({
        chain: row.chain,
        txHash: row.txHash,
        message: error.message,
        attempts: error.attempts || null,
      });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: now,
    summary: {
      candidateCount: candidates.length,
      attributedCount: records.length,
      failureCount: failures.length,
      existingCostCount: existingCostRecords.length,
    },
    records,
    failures,
  };
}
