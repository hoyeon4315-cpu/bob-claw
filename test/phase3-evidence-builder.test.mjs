import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPhase3Evidence } from "../src/strategy/phase3-evidence-builder.mjs";

function auditRecord({ strategyId = "s", timestamp = "2026-01-01T00:00:00.000Z", approved = true } = {}) {
  return {
    timestamp,
    strategyId,
    policyVerdict: approved ? "approved" : "rejected",
    lifecycle: { stage: approved ? "confirmed" : "rejected" },
  };
}

function receiptRecord({
  strategyId = "s",
  observedAt = "2026-01-01T00:00:00.000Z",
  pnl = 2,
  cost = 0.1,
  slippageBps = 5,
  oracle = 0.1,
  regime = "neutral",
} = {}) {
  return {
    observedAt,
    strategyId,
    regime,
    realized: {
      realizedNetPnlUsd: pnl,
      actualKnownCostUsd: cost,
      realizedFillVsEstimateBps: slippageBps,
    },
    priceValidation: {
      oracleDivergencePct: oracle,
    },
  };
}

test("buildPhase3Evidence stays blocked when records are absent", () => {
  const evidence = buildPhase3Evidence({ strategyId: "s", now: "2026-05-09T00:00:00.000Z" });
  assert.equal(evidence.autoPromotion.passed, false);
  assert.ok(evidence.autoPromotion.blockers.includes("phase3_evidence_incomplete"));
  assert.ok(evidence.incomplete.includes("walkForward.sharpe"));
  assert.equal(evidence.sampleSummary.signerAuditRecordCount, 0);
  assert.equal(evidence.sampleSummary.receiptRecordCount, 0);
});

test("buildPhase3Evidence computes receipt metrics but refuses incomplete regime evidence", () => {
  const receipts = Array.from({ length: 12 }, (_, index) => receiptRecord({
    observedAt: new Date(Date.UTC(2026, 0, 1 + index * 10)).toISOString(),
    pnl: 2 + index * 0.1,
    regime: "neutral",
  }));
  const audits = receipts.map((record) => auditRecord({ timestamp: record.observedAt }));
  const evidence = buildPhase3Evidence({
    strategyId: "s",
    signerAuditRecords: audits,
    receiptRecords: receipts,
    now: "2026-05-09T00:00:00.000Z",
  });
  assert.equal(evidence.walkForward.samplePeriods, 12);
  assert.equal(evidence.shadow.quoteSuccessRate, 1);
  assert.equal(evidence.execution.edgeAboveCostVariance, true);
  assert.ok(evidence.incomplete.includes("regimeBreakdown.bear"));
  assert.ok(evidence.incomplete.includes("regimeBreakdown.bull_peak"));
  assert.equal(evidence.autoPromotion.passed, false);
});

test("buildPhase3Evidence can produce a passing commit-time evidence object when all gates are backed", () => {
  const regimes = ["bear", "bear", "bear", "neutral", "neutral", "neutral", "bull_peak", "bull_peak", "bull_peak", "neutral", "bear", "bull_peak"];
  const receipts = Array.from({ length: 12 }, (_, index) => receiptRecord({
    observedAt: new Date(Date.UTC(2026, 0, 1 + index * 10)).toISOString(),
    pnl: 2 + index * 0.25,
    cost: 0.05,
    slippageBps: 10,
    oracle: 0.2,
    regime: regimes[index],
  }));
  const audits = receipts.map((record) => auditRecord({ timestamp: record.observedAt }));
  const evidence = buildPhase3Evidence({
    strategyId: "s",
    signerAuditRecords: audits,
    receiptRecords: receipts,
    now: "2026-05-09T00:00:00.000Z",
  });
  assert.deepEqual(evidence.incomplete, []);
  assert.equal(evidence.oosHoldout.holdoutDays, 30);
  assert.equal(evidence.shadow.consecutivePositivePeriods, 12);
  assert.equal(evidence.autoPromotion.passed, true, JSON.stringify(evidence.autoPromotion.blockers));
});
