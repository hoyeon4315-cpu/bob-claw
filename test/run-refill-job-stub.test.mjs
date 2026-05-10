import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExecutionGateBlockedEvent,
  ensureExecutionGuardsAllow,
} from "../src/cli/run-refill-job-stub.mjs";

test("refill job stub skips execution guards in preview mode", async () => {
  let called = false;
  const guards = await ensureExecutionGuardsAllow({
    execute: false,
    mode: "dry_run",
    readExecutionGuardsImpl: async () => {
      called = true;
      return { blocked: true, reasons: ["kill_switch_active"] };
    },
  });

  assert.equal(called, false);
  assert.deepEqual(guards, { blocked: false, reasons: [] });
});

test("refill job stub still enforces execution guards in execute mode", async () => {
  let called = false;
  const guards = await ensureExecutionGuardsAllow({
    execute: true,
    mode: "execute",
    readExecutionGuardsImpl: async (args) => {
      called = true;
      assert.equal(args.mode, "execute");
      return { blocked: true, reasons: ["kill_switch_active"] };
    },
  });

  assert.equal(called, true);
  assert.deepEqual(guards, { blocked: true, reasons: ["kill_switch_active"] });
});

test("refill job stub reports prior failed jobs as structured blockers", () => {
  const event = buildExecutionGateBlockedEvent({
    job: {
      jobId: "job-1",
      chain: "base",
      type: "refill_token",
      asset: "wBTC.OFT",
      token: "0x0555",
      targetAmount: "100",
      targetAmountDecimal: 0.000001,
      executionMethod: "cross_chain_swap_via_btc_intermediate",
      requiresManualReview: false,
      reviewReasons: [],
      constraints: {},
      fundingSource: { selectionStatus: "ready" },
    },
    mode: "live",
    executionGate: {
      ok: false,
      reason: "job_already_failed",
      latest: {
        status: "failed",
        observedAt: "2026-05-10T01:00:00.000Z",
      },
    },
  });

  assert.equal(event.status, "blocked");
  assert.deepEqual(event.blockers, ["job_already_failed"]);
  assert.equal(event.previousExecutionStatus, "failed");
  assert.equal(event.previousExecutionObservedAt, "2026-05-10T01:00:00.000Z");
});
