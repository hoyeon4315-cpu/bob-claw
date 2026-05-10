import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePositionBleed, featureEnabled } from "../src/executor/health/position-bleed-detector.mjs";

function makePosition(overrides = {}) {
  return {
    positionId: "pos-1",
    strategyId: "strat-a",
    cumulativeGasUsd: 10,
    realizedYieldUsd: 20,
    estimatedExitCostUsd: 1,
    valueUsd: 100,
    ...overrides,
  };
}

function makePolicy(overrides = {}) {
  return {
    bleedToYieldRatio: 1.0,
    ...overrides,
  };
}

test("bleed exceeded emits exit action", () => {
  const position = makePosition({ cumulativeGasUsd: 25, realizedYieldUsd: 20 });
  const policy = makePolicy();
  const actions = evaluatePositionBleed({ position, policy });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "exit");
  assert.equal(actions[0].reasonCode, "position_bleed");
  assert.equal(actions[0].strategyId, "strat-a");
  assert.equal(actions[0].positionId, "pos-1");
  assert.equal(actions[0].estimatedCostUsd, 1);
  assert.equal(actions[0].estimatedRecoveryUsd, 100);
  assert.ok(actions[0].reason.includes("25"));
  assert.ok(actions[0].reason.includes("20"));
  assert.ok(actions[0].dedupeKey);
});

test("below ratio emits no action", () => {
  const position = makePosition({ cumulativeGasUsd: 10, realizedYieldUsd: 20 });
  const policy = makePolicy();
  const actions = evaluatePositionBleed({ position, policy });
  assert.equal(actions.length, 0);
});

test("exactly at threshold emits no action", () => {
  const position = makePosition({ cumulativeGasUsd: 20, realizedYieldUsd: 20 });
  const policy = makePolicy();
  const actions = evaluatePositionBleed({ position, policy });
  assert.equal(actions.length, 0);
});

test("custom ratio scales threshold correctly", () => {
  // ratio 0.5 → threshold = 10; gas = 11 > 10 → exit
  const position = makePosition({ cumulativeGasUsd: 11, realizedYieldUsd: 20 });
  const policy = makePolicy({ bleedToYieldRatio: 0.5 });
  const actions = evaluatePositionBleed({ position, policy });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].reasonCode, "position_bleed");
});

test("missing data returns no action gracefully", () => {
  assert.equal(evaluatePositionBleed({ position: null, policy: makePolicy() }).length, 0);
  assert.equal(evaluatePositionBleed({ position: {}, policy: makePolicy() }).length, 0);
  assert.equal(evaluatePositionBleed({ position: makePosition({ cumulativeGasUsd: NaN }), policy: makePolicy() }).length, 0);
  assert.equal(evaluatePositionBleed({ position: makePosition({ realizedYieldUsd: NaN }), policy: makePolicy() }).length, 0);
  assert.equal(evaluatePositionBleed({ position: makePosition({ cumulativeGasUsd: undefined, realizedYieldUsd: undefined }), policy: makePolicy() }).length, 0);
});

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ positionBleedDetector: true }), true);
});

test("featureEnabled returns false when profile.positionBleedDetector is false", () => {
  assert.equal(featureEnabled({ positionBleedDetector: false }), false);
});
