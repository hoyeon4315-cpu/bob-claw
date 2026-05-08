import assert from "node:assert/strict";
import test from "node:test";

import {
  ABSOLUTE_CEILING_SATS,
  ABSOLUTE_FLOOR_SATS,
  MIN_PAYBACK_PCT_OF_CAPITAL,
  PAYBACK_CONFIG,
  effectiveMinPaybackSats,
} from "../src/config/payback.mjs";
import { loadPaybackPolicyConfig } from "../src/executor/payback/scheduler.mjs";

test("payback config exposes capital-aware minimum constants without changing ratio caps", () => {
  assert.equal(MIN_PAYBACK_PCT_OF_CAPITAL, 0.005);
  assert.equal(ABSOLUTE_FLOOR_SATS, 5_000);
  assert.equal(ABSOLUTE_CEILING_SATS, 50_000);
  assert.equal(PAYBACK_CONFIG.baseRatio, 0.20);
  assert.equal(PAYBACK_CONFIG.maxOfframpCostPctOfPayback, 0.10);
  assert.equal(PAYBACK_CONFIG.perPeriodMaxSats, 500_000);
  assert.equal(PAYBACK_CONFIG.annualMaxPaybackSats, 26_000_000);
});

test("effectiveMinPaybackSats clamps by percent floor and absolute bounds", () => {
  assert.equal(effectiveMinPaybackSats({ operatingCapitalSats: 620_000 }), 5_000);
  assert.equal(effectiveMinPaybackSats({ operatingCapitalSats: 2_000_000 }), 10_000);
  assert.equal(effectiveMinPaybackSats({ operatingCapitalSats: 100_000_000 }), 50_000);
  assert.equal(effectiveMinPaybackSats({ operatingCapitalSats: null }), 50_000);
});

test("scheduler policy loader records static and effective payback minimums", () => {
  const policy = loadPaybackPolicyConfig(PAYBACK_CONFIG, {
    operatingCapitalSats: 620_000,
  });

  assert.equal(policy.staticMinPaybackSats, 50_000);
  assert.equal(policy.minPaybackSats, 5_000);
  assert.equal(policy.minPaybackPctOfCapital, 0.005);
  assert.equal(policy.absoluteFloorSats, 5_000);
  assert.equal(policy.absoluteCeilingSats, 50_000);
  assert.equal(policy.operatingCapitalSats, 620_000);
});
