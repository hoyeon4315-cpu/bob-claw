#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { readFileSync } from "fs";
import { resetConsecutiveFailures } from "./run-reset-consecutive-failures.mjs";
import {
  classifyConsecutiveFailureRecord,
  countConsecutiveBroadcastFailures,
  latestClassifiedRecords,
} from "../executor/policy/consecutive-failures.mjs";

function uniqueBlockers(record = {}) {
  return [
    record.blockers,
    record.policyBlockers,
    record.lifecycle?.blockers,
    record.policy?.blockers,
  ]
    .filter(Array.isArray)
    .flat()
    .filter((item, index, items) => typeof item === "string" && item.length > 0 && items.indexOf(item) === index);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    auditPath: null,
    execute: false,
    rootDir: process.cwd(),
    json: false,
    dryRun: true,
  };
  for (const value of argv) {
    if (value === "--json") args.json = true;
    else if (value === "--execute") {
      args.execute = true;
      args.dryRun = false;
    }
    else if (value.startsWith("--audit-path=")) args.auditPath = value.slice("--audit-path=".length);
    else if (value.startsWith("--root-dir=")) args.rootDir = value.slice("--root-dir=".length);
  }
  return args;
}

function readAuditLines(auditPath) {
  try {
    const content = readFileSync(auditPath, "utf-8");
    return content
      .split("\n")
      .map((line) => {
        if (!line.trim()) return null;
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((item) => item !== null);
  } catch (error) {
    throw new Error(`Failed to read audit log: ${error?.message || error}`);
  }
}

export async function backfillConsecutiveFailuresClassifier({
  auditPath,
  execute = false,
  rootDir = process.cwd(),
  now = new Date().toISOString(),
} = {}) {
  const resolvedAuditPath = auditPath || path.join(rootDir, "logs/signer-audit.jsonl");
  
  if (!fs.existsSync(resolvedAuditPath)) {
    throw new Error(`Audit log not found: ${resolvedAuditPath}`);
  }

  const auditRecords = readAuditLines(resolvedAuditPath);
  
  // Group by (strategyId, chain) and compute the true broadcastFailed count
  const strategiesNeedingReset = [];
  const replayedCounts = [];
  const grouped = new Map();
  
  for (const record of auditRecords) {
    if (!record.strategyId) continue;
    const chain = record.chain || record.intent?.chain || null;
    const key = JSON.stringify([record.strategyId, chain]);
    if (!grouped.has(key)) {
      grouped.set(key, { strategyId: record.strategyId, chain, records: [] });
    }
    grouped.get(key).records.push(record);
  }
  
  // For each group, check whether a currently paused scope has no true
  // broadcast failures under the corrected classifier.
  for (const group of grouped.values()) {
    const { strategyId, chain, records } = group;

    // Use latestClassifiedRecords with proper filters to respect sequence order
    const classified = latestClassifiedRecords(records, { strategyId, chain });
    const failureCount = countConsecutiveBroadcastFailures(classified);
    const classifiedCounts = classified.reduce(
      (counts, item) => {
        counts[item.classification] = (counts[item.classification] || 0) + 1;
        return counts;
      },
      {
        broadcastFailed: 0,
        broadcastSucceeded: 0,
        policyRejected: 0,
        noTxFailure: 0,
        reset: 0,
      },
    );
    const hasMaxConsecutiveFailureBlocker = records.some((record) =>
      uniqueBlockers(record).includes("max_consecutive_failures_reached")
    );

    // Skip reset if the latest record is already a reset (idempotency)
    const latestIsReset = classified.length > 0 && classified[0].classification === "reset";
    const needsReset = hasMaxConsecutiveFailureBlocker && !latestIsReset && failureCount.count === 0;
    const replay = {
      strategyId,
      chain,
      consecutiveBroadcastFailures: failureCount.count,
      broadcastFailedCount: classifiedCounts.broadcastFailed,
      successfulBroadcastCount: classifiedCounts.broadcastSucceeded,
      policyRejectedCount: classifiedCounts.policyRejected,
      noTxFailureCount: classifiedCounts.noTxFailure,
      resetCount: classifiedCounts.reset,
      terminalRecordCount: classified.filter((item) =>
        ["broadcastFailed", "broadcastSucceeded", "reset"].includes(item.classification)
      ).length,
      lastTerminalStatus: classified[0]?.classification || null,
      latestFailureAt: failureCount.latestFailureAt,
      hasMaxConsecutiveFailureBlocker,
      latestIsReset,
      needsReset,
      recordCount: records.length,
    };
    replayedCounts.push(replay);

    if (needsReset) strategiesNeedingReset.push(replay);
  }
  replayedCounts.sort((left, right) =>
    `${left.strategyId}:${left.chain || ""}`.localeCompare(`${right.strategyId}:${right.chain || ""}`)
  );
  strategiesNeedingReset.sort((left, right) =>
    `${left.strategyId}:${left.chain || ""}`.localeCompare(`${right.strategyId}:${right.chain || ""}`)
  );
  
  if (execute && strategiesNeedingReset.length > 0) {
    const resetResults = [];
    for (const strategy of strategiesNeedingReset) {
      const result = await resetConsecutiveFailures({
        strategyId: strategy.strategyId,
        chain: strategy.chain,
        reason: "parcel-9 backfill from corrected classifier",
        actor: "parcel9_backfill",
        rootDir,
        now,
      });
      resetResults.push(result);
    }
    return {
      status: "executed",
      strategiesReset: strategiesNeedingReset.length,
      resetResults,
      summary: strategiesNeedingReset,
      replayedCounts,
    };
  } else {
    return {
      status: "preview",
      strategiesNeedingReset: strategiesNeedingReset.length,
      summary: strategiesNeedingReset,
      replayedCounts,
      message: "Run with --execute to apply resets",
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await backfillConsecutiveFailuresClassifier({
    auditPath: args.auditPath,
    execute: args.execute,
    rootDir: args.rootDir,
  });
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("backfill-consecutive-failures-classifier.mjs")) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exit(1);
  });
}
