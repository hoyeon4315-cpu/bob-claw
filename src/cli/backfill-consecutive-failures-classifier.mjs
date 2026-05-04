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
  const grouped = new Map();
  
  for (const record of auditRecords) {
    if (!record.strategyId) continue;
    const chain = record.chain || record.intent?.chain || null;
    const key = `${record.strategyId}:${chain || "*"}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(record);
  }
  
  // For each group, check if broadcastFailed count is 0 (should not be paused)
  // and the latest record is not already a reset
  for (const [key, records] of grouped) {
    const [strategyId, chainPart] = key.split(":");
    const chain = chainPart === "*" ? null : chainPart;
    
    // Use latestClassifiedRecords with proper filters to respect sequence order
    const classified = latestClassifiedRecords(records, { strategyId, chain });
    const failureCount = countConsecutiveBroadcastFailures(classified);
    
    // Skip reset if the latest record is already a reset (idempotency)
    const latestIsReset = classified.length > 0 && classified[0].classification === "reset";
    
    if (!latestIsReset && failureCount.count === 0) {
      strategiesNeedingReset.push({
        strategyId,
        chain,
        broadcastFailedCount: 0,
        recordCount: records.length,
        classification: "should_not_be_paused",
      });
    }
  }
  
  if (execute && strategiesNeedingReset.length > 0) {
    const resetResults = [];
    for (const strategy of strategiesNeedingReset) {
      const result = await resetConsecutiveFailures({
        strategyId: strategy.strategyId,
        chain: strategy.chain,
        reason: "parcel-9-backfill-from-corrected-classifier",
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
    };
  } else {
    return {
      status: "preview",
      strategiesNeedingReset: strategiesNeedingReset.length,
      summary: strategiesNeedingReset,
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
