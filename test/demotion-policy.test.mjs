import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDemotionPolicy,
  summarizeDemotionEvidence,
  DEMOTION_THRESHOLDS,
} from "../src/executor/policy/demotion-policy.mjs";

function receiptFixture(overrides = {}) {
  return {
    strategyId: "s1",
    source: "signer",
    txHash: "0xabc",
    outcome: "success",
    tsMs: Date.now(),
    realizedProfitSats: 500,
    roundTripCostSats: 50,
    ...overrides,
  };
}

describe("evaluateDemotionPolicy", () => {
  test("throws when strategyId missing", () => {
    assert.throws(() => evaluateDemotionPolicy({ receipts: [], nowMs: Date.now() }), /strategyId required/);
  });

  test("no receipts = clean (no triggers)", () => {
    const result = evaluateDemotionPolicy({ strategyId: "s1", receipts: [], nowMs: Date.now() });
    assert.equal(result.demoted, false);
    assert.deepEqual(result.triggers, []);
  });

  test("single success = clean", () => {
    const nowMs = Date.now();
    const result = evaluateDemotionPolicy({
      strategyId: "s1",
      receipts: [receiptFixture({ tsMs: nowMs - 3600_000 })],
      nowMs,
    });
    assert.equal(result.demoted, false);
    assert.equal(result.triggers.length, 0);
  });

  test("consecutive failures trigger recent_failure_burst", () => {
    const nowMs = Date.now();
    const receipts = [
      receiptFixture({ outcome: "success", tsMs: nowMs - 7200_000 }),
      receiptFixture({ outcome: "failure", tsMs: nowMs - 3600_000 }),
      receiptFixture({ outcome: "failure", tsMs: nowMs - 1800_000 }),
      receiptFixture({ outcome: "failure", tsMs: nowMs - 900_000 }),
    ];
    const result = evaluateDemotionPolicy({ strategyId: "s1", receipts, nowMs });
    assert.equal(result.demoted, true);
    assert.equal(result.triggers[0].kind, "recent_failure_burst");
    assert.equal(result.triggers[0].have, 3);
  });

  test("insufficient receipts skips failure-burst check", () => {
    const nowMs = Date.now();
    const receipts = [
      { strategyId: "s1", source: "simulator", outcome: "failure", tsMs: nowMs - 3600_000 },
    ];
    const result = evaluateDemotionPolicy({ strategyId: "s1", receipts, nowMs });
    assert.equal(result.demoted, false);
    assert.equal(result.triggers.length, 0);
  });

  test("emergency_unwind failure triggers demotion", () => {
    const nowMs = Date.now();
    const receipts = [
      receiptFixture({
        outcome: "failure",
        intentType: "emergency_unwind",
        tsMs: nowMs - 3600_000,
      }),
    ];
    const result = evaluateDemotionPolicy({ strategyId: "s1", receipts, nowMs });
    assert.equal(result.demoted, true);
    assert.equal(result.triggers[0].kind, "emergency_unwind_failure");
  });

  test("no success in window triggers stale_evidence", () => {
    const nowMs = Date.now();
    const receipts = [
      receiptFixture({ outcome: "failure", tsMs: nowMs - 3600_000 }),
    ];
    const result = evaluateDemotionPolicy({ strategyId: "s1", receipts, nowMs });
    assert.equal(result.demoted, true);
    assert.equal(result.triggers[0].kind, "stale_evidence_no_success_in_window");
  });

  test("low round-trip efficiency triggers demotion", () => {
    const nowMs = Date.now();
    const receipts = [
      receiptFixture({
        realizedProfitSats: 10,
        roundTripCostSats: 100,
        tsMs: nowMs - 3600_000,
      }),
    ];
    const result = evaluateDemotionPolicy({ strategyId: "s1", receipts, nowMs });
    assert.equal(result.demoted, true);
    assert.equal(result.triggers[0].kind, "round_trip_efficiency_below_threshold");
  });

  test("zero gross success skips efficiency demotion because there is no measured efficiency", () => {
    const nowMs = Date.now();
    const receipts = [
      receiptFixture({
        realizedProfitSats: 0,
        roundTripCostSats: 0,
        tsMs: nowMs - 3600_000,
      }),
    ];
    const result = evaluateDemotionPolicy({ strategyId: "s1", receipts, nowMs });
    assert.equal(result.demoted, false);
    assert.deepEqual(result.triggers, []);
  });

  test("filters receipts outside lookback", () => {
    const nowMs = Date.now();
    const oldReceipt = receiptFixture({
      outcome: "failure",
      tsMs: nowMs - 7 * 24 * 3600_000,
    });
    const result = evaluateDemotionPolicy({
      strategyId: "s1",
      receipts: [oldReceipt],
      nowMs,
      lookbackDays: 1,
    });
    assert.equal(result.demoted, false);
  });

  test("non-signer receipts are ignored", () => {
    const nowMs = Date.now();
    const receipts = [
      { strategyId: "s1", source: "simulator", outcome: "failure", tsMs: nowMs - 3600_000 },
    ];
    const result = evaluateDemotionPolicy({ strategyId: "s1", receipts, nowMs });
    assert.equal(result.demoted, false);
    assert.equal(result.evidence.signerBackedReceiptCount, 0);
  });

  test("returns frozen objects", () => {
    const result = evaluateDemotionPolicy({ strategyId: "s1", receipts: [], nowMs: Date.now() });
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.triggers));
    assert.ok(Object.isFrozen(result.evidence));
  });
});

describe("summarizeDemotionEvidence", () => {
  test("partitions demoted and clean", () => {
    const reports = [
      { strategyId: "a", demoted: true, triggers: [{ kind: "x" }] },
      { strategyId: "b", demoted: false, triggers: [] },
      { strategyId: "c", demoted: true, triggers: [{ kind: "y" }] },
    ];
    const summary = summarizeDemotionEvidence(reports);
    assert.equal(summary.demotedCount, 2);
    assert.equal(summary.cleanCount, 1);
    assert.deepEqual(summary.demoted, ["a", "c"]);
    assert.deepEqual(summary.clean, ["b"]);
    assert.ok(Object.isFrozen(summary));
    assert.ok(Object.isFrozen(summary.demoted));
  });

  test("throws on non-array", () => {
    assert.throws(() => summarizeDemotionEvidence(null), /reports array required/);
  });
});
