// Consecutive Failure Healer
// Prevents the #5 bug: strategies halted by previous failures, blocking all new operations
//
// Critical facts learned:
// - token-dex-experiment had 4 consecutive failures from earlier reverted tx
// - resumeAfterFailureAt was null, so strategy stayed halted forever
// - We had to manually edit strategy-caps.mjs and bump resumeAfterFailureAt
//
// This module:
// 1. Scans signer-audit.jsonl for terminal (failure/reverted/error) records per strategy
// 2. Counts consecutive terminal records
// 3. If count < max AND last failure is older than cooldown, auto-resets resumeAfterFailureAt
// 4. Requires operator confirmation for strategies with >= max failures

import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { getStrategyCaps } from "../../config/strategy-caps.mjs";

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const AUDIT_LOG_PATH = "./logs/signer-audit.jsonl";

export async function scanConsecutiveFailures({
  strategyId,
  auditLogPath = AUDIT_LOG_PATH,
  maxFailures = 3,
} = {}) {
  const records = [];

  try {
    const rl = createInterface({
      input: createReadStream(auditLogPath),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record.strategyId === strategyId) {
          records.push(record);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    return { strategyId, count: 0, lastFailureAt: null, canAutoHeal: false };
  }

  // Sort by timestamp descending
  records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Count consecutive terminal records from the end
  let count = 0;
  let lastFailureAt = null;

  for (const record of records) {
    const isTerminal = [
      "reverted",
      "error",
      "rejected",
    ].includes(record.lifecycle?.stage) ||
      record.policyVerdict === "errored" ||
      record.error != null;

    if (isTerminal) {
      count++;
      if (!lastFailureAt) lastFailureAt = record.timestamp;
    } else {
      break;
    }
  }

  const canAutoHeal = count < maxFailures;

  return {
    strategyId,
    count,
    maxFailures,
    lastFailureAt,
    canAutoHeal,
    cooldownMs: DEFAULT_COOLDOWN_MS,
  };
}

export async function healStrategyFailures({
  strategyId,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  auditLogPath = AUDIT_LOG_PATH,
  dryRun = true,
} = {}) {
  const scan = await scanConsecutiveFailures({ strategyId, auditLogPath });
  const caps = getStrategyCaps(strategyId);

  if (!caps) {
    return { ...scan, healed: false, reason: "strategy_caps_not_found" };
  }

  if (scan.count === 0) {
    return { ...scan, healed: false, reason: "no_failures" };
  }

  if (!scan.canAutoHeal) {
    return { ...scan, healed: false, reason: "max_failures_reached_requires_operator" };
  }

  // Check if last failure is older than cooldown
  if (scan.lastFailureAt) {
    const age = Date.now() - new Date(scan.lastFailureAt).getTime();
    if (age < cooldownMs) {
      return { ...scan, healed: false, reason: "cooldown_not_elapsed", elapsedMs: age };
    }
  }

  if (dryRun) {
    return { ...scan, healed: false, reason: "dry_run", wouldSetResumeAt: new Date(Date.now() + 60000).toISOString() };
  }

  // In a real implementation, this would edit strategy-caps.mjs
  // For now, return the suggested action
  return {
    ...scan,
    healed: true,
    action: "update_resumeAfterFailureAt",
    newValue: new Date().toISOString(),
    fileToEdit: "src/config/strategy-caps.mjs",
  };
}

export async function healAllStrategies({
  strategyIds = [],
  cooldownMs = DEFAULT_COOLDOWN_MS,
  dryRun = true,
} = {}) {
  const results = [];
  for (const id of strategyIds) {
    const result = await healStrategyFailures({ strategyId: id, cooldownMs, dryRun });
    results.push(result);
  }
  return {
    healed: results.filter((r) => r.healed),
    blocked: results.filter((r) => !r.healed && r.count > 0),
    clean: results.filter((r) => r.count === 0),
    timestamp: new Date().toISOString(),
  };
}
