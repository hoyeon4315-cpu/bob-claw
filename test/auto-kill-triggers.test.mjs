import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAutoKillConfig } from "../src/config/auto-kill.mjs";
import { heartbeatTimestampMs } from "../src/risk/auto-kill-replay.mjs";
import {
  evaluateAutoKillTriggers,
  evaluateCumulativeLoss,
  evaluateFailureBurst,
  evaluateOracleDivergence,
  evaluateHeartbeat,
} from "../src/risk/auto-kill-triggers.mjs";

const NOW = new Date("2026-04-25T12:00:00.000Z");
const NOW_MS = NOW.getTime();

function lossRecord({ minutesAgo, netUsd, strategyId = "x" }) {
  return {
    timestamp: new Date(NOW_MS - minutesAgo * 60_000).toISOString(),
    strategyId,
    lifecycle: { stage: "confirmed" },
    realized: { netUsd },
  };
}

function failureRecord({ minutesAgo, strategyId = "x", stage = "rejected" }) {
  return {
    timestamp: new Date(NOW_MS - minutesAgo * 60_000).toISOString(),
    strategyId,
    lifecycle: { stage },
  };
}

test("cumulative loss trigger fires when threshold breached in window", () => {
  const config = buildAutoKillConfig({
    cumulativeLoss: { thresholdUsd: 100, windowMs: 60 * 60 * 1000 },
  });
  const records = [
    lossRecord({ minutesAgo: 10, netUsd: -60 }),
    lossRecord({ minutesAgo: 20, netUsd: -50 }),
    lossRecord({ minutesAgo: 1000, netUsd: -500 }),
  ];
  const result = evaluateCumulativeLoss({
    auditRecords: records,
    config: config.cumulativeLoss,
    nowMs: NOW_MS,
  });
  assert.ok(result);
  assert.equal(result.trigger, "cumulative_loss");
  assert.equal(result.lossUsd, 110);
});

test("cumulative loss respects operating-capital fraction floor", () => {
  const config = buildAutoKillConfig({
    cumulativeLoss: { thresholdUsd: 1_000_000, operatingCapitalFractionFloor: 0.05 },
  });
  const records = [lossRecord({ minutesAgo: 1, netUsd: -60 })];
  const result = evaluateCumulativeLoss({
    auditRecords: records,
    config: config.cumulativeLoss,
    operatingCapitalUsd: 1000,
    nowMs: NOW_MS,
  });
  assert.ok(result, "5% of 1000 = 50, loss 60 should trip");
});

test("failure burst fires on per-strategy threshold", () => {
  const config = buildAutoKillConfig({
    failureBurst: { perStrategyFailureCount: 3, failureCount: 99 },
  });
  const records = [
    { timestamp: new Date(NOW_MS - 1 * 60_000).toISOString(), strategyId: "alpha", policyVerdict: "errored", lifecycle: { stage: "error" } },
    { timestamp: new Date(NOW_MS - 2 * 60_000).toISOString(), strategyId: "alpha", policyVerdict: "errored", lifecycle: { stage: "error" } },
    { timestamp: new Date(NOW_MS - 3 * 60_000).toISOString(), strategyId: "alpha", policyVerdict: "errored", lifecycle: { stage: "error" } },
  ];
  const result = evaluateFailureBurst({
    auditRecords: records,
    config: config.failureBurst,
    nowMs: NOW_MS,
  });
  assert.equal(result?.trigger, "failure_burst_per_strategy");
  assert.equal(result.strategyId, "alpha");
});

test("failure burst ignores no-tx policy guard rejections", () => {
  const config = buildAutoKillConfig({
    failureBurst: { perStrategyFailureCount: 2, failureCount: 99 },
  });
  const records = [
    {
      timestamp: new Date(NOW_MS - 60_000).toISOString(),
      strategyId: "alpha",
      policyVerdict: "rejected",
      lifecycle: { stage: "rejected", blockers: ["max_consecutive_failures_reached"] },
      broadcast: null,
    },
    {
      timestamp: new Date(NOW_MS - 120_000).toISOString(),
      strategyId: "alpha",
      policyVerdict: "rejected",
      lifecycle: { stage: "rejected", blockers: ["kill_switch_present"] },
      broadcast: null,
    },
  ];
  const result = evaluateFailureBurst({
    auditRecords: records,
    config: config.failureBurst,
    nowMs: NOW_MS,
  });
  assert.equal(result, null);
});

test("failure burst ignores no-tx policy rejections with substantive blockers", () => {
  const config = buildAutoKillConfig({
    failureBurst: { perStrategyFailureCount: 1, failureCount: 99 },
  });
  const records = [
    {
      timestamp: new Date(NOW_MS - 60_000).toISOString(),
      strategyId: "alpha",
      policyVerdict: "rejected",
      lifecycle: { stage: "rejected", blockers: ["strategy_per_chain_cap_exceeded"] },
      broadcast: null,
    },
  ];
  const result = evaluateFailureBurst({
    auditRecords: records,
    config: config.failureBurst,
    nowMs: NOW_MS,
  });
  assert.equal(result, null);
});

