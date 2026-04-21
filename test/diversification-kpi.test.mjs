import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDiversificationKpiSlice } from "../src/executor/payback/diversification-kpi.mjs";

test("empty allocations => status healthy, hhi=0, activeN=0", () => {
  const slice = buildDiversificationKpiSlice({ allocations: {}, observedAt: "2026-04-21T00:00:00Z" });
  assert.equal(slice.status, "healthy");
  assert.equal(slice.hhi, 0);
  assert.equal(slice.activeStrategies, 0);
  assert.equal(slice.effectiveN, 0);
  assert.equal(slice.schemaVersion, 1);
  assert.equal(slice.observedAt, "2026-04-21T00:00:00Z");
});

test("slice is frozen", () => {
  const slice = buildDiversificationKpiSlice({ allocations: {} });
  assert.throws(() => { slice.hhi = 99; });
  assert.throws(() => { slice.topStrategies.push({}); });
});

test("healthy diversified portfolio", () => {
  const slice = buildDiversificationKpiSlice({
    allocations: {
      perStrategy: { s1: 0.2, s2: 0.2, s3: 0.2, s4: 0.2, s5: 0.2 },
      perChain: { base: 0.3, bob: 0.1, avalanche: 0.2 },
      perProtocol: { moonwell: 0.25, pendle: 0.25 },
      bobL2DirectShare: 0.05,
    },
  });
  assert.equal(slice.status, "healthy");
  assert.equal(slice.activeStrategies, 5);
  assert.equal(slice.activeChains, 3);
  assert.equal(slice.activeProtocols, 2);
  assert.ok(Math.abs(slice.hhi - 0.2) < 1e-9);
  assert.ok(Math.abs(slice.effectiveN - 5) < 1e-6);
});

test("topStrategies sorted descending", () => {
  const slice = buildDiversificationKpiSlice({
    allocations: {
      perStrategy: { s1: 0.1, s2: 0.25, s3: 0.05, s4: 0.15 },
    },
  });
  assert.equal(slice.topStrategies[0].id, "s2");
  assert.equal(slice.topStrategies[1].id, "s4");
  assert.equal(slice.topStrategies[2].id, "s1");
  assert.equal(slice.topStrategies[3].id, "s3");
});

test("violation surfaces in slice", () => {
  const slice = buildDiversificationKpiSlice({
    allocations: {
      perStrategy: { s1: 0.4 },
    },
  });
  assert.equal(slice.status, "violation");
  assert.ok(slice.violations.some((v) => v.kind === "per_strategy_share_exceeded"));
});

test("Gateway official chains exposed", () => {
  const slice = buildDiversificationKpiSlice({ allocations: {} });
  assert.equal(slice.gatewayOfficialChains.length, 11);
  assert.ok(slice.gatewayOfficialChains.includes("base"));
  assert.ok(!slice.gatewayOfficialChains.includes("arbitrum"));
});

test("policy thresholds embedded for dashboard legend", () => {
  const slice = buildDiversificationKpiSlice({ allocations: {} });
  assert.equal(slice.policy.perStrategyMaxShare, 0.25);
  assert.equal(slice.policy.hhiMax, 0.30);
});
