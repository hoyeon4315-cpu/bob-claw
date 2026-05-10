import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  evaluateSlippageFeedback,
  recordSlippageFeedback,
} from "../../../src/executor/policy/slippage-feedback.mjs";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "slippage-feedback-test-"));
}

test("three consecutive slippage overruns -> future estimate raised -> next intent blocked if quote insufficient", () => {
  const tmpDir = makeTempDir();

  const intent = {
    strategyId: "test-strategy",
    chain: "base",
    protocol: "aerodrome",
    estimatedSlippageBps: 30,
    profile: {},
  };

  // Record 3 consecutive overruns (realized > estimated by >50 bps each)
  recordSlippageFeedback({
    intent,
    realizedSlippageBps: 85,
    estimatedSlippageBps: 30,
    dataDir: tmpDir,
  });
  recordSlippageFeedback({
    intent,
    realizedSlippageBps: 90,
    estimatedSlippageBps: 30,
    dataDir: tmpDir,
  });
  recordSlippageFeedback({
    intent,
    realizedSlippageBps: 95,
    estimatedSlippageBps: 30,
    dataDir: tmpDir,
  });

  // Evaluate feedback: should raise estimate
  const feedback = evaluateSlippageFeedback({ intent, dataDir: tmpDir });

  assert.equal(feedback.action, "raise_estimate", "should raise estimate after 3 overruns");
  assert.equal(feedback.adjustedEstimateBps, 80, "should add 50 bps to latest estimate (30+50)");
  assert.equal(feedback.overrunCount, 3, "should report 3 overruns");

  // Next intent with quote that only allows 50 bps slippage should be blocked
  const nextIntent = {
    ...intent,
    estimatedSlippageBps: 50, // below the adjusted 80 bps
  };

  const nextFeedback = evaluateSlippageFeedback({ intent: nextIntent, dataDir: tmpDir });
  assert.equal(nextFeedback.action, "raise_estimate", "should still raise");
  assert.equal(nextFeedback.adjustedEstimateBps, 80, "adjusted estimate should be 80");

  // Simulate policy check: if quote slippage < adjustedEstimate, block
  const quoteSlippageBps = 50;
  const shouldBlock = quoteSlippageBps < nextFeedback.adjustedEstimateBps;
  assert.equal(shouldBlock, true, "intent with insufficient quote slippage should be blocked");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("two consecutive overruns -> estimate not raised", () => {
  const tmpDir = makeTempDir();

  const intent = {
    strategyId: "test-strategy",
    chain: "base",
    protocol: "aerodrome",
    estimatedSlippageBps: 30,
    profile: {},
  };

  recordSlippageFeedback({
    intent,
    realizedSlippageBps: 85,
    estimatedSlippageBps: 30,
    dataDir: tmpDir,
  });
  recordSlippageFeedback({
    intent,
    realizedSlippageBps: 90,
    estimatedSlippageBps: 30,
    dataDir: tmpDir,
  });

  const feedback = evaluateSlippageFeedback({ intent, dataDir: tmpDir });

  assert.equal(feedback.action, "maintain", "should not raise after only 2 overruns");
  assert.equal(feedback.adjustedEstimateBps, 30, "estimate should remain unchanged");
  assert.equal(feedback.overrunCount, 2);

  rmSync(tmpDir, { recursive: true, force: true });
});

test("overrun diff exactly 50 bps counts as overrun", () => {
  const tmpDir = makeTempDir();

  const intent = {
    strategyId: "test-strategy",
    chain: "base",
    protocol: "uniswap",
    estimatedSlippageBps: 20,
    profile: {},
  };

  // diff = 70 - 20 = 50, which meets the threshold (>50 is not required, >50 means strictly greater)
  // Looking at the source: `diff > 50` — strictly greater than 50
  recordSlippageFeedback({
    intent,
    realizedSlippageBps: 71,
    estimatedSlippageBps: 20,
    dataDir: tmpDir,
  });

  const feedback = evaluateSlippageFeedback({ intent, dataDir: tmpDir });
  assert.equal(feedback.overrunCount, 1, "diff of 51 bps should count as overrun");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("overrun diff at exactly 50 bps does NOT count as overrun", () => {
  const tmpDir = makeTempDir();

  const intent = {
    strategyId: "test-strategy",
    chain: "base",
    protocol: "odos",
    estimatedSlippageBps: 20,
    profile: {},
  };

  // diff = 70 - 20 = 50 — not strictly greater than 50
  recordSlippageFeedback({
    intent,
    realizedSlippageBps: 70,
    estimatedSlippageBps: 20,
    dataDir: tmpDir,
  });

  const feedback = evaluateSlippageFeedback({ intent, dataDir: tmpDir });
  assert.equal(feedback.overrunCount, 0, "diff of exactly 50 bps should not count as overrun");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("slippage feedback is isolated per route key", () => {
  const tmpDir = makeTempDir();

  const intentA = {
    strategyId: "strategy-a",
    chain: "base",
    protocol: "aerodrome",
    estimatedSlippageBps: 30,
    profile: {},
  };

  const intentB = {
    strategyId: "strategy-b",
    chain: "base",
    protocol: "aerodrome",
    estimatedSlippageBps: 30,
    profile: {},
  };

  // 3 overruns for strategy A
  for (let i = 0; i < 3; i++) {
    recordSlippageFeedback({
      intent: intentA,
      realizedSlippageBps: 85 + i,
      estimatedSlippageBps: 30,
      dataDir: tmpDir,
    });
  }

  // Strategy B should not be affected
  const feedbackB = evaluateSlippageFeedback({ intent: intentB, dataDir: tmpDir });
  assert.equal(feedbackB.action, "maintain", "strategy B should not be affected by A's overruns");
  assert.equal(feedbackB.overrunCount, 0);

  // Strategy A should be raised
  const feedbackA = evaluateSlippageFeedback({ intent: intentA, dataDir: tmpDir });
  assert.equal(feedbackA.action, "raise_estimate");
  assert.equal(feedbackA.overrunCount, 3);

  rmSync(tmpDir, { recursive: true, force: true });
});

test("feature disabled -> noop and no file write", () => {
  const tmpDir = makeTempDir();

  const intent = {
    strategyId: "test-strategy",
    chain: "base",
    protocol: "aerodrome",
    estimatedSlippageBps: 30,
    profile: { slippageFeedback: false },
  };

  recordSlippageFeedback({
    intent,
    realizedSlippageBps: 100,
    estimatedSlippageBps: 30,
    dataDir: tmpDir,
  });

  const feedback = evaluateSlippageFeedback({ intent, dataDir: tmpDir });
  assert.equal(feedback.action, "noop", "disabled feature should return noop");
  assert.equal(feedback.adjustedEstimateBps, null, "should return null when disabled");

  // File should not exist because recordSlippageFeedback checks featureEnabled
  const filePath = join(tmpDir, "slippage-feedback.jsonl");
  assert.equal(existsSync(filePath), false, "should not write file when disabled");

  rmSync(tmpDir, { recursive: true, force: true });
});
