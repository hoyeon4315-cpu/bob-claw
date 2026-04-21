import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePromotionEvidence,
  summarizePromotionEvidence,
  buildAutoExecDiffHint,
  PROMOTION_THRESHOLDS,
  PROMOTION_THRESHOLDS_STRICT,
} from "../src/strategy/promotion-evidence.mjs";
import { buildPromotionReport, loadAuditReceipts } from "../src/cli/promotion-pr-preview.mjs";

const NOW = Date.parse("2026-04-21T00:00:00Z");
const ONE_DAY = 24 * 60 * 60 * 1000;
// Strict-policy overrides — used by tests written against the
// pre-fast-track 14-day / 8-receipt regime. New tests below cover the
// fast-track defaults explicitly.
const STRICT = Object.freeze({
  lookbackDays: 14,
  thresholds: PROMOTION_THRESHOLDS_STRICT,
});

function mkReceipt({ daysAgo = 0, success = true, signer = true, profit = 1000, cost = 50 } = {}) {
  return {
    strategyId: "wrapped-btc-loop-base-moonwell",
    tsMs: NOW - daysAgo * ONE_DAY,
    source: signer ? "signer" : "shadow",
    txHash: signer ? `0x${Math.random().toString(16).slice(2).padEnd(40, "0")}` : null,
    outcome: success ? "success" : "failure",
    realizedProfitSats: success ? profit : 0,
    roundTripCostSats: cost,
  };
}

