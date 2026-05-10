import { readJsonl } from "../../lib/jsonl-read.mjs";

export async function loadCapitalAuditRecords(baseDir) {
  try {
    return await readJsonl(baseDir, "capital-audit-pairs");
  } catch {
    return [];
  }
}

export function isCapitalAuditClosedForIntent({ intentHash, strategyId, capitalAuditRecords = [] }) {
  if (!intentHash) return false;
  return capitalAuditRecords.some(
    (record) => record.intentHash === intentHash && record.strategyId === strategyId,
  );
}

export function canMarkVerifiedCurrent({ intentHash, strategyId, capitalAuditRecords = [] }) {
  if (!intentHash || !strategyId) return false;
  return isCapitalAuditClosedForIntent({ intentHash, strategyId, capitalAuditRecords });
}
