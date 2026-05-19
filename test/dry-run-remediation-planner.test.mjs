import test from "node:test";
import assert from "node:assert/strict";

import { ACTION_LANES, buildDryRunRemediationPlan } from "../src/strategy/dry-run-remediation-planner.mjs";

function actionRow(family, actionClass, overrides = {}) {
  return {
    family,
    actionClass,
    reason: `${actionClass.toLowerCase()}_reason`,
    governingFieldPath: `familyActionTable[family=${family}].actionClass`,
    discoveredCandidateCount: 1,
    evPositiveCandidateCount: 0,
    policyEligibleCandidateCount: 0,
    activePositionCount: 0,
    signerIntentReadyCount: 0,
    unreconciledBroadcastCount: 0,
    missingProducer: null,
    refillNeed: null,
    ...overrides,
  };
}

test("maps every canonical action class into the required lane exactly once per family", () => {
  const rows = [
    actionRow("receipt", "RECONCILE_RECEIPT_REQUIRED"),
    actionRow("refill", "REFILL_REQUIRED"),
    actionRow("claim", "CLAIM_OR_HARVEST_REQUIRED"),
    actionRow("exit", "EXIT_OR_REDEEM_REQUIRED"),
    actionRow("entry", "ENTERABLE_NOW"),
    actionRow("producer", "BLOCKED_BY_MISSING_PRODUCER", {
      missingProducer: "producer::executor_missing",
    }),
    actionRow("policy_a", "POLICY_SEMANTIC_DEFECT_CANDIDATE"),
    actionRow("policy_b", "BLOCKED_BY_POLICY_SAFETY"),
    actionRow("sync", "BLOCKED_BY_GOVERNING_SYNC_MISMATCH"),
    actionRow("econ", "TRUE_NO_TRADE_ECONOMICS"),
    actionRow("hold", "TRUE_HOLD_NOOP"),
  ];

  const plan = buildDryRunRemediationPlan({ selectorReport: { familyActionTable: rows } });

  assert.deepEqual(
    [...ACTION_LANES],
    [
      "receipt_reconciliation",
      "capital_refill",
      "claim_harvest",
      "exit_redeem",
      "entry_candidate",
      "producer_backlog",
      "policy_review",
      "sync_repair",
      "waitlist",
    ],
  );
  assert.equal(plan.actionLaneQueue.length, rows.length);
  assert.deepEqual(Object.fromEntries(plan.actionLaneQueue.map((item) => [item.family, item.lane])), {
    receipt: "receipt_reconciliation",
    refill: "capital_refill",
    claim: "claim_harvest",
    exit: "exit_redeem",
    entry: "entry_candidate",
    producer: "producer_backlog",
    policy_a: "policy_review",
    policy_b: "policy_review",
    sync: "sync_repair",
    econ: "waitlist",
    hold: "waitlist",
  });
  assert.equal(new Set(plan.actionLaneQueue.map((item) => item.family)).size, rows.length);
});

test("defaults canLive false and attaches existing dry-run/report commands only to safe report lanes", () => {
  const plan = buildDryRunRemediationPlan({
    selectorReport: {
      familyActionTable: [
        actionRow("entry", "ENTERABLE_NOW"),
        actionRow("receipt", "RECONCILE_RECEIPT_REQUIRED"),
        actionRow("producer", "BLOCKED_BY_MISSING_PRODUCER", {
          missingProducer: "unknown::binding_executor_unregistered",
        }),
      ],
    },
  });

  const entry = plan.actionLaneQueue.find((item) => item.family === "entry");
  const receipt = plan.actionLaneQueue.find((item) => item.family === "receipt");
  const producer = plan.actionLaneQueue.find((item) => item.family === "producer");
  assert.equal(entry.canLive, false);
  assert.equal(entry.canDryRun, true);
  assert.match(entry.suggestedDryRunCommand, /run-all-source-deployment-selector/);
  assert.equal(receipt.canDryRun, true);
  assert.equal(receipt.suggestedDryRunCommand, "npm run report:receipt-ledger -- --json");
  assert.equal(producer.canLive, false);
  assert.equal(producer.canDryRun, false);
  assert.equal(producer.suggestedDryRunCommand, null);
  assert.equal(producer.missingProducer, "unknown::binding_executor_unregistered");
  assert.equal(producer.missingBinding, "unknown");
});

