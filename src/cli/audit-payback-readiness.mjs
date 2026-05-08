#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { config, getEnv } from "../config/env.mjs";
import { PAYBACK_CONFIG } from "../config/payback.mjs";
import { buildPaybackDecision, loadPaybackPolicyConfig } from "../executor/payback/scheduler.mjs";

const DEFAULT_MARKET_STATE_PATH = join(config.dataDir, "payback-market-state.json");
const DEFAULT_RISK_STATE_PATH = join(config.dataDir, "payback-risk-state.json");
const DEFAULT_RESERVE_STATE_PATH = join(config.dataDir, "payback-reserve-state.json");
const DEFAULT_RECEIPT_STORE_PATH = join(config.dataDir, "payback-receipt-store.json");
const DEFAULT_AUDIT_LOG_PATH = join(process.cwd(), "logs", "signer-audit.jsonl");

function parseArgs(argv) {
  const parsed = {
    json: false,
    marketStatePath: DEFAULT_MARKET_STATE_PATH,
    riskStatePath: DEFAULT_RISK_STATE_PATH,
    reserveStatePath: DEFAULT_RESERVE_STATE_PATH,
    receiptStorePath: DEFAULT_RECEIPT_STORE_PATH,
    auditLogPath: DEFAULT_AUDIT_LOG_PATH,
  };
  for (const arg of argv) {
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg.startsWith("--market-state-path=")) {
      parsed.marketStatePath = resolve(arg.slice("--market-state-path=".length));
    } else if (arg.startsWith("--risk-state-path=")) {
      parsed.riskStatePath = resolve(arg.slice("--risk-state-path=".length));
    } else if (arg.startsWith("--reserve-state-path=")) {
      parsed.reserveStatePath = resolve(arg.slice("--reserve-state-path=".length));
    } else if (arg.startsWith("--receipt-store-path=")) {
      parsed.receiptStorePath = resolve(arg.slice("--receipt-store-path=".length));
    } else if (arg.startsWith("--audit-log-path=")) {
      parsed.auditLogPath = resolve(arg.slice("--audit-log-path=".length));
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

function decisionTargetSats(decision) {
  return (
    finiteNumber(decision.decisionLog?.applied?.grossTargetBeforeCostsSats) ??
    finiteNumber(decision.decisionLog?.inputs?.grossTargetBeforeCostsSats) ??
    0
  );
}

function buildCurrentConditions(decision, policy) {
  const grossTargetBeforeCostsSats = decisionTargetSats(decision);
  const reserveNeeded = grossTargetBeforeCostsSats >= policy.minPaybackSats;
  return [
    {
      id: "destination_configured",
      ok: decision.reason !== "missing_destination_config",
      observed: {
        env: policy.destinationPath.bitcoinDestAddressEnv,
        underlyingReason: decision.decisionLog?.inputs?.underlyingReason || null,
      },
    },
    {
      id: "profit_target_clears_minimum",
      ok: grossTargetBeforeCostsSats >= policy.minPaybackSats,
      observed: {
        grossTargetBeforeCostsSats,
        minPaybackSats: policy.minPaybackSats,
        reason: decision.reason,
      },
    },
    {
      id: "reserve_asset_available_when_needed",
      ok: !reserveNeeded || decision.reason !== "reserve_asset_missing",
      observed: {
        reserveNeeded,
        reserveState: decision.reserveState || null,
        reason: decision.reason,
      },
    },
    {
      id: "emergency_pause_clear",
      ok: decision.status !== "paused" && decision.decisionLog?.reason !== "emergency_pause",
      observed: {
        paused: decision.status === "paused",
        reasons: decision.decisionLog?.emergencyPause?.reasons || [],
      },
    },
  ];
}

function buildLifetimeZeroTrace(decision) {
  const paidBackSatsLifetime = finiteNumber(decision.snapshot?.paidBackSats_lifetime) ?? 0;
  const reason = String(decision.reason || decision.decisionLog?.reason || "");
  const grossProfitSatsPeriod =
    finiteNumber(decision.snapshot?.grossProfitSats_period) ??
    finiteNumber(decision.decisionLog?.inputs?.grossProfitSatsPeriod) ??
    0;
  const bucketSeed = (count, matchedReason = null) => ({ count, matchedReason });
  return {
    paidBackSatsLifetime,
    status: paidBackSatsLifetime === 0 ? "zero_lifetime_payback" : "payback_observed",
    buckets: {
      profitZero: bucketSeed(grossProfitSatsPeriod <= 0 || reason === "non_positive_payback_target" ? 1 : 0, reason || null),
      plannedBelowMinimum: bucketSeed(reason === "planned_payback_below_minimum" ? 1 : 0, reason || null),
      costRatio: bucketSeed(reason.includes("cost") || reason.includes("offramp") ? 1 : 0, reason || null),
      emergencyPause: bucketSeed(decision.status === "paused" || decision.decisionLog?.reason === "emergency_pause" ? 1 : 0, reason || null),
    },
  };
}

function appliedMultiplier(decision, key, fallback) {
  return (
    finiteNumber(decision.decisionLog?.applied?.[key]) ??
    finiteNumber(decision.decisionLog?.inputs?.[key]) ??
    fallback
  );
}

function buildDataSources(decision, policy, marketState, riskState) {
  const regime = decision.decisionLog?.applied?.regime || decision.decisionLog?.inputs?.regime || marketState.regime || riskState.regime || "neutral";
  const volAnnualized =
    finiteNumber(decision.decisionLog?.applied?.volAnnualized) ??
    finiteNumber(decision.decisionLog?.inputs?.volAnnualized) ??
    finiteNumber(marketState.realizedVolAnnualized) ??
    finiteNumber(riskState.realizedVolAnnualized) ??
    null;
  return {
    regimeMultiplier: {
      configSourcePath: "src/config/payback.mjs",
      codeTrace: "src/executor/payback/scheduler.mjs:resolveRegimeMultiplier",
      runtimeSourcePath: marketState.regimeSourcePath || riskState.regimeSourcePath || null,
      runtimeValue: regime,
      actualValue: appliedMultiplier(decision, "regimeMultiplier", policy.regimeMultipliers[regime] ?? 1),
    },
    volMultiplier: {
      configSourcePath: "src/config/payback.mjs",
      codeTrace: "src/executor/payback/scheduler.mjs:resolveVolMultiplier",
      runtimeSourcePath: marketState.realizedVolSourcePath || riskState.realizedVolSourcePath || null,
      runtimeValue: volAnnualized,
      actualValue: appliedMultiplier(decision, "volMultiplier", policy.volMultiplier.cap),
      source: volAnnualized && volAnnualized > 0 ? "realized_vol_annualized" : "cap_default",
    },
  };
}

export async function buildPaybackReadinessAudit({
  auditLogLines = [],
  receiptStore = {},
  reserveState = null,
  paybackConfig = PAYBACK_CONFIG,
  now = new Date().toISOString(),
  marketState = {},
  riskState = {},
  accumulatorSnapshot,
  getEnvImpl = getEnv,
  recipientOverride = null,
} = {}) {
  const decision = await buildPaybackDecision({
    auditLogLines,
    receiptStore,
    reserveState,
    paybackConfig,
    now,
    marketState,
    riskState,
    accumulatorSnapshot,
    getEnvImpl,
    recipientOverride,
  });
  const policy = loadPaybackPolicyConfig(paybackConfig);
  return {
    schemaVersion: 1,
    observedAt: now,
    readOnly: true,
    decision: {
      status: decision.status,
      reason: decision.reason,
      observedAt: decision.observedAt,
      grossTargetBeforeCostsSats: decisionTargetSats(decision),
    },
    currentConditions: buildCurrentConditions(decision, policy),
    lifetimeZeroTrace: buildLifetimeZeroTrace(decision),
    dataSources: buildDataSources(decision, policy, marketState, riskState),
    recommendations: [
      "Keep payback policy deterministic; inspect the failing condition or missing source before any runtime action.",
      "Do not change caps, ratios, timing, or trigger logic from this audit surface.",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [marketState, riskState, reserveState, receiptStore, auditLogLines] = await Promise.all([
    readJsonIfExists(args.marketStatePath, {}),
    readJsonIfExists(args.riskStatePath, {}),
    readJsonIfExists(args.reserveStatePath, null),
    readJsonIfExists(args.receiptStorePath, {}),
    readJsonlIfExists(args.auditLogPath),
  ]);
  const audit = await buildPaybackReadinessAudit({
    auditLogLines,
    receiptStore,
    reserveState,
    marketState,
    riskState,
  });
  if (args.json) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }
  console.log(
    `payback-readiness: ${audit.decision.status}/${audit.decision.reason} target=${audit.decision.grossTargetBeforeCostsSats} sats`,
  );
  console.log(JSON.stringify(audit.currentConditions, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
