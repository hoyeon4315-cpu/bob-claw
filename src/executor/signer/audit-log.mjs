import { createHash } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stableSerialize } from "../../execution/journal.mjs";

export const DEFAULT_SIGNER_AUDIT_PATH = join("logs", "signer-audit.jsonl");

export function signerAuditPath(rootDir = process.cwd()) {
  return join(rootDir, DEFAULT_SIGNER_AUDIT_PATH);
}

export function buildSignerAuditRecord({
  intent,
  policyVerdict,
  lifecycle,
  broadcast = null,
  realized = null,
  error = null,
  observedAt = new Date().toISOString(),
} = {}) {
  const intentHash = createHash("sha256").update(stableSerialize(intent)).digest("hex");
  return {
    schemaVersion: 1,
    timestamp: observedAt,
    strategyId: intent.strategyId,
    chain: intent.chain,
    intentId: intent.intentId,
    intentHash,
    intent: {
      intentType: intent.intentType,
      amountUsd: intent.amountUsd,
      mode: intent.mode,
    },
    amountUsd: intent.amountUsd,
    policyVerdict,
    lifecycle,
    broadcast,
    realized,
    error: error
      ? {
          name: error.name,
          message: error.message,
        }
      : null,
  };
}

export async function appendSignerAuditRecord(record, { rootDir = process.cwd() } = {}) {
  const path = signerAuditPath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
  return path;
}

export async function readSignerAuditLog({ rootDir = process.cwd() } = {}) {
  const path = signerAuditPath(rootDir);
  try {
    const contents = await readFile(path, "utf8");
    return contents
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
