import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDynamicLiveGate } from "../src/status/dynamic-live-gate.mjs";

const NOW = "2026-04-21T12:00:00Z";
const NOW_MS = Date.parse(NOW);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function agoIso(ms) {
  return new Date(NOW_MS - ms).toISOString();
}

const freshPolicyReady = {
  verdict: { code: "policy_ready", observedAt: agoIso(1 * DAY) },
  shadowObservationCount: 12,
};

const freshReval = { lastTickAt: agoIso(1 * HOUR), consecutiveFailures: 0 };

test("all-green => allow_live", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: freshPolicyReady,
    revalidationSnapshot: freshReval,
    now: NOW,
  });
  assert.equal(r.gated, false);
  assert.equal(r.action, "allow_live");
  assert.equal(r.liveTradingHint, "ALLOWED");
  assert.equal(r.blockers.length, 0);
});

test("non-policy-ready verdict blocks", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: { verdict: { code: "positive_but_below_policy", observedAt: agoIso(DAY) }, shadowObservationCount: 12 },
    revalidationSnapshot: freshReval,
    now: NOW,
  });
  assert.equal(r.gated, true);
  assert.ok(r.blockers.some((b) => b.kind === "verdict_not_policy_ready"));
});

test("verdict older than horizon blocks", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: { verdict: { code: "policy_ready", observedAt: agoIso(30 * DAY) }, shadowObservationCount: 12 },
    revalidationSnapshot: freshReval,
    now: NOW,
  });
  assert.equal(r.gated, true);
  assert.ok(r.blockers.some((b) => b.kind === "verdict_outside_horizon"));
});

test("missing verdict timestamp blocks", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: { verdict: { code: "policy_ready" }, shadowObservationCount: 12 },
    revalidationSnapshot: freshReval,
    now: NOW,
  });
  assert.ok(r.blockers.some((b) => b.kind === "verdict_timestamp_missing"));
});

test("insufficient shadow observations blocks", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: { verdict: { code: "policy_ready", observedAt: agoIso(DAY) }, shadowObservationCount: 3 },
    revalidationSnapshot: freshReval,
    now: NOW,
  });
  assert.equal(r.gated, true);
  assert.ok(r.blockers.some((b) => b.kind === "insufficient_shadow_observations"));
});

test("stale revalidation blocks", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: freshPolicyReady,
    revalidationSnapshot: { lastTickAt: agoIso(48 * HOUR), consecutiveFailures: 0 },
    now: NOW,
  });
  assert.equal(r.gated, true);
  assert.ok(r.blockers.some((b) => b.kind === "revalidation_stale"));
});

test("revalidation never ran blocks", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: freshPolicyReady,
    revalidationSnapshot: null,
    now: NOW,
  });
  assert.ok(r.blockers.some((b) => b.kind === "revalidation_never_ran"));
});

test("consecutiveFailures>=3 blocks; 1-2 warns only", () => {
  const r1 = evaluateDynamicLiveGate({
    edgeViability: freshPolicyReady,
    revalidationSnapshot: { ...freshReval, consecutiveFailures: 3 },
    now: NOW,
  });
  assert.equal(r1.gated, true);
  assert.ok(r1.blockers.some((b) => b.kind === "revalidation_failing"));

  const r2 = evaluateDynamicLiveGate({
    edgeViability: freshPolicyReady,
    revalidationSnapshot: { ...freshReval, consecutiveFailures: 2 },
    now: NOW,
  });
  assert.equal(r2.gated, false);
  assert.ok(r2.warnings.some((w) => w.kind === "revalidation_partial_failure"));
});

test("horizonDays override respected", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: { verdict: { code: "policy_ready", observedAt: agoIso(10 * DAY) }, shadowObservationCount: 12 },
    revalidationSnapshot: freshReval,
    now: NOW,
    horizonDays: 7,
  });
  assert.equal(r.horizonDays, 7);
  assert.ok(r.blockers.some((b) => b.kind === "verdict_outside_horizon"));
});

test("future verdict timestamp => skew warning, not blocker", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: {
      verdict: { code: "policy_ready", observedAt: new Date(NOW_MS + 5 * HOUR).toISOString() },
      shadowObservationCount: 12,
    },
    revalidationSnapshot: freshReval,
    now: NOW,
  });
  assert.equal(r.gated, false);
  assert.ok(r.warnings.some((w) => w.kind === "verdict_timestamp_skewed"));
});

test("frozen output", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: freshPolicyReady,
    revalidationSnapshot: freshReval,
    now: NOW,
  });
  assert.throws(() => { r.gated = true; });
  assert.throws(() => { r.blockers.push({}); });
});

test("multiple blockers accumulate", () => {
  const r = evaluateDynamicLiveGate({
    edgeViability: { verdict: { code: "no_measured_loops" }, shadowObservationCount: 0 },
    revalidationSnapshot: null,
    now: NOW,
  });
  const kinds = r.blockers.map((b) => b.kind);
  assert.ok(kinds.includes("verdict_not_policy_ready"));
  assert.ok(kinds.includes("verdict_timestamp_missing"));
  assert.ok(kinds.includes("insufficient_shadow_observations"));
  assert.ok(kinds.includes("revalidation_never_ran"));
});

test("rejects invalid now/horizon", () => {
  assert.throws(() => evaluateDynamicLiveGate({ now: "not-a-date" }));
  assert.throws(() => evaluateDynamicLiveGate({ now: NOW, horizonDays: 0 }));
  assert.throws(() => evaluateDynamicLiveGate({ now: NOW, horizonDays: -1 }));
});
