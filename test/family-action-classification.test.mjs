import test from "node:test";
import assert from "node:assert/strict";

import {
  FAMILY_ACTION_CLASSES,
  buildFamilyActionTable,
  classifyFamilyActionRow,
} from "../src/strategy/family-action-classification.mjs";

function emptyEcon(overrides = {}) {
  return {
    markFailedCount: 0,
    markedHealthyCount: 0,
    markFailureKinds: {},
    totalActiveValueUsd: 0,
    claimReadyUsd: 0,
    claimPendingUsd: 0,
    claimChainReadyCount: 0,
    claimTopBlocker: null,
    perPositionDecisions: [],
    topActiveActionReason: null,
    ...overrides,
  };
}

function emptyRow(family, overrides = {}) {
  return {
    family,
    discoveredCandidateCount: 0,
    activePositionCount: 0,
    unreconciledBroadcastCount: 0,
    unreconciledBySource: {},
    activeActionEconomics: emptyEcon(),
    evPositiveCandidateCount: 0,
    policyEligibleCandidateCount: 0,
    signerIntentReadyCount: 0,
    receiptReadyCount: 0,
    capitalAuditReadyCount: 0,
    selectedAction: "observe",
    firstBlockingReason: "NO_SURFACE_EVIDENCE",
    actionCandidates: [],
    ...overrides,
  };
}

test("nine action classes enumerated", () => {
  assert.deepEqual(
    [...FAMILY_ACTION_CLASSES],
    [
      "ENTERABLE_NOW",
      "EXIT_OR_REDEEM_REQUIRED",
      "CLAIM_OR_HARVEST_REQUIRED",
      "REFILL_REQUIRED",
      "TRUE_HOLD_NOOP",
      "TRUE_NO_TRADE_ECONOMICS",
      "BLOCKED_BY_MISSING_PRODUCER",
      "BLOCKED_BY_POLICY_SAFETY",
      "BLOCKED_BY_GOVERNING_SYNC_MISMATCH",
    ],
  );
});

