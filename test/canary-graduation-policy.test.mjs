import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCanaryOutcome,
  evaluateCanaryGraduation,
} from "../src/executor/canary/canary-graduation.mjs";

const POLICY = Object.freeze({
  enabled: true,
  rungsUsd: Object.freeze([5, 10, 25, 50, 80]),
  maxAutoGraduatedUsd: 80,
  ethereumMinRungUsd: 25,
  minDeliveredForSecondRung: 1,
  minDeliveredForThirdRung: 2,
  minPositiveRealizedForThirdRung: 1,
  minPositiveRealizedForFourthRung: 2,
  minDistinctWindowsForFourthRung: 2,
  minPositiveRealizedForFifthRung: 3,
  minDistinctWindowsForFifthRung: 2,
  realizedLossWindowMs: 24 * 60 * 60 * 1000,
  realizedDailyLossLockUsd: 25,
  maxSubstantiveFailures: 2,
});
const TEST_STRATEGY_ID = "test_canary_graduation_strategy";

function queueItem(overrides = {}) {
  return {
    opportunityId: "opp-new",
    chain: "base",
    protocolId: "yo",
    mappedStrategyId: TEST_STRATEGY_ID,
    ...overrides,
  };
}

function delivered({
  opportunityId = "opp-old",
  protocolId = "yo",
  observedAt = "2026-05-01T00:00:00.000Z",
  amountUsd = 5,
  netUsd = null,
} = {}) {
  return {
    observedAt,
    mode: "execute",
    status: "delivered",
    queueItem: {
      opportunityId,
      chain: "base",
      protocolId,
      mappedStrategyId: TEST_STRATEGY_ID,
    },
    sizing: { amountUsd },
    execution: { settlementStatus: "delivered", txHash: `0x${opportunityId}` },
    realized: netUsd == null ? null : { netUsd },
  };
}

test("classifies no-tx policy rejections as neutral rather than ladder failures", () => {
  const outcome = classifyCanaryOutcome({
    timestamp: "2026-05-01T00:00:00.000Z",
    strategyId: "gateway_native_asset_conversion_sleeve",
    chain: "base",
    protocol: "yo",
    amountUsd: 25,
    policyVerdict: "rejected",
    lifecycle: { stage: "rejected", blockers: ["quote_stale"] },
    broadcast: null,
  });

  assert.equal(outcome.kind, "no_tx_sent");
  assert.equal(outcome.countsAsFailure, false);
  assert.equal(outcome.countsAsSuccess, false);
});

test("starts executable Base canaries at the first committed graduation rung", () => {
  const result = evaluateCanaryGraduation({
    queueItem: queueItem(),
    canaryExecutions: [],
    auditRecords: [],
    policy: POLICY,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.targetUsd, 5);
  assert.equal(result.rungIndex, 0);
});

test("graduates same-protocol canaries to the third rung after delivered and realized-positive proof", () => {
  const result = evaluateCanaryGraduation({
    queueItem: queueItem({ opportunityId: "opp-next" }),
    canaryExecutions: [
      delivered({ opportunityId: "opp-a", netUsd: 0.08, observedAt: "2026-05-01T00:00:00.000Z" }),
      delivered({ opportunityId: "opp-b", netUsd: null, observedAt: "2026-05-01T01:00:00.000Z" }),
    ],
    auditRecords: [],
    policy: POLICY,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.targetUsd, 25);
  assert.equal(result.rungIndex, 2);
  assert.equal(result.evidence.deliveredCount, 2);
  assert.equal(result.evidence.positiveRealizedCount, 1);
});

test("requires distinct opportunity windows before higher-rung auto-graduation", () => {
  const sameWindow = evaluateCanaryGraduation({
    queueItem: queueItem({ opportunityId: "opp-next" }),
    canaryExecutions: [
      delivered({ opportunityId: "opp-a", netUsd: 0.08, observedAt: "2026-05-01T00:00:00.000Z" }),
      delivered({ opportunityId: "opp-a", netUsd: 0.05, observedAt: "2026-05-01T01:00:00.000Z" }),
    ],
    auditRecords: [],
    policy: POLICY,
  });
  const distinctWindows = evaluateCanaryGraduation({
    queueItem: queueItem({ opportunityId: "opp-next" }),
    canaryExecutions: [
      delivered({ opportunityId: "opp-a", netUsd: 0.08, observedAt: "2026-05-01T00:00:00.000Z" }),
      delivered({ opportunityId: "opp-b", netUsd: 0.05, observedAt: "2026-05-01T01:00:00.000Z" }),
    ],
    auditRecords: [],
    policy: POLICY,
  });

  assert.equal(sameWindow.targetUsd, 25);
  assert.equal(distinctWindows.targetUsd, 50);
});

test("blocks ladder graduation after realized loss lock threshold", () => {
  const result = evaluateCanaryGraduation({
    queueItem: queueItem({ opportunityId: "opp-next" }),
    canaryExecutions: [
      delivered({ opportunityId: "opp-a", netUsd: -26, observedAt: "2026-05-01T00:00:00.000Z" }),
    ],
    auditRecords: [],
    policy: POLICY,
    now: "2026-05-01T01:00:00.000Z",
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("canary_graduation_loss_lock"));
  assert.equal(result.targetUsd, null);
});

test("ignores old realized losses outside the daily ladder lock window", () => {
  const result = evaluateCanaryGraduation({
    queueItem: queueItem({ opportunityId: "opp-next" }),
    canaryExecutions: [
      delivered({ opportunityId: "opp-a", netUsd: -26, observedAt: "2026-04-29T00:00:00.000Z" }),
    ],
    auditRecords: [],
    policy: POLICY,
    now: "2026-05-01T01:00:00.000Z",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.evidence.realizedLossUsd, 0);
});

test("blocks ladder graduation after substantive on-chain failures", () => {
  const result = evaluateCanaryGraduation({
    queueItem: queueItem({ opportunityId: "opp-next" }),
    canaryExecutions: [
      {
        observedAt: "2026-05-01T00:00:00.000Z",
        mode: "execute",
        status: "reverted",
        queueItem: {
          opportunityId: "opp-a",
          chain: "base",
          protocolId: "yo",
          mappedStrategyId: TEST_STRATEGY_ID,
        },
        sizing: { amountUsd: 5 },
        execution: { settlementStatus: "reverted", txHash: "0xaaa" },
      },
      {
        observedAt: "2026-05-01T01:00:00.000Z",
        mode: "execute",
        status: "reverted",
        queueItem: {
          opportunityId: "opp-b",
          chain: "base",
          protocolId: "yo",
          mappedStrategyId: TEST_STRATEGY_ID,
        },
        sizing: { amountUsd: 10 },
        execution: { settlementStatus: "reverted", txHash: "0xbbb" },
      },
    ],
    auditRecords: [],
    policy: { ...POLICY, maxSubstantiveFailures: 2 },
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("canary_graduation_failure_pause"));
});
