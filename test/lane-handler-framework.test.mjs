import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { HANDLER_STATUSES, buildLaneHandlerReport } from "../src/strategy/lane-handler-framework.mjs";

function queueItem(family, lane, overrides = {}) {
  return {
    lane,
    family,
    priority: 10,
    actionClass: lane.toUpperCase(),
    reason: `${lane}_reason`,
    governingFieldPath: `familyCoverage[family=${family}].firstBlockingReason`,
    canDryRun: lane !== "producer_backlog",
    suggestedDryRunCommand:
      lane === "capital_refill" ? "node src/cli/plan-capital-manager-refill-jobs.mjs --json" : null,
    canLive: false,
    missingProducer: null,
    safetyBlockers: [],
    sourceTruthStatus: "dry_run_plannable",
    ...overrides,
  };
}

function refillJob(family, overrides = {}) {
  return {
    jobId: `${family}-refill-job`,
    family,
    status: "planned",
    decision: "REFILL_REQUIRED",
    type: "refill_token",
    executionMethod: "cross_chain_bridge_or_swap",
    chain: "base",
    asset: "wBTC.OFT",
    token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    targetAmount: "118732",
    targetAmountDecimal: 0.00118732,
    estimatedAssetValueUsd: 91.12,
    fundingSource: {
      selectionStatus: "ready",
      method: "cross_chain_bridge_or_swap",
      source: {
        chain: "bitcoin",
        token: "0x0000000000000000000000000000000000000000",
        ticker: "BTC",
        estimatedUsd: 91.12,
      },
      expectedExecutionRefillCostUsd: 0.88,
      expectedReserveReplenishmentCostUsd: 0,
      missingInputs: [],
    },
    movementBudget: {
      bridgeQuoteCostUsd: 0.88,
      bridgeQuoteCostCeilingUsd: 1.5,
      bridgeQuoteCostAccepted: true,
    },
    systemEconomics: {
      effectiveSystemNetPnlUsd: 0.91,
      routeExecutableNetEdgeUsd: 1.79,
      routeKnownCostUsd: 0.38,
    },
    ...overrides,
  };
}

test("emits the required handler interface shape with a capital_refill dry-run intent", () => {
  const sourceQueueItem = queueItem("capital_family", "capital_refill");
  const report = buildLaneHandlerReport({
    selectorReport: { actionLaneQueue: [sourceQueueItem] },
    refillPlannerReport: {
      observedAt: "2026-05-19T12:00:00.000Z",
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: { jobs: [refillJob("capital_family")] },
    },
  });

  assert.equal(report.selectedPilotLane, "capital_refill");
  assert.equal(report.status, "LANE_HANDLER_PILOT_READY");
  assert.equal(report.reportOnly, true);
  assert.equal(report.canLive, false);
  assert.deepEqual(
    [...HANDLER_STATUSES],
    [
      "READY_FOR_DRY_RUN",
      "BLOCKED_MISSING_INPUT",
      "BLOCKED_MISSING_PRODUCER",
      "BLOCKED_POLICY_REVIEW",
      "WAITLIST",
      "DIAGNOSTIC_FAILURE",
    ],
  );

  const result = report.handlerResults[0];
  assert.equal(result.lane, "capital_refill");
  assert.equal(result.family, "capital_family");
  assert.deepEqual(result.sourceQueueItem, sourceQueueItem);
  assert.equal(result.status, "READY_FOR_DRY_RUN");
  assert.equal(result.canDryRun, true);
  assert.equal(result.canLive, false);
  assert.equal(result.reportOnly, true);
  assert.equal(result.dryRunCommand, "node src/cli/plan-capital-manager-refill-jobs.mjs --json");
  assert.equal(result.missingProducer, null);
  assert.deepEqual(result.missingInputs, []);
  assert.equal(result.governingFieldPath, sourceQueueItem.governingFieldPath);
  assert.deepEqual(result.safetyBlockers, []);
  assert.equal(result.dryRunIntent.selectedMethod, "cross_chain_bridge_or_swap");
  assert.deepEqual(result.dryRunIntent.source, {
    chain: "bitcoin",
    asset: "BTC",
    token: "0x0000000000000000000000000000000000000000",
    estimatedUsd: 91.12,
  });
  assert.deepEqual(result.dryRunIntent.destination, {
    chain: "base",
    asset: "wBTC.OFT",
    token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    targetAmount: "118732",
    targetAmountDecimal: 0.00118732,
    estimatedAssetValueUsd: 91.12,
  });
  assert.equal(result.dryRunIntent.expectedNetUsd, 0.91);
  assert.deepEqual(result.dryRunIntent.costs, {
    expectedExecutionRefillCostUsd: 0.88,
    expectedReserveReplenishmentCostUsd: 0,
    bridgeQuoteCostUsd: 0.88,
    bridgeQuoteCostCeilingUsd: 1.5,
    routeKnownCostUsd: 0.38,
  });
  assert.deepEqual(result.dryRunIntent.governingAgreement, {
    queueLane: "capital_refill",
    plannerDecision: "REFILL_REQUIRED",
    jobDecision: "REFILL_REQUIRED",
    selectionStatus: "ready",
    agrees: true,
  });
});

