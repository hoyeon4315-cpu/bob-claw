import assert from "node:assert/strict";
import { test } from "node:test";
import {
  scoreBriberyRevenue,
  featureEnabled,
} from "../src/strategy/bribery-source.mjs";
import { resolveAggressionProfile } from "../src/config/aggression-profile.mjs";

test("high revenue + high confidence → review action", () => {
  const result = scoreBriberyRevenue({
    validator: "val-1",
    blockBuilder: "builder-1",
    chain: "base",
    mockSource: { estimatedRevenueBps: 8, confidence: 0.85, source: "mock" },
  });
  assert.equal(result.estimatedRevenueBps, 8);
  assert.equal(result.confidence, 0.85);
  assert.equal(result.action.type, "review");
});

test("low revenue → no action", () => {
  const result = scoreBriberyRevenue({
    validator: "val-1",
    blockBuilder: "builder-1",
    chain: "base",
    mockSource: { estimatedRevenueBps: 3, confidence: 0.85, source: "mock" },
  });
  assert.equal(result.estimatedRevenueBps, 3);
  assert.equal(result.action, undefined);
});

test("profile: aggressive_calibrated has briberySourceEnabled=true", () => {
  const profile = resolveAggressionProfile("aggressive_calibrated");
  assert.equal(profile.briberySourceEnabled, true);
});

test("profile: safety_first has briberySourceEnabled=false", () => {
  const profile = resolveAggressionProfile("safety_first");
  assert.equal(profile.briberySourceEnabled, false);
});

test("featureEnabled returns true for aggressive_calibrated", () => {
  const profile = resolveAggressionProfile("aggressive_calibrated");
  assert.equal(featureEnabled(profile), true);
});

test("featureEnabled returns false for safety_first", () => {
  const profile = resolveAggressionProfile("safety_first");
  assert.equal(featureEnabled(profile), false);
});

test("feature flags off → scoreBriberyRevenue is no-op", () => {
  const profile = resolveAggressionProfile("safety_first");
  const result = scoreBriberyRevenue({
    validator: "val-1",
    blockBuilder: "builder-1",
    chain: "base",
    mockSource: { estimatedRevenueBps: 8, confidence: 0.85, source: "mock" },
    profile,
  });
  assert.equal(result.action, undefined);
});
