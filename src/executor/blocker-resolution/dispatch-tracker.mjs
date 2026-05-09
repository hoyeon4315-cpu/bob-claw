import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { writeTextIfChanged } from "../../lib/file-write.mjs";

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableCanonical(value[key])]),
  );
}

export function dispatchIntentHash(value = {}) {
  return createHash("sha256")
    .update(JSON.stringify(stableCanonical(value)))
    .digest("hex")
    .slice(0, 16);
}

export function buildPendingDispatchEntry({
  strategyId = null,
  code,
  paramsKey,
  action,
  observedAt = new Date().toISOString(),
} = {}) {
  const intent = action?.intent || action || {};
  const intentHash = intent.intentHash || dispatchIntentHash({ strategyId, code, paramsKey, intent });
  return {
    schemaVersion: 1,
    observedAt,
    strategyId: strategyId || intent.strategyId || null,
    code,
    paramsKey,
    intentHash,
    actionType: action?.type || null,
    authority: action?.authority || null,
    status: "pending_receipt",
    intent,
  };
}

function recordIntentHash(record = {}) {
  return record.intentHash ||
    record.intent?.intentHash ||
    record.metadata?.intentHash ||
    record.lifecycle?.intentHash ||
    record.receipt?.intentHash ||
    null;
}

function terminalSuccess(record = {}) {
  const stage = record.lifecycle?.stage || record.stage || record.receipt?.status || record.status || null;
  if (["confirmed", "delivered", "settled", "broadcasted"].includes(stage)) return true;
  if (record.txHash || record.broadcast?.txHash || record.receipt?.txHash) {
    return !["reverted", "failed", "error"].includes(stage);
  }
  return false;
}

export function reconcilePendingDispatches(pending = [], {
  signerAuditRecords = [],
  receiptRecords = [],
  observedAt = new Date().toISOString(),
} = {}) {
  const records = [...(signerAuditRecords || []), ...(receiptRecords || [])];
  const confirmed = [];
  const stillPending = [];
  for (const entry of pending || []) {
    const match = records.find((record) => recordIntentHash(record) === entry.intentHash && terminalSuccess(record));
    if (match) {
      confirmed.push({
        ...entry,
        status: "receipt_confirmed",
        confirmedAt: observedAt,
        txHash: match.txHash || match.broadcast?.txHash || match.receipt?.txHash || null,
        outcome: "receipt_confirmed",
      });
    } else {
      stillPending.push(entry);
    }
  }
  return {
    pending: stillPending,
    confirmed,
  };
}

export async function readPendingDispatches(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed?.pending) ? parsed.pending : Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function writePendingDispatches(path, pending) {
  return writeTextIfChanged(path, `${JSON.stringify({ schemaVersion: 1, pending: pending || [] }, null, 2)}\n`);
}
