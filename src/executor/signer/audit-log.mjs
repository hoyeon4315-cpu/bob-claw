import { createHash } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stableSerialize } from "../../execution/journal.mjs";
import {
  CONSECUTIVE_FAILURE_RESET_INTENT_TYPE,
  CONSECUTIVE_FAILURE_RESET_STAGE,
} from "../policy/consecutive-failures.mjs";

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
      metadata: intent.metadata || null,
      ...(intent.approval ? { approval: intent.approval } : {}),
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

export function buildConsecutiveFailureResetAuditRecord({
  strategyId,
  chain = null,
  reason,
  actor = "operator_cli",
  observedAt = new Date().toISOString(),
} = {}) {
  const normalizedStrategyId = typeof strategyId === "string" ? strategyId.trim() : "";
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  if (!normalizedStrategyId) {
    throw new Error("strategyId is required");
  }
  if (!normalizedReason) {
    throw new Error("reason is required");
  }
  const normalizedChain = typeof chain === "string" && chain.trim() ? chain.trim() : null;
  const resetScope = normalizedChain ? "strategy_chain" : "strategy_all_chains";
  return buildSignerAuditRecord({
    intent: {
      strategyId: normalizedStrategyId,
      chain: normalizedChain,
      intentId: `consecutive-failure-reset:${normalizedStrategyId}:${normalizedChain || "*"}:${observedAt}`,
      intentType: CONSECUTIVE_FAILURE_RESET_INTENT_TYPE,
      amountUsd: 0,
      mode: "operator",
      metadata: {
        actor,
        reason: normalizedReason,
        resetScope,
      },
    },
    policyVerdict: "approved",
    lifecycle: {
      stage: CONSECUTIVE_FAILURE_RESET_STAGE,
      actor,
      reason: normalizedReason,
      resetScope,
    },
    observedAt,
  });
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