test("signer-intent-ready candidate classifies as ENTERABLE_NOW", () => {
  const row = emptyRow("merkl", {
    discoveredCandidateCount: 10,
    signerIntentReadyCount: 1,
    policyEligibleCandidateCount: 1,
    selectedAction: "signer_intent_ready",
    firstBlockingReason: null,
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "ENTERABLE_NOW");
  assert.equal(out.missingProducer, null);
  assert.equal(out.governingFieldPath, "familyCoverage[family=merkl].signerIntentReadyCount");
});

test("policy safety blocker dominates other signals", () => {
  const row = emptyRow("radar", {
    discoveredCandidateCount: 68,
    firstBlockingReason: "chain_not_official_gateway_destination",
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "BLOCKED_BY_POLICY_SAFETY");
  assert.equal(out.reason, "chain_not_official_gateway_destination");
});

test("claim-ready chain classifies as CLAIM_OR_HARVEST_REQUIRED", () => {
  const row = emptyRow("merkl", {
    activeActionEconomics: emptyEcon({ claimReadyUsd: 1.5, claimChainReadyCount: 1 }),
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "CLAIM_OR_HARVEST_REQUIRED");
  assert.equal(out.claimAmountUsd ?? out.claimReadyUsd, 1.5);
});

test("actionable exit path classifies as EXIT_OR_REDEEM_REQUIRED", () => {
  const row = emptyRow("pendle", {
    activePositionCount: 1,
    activeActionEconomics: emptyEcon({
      perPositionDecisions: [
        {
          actionDecision: "EXIT_AVAILABLE",
          executableActionPath: {
            action: "exit",
            bindingKey: "pendle:pendle_market_swap",
            producer: "pendleYtExitFromPosition",
            dispatchEligibility: "exit_executor_bound",
            blocker: null,
          },
        },
      ],
    }),
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "EXIT_OR_REDEEM_REQUIRED");
});

test("UNSUPPORTED_BINDING decision yields BLOCKED_BY_MISSING_PRODUCER with exact missing producer", () => {
  const row = emptyRow("pendle", {
    activePositionCount: 1,
    firstBlockingReason: "UNSUPPORTED_BINDING",
    activeActionEconomics: emptyEcon({
      perPositionDecisions: [
        {
          actionDecision: "UNSUPPORTED_BINDING",
          missingBindingKey: "pendle:pendle_market_swap",
          executableActionPath: {
            action: "exit",
            bindingKey: "pendle:pendle_market_swap",
            producer: null,
            dispatchEligibility: "unsupported_binding",
            blocker: "binding_kind_not_registered",
          },
        },
      ],
    }),
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "BLOCKED_BY_MISSING_PRODUCER");
  assert.equal(out.missingProducer, "pendle:pendle_market_swap::binding_executor_unregistered");
  assert.match(out.governingFieldPath, /perPositionDecisions/);
});

test("refill blocker classifies as REFILL_REQUIRED with refill plan join", () => {
  const row = emptyRow("tokenized_gold_reserve", {
    discoveredCandidateCount: 7,
    firstBlockingReason: "live_inventory_entry_asset_not_found",
  });
  const out = classifyFamilyActionRow(row, {
    refillJobs: [
      {
        chain: "ethereum",
        asset: "XAUT",
        family: null,
        executionMethod: "cross_chain_swap_via_btc_intermediate",
        executionReason: "capital_rebalance",
        status: "planned",
      },
    ],
  });
  assert.equal(out.actionClass, "REFILL_REQUIRED");
  assert.equal(out.refillNeed.executionMethod, "cross_chain_swap_via_btc_intermediate");
});

test("unreconciled receipts classify as BLOCKED_BY_GOVERNING_SYNC_MISMATCH", () => {
  const row = emptyRow("btc_wrapper_lending", {
    unreconciledBroadcastCount: 188,
    firstBlockingReason: "NO_RECEIPT_RECONCILIATION",
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "BLOCKED_BY_GOVERNING_SYNC_MISMATCH");
  assert.equal(out.missingProducer, "btc_wrapper_lending::receipt_reconciliation_producer");
});

test("claim economics below floor classify as TRUE_NO_TRADE_ECONOMICS", () => {
  const row = emptyRow("merkl", {
    discoveredCandidateCount: 1722,
    evPositiveCandidateCount: 1,
    activePositionCount: 1,
    firstBlockingReason: "claimable_below_min_usd",
    activeActionEconomics: emptyEcon({
      claimPendingUsd: 0.0002,
      claimTopBlocker: "claimable_below_min_usd",
    }),
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "TRUE_NO_TRADE_ECONOMICS");
  assert.equal(out.reason, "claimable_below_min_usd");
});

test("HEALTH_CHECK_REQUIRED on mark-failed positions surfaces missing producer", () => {
  const row = emptyRow("ambiguous_position_family", {
    activePositionCount: 9,
    firstBlockingReason: "HEALTH_CHECK_REQUIRED",
    activeActionEconomics: emptyEcon({
      perPositionDecisions: [
        {
          actionDecision: "HEALTH_CHECK_REQUIRED",
          executableActionPath: { action: "health_check", blocker: "position_mark_failed:adapter_error" },
        },
      ],
    }),
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "BLOCKED_BY_MISSING_PRODUCER");
  assert.equal(out.missingProducer, "ambiguous_position_family::position_health_action_producer_missing");
});

test("all-HOLD_NOOP active positions classify as TRUE_HOLD_NOOP", () => {
  const row = emptyRow("ambiguous_position_family", {
    activePositionCount: 2,
    activeActionEconomics: emptyEcon({
      perPositionDecisions: [
        {
          actionDecision: "HOLD_NOOP",
          executableActionPath: { action: "hold", producer: "executeErc4626PortfolioExit", blocker: null },
        },
        {
          actionDecision: "HOLD_NOOP",
          executableActionPath: { action: "hold", producer: "executeErc4626PortfolioExit", blocker: null },
        },
      ],
    }),
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "TRUE_HOLD_NOOP");
});

test("no positive EV with no active positions classifies as TRUE_NO_TRADE_ECONOMICS", () => {
  const row = emptyRow("aggressive", {
    discoveredCandidateCount: 5,
    evPositiveCandidateCount: 0,
    firstBlockingReason: "no_high_yield_candidates_selected",
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "TRUE_NO_TRADE_ECONOMICS");
});

test("buildFamilyActionTable emits one row per family with required fields", () => {
  const rows = [
    emptyRow("pendle", {
      discoveredCandidateCount: 152,
      activePositionCount: 1,
      firstBlockingReason: "UNSUPPORTED_BINDING",
      activeActionEconomics: emptyEcon({
        perPositionDecisions: [
          {
            actionDecision: "UNSUPPORTED_BINDING",
            missingBindingKey: "pendle:pendle_market_swap",
            executableActionPath: {
              action: "exit",
              bindingKey: "pendle:pendle_market_swap",
              dispatchEligibility: "unsupported_binding",
              blocker: "binding_kind_not_registered",
            },
          },
        ],
      }),
    }),
    emptyRow("radar", {
      discoveredCandidateCount: 68,
      firstBlockingReason: "chain_not_official_gateway_destination",
    }),
  ];
  const table = buildFamilyActionTable(rows, { nextLegalDistByFamily: { pendle: { hold: 1 } } });
  assert.equal(table.length, 2);
  for (const entry of table) {
    assert.ok(entry.family);
    assert.ok(FAMILY_ACTION_CLASSES.includes(entry.actionClass));
    assert.ok(entry.governingFieldPath, "governingFieldPath must be present");
    assert.ok(
      typeof entry.discoveredCandidateCount === "number" &&
        typeof entry.evPositiveCandidateCount === "number" &&
        typeof entry.policyEligibleCandidateCount === "number" &&
        typeof entry.activePositionCount === "number" &&
        typeof entry.signerIntentReadyCount === "number",
    );
  }
  const pendleRow = table.find((row) => row.family === "pendle");
  assert.equal(pendleRow.actionClass, "BLOCKED_BY_MISSING_PRODUCER");
  assert.deepEqual(pendleRow.nextLegalCapitalActionCounts, { hold: 1 });
});

test("missing producer is reported even when only firstBlockingReason flags the binding gap", () => {
  const row = emptyRow("defillama", {
    discoveredCandidateCount: 52,
    firstBlockingReason: "defillama_requires_executable_protocol_binding",
  });
  const out = classifyFamilyActionRow(row);
  assert.equal(out.actionClass, "BLOCKED_BY_MISSING_PRODUCER");
  assert.equal(out.missingProducer, "defillama::defillama_requires_executable_protocol_binding");
});

test("none of the rows collapse into a vague unlabelled NO_TRADE", () => {
  const families = [
    "pendle",
    "merkl",
    "defillama",
    "stable_carry",
    "btc_wrapper_lending",
    "tokenized_gold_reserve",
    "radar",
    "aggressive",
    "strategy_catalog",
    "ambiguous_position_family",
  ];
  const rows = families.map((family) => emptyRow(family, { discoveredCandidateCount: 1 }));
  const table = buildFamilyActionTable(rows);
  for (const entry of table) {
    assert.ok(
      FAMILY_ACTION_CLASSES.includes(entry.actionClass),
      `family ${entry.family} got non-canonical class ${entry.actionClass}`,
    );
    assert.notEqual(entry.actionClass, null);
  }
});
