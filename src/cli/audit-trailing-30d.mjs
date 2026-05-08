#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { config } from "../config/env.mjs";

const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const FORBIDDEN_IDLE_ASSETS = new Set(["yo", "rlusd", "cbbtc", "native gas", "eth", "bnb", "avax", "bera", "sei", "s", "sonic"]);
const TRANSPORT_STRATEGY_IDS = new Set([
  "gateway_native_asset_conversion_sleeve",
  "gateway-route-infra",
  "gateway_transport",
  "transport",
  "btc-gateway-transport",
]);

function parseArgs(argv) {
  const parsed = {
    json: false,
    auditLogPath: join(process.cwd(), "logs", "signer-audit.jsonl"),
    merklQueuePath: join(config.dataDir, "merkl-canary-queue.json"),
  };
  for (const arg of argv) {
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg.startsWith("--audit-log-path=")) {
      parsed.auditLogPath = resolve(arg.slice("--audit-log-path=".length));
    } else if (arg.startsWith("--merkl-queue-path=")) {
      parsed.merklQueuePath = resolve(arg.slice("--merkl-queue-path=".length));
    }
  }
  return parsed;
}

async function readJsonIfExists(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonlIfExists(path) {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestampOf(record) {
  return record?.timestamp || record?.ts || record?.observedAt || record?.createdAt || record?.time || null;
}

function inWindow(record, startMs, endMs) {
  const ms = new Date(timestampOf(record) || 0).getTime();
  return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
}

function fieldText(record) {
  return [
    record?.strategyId,
    record?.family,
    record?.metadata?.family,
    record?.metadata?.strategyFamily,
    record?.metadata?.source,
    record?.stage,
    record?.lifecycleStage,
  ]
    .filter(Boolean)
    .map((item) => String(item).toLowerCase())
    .join(" ");
}

function blockersText(record) {
  const blockers = Array.isArray(record?.blockers)
    ? record.blockers
    : Array.isArray(record?.policy?.blockers)
      ? record.policy.blockers
      : Array.isArray(record?.reasons)
        ? record.reasons
        : [];
  return blockers.map((item) => String(item).toLowerCase()).join(" ");
}

function isIdleConsolidationPlanned(record) {
  return (
    record?.lifecycleStage === "idle_consolidation_planned" ||
    record?.stage === "idle_consolidation_planned" ||
    record?.auditStage === "idle_consolidation_planned"
  );
}

function candidatesOf(record) {
  if (Array.isArray(record?.candidates)) return record.candidates;
  if (Array.isArray(record?.plan?.candidates)) return record.plan.candidates;
  if (Array.isArray(record?.metadata?.candidates)) return record.metadata.candidates;
  return [];
}

function assetName(candidate) {
  return String(candidate?.asset || candidate?.symbol || candidate?.token || candidate?.srcAsset || candidate?.srcSymbol || "").trim();
}

function isForbiddenIdleAsset(candidate) {
  const normalized = assetName(candidate).toLowerCase();
  if (!normalized) return false;
  if (FORBIDDEN_IDLE_ASSETS.has(normalized)) return true;
  return normalized.includes("native gas") || normalized === "native";
}

function isApprovedBroadcast(record) {
  const verdict = String(record?.policyVerdict || record?.policy?.verdict || record?.verdict || "").toLowerCase();
  const stage = String(record?.stage || record?.lifecycleStage || "").toLowerCase();
  return (
    ["approved", "allow", "allowed"].includes(verdict) &&
    ["broadcast", "confirmed", "signed", "submitted", "receipt"].some((token) => stage.includes(token))
  );
}

function isTransportRecord(record) {
  const strategyId = String(record?.strategyId || "").toLowerCase();
  return TRANSPORT_STRATEGY_IDS.has(strategyId) || fieldText(record).includes("transport") || fieldText(record).includes("infrastructure");
}

function hasClampEvidence(record) {
  const cap = record?.capEvaluation || record?.metadata?.capEvaluation || record?.effectiveCaps || record?.caps || {};
  const perDay = finiteNumber(cap.effectivePerDayUsd ?? cap.perDayUsd);
  const loss = finiteNumber(cap.effectiveMaxDailyLossUsd ?? cap.maxDailyLossUsd);
  const clampText = String(cap.clamp || cap.source || record?.metadata?.capSource || "").toLowerCase();
  return (perDay === 200 && (loss === null || loss <= 100)) || clampText.includes("small_cap_transport");
}

function hasCapBlocker(record) {
  return /cap|perday|maxdailyloss|per-day|daily/.test(blockersText(record));
}

function isRejected(record) {
  return ["rejected", "reject", "blocked", "block", "deny", "denied"].includes(
    String(record?.policyVerdict || record?.policy?.verdict || record?.verdict || "").toLowerCase(),
  );
}

function merklBscQuotaFilled(records, merklCanaryQueue) {
  const quotaRows = [
    ...(Array.isArray(merklCanaryQueue?.chainQuotas) ? merklCanaryQueue.chainQuotas : []),
    ...(Array.isArray(merklCanaryQueue?.quotas) ? merklCanaryQueue.quotas : []),
  ];
  if (
    quotaRows.some((row) => String(row.chain).toLowerCase() === "bsc" && (finiteNumber(row.filled) ?? 0) >= (finiteNumber(row.required) ?? 1))
  ) {
    return true;
  }
  return records.some((record) => String(record?.chain || "").toLowerCase() === "bsc" && record?.quotaSlotFilled === true);
}

function buildForbiddenAssetAlert(records) {
  const examples = [];
  for (const record of records.filter(isIdleConsolidationPlanned)) {
    for (const candidate of candidatesOf(record)) {
      if (!isForbiddenIdleAsset(candidate)) continue;
      examples.push({
        timestamp: timestampOf(record),
        chain: candidate.chain || record.chain || null,
        asset: assetName(candidate),
        usd: finiteNumber(candidate.usd ?? candidate.usdValue ?? candidate.amountUsd),
      });
    }
  }
  return { alert: examples.length > 0, count: examples.length, examples: examples.slice(0, 5) };
}

function buildTransportClampFalsePositive(records) {
  const examples = records
    .filter((record) => isTransportRecord(record) && isRejected(record) && hasCapBlocker(record))
    .filter((record) => {
      const amount = finiteNumber(record.amountUsd ?? record.usd ?? record.intent?.amountUsd ?? record.metadata?.amountUsd);
      return amount === null || amount <= 200;
    })
    .map((record) => ({
      timestamp: timestampOf(record),
      strategyId: record.strategyId || null,
      amountUsd: finiteNumber(record.amountUsd ?? record.usd ?? record.intent?.amountUsd ?? record.metadata?.amountUsd),
      blockers: blockersText(record),
    }));
  return { alert: examples.length > 0, count: examples.length, examples: examples.slice(0, 5) };
}

function isConcentrationBlock(record) {
  const stage = String(record?.stage || record?.lifecycleStage || "").toLowerCase();
  const decision = String(record?.concentrationGuard?.decision || record?.concentration_guard?.decision || record?.decision || "").toLowerCase();
  return stage.includes("concentration") && ["block", "blocked"].includes(decision);
}

function buildConcentrationRetry(records) {
  const sorted = [...records].sort((a, b) => new Date(timestampOf(a) || 0) - new Date(timestampOf(b) || 0));
  const examples = [];
  for (const block of sorted.filter(isConcentrationBlock)) {
    const blockMs = new Date(timestampOf(block) || 0).getTime();
    const retry = sorted.find((record) => {
      if (record === block) return false;
      const recordMs = new Date(timestampOf(record) || 0).getTime();
      return (
        recordMs > blockMs &&
        recordMs - blockMs <= 24 * 60 * 60 * 1000 &&
        String(record.strategyId || "") === String(block.strategyId || "") &&
        String(record.chain || "") === String(block.chain || "") &&
        (isApprovedBroadcast(record) || String(record?.policyVerdict || "").toLowerCase() === "approved")
      );
    });
    if (retry) {
      examples.push({
        blockedAt: timestampOf(block),
        retriedAt: timestampOf(retry),
        strategyId: block.strategyId || null,
        chain: block.chain || null,
      });
    }
  }
  return { alert: examples.length > 0, count: examples.length, examples: examples.slice(0, 5) };
}

function isMerklBscAttempt(record) {
  return (
    String(record?.chain || "").toLowerCase() === "bsc" &&
    (fieldText(record).includes("merkl") || String(record?.metadata?.source || "").toLowerCase() === "merkl")
  );
}

function isEvReject(record) {
  return isRejected(record) && /ev|expected.?net|expected realized net|pnl after costs|cost/.test(blockersText(record));
}

function buildMerklEvRejectRatio(records, quotaFilled) {
  const attempts = records.filter(isMerklBscAttempt).filter((record) => record.policyVerdict || record.verdict || record.policy?.verdict);
  const rejected = attempts.filter(isEvReject);
  const ratio = attempts.length > 0 ? rejected.length / attempts.length : 0;
  return {
    alert: quotaFilled && attempts.length > 0 && ratio === 1,
    attempts: attempts.length,
    rejected: rejected.length,
    ratio,
  };
}

export function buildTrailing30dAudit({ now = new Date().toISOString(), auditRecords = [], merklCanaryQueue = {} } = {}) {
  const endMs = new Date(now).getTime();
  const startMs = endMs - WINDOW_DAYS * DAY_MS;
  const records = auditRecords.filter((record) => inWindow(record, startMs, endMs));
  const quotaFilled = merklBscQuotaFilled(records, merklCanaryQueue);
  const positive = {
    confirmedBroadcastCount30d: records.filter(isApprovedBroadcast).length,
    idleConsolidationPlannedCount30d: records.filter(isIdleConsolidationPlanned).length,
    transportClampObservedCount30d: records.filter((record) => isTransportRecord(record) && hasClampEvidence(record)).length,
    merklBscQuotaFilled: quotaFilled,
  };
  const negative = {
    idleDispatchForbiddenAssetAlert: buildForbiddenAssetAlert(records),
    transportClampFalsePositive: buildTransportClampFalsePositive(records),
    concentrationBlockEvasionRetry: buildConcentrationRetry(records),
    merklQuotaFilledEvAllRejectRatio: buildMerklEvRejectRatio(records, quotaFilled),
  };
  return {
    schemaVersion: 1,
    observedAt: now,
    readOnly: true,
    window: {
      days: WINDOW_DAYS,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      recordsScanned: records.length,
    },
    positive,
    negative,
    recommendations: [
      "Investigate any forbidden idle-dispatch asset before the next autopilot tick.",
      "Review transport clamp false positives against effective lookup caps, leaving nominal registry caps unchanged.",
      "Review concentration retries and Merkl EV inputs; do not auto-change caps or strategy config from this report.",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [auditRecords, merklCanaryQueue] = await Promise.all([
    readJsonlIfExists(args.auditLogPath),
    readJsonIfExists(args.merklQueuePath, {}),
  ]);
  const audit = buildTrailing30dAudit({ auditRecords, merklCanaryQueue });
  if (args.json) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }
  console.log(`trailing-30d-audit: records=${audit.window.recordsScanned}`);
  console.log(JSON.stringify({ positive: audit.positive, negative: audit.negative }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
