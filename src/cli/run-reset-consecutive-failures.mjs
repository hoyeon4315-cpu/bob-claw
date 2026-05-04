#!/usr/bin/env node

import { appendSignerAuditRecord, buildConsecutiveFailureResetAuditRecord } from "../executor/signer/audit-log.mjs";

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    strategyId: null,
    chain: null,
    reason: null,
    actor: "operator_cli",
    rootDir: process.cwd(),
    json: false,
  };
  for (const value of argv) {
    if (value === "--json") args.json = true;
    else if (value.startsWith("--strategy=")) args.strategyId = value.slice("--strategy=".length);
    else if (value.startsWith("--chain=")) args.chain = value.slice("--chain=".length);
    else if (value.startsWith("--reason=")) args.reason = value.slice("--reason=".length);
    else if (value.startsWith("--actor=")) args.actor = value.slice("--actor=".length);
    else if (value.startsWith("--root-dir=")) args.rootDir = value.slice("--root-dir=".length);
  }
  return args;
}

export async function resetConsecutiveFailures({
  strategyId,
  chain = null,
  reason,
  actor = "operator_cli",
  rootDir = process.cwd(),
  now = new Date().toISOString(),
} = {}) {
  const record = buildConsecutiveFailureResetAuditRecord({
    strategyId,
    chain,
    reason,
    actor,
    observedAt: now,
  });
  const auditPath = await appendSignerAuditRecord(record, { rootDir });
  return {
    status: "ok",
    strategyId: record.strategyId,
    chain: record.chain,
    reason: record.lifecycle?.reason || null,
    actor: record.lifecycle?.actor || actor,
    resetScope: record.lifecycle?.resetScope || null,
    timestamp: record.timestamp,
    auditPath,
    auditRecord: record,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await resetConsecutiveFailures({
    strategyId: args.strategyId,
    chain: args.chain,
    reason: args.reason,
    actor: args.actor,
    rootDir: args.rootDir,
  });
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("run-reset-consecutive-failures.mjs")) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exit(1);
  });
}
