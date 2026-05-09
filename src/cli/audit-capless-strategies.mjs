#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strategyIdsFromCaplessBlockers(blockerFunnel = {}) {
  const ids = new Set();
  for (const group of blockerFunnel.rootCauseGroups || []) {
    if (group.code !== "hard_safety_stop:capless_strategy") continue;
    const strategyIds = group.affectedStrategies?.length ? group.affectedStrategies : [group.params?.strategyId];
    for (const strategyId of strategyIds) {
      if (strategyId) ids.add(strategyId);
    }
  }
  for (const row of blockerFunnel.strategies || []) {
    if (row.code === "hard_safety_stop:capless_strategy" && row.strategyId) ids.add(row.strategyId);
  }
  return [...ids].sort();
}

function receiptsForStrategy(receiptRecords = [], strategyId) {
  return (receiptRecords || []).filter((record) => record.strategyId === strategyId || record.metadata?.strategyId === strategyId);
}

function inferCapsFromReceipts(receipts = []) {
  const amounts = receipts
    .map((record) => finiteNumber(record.amountUsd) ?? finiteNumber(record.notionalUsd) ?? finiteNumber(record.intent?.amountUsd))
    .filter((value) => value !== null && value > 0);
  if (amounts.length < 2) return null;
  const max = Math.max(...amounts);
  return {
    perTxUsd: Math.ceil(max),
    perDayUsd: Math.ceil(max * 3),
    perChainUsd: Math.ceil(max * 3),
    maxDailyLossUsd: Math.max(5, Math.ceil(max * 0.2)),
    sampleCount: amounts.length,
  };
}

function capBooleans(strategy = null) {
  const caps = strategy?.caps || {};
  return {
    hasPerTxCap: finiteNumber(caps.perTxUsd) !== null,
    hasPerDayCap: finiteNumber(caps.perDayUsd) !== null,
    hasMaxDailyLossUsd: finiteNumber(caps.maxDailyLossUsd) !== null,
    hasPerChainCap: Object.values(caps.perChainUsd || {}).some((value) => finiteNumber(value) !== null),
  };
}

function recommendedAction({ booleans, inferred }) {
  if (booleans.hasPerTxCap && booleans.hasPerDayCap && booleans.hasMaxDailyLossUsd && booleans.hasPerChainCap) {
    return "declare_cap_in_committed_diff";
  }
  if (inferred) return "declare_cap_in_committed_diff";
  return "needs_evidence_first";
}

export function auditCaplessStrategies({
  blockerFunnel = {},
  strategyCapsById = {},
  receiptRecords = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const rows = strategyIdsFromCaplessBlockers(blockerFunnel).map((strategyId) => {
    const strategy = strategyCapsById[strategyId] || null;
    const booleans = capBooleans(strategy);
    const receipts = receiptsForStrategy(receiptRecords, strategyId);
    const inferred = inferCapsFromReceipts(receipts);
    const action = recommendedAction({ booleans, inferred });
    return {
      strategyId,
      ...booleans,
      inferredCapFromObservedReceipts: inferred,
      recommendedAction: action,
      rationale:
        action === "declare_cap_in_committed_diff"
          ? "Cap blocker is present; declare or repair committed caps without runtime mutation."
          : "Cap blocker lacks enough receipt evidence for a deterministic suggested cap.",
    };
  });
  return {
    schemaVersion: 1,
    generatedAt,
    rows,
    summary: {
      caplessStrategyCount: rows.length,
      declareCapCount: rows.filter((row) => row.recommendedAction === "declare_cap_in_committed_diff").length,
      needsEvidenceCount: rows.filter((row) => row.recommendedAction === "needs_evidence_first").length,
      deprecateCount: rows.filter((row) => row.recommendedAction === "deprecate_strategy").length,
    },
  };
}

export async function runCaplessAuditCli(
  argv = process.argv.slice(2),
  {
    cwd = process.cwd(),
    dataDir = config.dataDir,
    dashboardDir = join(cwd, "dashboard", "public"),
    now = new Date().toISOString(),
  } = {},
) {
  const args = { json: hasFlag(argv, "--json") };
  const blockerFunnel = await readJsonIfExists(join(dashboardDir, "blocker-funnel.json")) || {};
  const receiptRecords = await readJsonl(resolve(cwd, dataDir), "receipt-reconciliations").catch(() => []);
  const strategyCapsById = Object.fromEntries(listStrategyCaps({ includeInactive: true }).map((strategy) => [strategy.strategyId, strategy]));
  const payload = auditCaplessStrategies({
    blockerFunnel,
    strategyCapsById,
    receiptRecords,
    generatedAt: now,
  });
  await writeTextIfChanged(join(resolve(cwd, dataDir), "capless-strategy-audit.json"), `${JSON.stringify(payload, null, 2)}\n`);
  const stdout = args.json
    ? `${JSON.stringify(payload, null, 2)}\n`
    : [
        `generatedAt=${payload.generatedAt}`,
        `caplessStrategyCount=${payload.summary.caplessStrategyCount}`,
        `declareCapCount=${payload.summary.declareCapCount}`,
        `needsEvidenceCount=${payload.summary.needsEvidenceCount}`,
      ].join("\n") + "\n";
  return { exitCode: 0, stdout, stderr: "", payload };
}

if (IS_MAIN) {
  runCaplessAuditCli().then((result) => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
