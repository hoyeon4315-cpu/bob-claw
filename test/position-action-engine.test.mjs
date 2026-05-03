import { test } from "node:test";
import assert from "node:assert/strict";

import { planActions, evaluatePosition, ACTION_TYPES } from "../src/executor/health/position-action-engine.mjs";

const now = new Date("2026-05-10T00:00:00Z");

test("ACTION_TYPES contains exactly the protective set (no rebalance)", () => {
  assert.deepEqual([...ACTION_TYPES].sort(), ["exit", "pause", "review", "unwind"]);
  assert.ok(!ACTION_TYPES.includes("rebalance"));
});

test("HF below min triggers exit", () => {
  const a = evaluatePosition({
    position: { positionId: "p1", strategyId: "s1", healthFactor: 1.05, valueUsd: 1000 },
    policy: { minHealthFactor: 1.1, warnHealthFactor: 1.3 },
    now,
  });
  assert.equal(a.length, 1);
  assert.equal(a[0].type, "exit");
  assert.equal(a[0].reasonCode, "hf_below_min");
});

test("HF in warn band triggers unwind", () => {
  const a = evaluatePosition({
    position: { positionId: "p1", strategyId: "s1", healthFactor: 1.2 },
    policy: { minHealthFactor: 1.1, warnHealthFactor: 1.3 },
    now,
  });
  assert.equal(a[0].type, "unwind");
  assert.equal(a[0].reasonCode, "hf_warn");
});

test("expiry_window triggers exit", () => {
  const ts = Math.floor(now.getTime() / 1000) + 3600;
  const a = evaluatePosition({
    position: { positionId: "p1", strategyId: "s1", expirySec: ts },
    policy: { exitBeforeExpirySec: 7 * 86400 },
    now,
  });
  assert.equal(a[0].reasonCode, "expiry_window");
});

test("CL out of range triggers review (not rebalance)", () => {
  const a = evaluatePosition({
    position: { positionId: "p1", strategyId: "s1", timeInRangeRatio: 0.2 },
    policy: { minTimeInRangeRatio: 0.5 },
    now,
  });
  assert.equal(a[0].type, "review");
  assert.equal(a[0].reasonCode, "cl_out_of_range");
});

test("planActions dedupes identical findings inside same window bucket", () => {
  const pos = { positionId: "p1", strategyId: "s1", healthFactor: 0.9 };
  const out = planActions({
    positions: [pos, { ...pos }],
    policiesByStrategy: { s1: { minHealthFactor: 1.0 } },
    now,
  });
  assert.equal(out.length, 1);
});

test("planActions sorts by priority (exit < unwind < pause < review)", () => {
  const out = planActions({
    positions: [
      { positionId: "p1", strategyId: "s1", timeInRangeRatio: 0.1 },
      { positionId: "p2", strategyId: "s1", healthFactor: 0.5 },
      { positionId: "p3", strategyId: "s1", aprDecayRatio: 0.9 },
    ],
    policiesByStrategy: {
      s1: { minHealthFactor: 1.0, minTimeInRangeRatio: 0.5, maxAprDecayRatio: 0.5 },
    },
    now,
  });
  assert.deepEqual(out.map((a) => a.type), ["exit", "unwind", "review"]);
});

test("missing policy yields no actions (engine just compares)", () => {
  const out = planActions({ positions: [{ positionId: "p1", healthFactor: 0.1 }] });
  assert.equal(out.length, 0);
});
