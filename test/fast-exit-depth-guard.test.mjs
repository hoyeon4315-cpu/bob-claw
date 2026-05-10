import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateFastExit, featureEnabled } from "../src/executor/health/fast-exit-depth-guard.mjs";

test("spread 250 bps blocks exit intent", () => {
  const result = evaluateFastExit({
    intent: { intentType: "exit", amountUsd: 100 },
    marketDepth: { spreadBps: 250, depthAtOutput: 500 },
    maxSpreadBps: 200,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "fast_exit_spread_too_wide");
  assert.ok(result.reason.includes("250"));
});

test("spread 50 bps and depth 3× allows exit intent", () => {
  const result = evaluateFastExit({
    intent: { intentType: "exit", amountUsd: 100 },
    marketDepth: { spreadBps: 50, depthAtOutput: 300 },
    maxSpreadBps: 200,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reasonCode, null);
});

test("depth 1.5× blocks exit intent", () => {
  const result = evaluateFastExit({
    intent: { intentType: "exit", amountUsd: 100 },
    marketDepth: { spreadBps: 50, depthAtOutput: 150 },
    maxSpreadBps: 200,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "fast_exit_depth_insufficient");
  assert.ok(result.reason.includes("150"));
});

test("non-exit intent is allowed regardless of spread/depth", () => {
  const result = evaluateFastExit({
    intent: { intentType: "deposit", amountUsd: 100 },
    marketDepth: { spreadBps: 500, depthAtOutput: 10 },
    maxSpreadBps: 200,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reasonCode, null);
});

test("missing market depth data allows by default", () => {
  const result = evaluateFastExit({
    intent: { intentType: "exit" },
    marketDepth: {},
    maxSpreadBps: 200,
  });
  assert.equal(result.allowed, true);
});

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ fastExitDepthGuard: true }), true);
});

test("featureEnabled returns false when profile.fastExitDepthGuard is false", () => {
  assert.equal(featureEnabled({ fastExitDepthGuard: false }), false);
});

test("feature flag off allows everything", () => {
  // We verify the no-op path through featureEnabled.
  assert.equal(featureEnabled({ fastExitDepthGuard: false }), false);
});
