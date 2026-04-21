import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCanaryPromotion,
  STAGES,
  ACTIONS,
  DEFAULT_THRESHOLDS,
} from "../src/executor/canary/canary-runner.mjs";

const NOW = "2026-04-21T12:00:00.000Z";

test("throws on missing adapterId / bad stage / bad now", () => {
  assert.throws(() => evaluateCanaryPromotion({}), /adapterId/);
  assert.throws(
    () => evaluateCanaryPromotion({ adapterId: "A", currentStage: "nope" }),
    /unknown stage/,
  );
  assert.throws(
    () => evaluateCanaryPromotion({ adapterId: "A", now: "not-a-date" }),
    /valid timestamp/,
  );
});

test("dry_run holds when observations insufficient", () => {
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.DRY_RUN,
    stats: { dryRunObservations: 3 },
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.HOLD);
  assert.equal(out.nextStage, STAGES.DRY_RUN);
  assert.equal(out.reason, "dry_run_insufficient");
});

test("dry_run promotes to canary_1 at threshold", () => {
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.DRY_RUN,
    stats: { dryRunObservations: 8 },
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.PROMOTE_PR);
  assert.equal(out.nextStage, STAGES.CANARY_1);
  assert.equal(out.capRequestSats, DEFAULT_THRESHOLDS.canary1CapSats);
});

test("canary_1 holds with no fills", () => {
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.CANARY_1,
    stats: { successfulFills: 0 },
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.HOLD);
  assert.equal(out.reason, "canary_1_no_fills");
  assert.equal(out.capRequestSats, DEFAULT_THRESHOLDS.canary1CapSats);
});

test("canary_1 holds with fill but non-positive net", () => {
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.CANARY_1,
    stats: { successfulFills: 1, realizedNetSats: 0 },
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.HOLD);
  assert.equal(out.reason, "canary_1_net_not_positive");
});

test("canary_1 promotes to canary_7 on positive fill", () => {
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.CANARY_1,
    stats: { successfulFills: 1, realizedNetSats: 42 },
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.PROMOTE_PR);
  assert.equal(out.nextStage, STAGES.CANARY_7);
  assert.equal(out.capRequestSats, DEFAULT_THRESHOLDS.canary7CapSats);
});

test("canary_7 holds when duration not met", () => {
  const entered = "2026-04-20T12:00:00.000Z"; // 1 day ago
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.CANARY_7,
    stageEnteredAt: entered,
    stats: { realizedNetSats: 500 },
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.HOLD);
  assert.equal(out.reason, "canary_7_duration_pending");
});

test("canary_7 holds when net below min after duration met", () => {
  const entered = "2026-04-14T12:00:00.000Z"; // 7 days ago
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.CANARY_7,
    stageEnteredAt: entered,
    stats: { realizedNetSats: 0 },
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.HOLD);
  assert.equal(out.reason, "canary_7_net_below_min");
});

test("canary_7 promotes to live when duration+net met", () => {
  const entered = "2026-04-14T12:00:00.000Z"; // 7 days
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.CANARY_7,
    stageEnteredAt: entered,
    stats: { realizedNetSats: 500 },
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.PROMOTE_PR);
  assert.equal(out.nextStage, STAGES.LIVE);
  assert.equal(out.capRequestSats, null); // live cap is from config
});

test("consecutive failures demote regardless of stage", () => {
  for (const stage of [STAGES.CANARY_1, STAGES.CANARY_7, STAGES.LIVE]) {
    const out = evaluateCanaryPromotion({
      adapterId: "S1",
      currentStage: stage,
      stats: { consecutiveFailures: 3 },
      now: NOW,
    });
    assert.equal(out.action, ACTIONS.DEMOTE_AND_DISABLE, `stage=${stage}`);
    assert.equal(out.nextStage, STAGES.DISABLED);
    assert.equal(out.reason, "consecutive_failures");
  }
});

test("realized loss beyond threshold demotes", () => {
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.CANARY_7,
    stats: { realizedLossSats: 20_000 },
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.DEMOTE_AND_DISABLE);
  assert.equal(out.reason, "realized_loss_exceeded");
});

test("disabled is terminal until PR", () => {
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.DISABLED,
    stats: { dryRunObservations: 999, successfulFills: 999 },
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.HOLD);
  assert.equal(out.nextStage, STAGES.DISABLED);
  assert.equal(out.reason, "disabled_requires_pr");
});

test("live holds in steady state", () => {
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.LIVE,
    stats: {},
    now: NOW,
  });
  assert.equal(out.action, ACTIONS.HOLD);
  assert.equal(out.reason, "live_steady_state");
});

test("output is frozen and deterministic", () => {
  const args = {
    adapterId: "S1",
    currentStage: STAGES.CANARY_1,
    stats: { successfulFills: 1, realizedNetSats: 42 },
    now: NOW,
  };
  const a = evaluateCanaryPromotion(args);
  const b = evaluateCanaryPromotion(args);
  assert.ok(Object.isFrozen(a));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

test("custom thresholds override defaults", () => {
  const out = evaluateCanaryPromotion({
    adapterId: "S1",
    currentStage: STAGES.DRY_RUN,
    stats: { dryRunObservations: 4 },
    now: NOW,
    thresholds: { dryRunMinObservations: 4 },
  });
  assert.equal(out.action, ACTIONS.PROMOTE_PR);
});
