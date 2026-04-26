import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGasZipRateState,
  evaluateGasZipRateLimit,
  classifySettlementTimeout,
} from "../src/executor/helpers/gas-zip-rate-limit.mjs";
import { GAS_ZIP_DEFAULT_POLICY } from "../src/config/gas-zip.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../src/treasury/policy.mjs";

function makeAuditRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    timestamp: overrides.timestamp || new Date().toISOString(),
    strategyId: "gas-zip-native-refuel",
    chain: overrides.chain || "bsc",
    intentId: `gas-zip-native-refuel:${overrides.chain || "bsc"}:${overrides.intentSuffix || "test"}`,
    amountUsd: overrides.amountUsd ?? 5,
    policyVerdict: overrides.policyVerdict || "approved",
    lifecycle: {
      stage: overrides.stage || "confirmed",
      txHash: overrides.txHash || "0xdead",
    },
    intent: {
      intentType: "gas_zip_native_refuel",
      amountUsd: overrides.amountUsd ?? 5,
      metadata: {
        gasZipDestinationChainId: overrides.dstChainId || 8453,
        gasZipDestinationShortId: overrides.dstShortId || 54,
      },
    },
  };
}

test("buildGasZipRateState accumulates daily volume per destination chain", () => {
  const now = "2026-04-20T12:00:00.000Z";
  const records = [
    makeAuditRecord({ amountUsd: 3, stage: "confirmed", timestamp: "2026-04-20T10:00:00.000Z", dstChainId: 8453, intentSuffix: "a" }),
    makeAuditRecord({ amountUsd: 4, stage: "broadcasted", timestamp: "2026-04-20T11:00:00.000Z", dstChainId: 8453, intentSuffix: "b" }),
  ];
  const state = buildGasZipRateState({ auditRecords: records, now });
  assert.equal(state.dailyVolumeUsd["base"], 7);
  assert.equal(state.dailyVolumeUsd["bsc"], undefined);
});

test("buildGasZipRateState ignores failed records in volume", () => {
  const now = "2026-04-20T12:00:00.000Z";
  const records = [
    makeAuditRecord({ amountUsd: 3, stage: "confirmed", timestamp: "2026-04-20T10:00:00.000Z", dstChainId: 8453, intentSuffix: "ok" }),
    makeAuditRecord({ amountUsd: 10, policyVerdict: "rejected", stage: "rejected", timestamp: "2026-04-20T11:00:00.000Z", dstChainId: 8453, intentSuffix: "bad" }),
  ];
  const state = buildGasZipRateState({ auditRecords: records, now });
  // Rejected should not count toward daily volume
  assert.equal(state.dailyVolumeUsd["base"], 3);
});

test("buildGasZipRateState tracks last refill timestamp per destination", () => {
  const now = "2026-04-20T12:00:00.000Z";
  const records = [
    makeAuditRecord({ stage: "confirmed", timestamp: "2026-04-20T08:00:00.000Z", dstChainId: 8453, intentSuffix: "a" }),
    makeAuditRecord({ stage: "confirmed", timestamp: "2026-04-20T10:00:00.000Z", dstChainId: 8453, intentSuffix: "b" }),
  ];
  const state = buildGasZipRateState({ auditRecords: records, now });
  assert.equal(state.lastRefillTimestamp["base"], "2026-04-20T10:00:00.000Z");
});

test("buildGasZipRateState counts open (in-flight) jobs", () => {
  const now = "2026-04-20T12:00:00.000Z";
  const records = [
    makeAuditRecord({ stage: "broadcasted", timestamp: "2026-04-20T11:00:00.000Z", dstChainId: 8453 }),
  ];
  const state = buildGasZipRateState({ auditRecords: records, now });
  assert.equal(state.openJobCount["base"], 1);
});

test("buildGasZipRateState collapses lifecycle records by intent", () => {
  const now = "2026-04-20T12:00:00.000Z";
  const records = [
    makeAuditRecord({ amountUsd: 5, stage: "signed", timestamp: "2026-04-20T10:00:00.000Z", dstChainId: 8453 }),
    makeAuditRecord({ amountUsd: 5, stage: "broadcasted", timestamp: "2026-04-20T10:01:00.000Z", dstChainId: 8453 }),
    makeAuditRecord({ amountUsd: 5, stage: "confirmed", timestamp: "2026-04-20T10:02:00.000Z", dstChainId: 8453 }),
  ];
  const state = buildGasZipRateState({ auditRecords: records, now });
  assert.equal(state.dailyVolumeUsd["base"], 5);
  assert.equal(state.openJobCount["base"], undefined);
});

