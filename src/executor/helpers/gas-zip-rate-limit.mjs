// Gas.Zip rate-limiting and policy enforcement.
//
// Enforces per-chain daily max, per-chain max open jobs, minimum hours
// between refills per chain, and destination-balance-already-met gates.
// These config values were previously defined but never enforced.

import { GAS_ZIP_DEFAULT_POLICY } from "../../config/gas-zip.mjs";
import { buildDefaultTreasuryPolicy } from "../../treasury/policy.mjs";

const GAS_ZIP_STRATEGY_ID = "gas-zip-native-refuel";

const NEAR_MATCH_THRESHOLD_BPS = 50; // 0.5% = near-match

function hoursAgo(isoTimestamp, nowIso) {
  const ts = new Date(isoTimestamp).getTime();
  const now = new Date(nowIso).getTime();
  return (now - ts) / 3_600_000;
}

function successfulBroadcast(record = {}) {
  return (
    ["approved", "signed", "broadcasted", "confirmed"].includes(record.policyVerdict) ||
    ["broadcasted", "signed", "confirmed"].includes(record.lifecycle?.stage)
  );
}

function isGasZipRecord(record = {}) {
  return record.strategyId === GAS_ZIP_STRATEGY_ID;
}

function isTerminalFailure(record = {}) {
  const stage = record.lifecycle?.stage;
  if (stage === "error" || stage === "reverted") return true;
  if (record.policyVerdict === "rejected") return true;
  return false;
}

/**
 * Build a per-chain Gas.Zip execution state from audit records.
 * This is the state needed to enforce rate limits.
 */
export function buildGasZipRateState({
  auditRecords = [],
  now = new Date().toISOString(),
  gasZipPolicy = GAS_ZIP_DEFAULT_POLICY,
  treasuryPolicy = buildDefaultTreasuryPolicy(),
} = {}) {
  const refillPolicy = treasuryPolicy?.refillPolicy || {};
  const minHours = Number.isFinite(refillPolicy.minHoursBetweenRefillsPerChain)
    ? refillPolicy.minHoursBetweenRefillsPerChain
    : 6;

  const dayStart = new Date(now).toISOString().slice(0, 10);

  // Collect all Gas.Zip records from today
  const todayRecords = auditRecords.filter((r) => {
    if (!isGasZipRecord(r)) return false;
    const ts = r.timestamp || r.observedAt || "";
    return ts.startsWith(dayStart);
  });

  // Per-chain accumulators
  const dailyVolumeUsd = {};
  const lastRefillTimestamp = {};
  const openJobCount = {};

  for (const record of todayRecords) {
    const chain = record.chain || record.intent?.chain || "unknown";
    const dstChain = record.intent?.metadata?.gasZipDestinationShortId
      ? String(record.intent.metadata.gasZipDestinationShortId)
      : null;

    // Use destination chain for rate limiting (where gas arrives)
    const targetChain = dstChain || chain;
    const amountUsd = Number(record.amountUsd || record.intent?.amountUsd || 0);

    // Skip terminal failures from volume counting
    if (isTerminalFailure(record)) continue;

    // Only count successful broadcasts toward daily volume
    if (successfulBroadcast(record)) {
      dailyVolumeUsd[targetChain] = (dailyVolumeUsd[targetChain] || 0) + amountUsd;
      // Track most recent successful broadcast timestamp
      const ts = record.timestamp || record.observedAt || "";
      if (!lastRefillTimestamp[targetChain] || ts > lastRefillTimestamp[targetChain]) {
        lastRefillTimestamp[targetChain] = ts;
      }
    }

    // Count open (in-flight) jobs: signed or broadcasted but not confirmed/failed
    const stage = record.lifecycle?.stage;
    if (stage === "signed" || stage === "broadcasted") {
      openJobCount[targetChain] = (openJobCount[targetChain] || 0) + 1;
    }
  }

  return {
    observedAt: now,
    dailyVolumeUsd,
    lastRefillTimestamp,
    openJobCount,
    minHoursBetweenRefills: minHours,
    perChainDailyMaxUsd: gasZipPolicy.perChainDailyMaxRefuelUsd,
    perChainMaxOpenJobs: gasZipPolicy.perChainMaxOpenJobs,
  };
}

