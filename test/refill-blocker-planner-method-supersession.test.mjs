// Producer-layer supersession proof for stale refillExecution snapshots whose
// `selectedExecutionMethod` has been reassigned to a different
// `executionMethod` by the live capital planner. Verifies the source-of-truth
// state (readiness `liveAutomation.refillBlockers`) drops the obsolete record
// without manual snapshot patching, fake timestamp refresh, or runtime
// mutation. No chain/asset/method literals are used; every fixture is
// synthetic.

import test from "node:test";
import assert from "node:assert/strict";

import { buildAllChainAutopilotDashboardSlice } from "../src/status/all-chain-autopilot-slice.mjs";

function syntheticAutopilotReport({
  refillExecutions = [],
  chain = "synth_chain_alpha",
  asset = "SYNTH_ASSET_A",
} = {}) {
  return {
    observedAt: "2026-05-20T00:00:00.000Z",
    mode: "execute",
    status: "completed_with_blockers",
    blockedReason: null,
    summary: {
      officialChainCount: 1,
      refillJobCount: 1,
      autoRefillJobCount: 1,
      refillAttemptedCount: 0,
      refillExecutedCount: 0,
      canarySweep: { status: "completed", executedCount: 0, deliveredCount: 0, blockedCount: 0, chainsTouched: [] },
      strategyDispatch: { batchStatus: "succeeded", selectedCount: 0, successCount: 0, failedCount: 0 },
      payback: { status: "carry" },
      portfolio: { status: "blocked", allocator: { deployments: [] } },
    },
    refillExecutions: refillExecutions.map((entry) => ({
      chain,
      asset,
      attempted: true,
      executed: false,
      ...entry,
    })),
  };
}

function syntheticPlannerJobs({
  methods,
  chain = "synth_chain_alpha",
  asset = "SYNTH_ASSET_A",
  jobIdPrefix = "planner-job",
}) {
  return {
    jobs: {
      jobs: methods.map((method, index) => ({
        jobId: `${jobIdPrefix}-${index}`,
        chain,
        asset,
        executionMethod: method,
        decision: "REFILL_REQUIRED",
        blocker: null,
        fundingSource: { method, selectionStatus: "ready" },
      })),
    },
  };
}

test("supersession drops stale selectedExecutionMethod when planner reassigned to a different in-set executionMethod", () => {
  const slice = buildAllChainAutopilotDashboardSlice(
    syntheticAutopilotReport({
      refillExecutions: [
        {
          jobId: "shared-job-id",
          selectedExecutionMethod: "method_old_prior_choice",
          executionMethod: "method_new_current_planner_choice",
          executionBlockedReason: "synthetic_prior_blocker_reason",
        },
      ],
    }),
    {
      capitalManagerRefillJobsLatest: syntheticPlannerJobs({
        methods: ["method_new_current_planner_choice", "method_alt_candidate"],
      }),
    },
  );
  assert.equal(slice.refill.blockedCount, 0, "stale prior-method snapshot must be dropped");
  assert.equal(slice.refill.blockers.length, 0);
  assert.equal(slice.refill.staleSnapshotMethodCount, 0);
  assert.equal(slice.refill.currentMethodBlockedCount, 0);
});

test("supersession keeps entry when only selectedExecutionMethod is present (no method reassignment signal)", () => {
  const slice = buildAllChainAutopilotDashboardSlice(
    syntheticAutopilotReport({
      refillExecutions: [
        {
          jobId: "shared-id-0",
          selectedExecutionMethod: "method_obsolete",
          executionBlockedReason: "synthetic_blocker_reason",
        },
      ],
    }),
    {
      capitalManagerRefillJobsLatest: syntheticPlannerJobs({
        methods: ["method_fresh_one", "method_fresh_two"],
        jobIdPrefix: "shared-id",
      }),
    },
  );
  assert.equal(slice.refill.blockedCount, 1);
  assert.equal(slice.refill.blockers[0].stalePlannerMethod, true);
});

