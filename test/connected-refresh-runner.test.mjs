import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildConnectedRefreshExecutionSummary,
  executeConnectedRefreshPackage,
} from "../src/prelive/connected-refresh-runner.mjs";

test("connected refresh runner previews selected refreshes and defers reevaluation on partial limit", async () => {
  const record = await executeConnectedRefreshPackage({
    refreshPackage: {
      status: "network_refresh_required",
      requiredRefreshes: [
        {
          id: "refresh_gateway_quote",
          sequence: 1,
          key: "gateway_quote",
          label: "refresh gateway quote",
          reason: "stale_gateway_quote",
          command: "npm run verify:gateway -- --route-key=base:0x0555->bob:0x0555 --amounts=10000",
        },
        {
          id: "refresh_src_gas",
          sequence: 2,
          key: "src_gas",
          label: "refresh source gas",
          reason: "stale_src_gas",
          command: "npm run gas:snapshot",
        },
      ],
      reevaluationSteps: [
        {
          id: "advance_canary",
          sequence: 1,
          label: "advance canary review",
          command: "npm run advance:canary",
        },
      ],
    },
    limit: 1,
  });

  assert.equal(record.mode, "preview");
  assert.equal(record.selectedRefreshCount, 1);
  assert.equal(record.selectedReevaluationCount, 0);
  assert.equal(record.stopReason, "remaining_refresh_steps_before_reevaluation");
});

test("connected refresh runner executes refreshes, reevaluation, and follow-up dashboard update", async () => {
  const calls = [];
  const record = await executeConnectedRefreshPackage({
    refreshPackage: {
      status: "network_refresh_required",
      requiredRefreshes: [
        {
          id: "refresh_gateway_quote",
          sequence: 1,
          key: "gateway_quote",
          label: "refresh gateway quote",
          reason: "stale_gateway_quote",
          command: "npm run verify:gateway -- --route-key=base:0x0555->bob:0x0555 --amounts=10000",
        },
        {
          id: "refresh_src_gas",
          sequence: 2,
          key: "src_gas",
          label: "refresh source gas",
          reason: "stale_src_gas",
          command: "npm run gas:snapshot",
        },
      ],
      reevaluationSteps: [
        {
          id: "advance_canary",
          sequence: 1,
          type: "reevaluate",
          label: "advance canary review",
          command: "npm run advance:canary",
        },
        {
          id: "rebuild_review_package",
          sequence: 2,
          type: "reevaluate",
          label: "rebuild review package",
          command: "npm run build:prelive-review-package -- --write && npm run validate:prelive-readiness -- --write && npm run write:session-handoff",
        },
      ],
    },
    execute: true,
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
  assert.equal(record.refreshResults.length, 2);
  assert.equal(record.reevaluationResults.length, 2);
  assert.equal(record.followUps.length, 1);
  assert.deepEqual(calls, [
    "verify:gateway",
    "gas:snapshot",
    "advance:canary",
    "build:prelive-review-package",
    "validate:prelive-readiness",
    "write:session-handoff",
    "status:dashboard",
  ]);
});

test("connected refresh execution summary aggregates preview and execute runs", () => {
  const summary = buildConnectedRefreshExecutionSummary([
    {
      observedAt: "2026-04-14T06:00:00.000Z",
      mode: "execute",
      executionStatus: "succeeded",
      selectedRefreshCount: 2,
      selectedReevaluationCount: 2,
      finalPackage: {
        summary: {
          requiredRefreshCount: 0,
        },
        nextAction: {
          code: "advance_canary",
        },
      },
    },
    {
      observedAt: "2026-04-14T06:01:00.000Z",
      mode: "preview",
      executionStatus: "preview",
      selectedRefreshCount: 1,
      selectedReevaluationCount: 0,
      packageSnapshot: {
        nextAction: {
          code: "refresh_gateway_quote",
        },
      },
    },
  ]);

  assert.equal(summary.runCount, 1);
  assert.equal(summary.previewCount, 1);
  assert.equal(summary.successCount, 1);
  assert.equal(summary.latestStatus, "preview");
  assert.equal(summary.nextAction.code, "refresh_gateway_quote");
});
