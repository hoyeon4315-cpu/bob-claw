import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAdmissionRemediationExecutionSummary,
  executeAdmissionRemediationPlan,
} from "../src/prelive/admission-remediation.mjs";

test("admission remediation runner previews the top ready items without executing", async () => {
  const record = await executeAdmissionRemediationPlan({
    plan: {
      overallStatus: "ready",
      items: [
        {
          rank: 1,
          code: "refresh_gateway_quote",
          label: "refresh gateway quote",
          status: "ready",
          reason: "stale_gateway_quote",
          command: "npm run verify:gateway -- --route-key=base:0x0555->unichain:0x0555 --amounts=25000",
        },
        {
          rank: 2,
          code: "refresh_src_gas",
          label: "refresh source gas snapshot",
          status: "ready",
          reason: "stale_src_gas",
          command: "npm run gas:snapshot",
        },
      ],
    },
    limit: 1,
  });

  assert.equal(record.mode, "preview");
  assert.equal(record.selectedCount, 1);
  assert.equal(record.selectedItems[0].code, "refresh_gateway_quote");
  assert.equal(record.actionResults.length, 0);
});

test("admission remediation runner executes selected items and follow-up refreshes", async () => {
  const calls = [];
  const record = await executeAdmissionRemediationPlan({
    plan: {
      overallStatus: "ready",
      items: [
        {
          rank: 1,
          code: "refresh_gateway_quote",
          label: "refresh gateway quote",
          status: "ready",
          reason: "stale_gateway_quote",
          command: "npm run verify:gateway -- --route-key=base:0x0555->unichain:0x0555 --amounts=25000",
        },
        {
          rank: 2,
          code: "refresh_src_gas",
          label: "refresh source gas snapshot",
          status: "ready",
          reason: "stale_src_gas",
          command: "npm run gas:snapshot",
        },
      ],
    },
    execute: true,
    limit: 2,
    followUpCommands: ["npm run status:dashboard", "npm run write:session-handoff"],
    runCommand: async ({ step }) => {
      calls.push(step.script);
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 5,
        stdout: "ok",
        stderr: "",
      };
    },
  });

  assert.equal(record.executionStatus, "succeeded");
  assert.equal(record.actionResults.length, 2);
  assert.equal(record.followUps.length, 2);
  assert.deepEqual(calls, ["verify:gateway", "gas:snapshot", "status:dashboard", "write:session-handoff"]);
});

test("admission remediation runner returns awaiting-policy-review when no ready items can run", async () => {
  const record = await executeAdmissionRemediationPlan({
    plan: {
      overallStatus: "awaiting_policy_review",
      items: [
        {
          rank: 1,
          code: "reconcile_fork_cycle",
          label: "reconcile fork cycle",
          status: "policy_review",
          reason: "fork_output_resolution_required",
          command: 'npm run reconcile:prelive-fork-execution -- --plan-id="plan-1" --tx-hash="<txHash>" --rpc-url="<forkRpcUrl>" --actual-output-units="<actualOutputUnits>"',
        },
      ],
    },
    execute: true,
  });

  assert.equal(record.executionStatus, "awaiting_policy_review");
  assert.equal(record.stopReason, "fork_output_resolution_required");
  assert.equal(record.actionResults.length, 0);
});

test("admission remediation execution summary aggregates preview and execute runs", () => {
  const summary = buildAdmissionRemediationExecutionSummary([
    {
      observedAt: "2026-04-12T12:00:00.000Z",
      runId: "r1",
      mode: "execute",
      finalStatus: "succeeded",
      selectedCount: 2,
      actionResults: [{ code: "refresh_gateway_quote" }],
      followUps: [{ command: "npm run status:dashboard" }],
      finalPlan: {
        nextAction: { code: "refresh_exact_gas" },
      },
    },
    {
      observedAt: "2026-04-12T12:01:00.000Z",
      runId: "r2",
      mode: "execute",
      finalStatus: "awaiting_policy_review",
      stopReason: "fork_output_resolution_required",
      selectedCount: 0,
      actionResults: [],
      followUps: [],
      finalPlan: {
        nextAction: { code: "reconcile_fork_cycle" },
      },
    },
    {
      observedAt: "2026-04-12T12:02:00.000Z",
      runId: "r3",
      mode: "preview",
      finalStatus: "preview",
      selectedCount: 1,
      actionResults: [],
      followUps: [],
      planSnapshot: {
        nextAction: { code: "refresh_gateway_quote" },
      },
    },
  ]);

  assert.equal(summary.runCount, 2);
  assert.equal(summary.previewCount, 1);
  assert.equal(summary.successCount, 1);
  assert.equal(summary.awaitingPolicyReviewCount, 1);
  assert.equal(summary.latestStatus, "preview");
  assert.equal(summary.nextAction.code, "refresh_gateway_quote");
});