describe("promotion evidence — pure gate", () => {
  test("rejects when no signer-backed receipts exist", () => {
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts: [],
      ...STRICT,
      nowMs: NOW,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.blockers.some((b) => b.kind === "insufficient_signer_backed_receipts"));
    assert.equal(r.suggestedDiff, null);
  });

  test("approves when all thresholds met", () => {
    const receipts = [];
    // 10 successful signer-backed receipts with 6_000 sats profit each.
    for (let i = 0; i < 10; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 6000 }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
    });
    assert.equal(r.eligible, true, JSON.stringify(r.blockers));
    assert.equal(r.evidence.signerBackedReceiptCount, 10);
    assert.ok(r.evidence.consecutiveSuccess >= PROMOTION_THRESHOLDS.minConsecutiveSuccess);
    assert.equal(r.suggestedDiff.file, "src/config/strategy-caps.mjs");
  });

  test("blocks when too many failures", () => {
    const receipts = [];
    for (let i = 0; i < 10; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 6000 }));
    receipts.push(mkReceipt({ daysAgo: 1, success: false }));
    receipts.push(mkReceipt({ daysAgo: 2, success: false }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.blockers.some((b) => b.kind === "too_many_failures"));
  });

  test("blocks when consecutive success is broken by recent failure", () => {
    const receipts = [];
    for (let i = 7; i < 12; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 6000 }));
    for (let i = 0; i < 4; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 6000 }));
    receipts.push(mkReceipt({ daysAgo: 0.5, success: false }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
    });
    assert.ok(r.blockers.some((b) => b.kind === "insufficient_consecutive_success"));
  });

  test("blocks when round-trip efficiency below 0.9", () => {
    const receipts = [];
    for (let i = 0; i < 10; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 700, cost: 300 }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
    });
    assert.ok(r.blockers.some((b) => b.kind === "round_trip_efficiency_below_target"), JSON.stringify(r.evidence));
  });

  test("ignores receipts outside lookback window", () => {
    const receipts = [];
    for (let i = 0; i < 10; i += 1) receipts.push(mkReceipt({ daysAgo: 30 + i, profit: 6000 }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
      lookbackDays: 14,
    });
    assert.equal(r.evidence.signerBackedReceiptCount, 0);
    assert.equal(r.eligible, false);
  });

  test("ignores shadow (non-signer) receipts", () => {
    const receipts = [];
    for (let i = 0; i < 20; i += 1) receipts.push(mkReceipt({ daysAgo: i, signer: false }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
    });
    assert.equal(r.evidence.signerBackedReceiptCount, 0);
  });

  test("strategyId filter scopes to one lane", () => {
    const receipts = [];
    for (let i = 0; i < 10; i += 1) receipts.push({
      ...mkReceipt({ daysAgo: i, profit: 6000 }),
      strategyId: "other-strategy",
    });
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
    });
    assert.equal(r.evidence.signerBackedReceiptCount, 0);
  });

  test("buildAutoExecDiffHint returns operator-actionable hint, not a patch", () => {
    const hint = buildAutoExecDiffHint("recursive_wrapped_btc_lending_loop");
    assert.equal(hint.file, "src/config/strategy-caps.mjs");
    assert.equal(hint.strategyId, "recursive_wrapped_btc_lending_loop");
    assert.match(hint.change, /autoExecute/);
    assert.ok(hint.operatorAction.includes("npm test"));
  });

  test("summarizePromotionEvidence aggregates correctly", () => {
    const reports = [
      Object.freeze({ strategyId: "a", eligible: true, blockers: [] }),
      Object.freeze({ strategyId: "b", eligible: false, blockers: [{ kind: "x" }] }),
    ];
    const s = summarizePromotionEvidence(reports);
    assert.equal(s.eligibleCount, 1);
    assert.equal(s.blockedCount, 1);
    assert.deepEqual([...s.eligible], ["a"]);
    assert.equal(s.blocked[0].firstBlocker, "x");
  });

  test("evaluatePromotionEvidence rejects bad input", () => {
    assert.throws(() => evaluatePromotionEvidence({ strategyId: "", receipts: [], nowMs: 0 }), /strategyId/);
    assert.throws(() => evaluatePromotionEvidence({ strategyId: "x", receipts: null, nowMs: 0 }), /receipts/);
    assert.throws(() => evaluatePromotionEvidence({ strategyId: "x", receipts: [], nowMs: NaN }), /nowMs/);
  });

  test("result is frozen", () => {
    const r = evaluatePromotionEvidence({
      strategyId: "x",
      receipts: [],
      ...STRICT,
      nowMs: NOW,
    });
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(r.evidence));
    assert.ok(Object.isFrozen(r.blockers));
  });

  test("walk-forward + regime evidence: absent by default (backwards compatible)", () => {
    const receipts = [];
    for (let i = 0; i < 10; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 6000 }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
    });
    assert.equal(r.eligible, true);
    assert.equal(r.evidence.walkForwardApplied, false);
    assert.equal(r.evidence.walkForwardPasses, null);
    assert.equal(r.evidence.regimeWindowApplied, false);
    assert.equal(r.evidence.regimeWindowHasChange, null);
  });

  test("walk-forward failing report blocks promotion", () => {
    const receipts = [];
    for (let i = 0; i < 10; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 6000 }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
      walkForwardReport: { passes: false, blockers: ["insufficient_folds_passed"] },
    });
    assert.equal(r.eligible, false);
    const b = r.blockers.find((x) => x.kind === "walk_forward_cv_failed");
    assert.ok(b);
    assert.deepEqual([...b.cvBlockers], ["insufficient_folds_passed"]);
    assert.equal(r.evidence.walkForwardApplied, true);
    assert.equal(r.evidence.walkForwardPasses, false);
  });

  test("walk-forward passing report does not block", () => {
    const receipts = [];
    for (let i = 0; i < 10; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 6000 }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
      walkForwardReport: { passes: true, blockers: [] },
    });
    assert.equal(r.eligible, true);
    assert.equal(r.evidence.walkForwardPasses, true);
  });

  test("regime window without change blocks promotion", () => {
    const receipts = [];
    for (let i = 0; i < 10; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 6000 }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
      regimeWindow: { hasChange: false },
    });
    assert.equal(r.eligible, false);
    assert.ok(r.blockers.some((b) => b.kind === "no_regime_change_in_sample_window"));
    assert.equal(r.evidence.regimeWindowApplied, true);
    assert.equal(r.evidence.regimeWindowHasChange, false);
  });

  test("regime window with change does not block", () => {
    const receipts = [];
    for (let i = 0; i < 10; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 6000 }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
      regimeWindow: { hasChange: true },
    });
    assert.equal(r.eligible, true);
    assert.equal(r.evidence.regimeWindowHasChange, true);
  });

  test("fast-track defaults: 2 receipts in 3 days promotes (operator opt-in)", () => {
    // The committed fast-track policy (PROMOTION_THRESHOLDS, the active
    // export) is intentionally permissive so a dust-canary lane with
    // perTradeCapUsd≈$1 can promote in days, not weeks. This test pins
    // that contract — changing it requires another committed diff.
    assert.equal(PROMOTION_THRESHOLDS.minSignerBackedReceipts, 2);
    assert.equal(PROMOTION_THRESHOLDS.minConsecutiveSuccess, 1);
    assert.equal(PROMOTION_THRESHOLDS.defaultLookbackDays, 3);
    assert.equal(PROMOTION_THRESHOLDS.minRoundTripEfficiency, 0.9);
    assert.ok(Object.isFrozen(PROMOTION_THRESHOLDS));
    assert.ok(Object.isFrozen(PROMOTION_THRESHOLDS_STRICT));

    // 2 signer-backed receipts in last 2 days → eligible under fast-track.
    const receipts = [
      mkReceipt({ daysAgo: 0, profit: 1000 }),
      mkReceipt({ daysAgo: 1, profit: 1000 }),
    ];
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      nowMs: NOW,
    });
    assert.equal(r.eligible, true, JSON.stringify(r.blockers));
    assert.equal(r.evidence.signerBackedReceiptCount, 2);

    // Same evidence under STRICT policy → blocked.
    const rStrict = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      nowMs: NOW,
      ...STRICT,
    });
    assert.equal(rStrict.eligible, false);
    assert.ok(
      rStrict.blockers.some((b) => b.kind === "insufficient_signer_backed_receipts"),
    );
  });

  test("walk-forward + regime both applied together", () => {
    const receipts = [];
    for (let i = 0; i < 10; i += 1) receipts.push(mkReceipt({ daysAgo: i, profit: 6000 }));
    const r = evaluatePromotionEvidence({
      strategyId: "wrapped-btc-loop-base-moonwell",
      receipts,
      ...STRICT,
      nowMs: NOW,
      walkForwardReport: { passes: true, blockers: [] },
      regimeWindow: { hasChange: true },
    });
    assert.equal(r.eligible, true);
    assert.equal(r.evidence.walkForwardApplied, true);
    assert.equal(r.evidence.regimeWindowApplied, true);
  });
});

describe("promotion-pr-preview CLI helpers", () => {
  test("loadAuditReceipts handles missing file gracefully", () => {
    const r = loadAuditReceipts("/nonexistent/path/to/audit.jsonl");
    assert.deepEqual(r, []);
  });

  test("buildPromotionReport produces stable shape", () => {
    const report = buildPromotionReport({
      receipts: [],
      ...STRICT,
      nowMs: NOW,
      strategyIds: ["recursive_wrapped_btc_lending_loop"],
      lookbackDays: 14,
    });
    assert.equal(report.lookbackDays, 14);
    assert.equal(report.summary.eligibleCount, 0);
    assert.equal(report.summary.blockedCount, 1);
    assert.equal(report.reports[0].strategyId, "recursive_wrapped_btc_lending_loop");
    assert.equal(typeof report.generatedAt, "string");
  });
});
