import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSlippageFeedback, featureEnabled, recordSlippageFeedback } from "../src/executor/policy/slippage-feedback.mjs";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
});

test("featureEnabled returns false when profile disables it", () => {
  assert.equal(featureEnabled({ slippageFeedback: false }), false);
});

test("consistent overrun raises estimate", () => {
  const history = [
    { estimatedSlippageBps: 10, realizedSlippageBps: 65 },
    { estimatedSlippageBps: 10, realizedSlippageBps: 70 },
    { estimatedSlippageBps: 10, realizedSlippageBps: 62 },
  ];
  const result = evaluateSlippageFeedback({
    intent: { chain: "base", protocol: "aerodrome", strategyId: "s1", estimatedSlippageBps: 10 },
    realizedSlippageBps: 65,
    history,
  });
  assert.equal(result.action, "raise_estimate");
  assert.equal(result.adjustedEstimateBps, 60);
  assert.equal(result.overrunCount, 3);
});

test("no consistent overrun maintains estimate", () => {
  const history = [
    { estimatedSlippageBps: 10, realizedSlippageBps: 20 },
    { estimatedSlippageBps: 10, realizedSlippageBps: 25 },
  ];
  const result = evaluateSlippageFeedback({
    intent: { chain: "base", protocol: "aerodrome", strategyId: "s1", estimatedSlippageBps: 10 },
    realizedSlippageBps: 20,
    history,
  });
  assert.equal(result.action, "maintain");
  assert.equal(result.adjustedEstimateBps, 10);
  assert.equal(result.overrunCount, 0);
});

test("feature disabled returns noop", () => {
  const result = evaluateSlippageFeedback({
    intent: { profile: { slippageFeedback: false } },
    realizedSlippageBps: 100,
    history: [],
  });
  assert.equal(result.action, "noop");
  assert.equal(result.adjustedEstimateBps, null);
});

test("recordSlippageFeedback appends to jsonl", () => {
  const dir = mkdtempSync(join(tmpdir(), "slippage-feedback-test-"));
  recordSlippageFeedback({
    intent: { chain: "base", protocol: "aerodrome", strategyId: "s1" },
    realizedSlippageBps: 65,
    estimatedSlippageBps: 10,
    now: "2026-05-10T00:00:00.000Z",
    dataDir: dir,
  });
  const raw = readFileSync(join(dir, "slippage-feedback.jsonl"), "utf8").trim();
  const entry = JSON.parse(raw);
  assert.equal(entry.routeKey, "base:aerodrome:s1");
  assert.equal(entry.realizedSlippageBps, 65);
  rmSync(dir, { recursive: true });
});

test("evaluate reads from file when history not provided", () => {
  const dir = mkdtempSync(join(tmpdir(), "slippage-feedback-test-"));
  recordSlippageFeedback({
    intent: { chain: "base", protocol: "aerodrome", strategyId: "s2" },
    realizedSlippageBps: 65,
    estimatedSlippageBps: 10,
    now: "2026-05-10T00:00:00.000Z",
    dataDir: dir,
  });
  recordSlippageFeedback({
    intent: { chain: "base", protocol: "aerodrome", strategyId: "s2" },
    realizedSlippageBps: 70,
    estimatedSlippageBps: 10,
    now: "2026-05-10T00:01:00.000Z",
    dataDir: dir,
  });
  recordSlippageFeedback({
    intent: { chain: "base", protocol: "aerodrome", strategyId: "s2" },
    realizedSlippageBps: 62,
    estimatedSlippageBps: 10,
    now: "2026-05-10T00:02:00.000Z",
    dataDir: dir,
  });
  const result = evaluateSlippageFeedback({
    intent: { chain: "base", protocol: "aerodrome", strategyId: "s2", estimatedSlippageBps: 10 },
    realizedSlippageBps: 65,
    dataDir: dir,
  });
  assert.equal(result.action, "raise_estimate");
  assert.equal(result.overrunCount, 3);
  rmSync(dir, { recursive: true });
});
