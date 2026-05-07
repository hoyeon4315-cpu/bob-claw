#!/usr/bin/env node
// Dev-lane helper: preview which candidate evidence files clear the
// deterministic auto-promotion guard used by coding-session LLM commits.
//
// Prints a deterministic JSON report. Does not edit configs, does not open
// PRs, and never reads signer receipts as promotion authority. Live execution
// remains owned by committed caps + policy + signer approval per AGENTS.md.
//
// Usage:
//   node src/cli/promotion-pr-preview.mjs                         # all autoExecute:false caps
//   node src/cli/promotion-pr-preview.mjs --strategy=<id>          # single strategy
//   node src/cli/promotion-pr-preview.mjs --evidence=<path>        # JSON object or array
//   node src/cli/promotion-pr-preview.mjs --evidence-dir=<path>    # *.json evidence files

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateAutoPromotion } from "../executor/auto-promotion-gate.mjs";
import { buildAutoPromotionConfig } from "../config/auto-promotion.mjs";
import { STRATEGY_CAPS } from "../config/strategy-caps.mjs";

function parseArgs(argv) {
  const out = { evidence: [] };
  for (const a of argv) {
    if (a.startsWith("--strategy=")) out.strategy = a.split("=")[1];
    else if (a.startsWith("--evidence=")) out.evidence.push(a.split("=")[1]);
    else if (a.startsWith("--evidence-dir=")) out.evidenceDir = a.split("=")[1];
    else if (a.startsWith("--write=")) out.write = a.split("=")[1];
    else if (a === "--quiet") out.quiet = true;
    // Deprecated compatibility flags retained so scheduled report commands do
    // not fail while their artifact name is migrated.
    else if (a.startsWith("--lookback-days=")) out.lookbackDays = Number(a.split("=")[1]);
    else if (a.startsWith("--audit=")) out.audit = a.split("=")[1];
  }
  return out;
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadEvidenceRecords(paths = []) {
  const records = [];
  for (const rawPath of paths) {
    const path = resolve(rawPath);
    if (!existsSync(path)) continue;
    const parsed = readJsonFile(path);
    if (Array.isArray(parsed)) records.push(...parsed);
    else if (parsed && typeof parsed === "object") records.push(parsed);
  }
  return records;
}

export function loadEvidenceRecordsFromDir(path) {
  if (!path || !existsSync(path)) return [];
  const dir = resolve(path);
  return loadEvidenceRecords(
    readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(dir, name)),
  );
}

export function buildAutoPromotionPreviewReport({
  evidenceRecords = [],
  nowMs,
  strategyIds,
  config = buildAutoPromotionConfig(),
} = {}) {
  const evidenceByStrategy = new Map();
  for (const evidence of evidenceRecords) {
    if (evidence?.strategyId && typeof evidence.strategyId === "string") {
      evidenceByStrategy.set(evidence.strategyId, evidence);
    }
  }
  const reports = strategyIds.map((strategyId) => {
    const evidence = evidenceByStrategy.get(strategyId) || { strategyId };
    const result = evaluateAutoPromotion(evidence, config);
    return {
      strategyId,
      passed: result.passed,
      eligible: result.passed,
      evidenceProvided: evidenceByStrategy.has(strategyId),
      blockers: result.blockers,
      evaluated: result.evaluated,
      initialCanaryCaps: result.initialCanaryCaps,
    };
  });
  const passedCount = reports.filter((report) => report.passed).length;
  const blockedCount = reports.length - passedCount;
  return {
    generatedAt: new Date(nowMs).toISOString(),
    schemaVersion: 2,
    source: "auto_promotion_evidence",
    advisoryOnly: true,
    deprecatedReceiptPromotion: false,
    summary: {
      strategyCount: reports.length,
      passedCount,
      eligibleCount: passedCount,
      blockedCount,
      evidenceProvidedCount: reports.filter((report) => report.evidenceProvided).length,
    },
    reports,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const knownIds = Object.keys(STRATEGY_CAPS);
  const knownAutoFalse = knownIds.filter((id) => STRATEGY_CAPS[id].autoExecute === false);
  const ids = args.strategy
    ? [args.strategy]
    : knownAutoFalse;
  const evidenceRecords = [
    ...loadEvidenceRecords(args.evidence),
    ...loadEvidenceRecordsFromDir(args.evidenceDir),
  ];
  const report = buildAutoPromotionPreviewReport({
    evidenceRecords,
    nowMs: Date.now(),
    strategyIds: ids,
  });
  if (args.write) {
    const target = resolve(args.write);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2) + "\n");
  }
  if (!args.quiet) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
