import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectFirstMoverOpportunities,
  canActivateAggressiveProfile,
  featureEnabled,
} from "../src/strategy/first-mover-detector.mjs";
import { resolveAggressionProfile } from "../src/config/aggression-profile.mjs";

function protocolFixture(overrides = {}) {
  return {
    protocol: "new-pool-1",
    firstSeenAt: Date.now() - 1 * 60 * 60 * 1000,
    tvlUsd: 1_000_000,
    impliedApr: 15,
    ageHours: 1,
    ...overrides,
  };
}

test("new protocol detected → candidate returned", () => {
  const protocols = [protocolFixture()];
  const result = detectFirstMoverOpportunities({ protocols, chain: "base" });
  assert.equal(result.length, 1);
  assert.equal(result[0].protocol, "new-pool-1");
  assert.equal(result[0].chain, "base");
  assert.ok(result[0].score > 0);
});

test("existing protocol → excluded", () => {
  const protocols = [protocolFixture()];
  const registryResult = {
    records: [{ strategyId: "new-pool-1", dedupeKey: "new-pool-1" }],
  };
  const result = detectFirstMoverOpportunities({
    protocols,
    chain: "base",
    registryResult,
  });
  assert.equal(result.length, 0);
});

test("old protocol (>24h) → excluded", () => {
  const protocols = [
    protocolFixture({ firstSeenAt: Date.now() - 48 * 60 * 60 * 1000 }),
  ];
  const result = detectFirstMoverOpportunities({ protocols, chain: "base" });
  assert.equal(result.length, 0);
});

test("featureEnabled returns true for aggressive_calibrated", () => {
  const profile = resolveAggressionProfile("aggressive_calibrated");
  assert.equal(featureEnabled(profile), true);
});

test("featureEnabled returns false for safety_first", () => {
  const profile = resolveAggressionProfile("safety_first");
  assert.equal(featureEnabled(profile), false);
});

test("canActivateAggressiveProfile: 2 evidence + clean audit → canActivate=true", () => {
  const result = canActivateAggressiveProfile({
    evidenceCount: 2,
    auditReplayClean: true,
  });
  assert.equal(result.canActivate, true);
});

test("canActivateAggressiveProfile: 1 evidence → canActivate=false", () => {
  const result = canActivateAggressiveProfile({
    evidenceCount: 1,
    auditReplayClean: true,
  });
  assert.equal(result.canActivate, false);
});

test("canActivateAggressiveProfile: 2 evidence + dirty audit → canActivate=false", () => {
  const result = canActivateAggressiveProfile({
    evidenceCount: 2,
    auditReplayClean: false,
  });
  assert.equal(result.canActivate, false);
});

test("feature flags off → detectFirstMoverOpportunities returns empty", () => {
  const profile = resolveAggressionProfile("safety_first");
  const protocols = [protocolFixture()];
  const result = detectFirstMoverOpportunities({ protocols, chain: "base", profile });
  assert.equal(result.length, 0);
});