test("failure burst still counts no-tx policy errors", () => {
  const config = buildAutoKillConfig({
    failureBurst: { perStrategyFailureCount: 1, failureCount: 99 },
  });
  const records = [
    {
      timestamp: new Date(NOW_MS - 60_000).toISOString(),
      strategyId: "alpha",
      policyVerdict: "errored",
      lifecycle: { stage: "error" },
      broadcast: null,
    },
  ];
  const result = evaluateFailureBurst({
    auditRecords: records,
    config: config.failureBurst,
    nowMs: NOW_MS,
  });
  assert.equal(result?.trigger, "failure_burst_per_strategy");
});

test("oracle divergence fires when sources disagree beyond threshold", () => {
  const config = buildAutoKillConfig({ oracleDivergence: { maxDivergencePct: 0.05 } });
  const samples = [
    { source: "coingecko", priceUsd: 100 },
    { source: "chainlink", priceUsd: 106 },
    { source: "pyth", priceUsd: 101 },
  ];
  const result = evaluateOracleDivergence({ samples, config: config.oracleDivergence });
  assert.equal(result?.trigger, "oracle_divergence");
});

test("oracle divergence stays silent below threshold", () => {
  const config = buildAutoKillConfig({ oracleDivergence: { maxDivergencePct: 0.05 } });
  const samples = [
    { source: "coingecko", priceUsd: 100 },
    { source: "chainlink", priceUsd: 102 },
  ];
  const result = evaluateOracleDivergence({ samples, config: config.oracleDivergence });
  assert.equal(result, null);
});

test("oracle divergence with minSourceCount 3 only evaluates once DIA adds the third source", () => {
  const config = buildAutoKillConfig({ oracleDivergence: { maxDivergencePct: 0.05, minSourceCount: 3 } });
  assert.equal(evaluateOracleDivergence({
    samples: [
      { source: "coingecko", pair: "BTC/USD", priceUsd: 100 },
      { source: "coinbase", pair: "BTC/USD", priceUsd: 110 },
    ],
    config: config.oracleDivergence,
  }), null);

  const result = evaluateOracleDivergence({
    samples: [
      { source: "coingecko", pair: "BTC/USD", priceUsd: 100 },
      { source: "coinbase", pair: "BTC/USD", priceUsd: 102 },
      { source: "dia", pair: "BTC/USD", priceUsd: 110 },
    ],
    config: config.oracleDivergence,
  });

  assert.equal(result?.trigger, "oracle_divergence");
  assert.deepEqual(result.sources, ["coingecko", "coinbase", "dia"]);
});

test("heartbeat trigger fires when stale", () => {
  const config = buildAutoKillConfig({ heartbeat: { maxAgeMs: 60_000 } });
  const result = evaluateHeartbeat({
    heartbeatAtMs: NOW_MS - 120_000,
    config: config.heartbeat,
    nowMs: NOW_MS,
  });
  assert.equal(result?.trigger, "heartbeat_stale");
});

test("auto-kill CLI heartbeat parser accepts signer updatedAt heartbeats", () => {
  const parsed = heartbeatTimestampMs({
    schemaVersion: 1,
    updatedAt: "2026-04-15T00:00:00.000Z",
    pid: 123,
  });
  assert.equal(parsed, new Date("2026-04-15T00:00:00.000Z").getTime());
});

test("auto-kill CLI heartbeat parser falls back when observedAtMs is null", () => {
  const parsed = heartbeatTimestampMs({
    schemaVersion: 1,
    observedAtMs: null,
    updatedAt: "2026-04-15T00:00:10.000Z",
    pid: 123,
  });
  assert.equal(parsed, new Date("2026-04-15T00:00:10.000Z").getTime());
});

test("evaluateAutoKillTriggers returns triggered=false on clean state", () => {
  const result = evaluateAutoKillTriggers({
    auditRecords: [],
    oracleSamples: [
      { source: "a", priceUsd: 100 },
      { source: "b", priceUsd: 100.5 },
    ],
    heartbeatAtMs: NOW_MS - 1_000,
    operatingCapitalUsd: 10_000,
    now: NOW,
  });
  assert.equal(result.triggered, false);
  assert.equal(result.triggers.length, 0);
});

test("evaluateAutoKillTriggers aggregates multiple triggers", () => {
  const config = buildAutoKillConfig({
    cumulativeLoss: { thresholdUsd: 50, windowMs: 60 * 60 * 1000 },
    failureBurst: { perStrategyFailureCount: 2, failureCount: 99 },
    oracleDivergence: { maxDivergencePct: 0.03 },
  });
  const result = evaluateAutoKillTriggers({
    auditRecords: [
      lossRecord({ minutesAgo: 1, netUsd: -100 }),
      { timestamp: new Date(NOW_MS - 1 * 60_000).toISOString(), strategyId: "x", policyVerdict: "errored", lifecycle: { stage: "error" } },
      { timestamp: new Date(NOW_MS - 2 * 60_000).toISOString(), strategyId: "x", policyVerdict: "errored", lifecycle: { stage: "error" } },
    ],
    oracleSamples: [
      { source: "a", priceUsd: 100 },
      { source: "b", priceUsd: 110 },
    ],
    heartbeatAtMs: NOW_MS - 1_000,
    config,
    now: NOW,
  });
  assert.equal(result.triggered, true);
  const names = result.triggers.map((t) => t.trigger).sort();
  assert.deepEqual(names, [
    "cumulative_loss",
    "failure_burst_per_strategy",
    "oracle_divergence",
  ]);
});
