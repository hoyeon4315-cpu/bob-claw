import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTrailing30dAudit } from "../src/cli/audit-trailing-30d.mjs";

const NOW = "2026-05-08T12:00:00.000Z";

test("trailing 30d audit reports positive metrics and negative signals together", () => {
  const audit = buildTrailing30dAudit({
    now: NOW,
    auditRecords: [
      {
        timestamp: "2026-05-08T00:00:00.000Z",
        stage: "idle_consolidation_planned",
        lifecycleStage: "idle_consolidation_planned",
        candidates: [{ asset: "wBTC.OFT", chain: "soneium", usd: 7 }],
        aggregateUsd: 7,
      },
      {
        timestamp: "2026-05-08T01:00:00.000Z",
        stage: "broadcast",
        policyVerdict: "approved",
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
      },
      {
        timestamp: "2026-05-08T02:00:00.000Z",
        strategyId: "gateway_native_asset_conversion_sleeve",
        policyVerdict: "approved",
        capEvaluation: { effectivePerDayUsd: 200, effectiveMaxDailyLossUsd: 100, clamp: "small_cap_transport" },
      },
      {
        timestamp: "2026-05-08T03:00:00.000Z",
        stage: "merkl_canary_queue",
        chain: "bsc",
        quotaSlotFilled: true,
      },
    ],
    merklCanaryQueue: {
      chainQuotas: [{ chain: "bsc", filled: 1, required: 1 }],
    },
  });

  assert.equal(audit.window.days, 30);
  assert.equal(audit.positive.confirmedBroadcastCount30d, 1);
  assert.equal(audit.positive.idleConsolidationPlannedCount30d, 1);
  assert.equal(audit.positive.transportClampObservedCount30d, 1);
  assert.equal(audit.positive.merklBscQuotaFilled, true);
  assert.equal(audit.negative.idleDispatchForbiddenAssetAlert.count, 0);
  assert.equal(audit.negative.transportClampFalsePositive.count, 0);
});

test("trailing 30d audit alerts on forbidden idle dispatch assets", () => {
  const audit = buildTrailing30dAudit({
    now: NOW,
    auditRecords: [
      {
        timestamp: "2026-05-08T00:00:00.000Z",
        lifecycleStage: "idle_consolidation_planned",
        candidates: [{ asset: "cbBTC", chain: "base", usd: 12 }],
      },
      {
        timestamp: "2026-05-08T00:30:00.000Z",
        lifecycleStage: "idle_consolidation_planned",
        candidates: [{ asset: "native gas", chain: "bsc", usd: 8 }],
      },
    ],
  });

  assert.equal(audit.negative.idleDispatchForbiddenAssetAlert.alert, true);
  assert.equal(audit.negative.idleDispatchForbiddenAssetAlert.count, 2);
  assert.equal(audit.negative.idleDispatchForbiddenAssetAlert.examples[0].asset, "cbBTC");
});

test("trailing 30d audit detects transport clamp false-positive and concentration block evasion retry", () => {
  const audit = buildTrailing30dAudit({
    now: NOW,
    auditRecords: [
      {
        timestamp: "2026-05-08T01:00:00.000Z",
        strategyId: "gateway_native_asset_conversion_sleeve",
        policyVerdict: "rejected",
        amountUsd: 150,
        blockers: ["perDayUsd cap exceeded"],
        metadata: { family: "transport" },
      },
      {
        timestamp: "2026-05-08T02:00:00.000Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        stage: "concentration_guard",
        concentrationGuard: { decision: "BLOCK", reason: "primary chain > 70%" },
      },
      {
        timestamp: "2026-05-08T02:20:00.000Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        policyVerdict: "approved",
        stage: "broadcast",
      },
    ],
  });

  assert.equal(audit.negative.transportClampFalsePositive.alert, true);
  assert.equal(audit.negative.transportClampFalsePositive.count, 1);
  assert.equal(audit.negative.concentrationBlockEvasionRetry.alert, true);
  assert.equal(audit.negative.concentrationBlockEvasionRetry.count, 1);
});

test("trailing 30d audit reports Merkl BSC quota filled but EV gate all rejected ratio without cap suggestions", () => {
  const audit = buildTrailing30dAudit({
    now: NOW,
    auditRecords: [
      {
        timestamp: "2026-05-08T03:00:00.000Z",
        stage: "merkl_canary_queue",
        chain: "bsc",
        quotaSlotFilled: true,
      },
      {
        timestamp: "2026-05-08T03:05:00.000Z",
        strategyId: "venus-bsc-canary",
        chain: "bsc",
        policyVerdict: "rejected",
        blockers: ["EV gate: expected realized net <= cost"],
        metadata: { protocolId: "venus", source: "merkl" },
      },
      {
        timestamp: "2026-05-08T03:10:00.000Z",
        strategyId: "venus-bsc-canary",
        chain: "bsc",
        policyVerdict: "rejected",
        blockers: ["expected_net_pnl_after_costs <= 0"],
        metadata: { protocolId: "venus", source: "merkl" },
      },
    ],
    merklCanaryQueue: {
      chainQuotas: [{ chain: "bsc", filled: 1, required: 1 }],
    },
  });

  assert.equal(audit.negative.merklQuotaFilledEvAllRejectRatio.alert, true);
  assert.equal(audit.negative.merklQuotaFilledEvAllRejectRatio.ratio, 1);
  assert.equal(audit.recommendations.some((item) => /cap raise|raise cap|increase cap/i.test(item)), false);
});