test("selects capital_refill before receipt_reconciliation when both have inputs", () => {
  const report = buildLaneHandlerReport({
    selectorReport: {
      actionLaneQueue: [
        queueItem("receipt_family", "receipt_reconciliation"),
        queueItem("capital_family", "capital_refill"),
      ],
    },
    refillPlannerReport: {
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: { jobs: [refillJob("capital_family")] },
    },
    receiptReport: { unreconciled: [{ family: "receipt_family", txHash: "0xabc" }] },
  });

  assert.equal(report.selectedPilotLane, "capital_refill");
  assert.equal(report.handlerResults.length, 1);
  assert.equal(
    report.handlerBacklog.some((item) => item.lane === "receipt_reconciliation"),
    true,
  );
});

test("falls back to receipt_reconciliation when refill evidence is missing", () => {
  const report = buildLaneHandlerReport({
    selectorReport: {
      actionLaneQueue: [
        queueItem("capital_family", "capital_refill"),
        queueItem("receipt_family", "receipt_reconciliation", {
          suggestedDryRunCommand: "npm run report:receipt-ledger -- --json",
        }),
      ],
    },
    refillPlannerReport: { capitalPlan: { decision: "REFILL_REQUIRED" }, jobs: { jobs: [] } },
    receiptReport: {
      unreconciled: [{ family: "receipt_family", txHash: "0xabc", status: "pending" }],
    },
  });

  assert.equal(report.selectedPilotLane, "receipt_reconciliation");
  assert.equal(report.handlerResults[0].status, "READY_FOR_DRY_RUN");
  assert.deepEqual(report.handlerResults[0].dryRunIntent.targets, [
    { family: "receipt_family", txHash: "0xabc", status: "pending" },
  ]);
});

test("falls back to producer_backlog when no dry-run handler input exists", () => {
  const report = buildLaneHandlerReport({
    selectorReport: {
      actionLaneQueue: [
        queueItem("blocked_family", "producer_backlog", {
          canDryRun: false,
          missingProducer: "blocked_family::binding_executor_unregistered",
          missingBinding: "blocked_family",
        }),
      ],
    },
  });

  assert.equal(report.selectedPilotLane, "producer_backlog");
  assert.equal(report.handlerResults[0].status, "BLOCKED_MISSING_PRODUCER");
  assert.equal(report.handlerResults[0].canDryRun, false);
  assert.equal(report.handlerResults[0].canLive, false);
  assert.equal(report.handlerResults[0].reportOnly, true);
  assert.equal(report.handlerResults[0].missingProducer, "blocked_family::binding_executor_unregistered");
  assert.deepEqual(report.handlerResults[0].dryRunIntent, {
    backlogType: "missing_producer",
    missingProducer: "blocked_family::binding_executor_unregistered",
    missingBinding: "blocked_family",
    sourceFields: {
      governingFieldPath: "familyCoverage[family=blocked_family].firstBlockingReason",
      reason: "producer_backlog_reason",
      actionClass: "PRODUCER_BACKLOG",
    },
  });
});

test("keeps policy and waitlist lanes in handlerBacklog without implementing extra handlers", () => {
  const report = buildLaneHandlerReport({
    selectorReport: {
      actionLaneQueue: [
        queueItem("policy_family", "policy_review", { safetyBlockers: ["policy_review_required"] }),
        queueItem("hold_family", "waitlist"),
        queueItem("blocked_family", "producer_backlog", {
          canDryRun: false,
          missingProducer: "blocked_family::missing",
        }),
      ],
    },
  });

  assert.equal(report.selectedPilotLane, "producer_backlog");
  assert.deepEqual(
    report.handlerBacklog.map((item) => [item.lane, item.status]),
    [
      ["policy_review", "BLOCKED_POLICY_REVIEW"],
      ["waitlist", "WAITLIST"],
    ],
  );
});

test("does not special-case strategy family names for pilot handlers", () => {
  const report = buildLaneHandlerReport({
    selectorReport: {
      actionLaneQueue: [queueItem("pendle", "capital_refill"), queueItem("merkl", "capital_refill")],
    },
    refillPlannerReport: {
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: { jobs: [refillJob("merkl")] },
    },
  });

  assert.equal(report.selectedPilotLane, "capital_refill");
  assert.equal(report.handlerResults[0].family, "merkl");
  assert.equal(report.handlerResults[0].dryRunIntent.selectedMethod, "cross_chain_bridge_or_swap");
});

test("builds from provided in-memory reports without generated runtime artifacts", () => {
  const report = buildLaneHandlerReport({
    selectorReport: { actionLaneQueue: [queueItem("blocked_family", "producer_backlog")] },
  });

  assert.equal(report.inputsRequired.generatedArtifactPath, null);
  assert.equal(report.handlerResults[0].status, "BLOCKED_MISSING_PRODUCER");
  assert.equal(report.safety.runtimeStateMutated, false);
  assert.equal(report.safety.signerCalled, false);
  assert.equal(report.safety.autoExecuteChanged, false);
});

test("does not import or emit signer, enqueue, or live broadcast surfaces", async () => {
  const source = await readFile(new URL("../src/strategy/lane-handler-framework.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(source, /executor\/signer|signer\/client|sign_and_broadcast|broadcastTransaction/);
  assert.doesNotMatch(source, /enqueueLive|enqueueRuntime|writeTextIfChanged|JsonlStore|--execute|--submit-signer/);
});
