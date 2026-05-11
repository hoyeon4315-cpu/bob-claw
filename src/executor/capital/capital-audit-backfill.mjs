import { readJsonl } from "../../lib/jsonl-read.mjs";
import { buildCapitalAuditClosureRecord } from "./capital-audit-pair.mjs";

function hasBroadcastEvidence(record = {}) {
  return Boolean(record.broadcast) || ["broadcasted", "confirmed", "reverted"].includes(record.lifecycle?.stage || null);
}

function txHashOf(record = {}) {
  return record.lifecycle?.txHash || record.broadcast?.txHash || record.realized?.hash || null;
}

function isTerminalAuditRecord(record = {}) {
  const stage = record.lifecycle?.stage || null;
  if (record.strategyId === "gateway-btc-onramp" && stage === "broadcasted") return true;
  return ["confirmed", "reverted"].includes(stage) || Boolean(record.realized);
}

function receiptIsClosed(receipt = {}) {
  return ["reconciled", "failed", "final_failed"].includes(receipt.reconciliationStatus);
}

export async function loadCapitalAuditBackfillInputs({ dataDir, auditRecords = null, receiptRecords = null } = {}) {
  const [audits, receipts, existing] = await Promise.all([
    Array.isArray(auditRecords) ? auditRecords : readJsonl("logs", "signer-audit").catch(() => []),
    Array.isArray(receiptRecords) ? receiptRecords : readJsonl(dataDir, "receipt-reconciliations").catch(() => []),
    readJsonl(dataDir, "capital-audit-pairs").catch(() => []),
  ]);
  return { auditRecords: audits, receiptRecords: receipts, existingRecords: existing };
}

export function buildCapitalAuditBackfillRecords({
  auditRecords = [],
  receiptRecords = [],
  existingRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const existingHashes = new Set(existingRecords.map((record) => record.intentHash).filter(Boolean));
  const receiptsByTx = new Map();
  for (const receipt of receiptRecords) {
    if (!receipt?.txHash || !receiptIsClosed(receipt)) continue;
    receiptsByTx.set(String(receipt.txHash).toLowerCase(), receipt);
  }

  const latestByIntent = new Map();
  for (const record of auditRecords) {
    if (!hasBroadcastEvidence(record) || !record.intentHash || existingHashes.has(record.intentHash)) continue;
    const txHash = txHashOf(record);
    const receipt = txHash ? receiptsByTx.get(String(txHash).toLowerCase()) : null;
    if (!receipt && !isTerminalAuditRecord(record)) continue;
    const previous = latestByIntent.get(record.intentHash);
    if (!previous || String(record.timestamp || "") >= String(previous.timestamp || "")) {
      latestByIntent.set(record.intentHash, record);
    }
  }

  return [...latestByIntent.values()]
    .map((record) => {
      const txHash = txHashOf(record);
      const receipt = txHash ? receiptsByTx.get(String(txHash).toLowerCase()) : null;
      if (!receipt && !isTerminalAuditRecord(record)) return null;
      return buildCapitalAuditClosureRecord({
        auditRecord: record,
        receiptRecord: receipt,
        source: receipt ? "receipt_reconciliation_backfill" : "signer_terminal_backfill",
        observedAt: now,
      });
    })
    .filter((record) => record?.validation?.ok === true);
}
