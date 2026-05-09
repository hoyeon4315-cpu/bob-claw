import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGY_PAUSE_STATE,
  strategyPauseResetFor,
} from "../../src/config/strategy-pause-state.mjs";
import { evaluateCanaryGraduation } from "../../src/executor/canary/canary-graduation.mjs";
import { evaluateConsecutiveFailures } from "../../src/executor/policy/consecutive-failures.mjs";

const GATEWAY_STRATEGY_ID = "gateway_native_asset_conversion_sleeve";

function revertedAuditRow({ timestamp, intentHash }) {
  return {
    strategyId: GATEWAY_STRATEGY_ID,
    chain: "ethereum",
    intentId: intentHash,
    intentHash,
    timestamp,
    policyVerdict: "errored",
    lifecycle: { stage: "reverted" },
  };
}

function canaryFailure(timestamp, id) {
  return {
    observedAt: timestamp,
    status: "reverted",
    queueItem: {
      opportunityId: id,
      chain: "ethereum",
      protocolId: "morpho",
      mappedStrategyId: GATEWAY_STRATEGY_ID,
    },
    execution: {
      settlementStatus: "reverted",
      txHash: `0x${id}`,
    },
  };
}

test("strategy pause state is committed, frozen, and evidence referenced", () => {
  assert.equal(Object.isFrozen(STRATEGY_PAUSE_STATE), true);
  assert.equal(Object.isFrozen(STRATEGY_PAUSE_STATE.paused), true);
  assert.equal(Object.isFrozen(STRATEGY_PAUSE_STATE.reset), true);

  const reset = strategyPauseResetFor(GATEWAY_STRATEGY_ID);
  assert.match(reset.evidenceRef, /^[0-9a-f]{40}$/);
  assert.equal(Number.isFinite(new Date(reset.resetAt).getTime()), true);
});

test("committed reset clears pre-evidence consecutive failure streaks only", () => {
  const beforeOnly = evaluateConsecutiveFailures({
    intent: {
      strategyId: GATEWAY_STRATEGY_ID,
      chain: "ethereum",
      intentId: "next-intent",
    },
    auditRecords: [
      revertedAuditRow({ timestamp: "2026-05-02T00:00:00.000Z", intentHash: "fail-1" }),
      revertedAuditRow({ timestamp: "2026-05-02T00:01:00.000Z", intentHash: "fail-2" }),
      revertedAuditRow({ timestamp: "2026-05-02T00:02:00.000Z", intentHash: "fail-3" }),
    ],
    maxConsecutiveFailures: 2,
    now: "2026-05-09T05:00:00.000Z",
  });

  assert.equal(beforeOnly.decision, "ALLOW");
  assert.equal(beforeOnly.metrics.consecutiveFailures, 0);
  assert.equal(beforeOnly.metrics.resumeAfter, "2026-05-09T02:06:00.000Z");
  assert.equal(beforeOnly.metrics.committedReset.evidenceRef, strategyPauseResetFor(GATEWAY_STRATEGY_ID).evidenceRef);

  const afterReset = evaluateConsecutiveFailures({
    intent: {
      strategyId: GATEWAY_STRATEGY_ID,
      chain: "ethereum",
      intentId: "next-intent",
    },
    auditRecords: [
      revertedAuditRow({ timestamp: "2026-05-02T00:00:00.000Z", intentHash: "old-fail" }),
      revertedAuditRow({ timestamp: "2026-05-09T02:07:00.000Z", intentHash: "new-fail-1" }),
      revertedAuditRow({ timestamp: "2026-05-09T02:08:00.000Z", intentHash: "new-fail-2" }),
    ],
    maxConsecutiveFailures: 2,
    now: "2026-05-09T05:00:00.000Z",
  });

  assert.equal(afterReset.decision, "BLOCK");
  assert.ok(afterReset.blockers.includes("max_consecutive_failures_reached"));
});

test("committed reset clears pre-evidence canary graduation failures only", () => {
  const queueItem = {
    opportunityId: "next",
    chain: "ethereum",
    protocolId: "morpho",
    mappedStrategyId: GATEWAY_STRATEGY_ID,
  };
  const policy = {
    enabled: true,
    rungsUsd: [5],
    maxAutoGraduatedUsd: 5,
    maxSubstantiveFailures: 2,
    realizedDailyLossLockUsd: 25,
    realizedLossWindowMs: 24 * 60 * 60 * 1000,
  };

  const beforeOnly = evaluateCanaryGraduation({
    queueItem,
    canaryExecutions: [
      canaryFailure("2026-05-02T00:00:00.000Z", "aaa"),
      canaryFailure("2026-05-02T00:01:00.000Z", "bbb"),
    ],
    policy,
    now: "2026-05-09T05:00:00.000Z",
  });

  assert.equal(beforeOnly.status, "ready");
  assert.equal(beforeOnly.evidence.substantiveFailureCount, 0);
  assert.equal(beforeOnly.evidence.committedReset.evidenceRef, strategyPauseResetFor(GATEWAY_STRATEGY_ID).evidenceRef);

  const afterReset = evaluateCanaryGraduation({
    queueItem,
    canaryExecutions: [
      canaryFailure("2026-05-02T00:00:00.000Z", "aaa"),
      canaryFailure("2026-05-09T02:07:00.000Z", "ccc"),
      canaryFailure("2026-05-09T02:08:00.000Z", "ddd"),
    ],
    policy,
    now: "2026-05-09T05:00:00.000Z",
  });

  assert.equal(afterReset.status, "blocked");
  assert.ok(afterReset.blockers.includes("canary_graduation_failure_pause"));
});
