import assert from "node:assert/strict";
import { test } from "node:test";
import { SEVERITY, makeVerdict, ewma } from "../src/executor/risk/types.mjs";
import { evaluateProtocolHealth } from "../src/executor/risk/protocol-health.mjs";
import { evaluateLiquidityWatch } from "../src/executor/risk/liquidity-watch.mjs";
import { evaluatePegMonitor } from "../src/executor/risk/peg-monitor.mjs";
import { evaluateConcentrationGuard } from "../src/executor/risk/concentration-guard.mjs";
import { evaluateFundingRateGate } from "../src/executor/risk/funding-rate-gate.mjs";
import { evaluateCircuitBreaker } from "../src/executor/risk/circuit-breaker.mjs";

test("types: ewma returns null for empty, valid for populated", () => {
  assert.equal(ewma([], 10), null);
  assert.ok(Math.abs(ewma([0.05, 0.05, 0.05], 5) - 0.05) < 1e-9);
});

test("types: makeVerdict returns frozen object", () => {
  const v = makeVerdict({ moduleId: "x" });
  assert.throws(() => { v.ok = false; });
  assert.throws(() => { v.violations.push("y"); });
});

// --- protocol-health ---
test("protocol-health: healthy snapshot passes", () => {
  const v = evaluateProtocolHealth({
    protocolId: "moonwell",
    tvlDrop24hPct: 0.05,
    oracleDeviationPct: 0.001,
  });
  assert.equal(v.ok, true);
  assert.equal(v.severity, SEVERITY.INFO);
});

test("protocol-health: tvl drop >=30% flags halt_protocol", () => {
  const v = evaluateProtocolHealth({
    protocolId: "moonwell",
    tvlDrop24hPct: 0.30,
  });
  assert.equal(v.ok, false);
  assert.equal(v.severity, SEVERITY.HALT_PROTOCOL);
  assert.ok(v.violations.some((x) => x.kind === "tvl_drop_24h_exceeded"));
});

test("protocol-health: oracle deviation >=3% flags", () => {
  const v = evaluateProtocolHealth({
    protocolId: "pendle",
    oracleDeviationPct: 0.035,
  });
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => x.kind === "oracle_deviation_exceeded"));
});

test("protocol-health: admin key change flags", () => {
  const v = evaluateProtocolHealth({ protocolId: "x", adminKeyChangedRecently: true });
  assert.equal(v.ok, false);
});

// --- liquidity-watch ---
test("liquidity-watch: 95% utilization sustained 60m trips pause_new_entries", () => {
  const v = evaluateLiquidityWatch({
    poolId: "moonwell-usdc",
    utilizationPct: 0.97,
    utilizationSustainedMinutes: 60,
  });
  assert.equal(v.ok, false);
  assert.equal(v.severity, SEVERITY.HALT_STRATEGY);
  assert.equal(v.action, "pause_new_entries");
});

test("liquidity-watch: deep withdrawal queue trips queue_unwind", () => {
  const v = evaluateLiquidityWatch({
    poolId: "moonwell-usdc",
    utilizationPct: 0.80,
    utilizationSustainedMinutes: 0,
    withdrawalQueueBlocks: 600,
  });
  assert.equal(v.ok, false);
  assert.equal(v.action, "queue_unwind");
});

test("liquidity-watch: both violations default to queue_unwind", () => {
  const v = evaluateLiquidityWatch({
    poolId: "moonwell-usdc",
    utilizationPct: 0.97,
    utilizationSustainedMinutes: 60,
    withdrawalQueueBlocks: 600,
  });
  assert.equal(v.ok, false);
  assert.equal(v.action, "queue_unwind");
});

test("liquidity-watch: 95% utilization for 30m does NOT trip (not sustained)", () => {
  const v = evaluateLiquidityWatch({
    poolId: "moonwell-usdc",
    utilizationPct: 0.97,
    utilizationSustainedMinutes: 30,
  });
  assert.equal(v.ok, true);
});