test("supersession keeps entry when current executionMethod is not in planner candidate set", () => {
  // Use matching jobId so the existing currentResSet jobId-based supersession does not fire.
  const slice = buildAllChainAutopilotDashboardSlice(
    syntheticAutopilotReport({
      refillExecutions: [
        {
          jobId: "shared-id-0",
          selectedExecutionMethod: "method_one",
          executionMethod: "method_two_not_in_planner",
          executionBlockedReason: "synthetic_blocker_reason",
        },
      ],
    }),
    {
      capitalManagerRefillJobsLatest: syntheticPlannerJobs({
        methods: ["method_three", "method_four"],
        jobIdPrefix: "shared-id",
      }),
    },
  );
  assert.equal(slice.refill.blockedCount, 1, "no proof of planner reassignment when current method also out-of-set");
});

test("supersession keeps entry when selectedExecutionMethod is also in planner candidate set (current-method collision)", () => {
  const slice = buildAllChainAutopilotDashboardSlice(
    syntheticAutopilotReport({
      refillExecutions: [
        {
          jobId: "shared-id-0",
          selectedExecutionMethod: "method_x",
          executionMethod: "method_y",
          executionBlockedReason: "synthetic_blocker_reason",
        },
      ],
    }),
    {
      capitalManagerRefillJobsLatest: syntheticPlannerJobs({
        methods: ["method_x", "method_y"],
        jobIdPrefix: "shared-id",
      }),
    },
  );
  assert.equal(slice.refill.blockedCount, 1);
  assert.equal(slice.refill.blockers[0].stalePlannerMethod, false);
});

test("supersession keeps entry when no planner data is available", () => {
  const slice = buildAllChainAutopilotDashboardSlice(
    syntheticAutopilotReport({
      refillExecutions: [
        {
          jobId: "no-planner-job",
          selectedExecutionMethod: "method_prior",
          executionMethod: "method_current",
          executionBlockedReason: "synthetic_blocker_reason",
        },
      ],
    }),
    { capitalManagerRefillJobsLatest: null },
  );
  assert.equal(slice.refill.blockedCount, 1);
  assert.equal(slice.refill.blockers[0].stalePlannerMethod, null);
});

test("supersession keeps entry when planner has jobs only for an unrelated (chain, asset) resource", () => {
  const slice = buildAllChainAutopilotDashboardSlice(
    syntheticAutopilotReport({
      chain: "synth_chain_alpha",
      asset: "SYNTH_ASSET_A",
      refillExecutions: [
        {
          jobId: "unrelated-resource-job",
          selectedExecutionMethod: "method_prior",
          executionMethod: "method_current",
          executionBlockedReason: "synthetic_blocker_reason",
        },
      ],
    }),
    {
      capitalManagerRefillJobsLatest: syntheticPlannerJobs({
        methods: ["method_current"],
        chain: "synth_chain_beta",
        asset: "SYNTH_ASSET_B",
      }),
    },
  );
  assert.equal(slice.refill.blockedCount, 1, "resource mismatch must not trigger supersession");
});

test("supersession does not consult planner jobs that are not in a ready state", () => {
  const slice = buildAllChainAutopilotDashboardSlice(
    syntheticAutopilotReport({
      refillExecutions: [
        {
          jobId: "planner-blocked",
          selectedExecutionMethod: "method_old",
          executionMethod: "method_pending",
          executionBlockedReason: "synthetic_blocker_reason",
        },
      ],
    }),
    {
      capitalManagerRefillJobsLatest: {
        jobs: {
          jobs: [
            {
              jobId: "planner-blocked",
              chain: "synth_chain_alpha",
              asset: "SYNTH_ASSET_A",
              executionMethod: "method_pending",
              decision: "REFILL_REQUIRED",
              blocker: "some_planner_blocker",
              fundingSource: { method: "method_pending", selectionStatus: "ready" },
            },
          ],
        },
      },
    },
  );
  assert.equal(slice.refill.blockedCount, 1, "supersession requires a ready planner candidate");
});

test("supersession does not introduce sample-specific chain/asset/method branches", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/status/all-chain-autopilot-slice.mjs", import.meta.url), "utf8");
  const sampleLiterals = [
    "BTC",
    "wBTC.OFT",
    "Gateway",
    "Base",
    "bitcoin",
    "ethereum",
    "same_chain_native_to_token_swap",
    "cross_chain_bridge_or_swap",
    "cross_chain_swap_via_btc_intermediate",
  ];
  for (const literal of sampleLiterals) {
    assert.ok(
      !src.includes(`"${literal}"`),
      `producer should not branch on sample literal "${literal}" in production code`,
    );
  }
});
