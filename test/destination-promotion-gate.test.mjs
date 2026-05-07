import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationPromotionGate } from "../src/strategy/destination-promotion-gate.mjs";

test("destination promotion gate blocks candidates without allowlist decisions or economics", () => {
  const allowlistBoard = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        score: 0.66,
        values: {},
        recommendation: {
          status: "candidate_for_allowlist_review",
        },
      },
      {
        templateId: "base:custom_destination_actions",
        chain: "base",
        familyId: "custom_destination_actions",
        label: "Gateway custom destination actions",
        score: 0.59,
        values: {},
        recommendation: {
          status: "contract_policy_review",
        },
      },
    ],
  };

  const evidencePolicy = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        unmetPolicyInputs: ["allowlistDecision"],
      },
      {
        templateId: "base:custom_destination_actions",
        unmetPolicyInputs: [],
      },
    ],
  };

  const economics = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        economicsStatus: "missing_inputs",
      },
      {
        templateId: "base:custom_destination_actions",
        economicsStatus: "non_numeric_track",
      },
    ],
  };

  const freshnessAudit = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        freshnessStatus: "missing",
      },
      {
        templateId: "base:custom_destination_actions",
        freshnessStatus: "fresh",
      },
    ],
  };

  const report = buildDestinationPromotionGate({ allowlistBoard, evidencePolicy, economics, freshnessAudit });

  assert.equal(report.scoreSourceOnly, true);
  assert.equal(report.runtimeAuthority, "none");
  assert.equal(report.summary.promotableCount, 0);
  assert.equal(report.summary.blockedCount, 2);
  assert.equal(report.summary.topBlockers[0].blocker, "allowlist_decision_missing");
});

test("destination promotion gate can mark an approved policy-passing item as promotable", () => {
  const allowlistBoard = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        score: 0.66,
        values: {
          allowlistDecision: "approved",
        },
        recommendation: {
          status: "candidate_for_allowlist_review",
        },
      },
    ],
  };

  const evidencePolicy = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        unmetPolicyInputs: [],
        policy: {
          freshnessHours: 24,
          minIndependentChecks: 3,
          minSources: 2,
          volatileFields: ["grossReturnBps", "unwindSlippageBps"],
          minVolatileFieldObservations: 2,
        },
      },
    ],
  };

  const economics = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        economicsStatus: "estimated",
        activeBudgetEstimate: { passesPolicy: true },
        planningBudgetEstimate: { passesPolicy: true },
      },
    ],
  };

  const freshnessAudit = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        freshnessStatus: "fresh",
      },
    ],
  };

  const ledger = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        coveragePct: 1,
        targetEconomicFields: ["grossReturnBps", "depositFeeBps", "withdrawFeeBps", "unwindSlippageBps"],
        missingEconomicFields: [],
        sourceCount: 2,
        sourceNames: ["Example Protocol", "Gateway Quote"],
        sourceTypes: ["official_docs", "live_quote"],
        observedAtCount: 3,
        latestObservedAt: "2026-04-14T12:00:00.000Z",
        fieldObservationCounts: {
          grossReturnBps: 1,
          depositFeeBps: 1,
          withdrawFeeBps: 1,
          unwindSlippageBps: 1,
        },
      },
    ],
  };

  const report = buildDestinationPromotionGate({ allowlistBoard, evidencePolicy, economics, freshnessAudit, ledger });
  assert.equal(report.summary.promotableCount, 1);
  assert.equal(report.summary.blockedCount, 0);
  assert.equal(report.summary.allocationReadyCount, 0);
  assert.equal(report.summary.reviewOnlyCount, 1);
  assert.equal(report.items[0].allocationGate.status, "review_only");
  assert.match(report.items[0].allocationGate.blockers.join(","), /allocation_grossReturnBps_recheck_required/);
});

test("destination promotion gate marks repeated volatile observations as allocation ready", () => {
  const report = buildDestinationPromotionGate({
    allowlistBoard: {
      items: [
        {
          templateId: "base:stablecoin_lending_carry",
          chain: "base",
          familyId: "stablecoin_lending_carry",
          label: "Stablecoin lending carry",
          score: 0.66,
          values: {
            allowlistDecision: "approved",
          },
          recommendation: {
            status: "candidate_for_allowlist_review",
          },
        },
      ],
    },
    evidencePolicy: {
      items: [
        {
          templateId: "base:stablecoin_lending_carry",
          unmetPolicyInputs: [],
          policy: {
            freshnessHours: 24,
            minIndependentChecks: 3,
            minSources: 2,
            volatileFields: ["grossReturnBps", "unwindSlippageBps"],
            minVolatileFieldObservations: 2,
          },
        },
      ],
    },
    economics: {
      items: [
        {
          templateId: "base:stablecoin_lending_carry",
          economicsStatus: "estimated",
          activeBudgetEstimate: { passesPolicy: true },
          planningBudgetEstimate: { passesPolicy: true },
        },
      ],
    },
    freshnessAudit: {
      items: [
        {
          templateId: "base:stablecoin_lending_carry",
          freshnessStatus: "fresh",
        },
      ],
    },
    ledger: {
      items: [
        {
          templateId: "base:stablecoin_lending_carry",
          coveragePct: 1,
          targetEconomicFields: ["grossReturnBps", "depositFeeBps", "withdrawFeeBps", "unwindSlippageBps"],
          missingEconomicFields: [],
          sourceCount: 2,
          sourceNames: ["Example Protocol", "Gateway Quote"],
          sourceTypes: ["official_docs", "live_quote"],
          observedAtCount: 4,
          latestObservedAt: "2026-04-14T12:00:00.000Z",
          fieldObservationCounts: {
            grossReturnBps: 2,
            depositFeeBps: 1,
            withdrawFeeBps: 1,
            unwindSlippageBps: 2,
          },
        },
      ],
    },
  });

  assert.equal(report.summary.promotableCount, 1);
  assert.equal(report.summary.allocationReadyCount, 1);
  assert.equal(report.summary.reviewOnlyCount, 0);
  assert.equal(report.items[0].allocationGate.status, "allocation_ready");
});