// --- peg-monitor ---
test("peg-monitor: 0.5% depeg sustained 30m unwinds", () => {
  const v = evaluatePegMonitor({
    assetId: "LBTC",
    pegDeviationPct: -0.006,
    pegSustainedMinutes: 30,
  });
  assert.equal(v.ok, false);
  assert.equal(v.severity, SEVERITY.UNWIND_ALL);
});

test("peg-monitor: transient depeg below threshold passes", () => {
  const v = evaluatePegMonitor({
    assetId: "LBTC",
    pegDeviationPct: -0.003,
    pegSustainedMinutes: 30,
  });
  assert.equal(v.ok, true);
});

// --- concentration-guard ---
test("concentration-guard: within caps allows", () => {
  const v = evaluateConcentrationGuard({
    currentAllocations: { perStrategy: { s1: 0.1 } },
    candidate: { strategyId: "s2", chainId: "base", addShare: 0.15 },
  });
  assert.equal(v.ok, true);
  assert.equal(v.action, "allow");
});

test("concentration-guard: over-cap rejects", () => {
  const v = evaluateConcentrationGuard({
    currentAllocations: { perStrategy: { s1: 0.2 } },
    candidate: { strategyId: "s1", chainId: "base", addShare: 0.1 },
  });
  assert.equal(v.ok, false);
  assert.equal(v.action, "reject_intent");
});

test("concentration-guard: missing candidate rejects safely", () => {
  const v = evaluateConcentrationGuard({});
  assert.equal(v.ok, false);
});

// --- funding-rate-gate ---
test("funding-rate-gate: positive EWMA >= entry threshold allows entry", () => {
  const samples = new Array(40).fill(0.05); // 5% APR sustained
  const v = evaluateFundingRateGate({
    marketId: "gmx-btc-short",
    fundingRateAnnualizedSamples: samples,
    recentNegativeDays: 0,
  });
  assert.equal(v.action, "allow_entry");
});

test("funding-rate-gate: 3 negative days forces exit", () => {
  const samples = new Array(40).fill(0.01);
  const v = evaluateFundingRateGate({
    marketId: "gmx-btc-short",
    fundingRateAnnualizedSamples: samples,
    recentNegativeDays: 3,
  });
  assert.equal(v.ok, false);
  assert.equal(v.action, "force_exit");
});

test("funding-rate-gate: insufficient data defers", () => {
  const v = evaluateFundingRateGate({ marketId: "x", fundingRateAnnualizedSamples: [] });
  assert.equal(v.action, "defer_insufficient_data");
});

// --- circuit-breaker ---
test("circuit-breaker: all-info verdicts do not trip", () => {
  const v = evaluateCircuitBreaker([
    makeVerdict({ moduleId: "a", ok: true, severity: SEVERITY.INFO }),
    makeVerdict({ moduleId: "b", ok: true, severity: SEVERITY.INFO }),
  ]);
  assert.equal(v.ok, true);
  assert.equal(v.action, "none");
});

test("circuit-breaker: any halt_protocol trips", () => {
  const v = evaluateCircuitBreaker([
    makeVerdict({ moduleId: "a", ok: true, severity: SEVERITY.INFO }),
    makeVerdict({ moduleId: "b", ok: false, severity: SEVERITY.HALT_PROTOCOL }),
  ]);
  assert.equal(v.ok, false);
  assert.equal(v.action, "touch_kill_switch_and_alert");
  assert.equal(v.violations.length, 1);
});

test("circuit-breaker: kill_switch trips and is worst severity", () => {
  const v = evaluateCircuitBreaker([
    makeVerdict({ moduleId: "a", ok: false, severity: SEVERITY.KILL_SWITCH }),
  ]);
  assert.equal(v.severity, SEVERITY.KILL_SWITCH);
  assert.equal(v.ok, false);
});

test("circuit-breaker: warn-only does not trip", () => {
  const v = evaluateCircuitBreaker([
    makeVerdict({ moduleId: "a", ok: false, severity: SEVERITY.WARN }),
  ]);
  assert.equal(v.ok, true);
});