test("stays report-only even when live policy context is allowed", () => {
  const plan = buildDryRunRemediationPlan({
    selectorReport: {
      policy: { liveTrading: "ALLOWED", policyLiveTrading: "ALLOWED" },
      familyActionTable: [
        actionRow("entry", "ENTERABLE_NOW", {
          signerIntentReadyCount: 1,
          policyEligibleCandidateCount: 1,
        }),
      ],
    },
  });

  assert.equal(plan.safety.reportOnly, true);
  assert.equal(plan.safety.allowedToExecuteLive, false);
  assert.equal(plan.safety.liveExecutionAuthority, "none");
  assert.equal(plan.safety.signerCalled, false);
  assert.equal(plan.safety.autoExecuteChanged, false);
  assert.equal(plan.actionLaneQueue[0].canLive, false);
  assert.equal(plan.actionLaneQueue[0].currentLiveEligible, false);
  assert.equal(plan.actionLaneQueue[0].selectedMode, "dry_run");
  assert.equal(plan.actionLaneQueue[0].allowedToExecuteLive, false);
});

test("keeps policy candidates in policy_review with required safe and unsafe tests", () => {
  const plan = buildDryRunRemediationPlan({
    selectorReport: {
      familyActionTable: [
        actionRow("merkl", "POLICY_SEMANTIC_DEFECT_CANDIDATE", {
          reason: "executable_candidate_available",
        }),
      ],
    },
  });

  const item = plan.actionLaneQueue[0];
  assert.equal(item.lane, "policy_review");
  assert.equal(item.canLive, false);
  assert.ok(item.requiredEvidence.includes("policy_key_or_function"));
  assert.ok(item.requiredEvidence.includes("safe_case_regression_test"));
  assert.ok(item.requiredEvidence.includes("unsafe_case_regression_test"));
  assert.deepEqual(item.safetyBlockers, ["policy_review_required"]);
});

test("routes true economics and hold no-op to waitlist instead of vague NO_TRADE", () => {
  const plan = buildDryRunRemediationPlan({
    selectorReport: {
      familyActionTable: [
        actionRow("econ", "TRUE_NO_TRADE_ECONOMICS", {
          reason: "expected_net_below_cost_floor",
        }),
        actionRow("hold", "TRUE_HOLD_NOOP", {
          reason: "all_active_positions_hold_noop",
        }),
      ],
    },
  });

  assert.deepEqual(
    plan.actionLaneQueue.map((item) => [item.family, item.lane, item.governingFieldPath]),
    [
      ["econ", "waitlist", "familyActionTable[family=econ].actionClass"],
      ["hold", "waitlist", "familyActionTable[family=hold].actionClass"],
    ],
  );
});

test("does not special-case Pendle or Merkl family names", () => {
  const plan = buildDryRunRemediationPlan({
    selectorReport: {
      familyActionTable: [
        actionRow("pendle", "BLOCKED_BY_MISSING_PRODUCER", {
          missingProducer: "pendle:pendle_market_swap::binding_executor_unregistered",
        }),
        actionRow("merkl", "BLOCKED_BY_MISSING_PRODUCER", {
          missingProducer: "merkl::distributor_address_resolution_missing",
        }),
      ],
    },
  });

  assert.deepEqual(Object.fromEntries(plan.actionLaneQueue.map((item) => [item.family, item.lane])), {
    pendle: "producer_backlog",
    merkl: "producer_backlog",
  });
});
