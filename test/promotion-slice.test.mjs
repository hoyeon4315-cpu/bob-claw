import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildPromotionSlice } from "../src/status/promotion-slice.mjs";

describe("promotion slice", () => {
  test("returns frozen empty slice when no report supplied", () => {
    const slice = buildPromotionSlice(null);
    assert.equal(slice.available, false);
    assert.equal(slice.generatedAt, null);
    assert.equal(slice.lookbackDays, null);
    assert.equal(slice.eligibleCount, 0);
    assert.equal(slice.blockedCount, 0);
    assert.deepEqual(slice.eligible, []);
    assert.deepEqual(slice.blocked, []);
    assert.ok(Object.isFrozen(slice));
    assert.ok(Object.isFrozen(slice.eligible));
    assert.ok(Object.isFrozen(slice.blocked));
  });

  test("handles undefined / wrong-type inputs without throwing", () => {
    assert.equal(buildPromotionSlice(undefined).available, false);
    assert.equal(buildPromotionSlice("not an object").available, false);
    assert.equal(buildPromotionSlice(42).available, false);
  });

  test("summarizes a realistic report shape", () => {
    const report = {
      generatedAt: "2026-04-21T10:00:00Z",
      lookbackDays: 14,
      thresholds: { minSignerBackedReceipts: 8 },
      summary: { eligibleCount: 0, blockedCount: 2 },
      reports: [
        {
          strategyId: "recursive_wrapped_btc_lending_loop",
          eligible: false,
          evidence: { signerBackedReceiptCount: 0 },
          blockers: [
            { kind: "insufficient_signer_backed_receipts", have: 0, need: 8 },
          ],
        },
        {
          strategyId: "gateway-instant-swap-verification",
          eligible: false,
          evidence: { signerBackedReceiptCount: 3 },
          blockers: [
            { kind: "insufficient_signer_backed_receipts", have: 3, need: 8 },
          ],
        },
      ],
    };
    const slice = buildPromotionSlice(report);
    assert.equal(slice.available, true);
    assert.equal(slice.generatedAt, "2026-04-21T10:00:00Z");
    assert.equal(slice.lookbackDays, 14);
    assert.equal(slice.eligibleCount, 0);
    assert.equal(slice.blockedCount, 2);
    assert.equal(slice.blocked[0].strategyId, "recursive_wrapped_btc_lending_loop");
    assert.equal(slice.blocked[0].firstBlocker, "insufficient_signer_backed_receipts");
    assert.equal(slice.blocked[0].receiptsObserved, 0);
    assert.equal(slice.blocked[0].receiptsRequired, 8);
    assert.equal(slice.blocked[1].receiptsObserved, 3);
  });

  test("promotes eligible strategies into the eligible list", () => {
    const report = {
      generatedAt: "2026-04-21T10:00:00Z",
      lookbackDays: 14,
      thresholds: { minSignerBackedReceipts: 8 },
      reports: [
        {
          strategyId: "promoted_strategy",
          eligible: true,
          evidence: { signerBackedReceiptCount: 10 },
          blockers: [],
        },
        {
          strategyId: "blocked_strategy",
          eligible: false,
          evidence: { signerBackedReceiptCount: 0 },
          blockers: ["insufficient_signer_backed_receipts"],
        },
      ],
    };
    const slice = buildPromotionSlice(report);
    assert.equal(slice.eligibleCount, 1);
    assert.equal(slice.blockedCount, 1);
    assert.equal(slice.eligible[0].strategyId, "promoted_strategy");
    assert.equal(slice.blocked[0].strategyId, "blocked_strategy");
    assert.equal(slice.blocked[0].firstBlocker, "insufficient_signer_backed_receipts");
  });

  test("never surfaces suggestedDiff body (invariant: stays off public dashboard)", () => {
    const report = {
      generatedAt: "2026-04-21T10:00:00Z",
      lookbackDays: 14,
      thresholds: { minSignerBackedReceipts: 8 },
      reports: [
        {
          strategyId: "sensitive_strategy",
          eligible: true,
          evidence: { signerBackedReceiptCount: 9 },
          blockers: [],
          suggestedDiff: {
            file: "src/config/strategy-caps.mjs",
            operatorAction: "do not leak into mobile dashboard",
          },
        },
      ],
    };
    const slice = buildPromotionSlice(report);
    const json = JSON.stringify(slice);
    assert.equal(json.includes("suggestedDiff"), false);
    assert.equal(json.includes("operatorAction"), false);
    assert.equal(json.includes("strategy-caps.mjs"), false);
  });

  test("tolerates malformed report entries", () => {
    const report = {
      reports: [
        null,
        { /* missing strategyId */ eligible: true },
        { strategyId: "ok", eligible: false, blockers: [] },
      ],
    };
    const slice = buildPromotionSlice(report);
    assert.equal(slice.blockedCount, 1);
    assert.equal(slice.blocked[0].firstBlocker, "unknown");
  });
});
