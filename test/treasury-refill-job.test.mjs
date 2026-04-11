import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFundingSourcePlan } from "../src/treasury/funding-source-planner.mjs";
import { buildTreasuryRefillJobs } from "../src/treasury/refill-job.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../src/treasury/policy.mjs";

function planFixture(decision = "REVIEW_REFILL_PLAN") {
  return {
    schemaVersion: 1,
    observedAt: "2026-04-11T03:30:00.000Z",
    address: "0x000000000000000000000000000000000000dEaD",
    decision,
    inventory: {
      native: [{ chain: "bob", actualDecimal: 0.001 }],
      tokens: [{ chain: "bob", actual: "5000", actualDecimal: 0.00005, token: "0x0555", ticker: "wBTC.OFT" }],
    },
    actions: [
      {
        type: "refill_native",
        chain: "bob",
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "4000000000000000",
        refillAmountDecimal: 0.004,
        refillEstimatedUsd: 8.8,
        rationale: "Primary chain buffer",
      },
      {
        type: "refill_token",
        chain: "bob",
        ticker: "wBTC.OFT",
        token: "0x0555",
        refillAmount: "25000",
        refillAmountDecimal: 0.00025,
        refillEstimatedUsd: 17.5,
        rationale: "Route token buffer",
      },
    ],
  };
}

test("refill jobs are deterministic and carry execution constraints", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const fundingSourcePlan = buildFundingSourcePlan({ plan: planFixture(), policy });
  const jobs = buildTreasuryRefillJobs({ plan: planFixture(), policy, fundingSourcePlan });

  assert.equal(jobs.requiresManualReview, true);
  assert.equal(jobs.jobs.length, 2);
  assert.equal(jobs.jobs[0].constraints.requireEmergencyStopClear, true);
  assert.equal(jobs.jobs[0].executionMethod, "same_chain_token_to_native_swap");
  assert.equal(jobs.jobs[1].executionMethod, "same_chain_native_to_token_swap");
  assert.equal(jobs.jobs[0].candidateMethods.some((item) => item.method === "same_chain_token_to_native_swap"), true);
  assert.equal(jobs.jobs[0].fundingSource.selectionStatus, "ready");
  assert.equal(jobs.jobs[0].jobId, buildTreasuryRefillJobs({ plan: planFixture(), policy, fundingSourcePlan }).jobs[0].jobId);
});

test("refill jobs stop requiring manual review when plan is refill-ready", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const fundingSourcePlan = buildFundingSourcePlan({ plan: planFixture("REFILL_REQUIRED"), policy });
  const jobs = buildTreasuryRefillJobs({ plan: planFixture("REFILL_REQUIRED"), policy, fundingSourcePlan });

  assert.equal(jobs.requiresManualReview, false);
  assert.equal(jobs.summary.highPriorityCount, 1);
  assert.equal(jobs.summary.mediumPriorityCount, 1);
});

test("dual wallet mode prefers reserve transfers", () => {
  const policy = validateTreasuryPolicy({ ...buildDefaultTreasuryPolicy(), walletMode: "dual_wallet" });
  const fundingSourcePlan = buildFundingSourcePlan({ plan: planFixture("REFILL_REQUIRED"), policy });
  const jobs = buildTreasuryRefillJobs({ plan: planFixture("REFILL_REQUIRED"), policy, fundingSourcePlan });

  assert.equal(jobs.jobs[0].executionMethod, "same_chain_native_transfer");
  assert.equal(jobs.jobs[1].executionMethod, "same_chain_token_transfer");
  assert.equal(jobs.jobs[0].fundingSource.requiresReserveState, true);
});

test("refill jobs tolerate a selection without selected source details", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const fundingSourcePlan = {
    ...buildFundingSourcePlan({ plan: planFixture(), policy }),
    selections: [
      {
        actionType: "refill_native",
        chain: "bob",
        asset: "ETH",
        resourceKey: "bob:native",
        selectionStatus: "waiting_inputs",
        selectedMethod: "manual_funding_required",
        selectedSource: null,
        expectedExecutionRefillCostUsd: null,
        expectedReserveReplenishmentCostUsd: null,
        requiresManualFunding: true,
        requiresReserveState: false,
        missingInputs: ["selected_source"],
      },
      {
        actionType: "refill_token",
        chain: "bob",
        token: "0x0555",
        ticker: "wBTC.OFT",
        resourceKey: "bob:0x0555",
        selectionStatus: "ready",
        selectedMethod: "same_chain_native_to_token_swap",
        selectedSource: { source: "same_chain_native_balance" },
        expectedExecutionRefillCostUsd: 0.01,
        expectedReserveReplenishmentCostUsd: 0,
        requiresManualFunding: false,
        requiresReserveState: false,
        missingInputs: [],
      },
    ],
  };
  const jobs = buildTreasuryRefillJobs({ plan: planFixture(), policy, fundingSourcePlan });

  assert.equal(jobs.jobs[0].fundingSource.source, null);
});