test("evaluateGasZipRateLimit blocks when destination already meets minimum", () => {
  const rateState = {
    observedAt: new Date().toISOString(),
    dailyVolumeUsd: {},
    lastRefillTimestamp: {},
    openJobCount: {},
    minHoursBetweenRefills: 6,
    perChainDailyMaxUsd: 25,
    perChainMaxOpenJobs: 1,
  };
  const result = evaluateGasZipRateLimit({
    dstChain: "54",
    amountUsd: 5,
    rateState,
    destinationBalanceStatus: "ready",
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("gas_zip_destination_already_meets_minimum"));
});

test("evaluateGasZipRateLimit blocks when destination balance exceeds min numerically", () => {
  const rateState = {
    observedAt: new Date().toISOString(),
    dailyVolumeUsd: {},
    lastRefillTimestamp: {},
    openJobCount: {},
    minHoursBetweenRefills: 6,
    perChainDailyMaxUsd: 25,
    perChainMaxOpenJobs: 1,
  };
  const result = evaluateGasZipRateLimit({
    dstChain: "54",
    amountUsd: 5,
    rateState,
    destinationNativeDecimal: 0.004,
    destinationMinBalanceDecimal: 0.0015,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("gas_zip_destination_already_meets_minimum"));
});

test("evaluateGasZipRateLimit blocks when daily max exceeded", () => {
  const rateState = {
    observedAt: new Date().toISOString(),
    dailyVolumeUsd: { base: 23 },
    lastRefillTimestamp: {},
    openJobCount: {},
    minHoursBetweenRefills: 6,
    perChainDailyMaxUsd: 25,
    perChainMaxOpenJobs: 1,
  };
  const result = evaluateGasZipRateLimit({
    dstChain: "base",
    amountUsd: 5,
    rateState,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("gas_zip_per_chain_daily_max_exceeded"));
});

test("evaluateGasZipRateLimit blocks when max open jobs exceeded", () => {
  const rateState = {
    observedAt: new Date().toISOString(),
    dailyVolumeUsd: {},
    lastRefillTimestamp: {},
    openJobCount: { base: 1 },
    minHoursBetweenRefills: 6,
    perChainDailyMaxUsd: 25,
    perChainMaxOpenJobs: 1,
  };
  const result = evaluateGasZipRateLimit({
    dstChain: "base",
    amountUsd: 3,
    rateState,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("gas_zip_per_chain_max_open_jobs_exceeded"));
});

test("evaluateGasZipRateLimit blocks when cooldown not elapsed", () => {
  const now = new Date().toISOString();
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const rateState = {
    observedAt: now,
    dailyVolumeUsd: {},
    lastRefillTimestamp: { base: fiveMinutesAgo },
    openJobCount: {},
    minHoursBetweenRefills: 6,
    perChainDailyMaxUsd: 25,
    perChainMaxOpenJobs: 1,
  };
  const result = evaluateGasZipRateLimit({
    dstChain: "base",
    amountUsd: 3,
    rateState,
    now,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("gas_zip_min_hours_between_refills_not_elapsed"));
});

test("evaluateGasZipRateLimit allows cooldown bypass while destination remains below minimum", () => {
  const now = "2026-04-20T12:00:00.000Z";
  const rateState = buildGasZipRateState({
    auditRecords: [
      makeAuditRecord({ stage: "confirmed", timestamp: "2026-04-20T11:00:00.000Z", dstChainId: 1 }),
    ],
    now,
  });
  const result = evaluateGasZipRateLimit({
    dstChain: "ethereum",
    amountUsd: 4,
    rateState,
    destinationNativeDecimal: 0.002,
    destinationMinBalanceDecimal: 0.004,
    now,
  });
  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.blockers, []);
});

test("evaluateGasZipRateLimit allows when all gates pass", () => {
  const now = new Date().toISOString();
  const sevenHoursAgo = new Date(Date.now() - 7 * 3600_000).toISOString();
  const rateState = {
    observedAt: now,
    dailyVolumeUsd: { base: 5 },
    lastRefillTimestamp: { base: sevenHoursAgo },
    openJobCount: {},
    minHoursBetweenRefills: 6,
    perChainDailyMaxUsd: 25,
    perChainMaxOpenJobs: 1,
  };
  const result = evaluateGasZipRateLimit({
    dstChain: "base",
    amountUsd: 5,
    rateState,
    now,
    destinationBalanceStatus: "refill_required",
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.length, 0);
});

test("classifySettlementTimeout upgrades near-match timeouts to near_match_timeout", () => {
  const proof = {
    status: "unproven_timeout",
    proofSource: "native_balance_delta",
    initialBalance: "1000",
    settledBalance: "1999",
    observedDelta: "999",
    requiredDelta: "1000",
    observedAt: new Date().toISOString(),
    rpcUrl: "https://example.com",
    attempts: 12,
  };
  const result = classifySettlementTimeout(proof);
  assert.equal(result.status, "near_match_timeout");
  // 1/1000 = 10bps, well within 50bps threshold
  assert.ok(result.nearMatchBps <= 50);
});

test("classifySettlementTimeout leaves wide misses as unproven_timeout", () => {
  const proof = {
    status: "unproven_timeout",
    proofSource: "native_balance_delta",
    initialBalance: "1000",
    settledBalance: "1500",
    observedDelta: "500",
    requiredDelta: "1000",
    observedAt: new Date().toISOString(),
    rpcUrl: "https://example.com",
    attempts: 12,
  };
  const result = classifySettlementTimeout(proof);
  assert.equal(result.status, "unproven_timeout");
  assert.equal(result.nearMatchBps, undefined);
});

test("classifySettlementTimeout passes through delivered status unchanged", () => {
  const proof = {
    status: "delivered",
    proofSource: "native_balance_delta",
    initialBalance: "1000",
    settledBalance: "2000",
    observedDelta: "1000",
    requiredDelta: "1000",
    observedAt: new Date().toISOString(),
    rpcUrl: "https://example.com",
    attempts: 1,
  };
  const result = classifySettlementTimeout(proof);
  assert.equal(result.status, "delivered");
  assert.equal(result.nearMatchBps, undefined);
});

test("classifySettlementTimeout returns null for null input", () => {
  const result = classifySettlementTimeout(null);
  assert.equal(result, null);
});