test("destination promotion gate accepts fresh carry-forward volatile rechecks from the ledger", () => {
  const report = buildDestinationPromotionGate({
    allowlistBoard: {
      items: [
        {
          templateId: "avalanche:wrapped_btc_lending",
          chain: "avalanche",
          familyId: "wrapped_btc_lending",
          label: "Wrapped BTC -> lending positions",
          score: 0.56,
          values: {
            allowlistDecision: "candidate_for_review",
          },
          recommendation: {
            status: "decision_recorded",
          },
        },
      ],
    },
    evidencePolicy: {
      items: [
        {
          templateId: "avalanche:wrapped_btc_lending",
          unmetPolicyInputs: [],
          policy: {
            freshnessHours: 24,
            minIndependentChecks: 3,
            minSources: 2,
            volatileFields: ["grossReturnBps", "unwindSlippageBps"],
            minVolatileFieldObservations: 2,
          },
        },
      ],
    },
    economics: {
      items: [
        {
          templateId: "avalanche:wrapped_btc_lending",
          economicsStatus: "estimated",
          activeBudgetEstimate: { passesPolicy: true },
          planningBudgetEstimate: { passesPolicy: true },
        },
      ],
    },
    freshnessAudit: {
      items: [
        {
          templateId: "avalanche:wrapped_btc_lending",
          freshnessStatus: "fresh",
        },
      ],
    },
    ledger: {
      items: [
        {
          templateId: "avalanche:wrapped_btc_lending",
          coveragePct: 1,
          targetEconomicFields: ["grossReturnBps", "depositFeeBps", "withdrawFeeBps", "unwindSlippageBps"],
          missingEconomicFields: [],
          sourceCount: 4,
          sourceNames: ["BENQI app", "BENQI docs", "Gateway unwind quote"],
          sourceTypes: ["official_app", "official_docs", "live_quote"],
          observedAtCount: 4,
          latestObservedAt: "2026-04-19T20:58:20.746Z",
          fieldObservationCounts: {
            grossReturnBps: 2,
            depositFeeBps: 1,
            withdrawFeeBps: 1,
            unwindSlippageBps: 1,
          },
          effectiveFieldObservationCounts: {
            grossReturnBps: 2,
            depositFeeBps: 1,
            withdrawFeeBps: 1,
            unwindSlippageBps: 2,
          },
          verificationCarryForwardFields: ["unwindSlippageBps"],
        },
      ],
    },
  });

  assert.equal(report.summary.allocationReadyCount, 1);
  assert.equal(report.summary.reviewOnlyCount, 0);
  assert.equal(report.items[0].allocationGate.status, "allocation_ready");
  assert.deepEqual(report.items[0].allocationGate.evidence.verificationCarryForwardFields, ["unwindSlippageBps"]);
});

test("destination promotion gate surfaces venue blockers from blocked economics items", () => {
  const report = buildDestinationPromotionGate({
    allowlistBoard: {
      items: [
        {
          templateId: "soneium:wrapped_btc_lending",
          chain: "soneium",
          familyId: "wrapped_btc_lending",
          label: "Wrapped BTC -> lending positions",
          score: 0.61,
          values: {
            allowlistDecision: "candidate_for_review",
          },
          recommendation: {
            status: "candidate_for_allowlist_review",
          },
        },
      ],
    },
    evidencePolicy: {
      items: [
        {
          templateId: "soneium:wrapped_btc_lending",
          unmetPolicyInputs: [],
          policy: {
            freshnessHours: 24,
            minIndependentChecks: 1,
            minSources: 1,
            volatileFields: ["grossReturnBps", "unwindSlippageBps"],
            minVolatileFieldObservations: 1,
          },
        },
      ],
    },
    economics: {
      items: [
        {
          templateId: "soneium:wrapped_btc_lending",
          economicsStatus: "blocked",
          blockerCode: "no_current_destination_venue",
        },
      ],
    },
    freshnessAudit: {
      items: [
        {
          templateId: "soneium:wrapped_btc_lending",
          freshnessStatus: "fresh",
        },
      ],
    },
    ledger: {
      items: [
        {
          templateId: "soneium:wrapped_btc_lending",
          coveragePct: 0,
          targetEconomicFields: ["grossReturnBps", "depositFeeBps", "withdrawFeeBps", "unwindSlippageBps"],
          missingEconomicFields: ["grossReturnBps", "depositFeeBps", "withdrawFeeBps", "unwindSlippageBps"],
          sourceCount: 0,
          sourceNames: [],
          sourceTypes: [],
          observedAtCount: 0,
          latestObservedAt: null,
          fieldObservationCounts: {},
        },
      ],
    },
  });

  assert.equal(report.summary.promotableCount, 0);
  assert.equal(report.summary.blockedCount, 1);
  assert.match(report.items[0].gate.blockers.join(","), /no_current_destination_venue/);
});
