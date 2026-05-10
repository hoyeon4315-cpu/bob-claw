import assert from "node:assert/strict";
import { test } from "node:test";
import {
  featureEnabled,
  buildCompoundIntent,
} from "../src/executor/harvest/auto-compound.mjs";

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ autoCompound: true }), true);
});

test("featureEnabled returns false when profile disables it", () => {
  assert.equal(featureEnabled({ autoCompound: false }), false);
});

test("buildCompoundIntent splits 80% compound and 20% payback", () => {
  const intent = buildCompoundIntent({
    strategyId: "test-strat",
    chain: "base",
    protocol: "aerodrome",
    harvestedAmountUsd: 100,
    compoundRatio: 0.8,
    now: "2026-05-12T10:00:00.000Z",
  });
  assert.ok(intent);
  assert.equal(intent.intentType, "compound");
  assert.equal(intent.strategyId, "test-strat");
  assert.equal(intent.chain, "base");
  assert.equal(intent.protocol, "aerodrome");
  assert.equal(intent.compoundAmountUsd, 80);
  assert.equal(intent.paybackAmountUsd, 20);
  assert.equal(intent.harvestedAmountUsd, 100);
});

test("buildCompoundIntent uses default compoundRatio 0.80", () => {
  const intent = buildCompoundIntent({
    strategyId: "test-strat",
    chain: "base",
    protocol: "aerodrome",
    harvestedAmountUsd: 100,
  });
  assert.equal(intent.compoundAmountUsd, 80);
  assert.equal(intent.paybackAmountUsd, 20);
});

test("buildCompoundIntent returns null for zero harvest", () => {
  const intent = buildCompoundIntent({
    strategyId: "test-strat",
    chain: "base",
    protocol: "aerodrome",
    harvestedAmountUsd: 0,
  });
  assert.equal(intent, null);
});

test("buildCompoundIntent no-op when feature disabled", () => {
  const intent = buildCompoundIntent(
    {
      strategyId: "test-strat",
      chain: "base",
      protocol: "aerodrome",
      harvestedAmountUsd: 100,
    },
    { profile: { autoCompound: false } },
  );
  assert.equal(intent, null);
});