/**
 * Evaluate whether a Gas.Zip refuel is allowed given the current rate state
 * and destination balance.
 */
export function evaluateGasZipRateLimit({
  dstChain,
  amountUsd,
  rateState,
  destinationBalanceStatus = null, // "ready" | "supported_buffered" | "refill_required" | etc
  destinationNativeDecimal = null, // current balance in native decimal
  destinationMinBalanceDecimal = null, // minimum balance threshold
  now = new Date().toISOString(),
}) {
  const blockers = [];

  // 1. Destination already meets or exceeds minimum — no refill needed
  if (destinationBalanceStatus && ["ready", "supported_buffered", "over_max_supported", "observe_only_balance_present"].includes(destinationBalanceStatus)) {
    blockers.push("gas_zip_destination_already_meets_minimum");
  }
  // Also check numerically if we have balance data
  if (
    Number.isFinite(destinationNativeDecimal) &&
    Number.isFinite(destinationMinBalanceDecimal) &&
    destinationMinBalanceDecimal > 0 &&
    destinationNativeDecimal >= destinationMinBalanceDecimal
  ) {
    if (!blockers.includes("gas_zip_destination_already_meets_minimum")) {
      blockers.push("gas_zip_destination_already_meets_minimum");
    }
  }

  // 2. Per-chain daily max
  const dailyUsed = rateState.dailyVolumeUsd[dstChain] || 0;
  const dailyMax = Number.isFinite(rateState.perChainDailyMaxUsd) ? rateState.perChainDailyMaxUsd : 25;
  if (Number.isFinite(amountUsd) && dailyUsed + amountUsd > dailyMax) {
    blockers.push("gas_zip_per_chain_daily_max_exceeded");
  }

  // 3. Per-chain max open jobs
  const openJobs = rateState.openJobCount[dstChain] || 0;
  const maxOpen = Number.isFinite(rateState.perChainMaxOpenJobs) ? rateState.perChainMaxOpenJobs : 1;
  if (openJobs >= maxOpen) {
    blockers.push("gas_zip_per_chain_max_open_jobs_exceeded");
  }

  // 4. Min hours between refills per chain
  const lastTs = rateState.lastRefillTimestamp[dstChain];
  if (lastTs) {
    const elapsed = hoursAgo(lastTs, now);
    if (elapsed < rateState.minHoursBetweenRefills) {
      blockers.push("gas_zip_min_hours_between_refills_not_elapsed");
    }
  }

  return {
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers,
    metrics: {
      dstChain,
      amountUsd: Number.isFinite(amountUsd) ? amountUsd : null,
      dailyUsedUsd: dailyUsed,
      dailyMaxUsd: dailyMax,
      openJobs,
      maxOpenJobs: maxOpen,
      lastRefillTimestamp: lastTs || null,
      minHoursBetweenRefills: rateState.minHoursBetweenRefills,
      destinationBalanceStatus,
      destinationNativeDecimal,
      destinationMinBalanceDecimal,
    },
  };
}

/**
 * Classify an unproven_timeout settlement as near_match_timeout
 * when observedDelta is within NEAR_MATCH_THRESHOLD_BPS of requiredDelta.
 * Does NOT relax the delivery proof standard — only improves reporting.
 */
export function classifySettlementTimeout(proof) {
  if (!proof || proof.status !== "unproven_timeout") return proof;

  const observed = BigInt(proof.observedDelta || "0");
  const required = BigInt(proof.requiredDelta || "0");

  // Avoid division by zero
  if (required === 0n) return proof;

  // |required - observed| / required * 10000
  const diffBps = Number((required - observed) * 10000n / required);

  if (diffBps >= 0 && diffBps <= NEAR_MATCH_THRESHOLD_BPS) {
    return { ...proof, status: "near_match_timeout", nearMatchBps: diffBps };
  }
  return proof;
}